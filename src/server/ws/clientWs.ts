import { WebSocket } from 'ws';
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

      case 'agent:prompt': {
        const { sessionId, deviceId, prompt, model, mode, workspacePath, cursorChatId, continueLastSession } = msg.payload;
        
        let session = sessionManager.getSession(sessionId);
        if (!session) {
          session = sessionManager.createSession({
            deviceId,
            workspacePath,
            model,
            mode,
            cursorChatId,
          });
        }

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
          },
        });

        if (!sent) {
          sessionManager.finalizeAssistantMessage(
            session.id,
            '⚠️ Error: Selected machine is currently offline or unreachable.'
          );
          this.broadcast({
            type: 'session:updated',
            payload: sessionManager.getSession(session.id)!,
          });
        }
        break;
      }

      case 'agent:abort': {
        const session = sessionManager.getSession(msg.payload.sessionId);
        if (session) {
          deviceManager.sendToWorker(session.deviceId, {
            type: 'agent:abort',
            payload: { sessionId: session.id },
          });
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

      case 'fs:tree': {
        const reqId = Math.random().toString(36).substring(2, 10);
        const targetDev = msg.payload.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.registerPendingFsRequest(reqId, (result) => {
            this.send(socket, {
              type: 'fs:tree',
              payload: result,
            });
          });
          deviceManager.sendToWorker(targetDev, {
            type: 'fs:get_tree',
            payload: { reqId, path: msg.payload.path },
          });
        }
        break;
      }

      case 'fs:read': {
        const reqId = Math.random().toString(36).substring(2, 10);
        const targetDev = msg.payload.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.registerPendingFsRequest(reqId, (result) => {
            this.send(socket, {
              type: 'fs:file',
              payload: result,
            });
          });
          deviceManager.sendToWorker(targetDev, {
            type: 'fs:read_file',
            payload: { reqId, path: msg.payload.path },
          });
        }
        break;
      }

      case 'fs:write': {
        const reqId = Math.random().toString(36).substring(2, 10);
        const targetDev = msg.payload.deviceId || deviceManager.getActiveDeviceId();
        if (targetDev) {
          deviceManager.sendToWorker(targetDev, {
            type: 'fs:write_file',
            payload: { reqId, path: msg.payload.path, content: msg.payload.content },
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
