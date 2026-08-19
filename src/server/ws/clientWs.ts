import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { ClientToHubMessage, HubToClientMessage } from '../../shared/types';
import { verifyToken } from '../auth';
import { deviceManager } from '../deviceManager';
import { sessionManager } from '../sessionManager';

export class ClientWsManager {
  private connectedClients = new Set<WebSocket>();

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

    this.send(socket, {
      type: 'state:init',
      payload: {
        devices,
        activeDeviceId,
        sessions,
        activeSessionId: sessions[0] ? sessions[0].id : undefined,
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
        const { sessionId, deviceId, prompt, model, mode, workspacePath, cursorChatId, continueLastSession, thinkingEffort } = (msg as any).payload;
        
        let session = sessionManager.getSession(sessionId);
        if (!session) {
          session = sessionManager.createSession({
            deviceId,
            workspacePath,
            model,
            mode,
            cursorChatId,
            thinkingEffort,
          });
        }

        // Update session's active model / thinkingEffort if passed
        if (model && session.model !== model) {
          session.model = model;
        }
        if (thinkingEffort && session.thinkingEffort !== thinkingEffort) {
          session.thinkingEffort = thinkingEffort;
        }
        sessionManager.updateSession(session.id, { model: session.model, thinkingEffort: session.thinkingEffort });

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
          isStreaming: true,
          model: model || session.model,
        });

        // Broadcast session update to clients
        this.broadcast({
          type: 'session:updated',
          payload: sessionManager.getSession(session.id)!,
        });

        // Dispatch agent:start to worker
        const targetDeviceId = deviceId || session.deviceId || deviceManager.getActiveDeviceId();
        if (!targetDeviceId) {
          this.send(socket, { type: 'error', message: 'No target device available' });
          return;
        }

        const sent = deviceManager.sendToWorker(targetDeviceId, {
          type: 'agent:start',
          payload: {
            sessionId: session.id,
            deviceId: targetDeviceId,
            prompt,
            model: model || session.model,
            mode: mode || session.mode,
            workspacePath: workspacePath || session.workspacePath,
            cursorChatId: cursorChatId || session.cursorChatId,
            continueLastSession,
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
            payload: { reqId: clientReqId, path: searchPath },
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
            payload: { reqId: clientReqId, path: filePath },
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
            payload: { reqId: clientReqId, path: filePath, content },
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
