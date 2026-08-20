import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { ClientToHubMessage, HubToClientMessage } from '../../shared/types';
import { isGeminiModelId, isUsageLimitError } from '../../shared/modelRouting';
import { verifyToken } from '../auth';
import { deviceManager } from '../deviceManager';
import { sessionManager } from '../sessionManager';

export class ClientWsManager {
  private connectedClients = new Set<WebSocket>();
  private hubStatusTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.hubStatusTimer = setInterval(() => {
      if (this.connectedClients.size === 0) return;
      const mem = process.memoryUsage();
      this.broadcast({
        type: 'hub:status',
        payload: {
          uptime: Math.round(process.uptime()),
          ramMb: Math.round(mem.rss / (1024 * 1024)),
          activeSessions: sessionManager.getSessions().length,
          onlineDevices: deviceManager.getOnlineDevicesCount(),
        },
      });
    }, 5000);
  }

  public handleConnection(socket: WebSocket) {
    this.connectedClients.add(socket);

    socket.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as ClientToHubMessage;
        this.processClientMessage(socket, msg);
      } catch (err) {
        console.error('[ClientWS] Parse error:', err);
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message payload' }));
      }
    });

    socket.on('close', () => {
      this.connectedClients.delete(socket);
    });

    // Send initial state
    const devices = deviceManager.getDevices();
    const activeDeviceId = deviceManager.getActiveDeviceId() || (devices[0] ? devices[0].id : undefined);
    const sessions = sessionManager.getSessions();
    const projects = sessionManager.getProjects();

    this.send(socket, {
      type: 'state:init',
      payload: {
        devices,
        activeDeviceId,
        sessions,
        activeSessionId: sessions[0] ? sessions[0].id : undefined,
        projects,
      },
    });
  }

  private processClientMessage(socket: WebSocket, msg: ClientToHubMessage) {
    switch (msg.type) {
      case 'device:select': {
        deviceManager.setActiveDeviceId(msg.deviceId);
        this.broadcast({
          type: 'device:updated',
          payload: deviceManager.getDevice(msg.deviceId)!,
        });
        break;
      }

      case 'cursor:auth_start' as any:
      case 'agent:trigger_auth': {
        const targetDev = (msg as any).payload?.deviceId || (msg as any).deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.sendToWorker(targetDev, {
            type: 'agent:trigger_auth',
            payload: { deviceId: targetDev },
          });
        }
        break;
      }

      case 'agent:run' as any:
      case 'agent:prompt': {
        const { sessionId, deviceId, prompt, model, mode, workspacePath, cursorChatId, continueLastSession, thinkingEffort, engine: payloadEngine } = (msg as any).payload;
        
        let session = sessionManager.getSession(sessionId);
        if (!session) {
          session = sessionManager.createSession({
            deviceId,
            workspacePath,
            model,
            mode,
            cursorChatId,
            thinkingEffort,
            engine: payloadEngine || (isGeminiModelId(model) ? 'antigravity' : 'cursor'),
          });
        }

        const inferredEngine =
          payloadEngine ||
          session.engine ||
          (isGeminiModelId(model || session.model) ? 'antigravity' : 'cursor');
        const originalEngine = session.engine;
        if (session.engine !== inferredEngine) {
          session.engine = inferredEngine;
        }

        // Update session's active model / thinkingEffort if passed
        if (model && session.model !== model) {
          session.model = model;
        }
        if (thinkingEffort && session.thinkingEffort !== thinkingEffort) {
          session.thinkingEffort = thinkingEffort;
        }
        sessionManager.updateSession(session.id, {
          engine: session.engine,
          model: session.model,
          thinkingEffort: session.thinkingEffort,
        });

        // If session is ALREADY streaming or running, automatically enqueue to prevent duplicate runs
        if (session.isStreaming || session.status === 'running') {
          console.log(`[ClientWS] Session ${session.id} is already busy. Auto-queuing incoming prompt.`);
          const currentQueue = session.promptQueue || [];
          if (currentQueue.length === 0 || currentQueue[currentQueue.length - 1] !== prompt) {
            sessionManager.enqueuePrompt(session.id, prompt);
            this.broadcast({
              type: 'session:updated',
              payload: sessionManager.getSession(session.id)!,
            });
          }
          break;
        }

        // Set session status to running
        sessionManager.updateSession(session.id, {
          isStreaming: true,
          status: 'running',
          engine: session.engine,
          model: model || session.model,
          mode: mode || session.mode,
          thinkingEffort: thinkingEffort || session.thinkingEffort,
        });

        // Add user message to session
        sessionManager.addMessage(session.id, {
          role: 'user',
          content: prompt,
        });

        // Add placeholder streaming assistant message
        sessionManager.addMessage(session.id, {
          role: 'assistant',
          content: '',
          blocks: [],
          isStreaming: true,
          model: model || session.model,
        });

        // Broadcast session update to clients
        this.broadcast({
          type: 'session:updated',
          payload: sessionManager.getSession(session.id)!,
        });

        // Dispatch agent:start to worker
        const targetDeviceId =
          (deviceId && deviceManager.getDevice(deviceId)?.status === 'online' ? deviceId : undefined) ||
          (session.deviceId && deviceManager.getDevice(session.deviceId)?.status === 'online' ? session.deviceId : undefined) ||
          deviceManager.getActiveDeviceId();
        if (!targetDeviceId) {
          this.send(socket, { type: 'error', message: 'No target device available' });
          return;
        }

        const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant' && m.content);
        let resumeId = cursorChatId || session.cursorChatId;
        if (
          isUsageLimitError(lastAssistant?.content) ||
          (inferredEngine === 'antigravity' && originalEngine !== 'antigravity')
        ) {
          resumeId = undefined;
        }
        if (isUsageLimitError(lastAssistant?.content)) {
          sessionManager.updateSession(session.id, { cursorChatId: '' });
        }

        const sent = deviceManager.sendToWorker(targetDeviceId, {
          type: 'agent:start',
          payload: {
            sessionId: session.id,
            deviceId: targetDeviceId,
            engine: inferredEngine,
            prompt,
            model: model || session.model,
            mode: mode || session.mode,
            workspacePath: workspacePath || session.workspacePath,
            cursorChatId: resumeId,
            continueLastSession: resumeId ? continueLastSession : false,
            thinkingEffort: thinkingEffort || session.thinkingEffort || 'medium',
          },
        });

        if (!sent) {
          sessionManager.finalizeAssistantMessage(
            session.id,
            '⚠️ Error: Selected machine is currently offline or unreachable.'
          );
          sessionManager.updateSession(session.id, { isStreaming: false, status: 'idle' });
          this.broadcast({
            type: 'session:updated',
            payload: sessionManager.getSession(session.id)!,
          });
        }
        break;
      }

      case 'agent:abort': {
        const abortSessionId = (msg as any).payload?.sessionId || (msg as any).sessionId;
        const session = sessionManager.getSession(abortSessionId);
        if (session) {
          sessionManager.abortRun(session.id);
          const updated = sessionManager.getSession(session.id);
          this.broadcast({
            type: 'agent:complete',
            payload: { sessionId: session.id, success: false, aborted: true } as any,
          });
          if (updated) {
            this.broadcast({
              type: 'session:updated',
              payload: updated,
            });
          }
          deviceManager.sendToWorker(session.deviceId, {
            type: 'agent:abort',
            payload: { sessionId: session.id },
          });
        }
        break;
      }

      case 'agent:queue_prompt': {
        const { sessionId, prompt } = (msg as any).payload;
        if (sessionId && prompt) {
          sessionManager.enqueuePrompt(sessionId, prompt);
          const session = sessionManager.getSession(sessionId);
          if (session) {
            this.broadcast({
              type: 'session:updated',
              payload: session,
            });
          }
        }
        break;
      }

      case 'agent:remove_queued_prompt': {
        const { sessionId, index } = (msg as any).payload;
        if (sessionId !== undefined && index !== undefined) {
          sessionManager.removeQueuedPrompt(sessionId, index);
          const session = sessionManager.getSession(sessionId);
          if (session) {
            this.broadcast({
              type: 'session:updated',
              payload: session,
            });
          }
        }
        break;
      }

      case 'agent:update_queued_prompt':
      case 'agent:edit_queued_prompt': {
        const { sessionId, index, newPrompt, prompt } = (msg as any).payload;
        const text = newPrompt || prompt;
        if (sessionId !== undefined && index !== undefined && text) {
          sessionManager.updateQueuedPrompt(sessionId, index, text);
          const session = sessionManager.getSession(sessionId);
          if (session) {
            this.broadcast({
              type: 'session:updated',
              payload: session,
            });
          }
        }
        break;
      }

      case 'agent:clear_queue': {
        const { sessionId } = (msg as any).payload;
        if (sessionId) {
          sessionManager.clearQueue(sessionId);
          const session = sessionManager.getSession(sessionId);
          if (session) {
            this.broadcast({
              type: 'session:updated',
              payload: session,
            });
          }
        }
        break;
      }

      case 'sessions:force_sync': {
        const { sessionId } = (msg as any).payload;
        if (sessionId) {
          const session = sessionManager.getSession(sessionId);
          if (session) {
            const targetDeviceId = session.deviceId || deviceManager.getActiveDeviceId();
            if (targetDeviceId) {
              deviceManager.sendToWorker(targetDeviceId, {
                type: 'sessions:force_sync',
                payload: {
                  reqId: randomUUID(),
                  sessionId: session.id,
                  sourceSessionId: session.sourceSessionId,
                  sourceFilePath: session.sourceFilePath,
                  engine: session.engine,
                },
              });
            }
          }
        }
        break;
      }

      case 'terminal:exec': {
        const { commandId, deviceId, command, cwd } = msg.payload;
        const targetDev = deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.sendToWorker(targetDev, {
            type: 'terminal:run',
            payload: { commandId, command, cwd },
          });
        }
        break;
      }

      case 'fs:tree':
      case 'fs:list' as any: {
        const clientReqId = (msg as any).payload?.reqId || Math.random().toString(36).substring(2, 10);
        const searchPath = (msg as any).payload?.dirPath || (msg as any).payload?.path;
        const workspacePath = (msg as any).payload?.workspacePath || searchPath;
        const targetDev = (msg as any).payload?.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.registerPendingFsRequest(clientReqId, (result) => {
            const items = result.tree || result.items || [];
            const rootPath = result.rootPath || searchPath || '';
            // Send both type aliases for full client compatibility
            this.send(socket, {
              type: 'fs:tree_result' as any,
              payload: { reqId: clientReqId, items, tree: items, path: rootPath, rootPath, error: result.error },
            } as any);
            this.send(socket, {
              type: 'fs:tree',
              payload: { reqId: clientReqId, items, tree: items, path: rootPath, rootPath, error: result.error },
            } as any);
          });
          deviceManager.sendToWorker(targetDev, {
            type: 'fs:get_tree',
            payload: { reqId: clientReqId, path: searchPath, workspacePath },
          });
        } else {
          this.send(socket, {
            type: 'fs:tree_result' as any,
            payload: { reqId: clientReqId, items: [], path: searchPath, error: 'No active device connected' },
          } as any);
        }
        break;
      }

      case 'fs:read':
      case 'fs:read_file' as any: {
        const clientReqId = (msg as any).payload?.reqId || Math.random().toString(36).substring(2, 10);
        const filePath = (msg as any).payload?.filePath || (msg as any).payload?.path;
        const workspacePath = (msg as any).payload?.workspacePath;
        const targetDev = (msg as any).payload?.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.registerPendingFsRequest(clientReqId, (result) => {
            this.send(socket, {
              type: 'fs:file_result' as any,
              payload: { reqId: clientReqId, path: filePath, content: result.content, size: result.size, error: result.error },
            } as any);
            this.send(socket, {
              type: 'fs:file',
              payload: { reqId: clientReqId, path: filePath, content: result.content, size: result.size, error: result.error },
            } as any);
          });
          deviceManager.sendToWorker(targetDev, {
            type: 'fs:read_file',
            payload: { reqId: clientReqId, path: filePath, workspacePath },
          });
        } else {
          this.send(socket, {
            type: 'fs:file_result' as any,
            payload: { reqId: clientReqId, path: filePath, content: '', error: 'No active device connected' },
          } as any);
        }
        break;
      }

      case 'fs:write':
      case 'fs:write_file' as any: {
        const clientReqId = (msg as any).payload?.reqId || Math.random().toString(36).substring(2, 10);
        const filePath = (msg as any).payload?.filePath || (msg as any).payload?.path;
        const content = (msg as any).payload?.content;
        const workspacePath = (msg as any).payload?.workspacePath;
        const targetDev = (msg as any).payload?.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.registerPendingFsRequest(clientReqId, (result) => {
            this.send(socket, {
              type: 'fs:write_result' as any,
              payload: { reqId: clientReqId, success: result.success, error: result.error },
            } as any);
          });
          deviceManager.sendToWorker(targetDev, {
            type: 'fs:write_file',
            payload: { reqId: clientReqId, path: filePath, content, workspacePath },
          });
        }
        break;
      }

      case 'transcripts:list_local': {
        const targetDev = (msg as any).payload?.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.sendToWorker(targetDev, {
            type: 'transcripts:list_local',
            payload: { reqId: (msg as any).payload.reqId },
          });
        }
        break;
      }

      case 'transcripts:read_local': {
        const targetDev = (msg as any).payload?.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.sendToWorker(targetDev, {
            type: 'transcripts:read_local',
            payload: { reqId: (msg as any).payload.reqId, filePath: (msg as any).payload.filePath },
          });
        }
        break;
      }

      case 'session:pin': {
        const { sessionId, isPinned } = (msg as any).payload;
        const updated = sessionManager.updateSession(sessionId, { isPinned });
        if (updated) {
          this.broadcast({
            type: 'session:updated',
            payload: updated,
          });
        }
        break;
      }

      case 'session:move_project': {
        const { sessionId, projectId } = (msg as any).payload;
        const updated = sessionManager.setSessionProject(sessionId, projectId);
        if (updated) {
          this.broadcast({
            type: 'session:updated',
            payload: updated,
          });
        }
        break;
      }

      case 'project:create': {
        const payload = (msg as any).payload || {};
        const project = sessionManager.createProject(payload);
        this.broadcast({
          type: 'project:updated',
          payload: project,
        });
        break;
      }

      case 'project:update': {
        const { id, updates } = (msg as any).payload || {};
        if (id) {
          const project = sessionManager.updateProject(id, updates);
          if (project) {
            this.broadcast({
              type: 'project:updated',
              payload: project,
            });
          }
        }
        break;
      }

      case 'project:delete': {
        const { id } = (msg as any).payload || {};
        if (id) {
          const deleted = sessionManager.deleteProject(id);
          if (deleted) {
            this.broadcast({
              type: 'project:deleted',
              payload: { projectId: id },
            });
          }
        }
        break;
      }
    }
  }

  public broadcast(message: HubToClientMessage) {
    const payload = JSON.stringify(message);
    for (const client of this.connectedClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  public send(socket: WebSocket, message: HubToClientMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}

export const clientWsManager = new ClientWsManager();
