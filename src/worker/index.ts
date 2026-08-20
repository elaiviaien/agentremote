import WebSocket from 'ws';
import os from 'os';
import dotenv from 'dotenv';
import { DeviceInfo, HubToWorkerMessage, WorkerToHubMessage } from '../shared/types';
import { detectCursorTools, checkCursorAuthStatus, getAgentLimitsInfo } from './cursorDetector';
import { AgentRunner } from './agentRunner';
import { TerminalRunner } from './terminalRunner';
import { FsBridge } from './fsBridge';
import { TranscriptScanner } from './transcriptScanner';
import { TranscriptWatcher } from './transcriptWatcher';

dotenv.config();

const WORKER_TOKEN = process.env.WORKER_TOKEN || process.env.MASTER_WORKER_KEY || 'agentremote-worker-secret-key-2026';
const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname() || 'My-Device';
const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE || process.cwd();
const DEVICE_ID = `dev-${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '-')}-${os.userInfo().username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

function parseHubUrls(): string[] {
  const listed = (process.env.HUB_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (listed.length > 0) return [...new Set(listed)];

  const urls = [
    process.env.HUB_URL || 'http://127.0.0.1:3000',
    process.env.REMOTE_HUB_URL || 'https://agentremote-production.up.railway.app',
  ].filter(Boolean);
  return [...new Set(urls)];
}

function toWorkerWsUrl(hubUrl: string): string {
  const base = hubUrl
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
    .replace(/^ws:\/\//, 'ws://')
    .replace(/^wss:\/\//, 'wss://');
  const clean = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${clean}/ws/worker?token=${encodeURIComponent(WORKER_TOKEN)}`;
}

type SendFn = (msg: WorkerToHubMessage) => void;

class HubLink {
  public ws: WebSocket | null = null;
  private reconnecting = false;
  private attempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private sessionCloseTimer: NodeJS.Timeout | null = null;
  private intentionalStop = false;

  constructor(
    public readonly hubUrl: string,
    private readonly onMessage: (msg: HubToWorkerMessage, send: SendFn) => void,
    private readonly onCloseSessions: (send: SendFn) => void,
    private readonly buildDeviceInfo: () => DeviceInfo
  ) {}

  public start() {
    this.intentionalStop = false;
    this.connect();
  }

  public stop() {
    this.intentionalStop = true;
    this.reconnecting = true;
    this.stopHeartbeat();
    this.clearSessionCloseTimer();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  public send: SendFn = (msg) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  };

  private connect() {
    if (this.intentionalStop) return;
    const wsUrl = toWorkerWsUrl(this.hubUrl);
    console.log(`[Worker] Connecting to ${this.hubUrl} (${wsUrl.replace(WORKER_TOKEN, '***')})`);

    // Drop previous socket listeners cleanly before opening a new one
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(wsUrl, {
        handshakeTimeout: 20000,
        perMessageDeflate: false,
      });
      const socket = this.ws;

      socket.on('open', () => {
        if (this.ws !== socket) return;
        console.log(`[Worker] Connected to ${this.hubUrl}`);
        this.reconnecting = false;
        this.attempts = 0;
        this.clearSessionCloseTimer();
        this.send({ type: 'worker:register', payload: this.buildDeviceInfo() });
        this.startHeartbeat();
      });
      socket.on('message', (data: WebSocket.Data) => {
        if (this.ws !== socket) return;
        try {
          const msg = JSON.parse(data.toString()) as HubToWorkerMessage;
          this.onMessage(msg, this.send);
        } catch (err) {
          console.error(`[Worker] Parse message error (${this.hubUrl}):`, err);
        }
      });
      socket.on('pong', () => {
        /* Railway / proxy keepalive */
      });
      socket.on('close', (code, reason) => {
        if (this.ws !== socket) return; // superseded by a newer connection attempt
        console.warn(`[Worker] Disconnected from ${this.hubUrl} (code: ${code}, reason: ${reason || 'none'})`);
        this.stopHeartbeat();
        this.ws = null;
        // Don't abort sessions on brief blips — wait for reconnect grace period
        this.scheduleSessionFailIfStillDown();
        if (!this.intentionalStop) this.scheduleReconnect();
      });
      socket.on('error', (err) => {
        console.error(`[Worker] WebSocket error (${this.hubUrl}):`, err.message);
      });
    } catch (err: any) {
      console.error(`[Worker] Connection setup failed (${this.hubUrl}):`, err.message);
      if (!this.intentionalStop) this.scheduleReconnect();
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    // App-level heartbeat for DeviceManager lastPing
    this.heartbeatTimer = setInterval(() => {
      const totalMem = Math.round(os.totalmem() / 1024 / 1024);
      const freeMem = Math.round(os.freemem() / 1024 / 1024);
      this.send({
        type: 'worker:heartbeat',
        payload: {
          deviceId: DEVICE_ID,
          memoryUsage: { total: totalMem, free: freeMem, used: totalMem - freeMem },
        },
      });
    }, 8000);

    // Protocol-level ping keeps Railway/load-balancer idle timeouts from killing the socket
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearSessionCloseTimer() {
    if (this.sessionCloseTimer) {
      clearTimeout(this.sessionCloseTimer);
      this.sessionCloseTimer = null;
    }
  }

  private scheduleSessionFailIfStillDown() {
    this.clearSessionCloseTimer();
    this.sessionCloseTimer = setTimeout(() => {
      this.sessionCloseTimer = null;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      this.onCloseSessions(this.send);
    }, 20000);
  }

  private scheduleReconnect() {
    if (this.reconnecting || this.intentionalStop) return;
    this.reconnecting = true;
    this.attempts++;
    // Fast first retries so the Railway UI barely sees offline
    const delay =
      this.attempts === 1
        ? 400
        : this.attempts === 2
          ? 1000
          : Math.min(1000 * Math.pow(1.5, this.attempts - 1), 12000);
    console.log(`[Worker] Reconnecting to ${this.hubUrl} in ${(delay / 1000).toFixed(1)}s`);
    setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, delay);
  }
}

class WorkerDaemon {
  private tools = detectCursorTools();
  private agentRunner = new AgentRunner(this.tools);
  private terminalRunner = new TerminalRunner();
  private links: HubLink[] = [];
  private sessionSenders = new Map<string, SendFn>();
  private transcriptWatcher = new TranscriptWatcher((payload) => {
    this.broadcast({
      type: 'sessions:sync_update',
      payload: {
        sessionId: payload.sessionId,
        sourceSessionId: payload.sourceSessionId,
        sourceFilePath: payload.sourceFilePath,
        messages: payload.messages.map((m, idx) => ({
          id: `ext_${payload.sourceSessionId || 'msg'}_${idx}_${m.timestamp || Date.now()}`,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || Date.now(),
        })),
        title: payload.title,
      },
    });
  });

  constructor() {
    const hubs = parseHubUrls();
    console.log(`\n======================================================`);
    console.log(`🤖 AgentRemote Local Daemon Starting`);
    console.log(`💻 Device: ${DEVICE_NAME} (${DEVICE_ID})`);
    console.log(`📂 Default Workspace: ${DEFAULT_WORKSPACE}`);
    console.log(`🔎 Cursor Agent CLI: ${this.tools.cursorAgentCmd || 'NOT FOUND'}`);
    console.log(`🔎 Antigravity: ${this.tools.antigravityAvailable ? 'Detected' : 'Not detected'}`);
    console.log(`☁️ Hub URLs: ${hubs.join(', ')}`);
    console.log(`======================================================\n`);
  }

  public start() {
    this.transcriptWatcher.start(3500);
    for (const url of parseHubUrls()) {
      const link = new HubLink(
        url,
        (msg, send) => this.handleHubMessage(msg, send),
        (send) => this.finishSessionsForSender(send, 'Hub connection lost'),
        () => this.buildDeviceInfo()
      );
      this.links.push(link);
      link.start();
    }
  }

  public shutdown() {
    console.log('[Worker] Shutting down, aborting active agent runs...');
    this.agentRunner.abortAll();
    this.transcriptWatcher.stop();
    for (const link of this.links) link.stop();
  }

  private broadcast(msg: WorkerToHubMessage) {
    for (const link of this.links) link.send(msg);
  }

  private buildDeviceInfo(): DeviceInfo {
    this.tools = detectCursorTools();
    this.agentRunner.updateTools(this.tools);
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    return {
      id: DEVICE_ID,
      name: DEVICE_NAME,
      token: WORKER_TOKEN,
      status: 'online',
      os: `${os.type()} ${os.release()}`,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      defaultWorkspace: DEFAULT_WORKSPACE,
      cursorCliPath: this.tools.cursorAgentCmd,
      cursorAuthStatus: checkCursorAuthStatus(this.tools),
      limitsInfo: getAgentLimitsInfo(this.tools),
      antigravityAvailable: this.tools.antigravityAvailable,
      lastSeen: Date.now(),
      memoryUsage: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
      },
    };
  }

  private finishSessionsForSender(send: SendFn, reason: string) {
    const owned = [...this.sessionSenders.entries()].filter(([, s]) => s === send).map(([id]) => id);
    for (const sessionId of owned) {
      send({
        type: 'agent:complete',
        payload: { sessionId, fullContent: '', success: false, aborted: true, error: reason },
      });
      this.agentRunner.abort(sessionId);
      this.sessionSenders.delete(sessionId);
    }
  }

  private handleHubMessage(msg: HubToWorkerMessage, send: SendFn) {
    switch (msg.type) {
      case 'agent:start': {
        const { sessionId, workspacePath } = msg.payload;
        const targetWs = workspacePath || DEFAULT_WORKSPACE;
        this.sessionSenders.set(sessionId, send);

        this.agentRunner.run(
          { ...msg.payload, workspacePath: targetWs },
          {
            onChunk: (chunk, delta) => send({ type: 'agent:chunk', payload: { sessionId, chunk, delta } }),
            onThinking: (thinking, delta) => send({ type: 'agent:thinking', payload: { sessionId, thinking, delta } }),
            onToolCall: (toolCall) => send({ type: 'agent:tool_call', payload: { sessionId, toolCall } }),
            onToolResult: (toolCallId, result, status) =>
              send({ type: 'agent:tool_result', payload: { sessionId, toolCallId, result, status } }),
            onComplete: (fullContent, cursorChatId, success = true, error) => {
              send({ type: 'agent:complete', payload: { sessionId, fullContent, cursorChatId, success, error } });
              this.sessionSenders.delete(sessionId);
            },
            onError: (error) => send({ type: 'agent:error', payload: { sessionId, error } }),
          }
        );
        break;
      }

      case 'agent:abort': {
        this.agentRunner.abort(msg.payload.sessionId);
        send({
          type: 'agent:complete',
          payload: { sessionId: msg.payload.sessionId, fullContent: '', success: false, aborted: true },
        });
        this.sessionSenders.delete(msg.payload.sessionId);
        break;
      }

      case 'agent:trigger_auth': {
        this.agentRunner.triggerAuth(
          (url) => send({ type: 'agent:auth_url', payload: { deviceId: DEVICE_ID, url } }),
          (success) => {
            if (success) send({ type: 'agent:auth_success', payload: { deviceId: DEVICE_ID } });
          }
        );
        break;
      }

      case 'terminal:run': {
        const { commandId, command, cwd } = msg.payload;
        this.terminalRunner.run(commandId, command, cwd || DEFAULT_WORKSPACE, {
          onOutput: (data, isError) => send({ type: 'terminal:output', payload: { commandId, data, isError } }),
          onExit: (code) => send({ type: 'terminal:exit', payload: { commandId, code } }),
        });
        break;
      }

      case 'terminal:kill': {
        this.terminalRunner.kill(msg.payload.commandId);
        break;
      }

      case 'fs:get_tree': {
        const { reqId, path: searchPath, maxDepth } = msg.payload;
        const res = FsBridge.getTree(searchPath || DEFAULT_WORKSPACE, maxDepth || 2);
        send({ type: 'fs:tree_result', payload: { reqId, tree: res.tree, rootPath: res.rootPath } });
        break;
      }

      case 'fs:read_file': {
        const { reqId, path: filePath } = msg.payload;
        const res = FsBridge.readFile(filePath);
        send({ type: 'fs:file_result', payload: { reqId, path: filePath, content: res.content, error: res.error } as any });
        break;
      }

      case 'fs:write_file': {
        const { reqId, path: filePath, content } = msg.payload;
        const res = FsBridge.writeFile(filePath, content);
        send({ type: 'fs:write_result', payload: { reqId, success: res.success, error: res.error } });
        break;
      }

      case 'transcripts:list_local': {
        const { reqId } = msg.payload as any;
        send({ type: 'transcripts:list_result', payload: { reqId, transcripts: TranscriptScanner.scanAllLocalTranscripts() } });
        break;
      }

      case 'transcripts:read_local' as any: {
        const { reqId, filePath } = msg.payload as any;
        send({
          type: 'transcripts:read_result' as any,
          payload: { reqId, result: TranscriptScanner.readAndSanitizeLocalTranscript(filePath) },
        });
        break;
      }

      case 'sessions:force_sync': {
        const { sessionId, sourceSessionId, sourceFilePath } = (msg as any).payload;
        this.transcriptWatcher.forceSync(sourceSessionId, sourceFilePath, sessionId);
        break;
      }
    }
  }
}

const daemon = new WorkerDaemon();
daemon.start();

const stop = () => {
  daemon.shutdown();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);
