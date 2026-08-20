import { WebSocket } from 'ws';
import { DeviceInfo, HubToWorkerMessage, WorkerToHubMessage } from '../shared/types';
import { db } from './db';

interface ConnectedWorker {
  deviceInfo: DeviceInfo;
  socket: WebSocket;
  lastPing: number;
}

class DeviceManager {
  private activeWorkers = new Map<string, ConnectedWorker>();
  private activeDeviceId: string | null = null;
  private pendingFsRequests = new Map<string, (result: any) => void>();

  constructor() {
    // Periodic check for dead sockets
    setInterval(() => {
      const now = Date.now();
      for (const [id, worker] of this.activeWorkers.entries()) {
        if (now - worker.lastPing > 90000) {
          console.log(`[DeviceManager] Worker ${id} timed out. Disconnecting.`);
          worker.socket.terminate();
          this.activeWorkers.delete(id);
          this.updateDeviceStatus(id, 'offline');
        }
      }
    }, 15000);
  }

  public registerWorker(deviceInfo: DeviceInfo, socket: WebSocket) {
    const existing = db.getDevice(deviceInfo.id);
    const updatedInfo: DeviceInfo = {
      ...(existing || {}),
      ...deviceInfo,
      status: 'online',
      lastSeen: Date.now(),
    };

    db.saveDevice(updatedInfo);
    this.activeWorkers.set(deviceInfo.id, {
      deviceInfo: updatedInfo,
      socket,
      lastPing: Date.now(),
    });

    if (!this.activeDeviceId) {
      this.activeDeviceId = deviceInfo.id;
    }

    console.log(`[DeviceManager] Worker registered: ${deviceInfo.name} (${deviceInfo.id}) [${deviceInfo.os}]`);
    return updatedInfo;
  }

  public unregisterWorker(deviceId: string) {
    this.activeWorkers.delete(deviceId);
    this.updateDeviceStatus(deviceId, 'offline');
    console.log(`[DeviceManager] Worker disconnected: ${deviceId}`);
  }

  public updateHeartbeat(deviceId: string, memoryUsage?: any, cpuUsage?: number) {
    const worker = this.activeWorkers.get(deviceId);
    if (worker) {
      worker.lastPing = Date.now();
      worker.deviceInfo.lastSeen = Date.now();
      if (memoryUsage) worker.deviceInfo.memoryUsage = memoryUsage;
      if (cpuUsage !== undefined) worker.deviceInfo.cpuUsage = cpuUsage;
      db.saveDevice(worker.deviceInfo);
    }
  }

  public updateDeviceStatus(deviceId: string, status: 'online' | 'offline') {
    const dev = db.getDevice(deviceId);
    if (dev) {
      dev.status = status;
      dev.lastSeen = Date.now();
      db.saveDevice(dev);
    }
  }

  public getDevices(): DeviceInfo[] {
    const all = db.getDevices();
    // Update online status in-memory
    return all.map((d) => ({
      ...d,
      status: this.activeWorkers.has(d.id) ? 'online' : 'offline',
    }));
  }

  public getDevice(id: string): DeviceInfo | undefined {
    const dev = db.getDevice(id);
    if (dev) {
      return {
        ...dev,
        status: this.activeWorkers.has(id) ? 'online' : 'offline',
      };
    }
    return undefined;
  }

  public getActiveDeviceId(): string | null {
    if (this.activeDeviceId && this.activeWorkers.has(this.activeDeviceId)) {
      return this.activeDeviceId;
    }
    // Pick the first online device if any
    const firstOnline = Array.from(this.activeWorkers.keys())[0];
    return firstOnline || this.activeDeviceId || null;
  }

  public setActiveDeviceId(id: string) {
    this.activeDeviceId = id;
  }

  public sendToWorker(deviceId: string, message: HubToWorkerMessage): boolean {
    const trySend = (id: string | undefined | null): boolean => {
      if (!id) return false;
      const worker = this.activeWorkers.get(id);
      if (!worker) return false;
      const sock: any = worker.socket;
      const target = typeof sock?.send === 'function' ? sock : sock?.socket;
      const state = target?.readyState;
      const open = state === WebSocket.OPEN || state === 1;
      if (!target || !open) {
        console.warn(`[DeviceManager] Worker ${id} socket not open (readyState=${state})`);
        return false;
      }
      target.send(JSON.stringify(message));
      return true;
    };

    if (trySend(deviceId)) return true;

    for (const id of this.activeWorkers.keys()) {
      if (id !== deviceId && trySend(id)) {
        console.warn(`[DeviceManager] Worker ${deviceId} unreachable; sent via ${id}`);
        return true;
      }
    }

    console.warn(`[DeviceManager] Cannot send to worker ${deviceId}: not connected`);
    return false;
  }

  public broadcastToWorkers(message: HubToWorkerMessage) {
    for (const worker of this.activeWorkers.values()) {
      if (worker.socket.readyState === WebSocket.OPEN) {
        worker.socket.send(JSON.stringify(message));
      }
    }
  }

  // FS Promise bridge
  public registerPendingFsRequest(reqId: string, resolve: (res: any) => void) {
    this.pendingFsRequests.set(reqId, resolve);
    setTimeout(() => {
      if (this.pendingFsRequests.has(reqId)) {
        this.pendingFsRequests.delete(reqId);
        resolve({ error: 'Request timed out' });
      }
    }, 15000);
  }

  public resolvePendingFsRequest(reqId: string, result: any) {
    const resolver = this.pendingFsRequests.get(reqId);
    if (resolver) {
      this.pendingFsRequests.delete(reqId);
      resolver(result);
    }
  }
}

export const deviceManager = new DeviceManager();
