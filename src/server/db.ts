import fs from 'fs';
import path from 'path';
import { DeviceInfo, ChatSession } from '../shared/types';
import { config } from './config';

interface UserRecord {
  username: string;
  passwordHash: string;
  createdAt: number;
}

interface DatabaseSchema {
  users: Record<string, UserRecord>;
  devices: Record<string, DeviceInfo>;
  sessions: Record<string, ChatSession>;
}

class JsonDb {
  private dbPath: string;
  private data: DatabaseSchema = {
    users: {},
    devices: {},
    sessions: {},
  };
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    if (!fs.existsSync(config.dataDir)) {
      try {
        fs.mkdirSync(config.dataDir, { recursive: true });
      } catch (err) {
        console.error('Failed to create data dir:', err);
      }
    }
    this.dbPath = path.join(config.dataDir, 'db.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          users: parsed.users || {},
          devices: parsed.devices || {},
          sessions: parsed.sessions || {},
        };
      }
    } catch (err) {
      console.warn('Failed to parse existing db.json, starting fresh:', err);
    }
  }

  private scheduleSave() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (err) {
        console.error('Error saving db.json:', err);
      }
    }, 500);
  }

  public flush() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error flushing db.json:', err);
    }
  }

  // User methods
  public getUser(username: string): UserRecord | undefined {
    return this.data.users[username];
  }

  public saveUser(user: UserRecord) {
    this.data.users[user.username] = user;
    this.scheduleSave();
  }

  public hasUsers(): boolean {
    return Object.keys(this.data.users).length > 0;
  }

  // Device methods
  public getDevices(): DeviceInfo[] {
    return Object.values(this.data.devices);
  }

  public getDevice(id: string): DeviceInfo | undefined {
    return this.data.devices[id];
  }

  public saveDevice(device: DeviceInfo) {
    this.data.devices[device.id] = device;
    this.scheduleSave();
  }

  public removeDevice(id: string) {
    delete this.data.devices[id];
    this.scheduleSave();
  }

  // Session methods
  public getSessions(deviceId?: string): ChatSession[] {
    const list = Object.values(this.data.sessions);
    if (deviceId) {
      return list.filter((s) => s.deviceId === deviceId);
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getSession(id: string): ChatSession | undefined {
    return this.data.sessions[id];
  }

  public saveSession(session: ChatSession) {
    this.data.sessions[session.id] = session;
    this.scheduleSave();
  }

  public deleteSession(id: string) {
    delete this.data.sessions[id];
    this.scheduleSave();
  }
}

export const db = new JsonDb();
