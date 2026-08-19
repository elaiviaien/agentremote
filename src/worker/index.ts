import WebSocket from 'ws';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import { DeviceInfo, HubToWorkerMessage, WorkerToHubMessage } from '../shared/types';
import { detectCursorTools, checkCursorAuthStatus, getAgentLimitsInfo } from './cursorDetector';
import { AgentRunner } from './agentRunner';
import { TerminalRunner } from './terminalRunner';
import { FsBridge } from './fsBridge';
import { TranscriptScanner } from './transcriptScanner';
import { TranscriptWatcher } from './transcriptWatcher';

dotenv.config();

const HUB_URL = process.env.HUB_URL || 'http://localhost:3000';
const WORKER_TOKEN = process.env.WORKER_TOKEN || process.env.MASTER_WORKER_KEY || 'agentremote-worker-secret-key-2026';
const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname() || 'My-Device';
const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE || process.cwd();

// Generate a deterministic or stable device ID based on hostname and user
const DEVICE_ID = `dev-${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '-')}-${os.userInfo().username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

class WorkerDaemon {
  private ws: WebSocket | null = null;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private tools = detectCursorTools();
  private agentRunner = new AgentRunner(this.tools);
  private terminalRunner = new TerminalRunner();
  private transcriptWatcher = new TranscriptWatcher((payload) => {
    this.send({
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
    console.log(`\n======================================================`);
    console.log(`🤖 AgentRemote Local Daemon Starting`);
    console.log(`💻 Device: ${DEVICE_NAME} (${DEVICE_ID})`);
    console.log(`📂 Default Workspace: ${DEFAULT_WORKSPACE}`);
    console.log(`🔎 Cursor Agent CLI: ${this.tools.cursorAgentCmd || 'NOT FOUND'}`);
    console.log(`🔎 Antigravity: ${this.tools.antigravityAvailable ? 'Detected' : 'Not detected'}`);
    console.log(`☁️ Hub URL: ${HUB_URL}`);
    console.log(`======================================================\n`);
  }

  public start() {
    this.connect();
  }

  private getWsUrl(): string {
    const isSsl = HUB_URL.startsWith('https://') || HUB_URL.startsWith('wss://');
    const base = HUB_URL.replace(/^http:\/\//, 'ws://')
                        .replace(/^https:\/\//, 'wss://')
                        .replace(/^ws:\/\//, 'ws://')
                        .replace(/^wss:\/\//, 'wss://');
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${cleanBase}/ws/worker?token=${encodeURIComponent(WORKER_TOKEN)}`;
  }

  private connect() {
    const wsUrl = this.getWsUrl();
    console.log(`[Worker] Connecting to Cloud Hub: ${wsUrl.replace(WORKER_TOKEN, '***')}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log(`✅ [Worker] Connected to Cloud Hub!`);
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.register();
        this.startHeartbeat();
        this.transcriptWatcher.start(3500);
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as HubToWorkerMessage;
          this.handleHubMessage(msg);
        } catch (err) {
          console.error('[Worker] Parse message error:', err);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.warn(`⚠️ [Worker] Disconnected from Cloud Hub (code: ${code}, reason: ${reason || 'none'})`);
        this.stopHeartbeat();
        this.transcriptWatcher.stop();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error(`❌ [Worker] WebSocket error:`, err.message);
      });
    } catch (err: any) {
      console.error(`❌ [Worker] Connection setup failed:`, err.message);
      this.scheduleReconnect();
    }
  }

  private register() {
    // Refresh tools in case Cursor was just updated/opened
    this.tools = detectCursorTools();
    this.agentRunner.updateTools(this.tools);

    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    const authStatus = checkCursorAuthStatus(this.tools);
    const limitsInfo = getAgentLimitsInfo(this.tools);

    const deviceInfo: DeviceInfo = {
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
      cursorAuthStatus: authStatus,
      limitsInfo,
      antigravityAvailable: this.tools.antigravityAvailable,
      lastSeen: Date.now(),
      memoryUsage: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
      },
    };

    this.send({
      type: 'worker:register',
      payload: deviceInfo,
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
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
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
    console.log(`[Worker] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => {
      this.isReconnecting = false;
      this.connect();
    }, delay);
  }

  private send(msg: WorkerToHubMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleHubMessage(msg: HubToWorkerMessage) {
    switch (msg.type) {
      case 'agent:start': {
        const { sessionId, workspacePath } = msg.payload;
        const targetWs = workspacePath || DEFAULT_WORKSPACE;

        this.agentRunner.run(
          { ...msg.payload, workspacePath: targetWs },
          {
            onChunk: (chunk, delta) => {
              this.send({
                type: 'agent:chunk',
                payload: { sessionId, chunk, delta },
              });
            },
            onThinking: (thinking, delta) => {
              this.send({
                type: 'agent:thinking',
                payload: { sessionId, thinking, delta },
              });
            },
            onToolCall: (toolCall) => {
              this.send({
                type: 'agent:tool_call',
                payload: { sessionId, toolCall },
              });
            },
            onToolResult: (toolCallId, result, status) => {
              this.send({
                type: 'agent:tool_result',
                payload: { sessionId, toolCallId, result, status },
              });
            },
            onComplete: (fullContent, cursorChatId, success = true, error) => {
              this.send({
                type: 'agent:complete',
                payload: { sessionId, fullContent, cursorChatId, success, error },
              });
            },
            onError: (error) => {
              this.send({
                type: 'agent:error',
                payload: { sessionId, error },
              });
            },
          }
        );
        break;
      }

      case 'agent:abort': {
        this.agentRunner.abort(msg.payload.sessionId);
        this.send({
          type: 'agent:complete',
          payload: {
            sessionId: msg.payload.sessionId,
            fullContent: '',
            success: false,
            aborted: true,
          },
        });
        break;
      }

      case 'agent:trigger_auth': {
        this.agentRunner.triggerAuth(
          (url) => {
            this.send({
              type: 'agent:auth_url',
              payload: { deviceId: DEVICE_ID, url },
            });
          },
          (success) => {
            if (success) {
              this.send({
                type: 'agent:auth_success',
                payload: { deviceId: DEVICE_ID },
              });
            }
          }
        );
        break;
      }

      case 'terminal:run': {
        const { commandId, command, cwd } = msg.payload;
        this.terminalRunner.run(commandId, command, cwd || DEFAULT_WORKSPACE, {
          onOutput: (data, isError) => {
            this.send({
              type: 'terminal:output',
              payload: { commandId, data, isError },
            });
          },
          onExit: (code) => {
            this.send({
              type: 'terminal:exit',
              payload: { commandId, code },
            });
          },
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
        this.send({
          type: 'fs:tree_result',
          payload: { reqId, tree: res.tree, rootPath: res.rootPath },
        });
        break;
      }

      case 'fs:read_file': {
        const { reqId, path: filePath } = msg.payload;
        const res = FsBridge.readFile(filePath);
        this.send({
          type: 'fs:file_result',
          payload: { reqId, path: filePath, content: res.content, error: res.error } as any,
        });
        break;
      }

      case 'fs:write_file': {
        const { reqId, path: filePath, content } = msg.payload;
        const res = FsBridge.writeFile(filePath, content);
        this.send({
          type: 'fs:write_result',
          payload: { reqId, success: res.success, error: res.error },
        });
        break;
      }

      case 'transcripts:list_local': {
        const { reqId } = msg.payload as any;
        const transcripts = TranscriptScanner.scanAllLocalTranscripts();
        this.send({
          type: 'transcripts:list_result',
          payload: { reqId, transcripts },
        });
        break;
      }

      case 'transcripts:read_local' as any: {
        const { reqId, filePath } = msg.payload as any;
        const result = TranscriptScanner.readAndSanitizeLocalTranscript(filePath);
        this.send({
          type: 'transcripts:read_result' as any,
          payload: { reqId, result },
        });
        break;
      }

      case 'sessions:force_sync': {
        const { reqId, sessionId, sourceSessionId, sourceFilePath } = (msg as any).payload;
        this.transcriptWatcher.forceSync(sourceSessionId, sourceFilePath, sessionId);
        break;
      }
    }
  }
}

const daemon = new WorkerDaemon();
daemon.start();
