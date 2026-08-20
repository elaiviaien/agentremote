import { WebSocket } from 'ws';
import { WorkerToHubMessage } from '../../shared/types';
import { deviceManager } from '../deviceManager';
import { sessionManager } from '../sessionManager';
import { clientWsManager } from './clientWs';
import { config } from '../config';

export class WorkerWsManager {
  public handleConnection(socket: WebSocket, token?: string) {
    let registeredDeviceId: string | null = null;

    socket.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as WorkerToHubMessage;
        this.processWorkerMessage(socket, msg, (devId) => {
          registeredDeviceId = devId;
        });
      } catch (err) {
        console.error('[WorkerWS] Parse error:', err);
      }
    });

    socket.on('close', () => {
      if (registeredDeviceId) {
        const removed = deviceManager.unregisterWorker(registeredDeviceId, socket);
        if (!removed) return; // stale socket; a newer connection is already online

        clientWsManager.broadcast({
          type: 'device:status',
          payload: { deviceId: registeredDeviceId, status: 'offline' },
        });
        this.failRunningSessions(registeredDeviceId);
      }
    });
  }

  /**
   * A worker that disappears mid-run can never send `agent:complete`, which would
   * leave the session (and the composer in the web client) stuck in "running".
   */
  private failRunningSessions(deviceId: string) {
    const stuck = sessionManager
      .getSessions(deviceId)
      .filter((s) => s.isStreaming || s.status === 'running');

    for (const session of stuck) {
      sessionManager.finalizeAssistantMessage(
        session.id,
        "⚠️ Зв’язок з машиною втрачено — виконання перервано."
      );
      sessionManager.clearQueue(session.id);
      sessionManager.updateSession(session.id, { isStreaming: false, status: 'idle' });

      clientWsManager.broadcast({
        type: 'agent:complete',
        payload: {
          sessionId: session.id,
          success: false,
          error: 'Worker disconnected',
          aborted: true,
        } as any,
      });

      const updated = sessionManager.getSession(session.id);
      if (updated) {
        clientWsManager.broadcast({ type: 'session:updated', payload: updated });
      }
    }
  }

  private processWorkerMessage(
    socket: WebSocket,
    msg: WorkerToHubMessage,
    setRegisteredId: (id: string) => void
  ) {
    switch (msg.type) {
      case 'worker:register': {
        const devInfo = msg.payload;
        // Verify worker token
        if (devInfo.token !== config.masterWorkerKey && config.masterWorkerKey) {
          console.warn(`[WorkerWS] Rejected worker with invalid token: ${devInfo.name}`);
          socket.close(4001, 'Unauthorized worker token');
          return;
        }

        const saved = deviceManager.registerWorker(devInfo, socket);
        setRegisteredId(devInfo.id);

        clientWsManager.broadcast({
          type: 'device:updated',
          payload: saved,
        });
        break;
      }

      case 'worker:heartbeat': {
        deviceManager.updateHeartbeat(msg.payload.deviceId, msg.payload.memoryUsage, msg.payload.cpuUsage);
        break;
      }

      case 'agent:auth_url': {
        clientWsManager.broadcast({
          type: 'agent:auth_url',
          payload: msg.payload,
        });
        break;
      }

      case 'agent:auth_success': {
        clientWsManager.broadcast({
          type: 'agent:auth_success',
          payload: msg.payload,
        });
        break;
      }

      case 'agent:chunk': {
        const { sessionId } = msg.payload;
        sessionManager.appendChunk(sessionId, msg.payload);
        clientWsManager.broadcast({
          type: 'agent:chunk',
          payload: msg.payload,
        });
        break;
      }

      case 'agent:thinking': {
        const { sessionId } = msg.payload;
        sessionManager.appendThinking(sessionId, msg.payload);
        clientWsManager.broadcast({
          type: 'agent:thinking',
          payload: msg.payload,
        });
        break;
      }

      case 'agent:tool_call': {
        sessionManager.addToolCall(msg.payload.sessionId, msg.payload.toolCall);
        clientWsManager.broadcast({
          type: 'agent:tool_call',
          payload: msg.payload,
        });
        break;
      }

      case 'agent:tool_result': {
        sessionManager.updateToolResult(
          msg.payload.sessionId,
          msg.payload.toolCallId,
          msg.payload.result,
          msg.payload.status
        );
        clientWsManager.broadcast({
          type: 'agent:tool_result',
          payload: msg.payload,
        });
        break;
      }

      case 'agent:complete': {
        const { sessionId, fullContent, cursorChatId, success, error, aborted } = msg.payload as any;
        sessionManager.finalizeAssistantMessage(
          sessionId,
          aborted ? undefined : fullContent,
          cursorChatId
        );
        clientWsManager.broadcast({
          type: 'agent:complete',
          payload: { sessionId, success, error, cursorChatId, aborted } as any,
        });

        if (aborted) {
          sessionManager.updateSession(sessionId, { isStreaming: false, status: 'idle' });
          const abortedSession = sessionManager.getSession(sessionId);
          if (abortedSession) {
            clientWsManager.broadcast({
              type: 'session:updated',
              payload: abortedSession,
            });
          }
          break;
        }

        // Check if there is a queued prompt for this session!
        const nextPrompt = sessionManager.dequeuePrompt(sessionId);
        if (nextPrompt) {
          const session = sessionManager.getSession(sessionId);
          if (session) {
            // Add user message for queued prompt
            sessionManager.addMessage(session.id, {
              role: 'user',
              content: nextPrompt,
            });
            // Add placeholder assistant message
            sessionManager.addMessage(session.id, {
              role: 'assistant',
              content: '',
              isStreaming: true,
              model: session.model,
            });
            sessionManager.updateSession(session.id, { isStreaming: true, status: 'running' });

            // Broadcast session update to clients
            clientWsManager.broadcast({
              type: 'session:updated',
              payload: sessionManager.getSession(session.id)!,
            });

            // Dispatch next prompt to worker
            const targetDeviceId = session.deviceId || deviceManager.getActiveDeviceId();
            if (targetDeviceId) {
              deviceManager.sendToWorker(targetDeviceId, {
                type: 'agent:start',
                payload: {
                  sessionId: session.id,
                  deviceId: targetDeviceId,
                  engine: session.engine || 'cursor',
                  prompt: nextPrompt,
                  model: session.model,
                  mode: session.mode,
                  workspacePath: session.workspacePath,
                  cursorChatId: session.cursorChatId,
                  continueLastSession: true,
                  thinkingEffort: session.thinkingEffort || 'medium',
                },
              });
            }
          }
        } else {
          sessionManager.updateSession(sessionId, { isStreaming: false, status: 'idle' });
          // Broadcast final updated session state
          const session = sessionManager.getSession(sessionId);
          if (session) {
            clientWsManager.broadcast({
              type: 'session:updated',
              payload: session,
            });
          }
        }
        break;
      }

      case 'agent:error': {
        sessionManager.finalizeAssistantMessage(
          msg.payload.sessionId,
          `❌ Agent Error: ${msg.payload.error}`
        );
        clientWsManager.broadcast({
          type: 'agent:error' as any,
          payload: { sessionId: msg.payload.sessionId, error: msg.payload.error },
        } as any);
        clientWsManager.broadcast({
          type: 'agent:complete',
          payload: { sessionId: msg.payload.sessionId, success: false, error: msg.payload.error },
        });
        break;
      }

      case 'terminal:output': {
        clientWsManager.broadcast({
          type: 'terminal:output',
          payload: msg.payload,
        });
        break;
      }

      case 'terminal:exit': {
        clientWsManager.broadcast({
          type: 'terminal:exit',
          payload: msg.payload,
        });
        break;
      }

      case 'fs:tree_result': {
        deviceManager.resolvePendingFsRequest(msg.payload.reqId, {
          tree: msg.payload.tree,
          rootPath: msg.payload.rootPath,
        });
        break;
      }

      case 'fs:file_result': {
        deviceManager.resolvePendingFsRequest(msg.payload.reqId, {
          path: (msg.payload as any).path,
          content: msg.payload.content,
          error: msg.payload.error,
        });
        break;
      }

      case 'fs:write_result': {
        deviceManager.resolvePendingFsRequest(msg.payload.reqId, {
          success: msg.payload.success,
          error: msg.payload.error,
        });
        break;
      }

      case 'transcripts:list_result': {
        clientWsManager.broadcast({
          type: 'transcripts:list_result',
          payload: { reqId: (msg as any).payload.reqId, transcripts: (msg as any).payload.transcripts },
        });
        break;
      }

      case 'transcripts:read_result': {
        clientWsManager.broadcast({
          type: 'transcripts:read_result',
          payload: { reqId: (msg as any).payload.reqId, result: (msg as any).payload.result },
        });
        break;
      }

      case 'sessions:sync_update': {
        const { sessionId, sourceSessionId, sourceFilePath, messages, title } = (msg as any).payload;
        const targetId = sessionId || sourceSessionId || sourceFilePath;
        if (targetId && messages) {
          const updated = sessionManager.syncExternalMessages(targetId, messages, title);
          if (updated) {
            clientWsManager.broadcast({
              type: 'session:updated',
              payload: updated,
            });
          }
        }
        break;
      }
    }
  }
}

export const workerWsManager = new WorkerWsManager();
