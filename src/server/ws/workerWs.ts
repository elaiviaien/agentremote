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
        deviceManager.unregisterWorker(registeredDeviceId);
        clientWsManager.broadcast({
          type: 'device:status',
          payload: { deviceId: registeredDeviceId, status: 'offline' },
        });
      }
    });
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
        const { sessionId, chunk, delta } = msg.payload;
        sessionManager.appendChunk(sessionId, delta || chunk);
        clientWsManager.broadcast({
          type: 'agent:chunk',
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
        sessionManager.finalizeAssistantMessage(
          msg.payload.sessionId,
          msg.payload.fullContent,
          msg.payload.cursorChatId
        );
        clientWsManager.broadcast({
          type: 'agent:complete',
          payload: { sessionId: msg.payload.sessionId, success: msg.payload.success, error: msg.payload.error },
        });

        // Also broadcast full session update to make sure client is 100% in sync
        const session = sessionManager.getSession(msg.payload.sessionId);
        if (session) {
          clientWsManager.broadcast({
            type: 'session:updated',
            payload: session,
          });
        }
        break;
      }

      case 'agent:error': {
        sessionManager.finalizeAssistantMessage(
          msg.payload.sessionId,
          `❌ Agent Error: ${msg.payload.error}`
        );
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
    }
  }
}

export const workerWsManager = new WorkerWsManager();
