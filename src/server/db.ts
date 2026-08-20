import fs from 'fs';
import path from 'path';
import { DeviceInfo, ChatSession, Project } from '../shared/types';
import { truncateToolCallItem } from '../shared/chatSanitizer';
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
  projects: Record<string, Project>;
}

class JsonDb {
  private dbPath: string;
  private data: DatabaseSchema = {
    users: {},
    devices: {},
    sessions: {},
    projects: {},
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

  private sanitizeSession(session: ChatSession): ChatSession {
    if (!session || !Array.isArray(session.messages)) return session;
    for (const msg of session.messages) {
      if (Array.isArray(msg.toolCalls)) {
        msg.toolCalls = msg.toolCalls.map((tc) => truncateToolCallItem(tc));
      }
    }
    return session;
  }

  private load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const sessions: Record<string, ChatSession> = parsed.sessions || {};
        const projects: Record<string, Project> = parsed.projects || {};
        
        // Sanitize existing sessions to prevent db bloat
        let hasChanges = false;
        for (const [id, session] of Object.entries(sessions)) {
          sessions[id] = this.sanitizeSession(session);
          hasChanges = true;
        }

        this.data = {
          users: parsed.users || {},
          devices: parsed.devices || {},
          sessions,
          projects,
        };

        if (hasChanges) {
          // Flush clean compact version
          this.flush();
        }
      }
    } catch (err) {
      console.warn('Failed to parse existing db.json, starting fresh:', err);
    }
  }

  private scheduleSave() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.flush();
    }, 500);
  }

  public flush() {
    try {
      const jsonStr = JSON.stringify(this.data, null, 2);
      const tmpPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
      try {
        if (process.platform === 'win32' && fs.existsSync(this.dbPath)) {
          fs.copyFileSync(tmpPath, this.dbPath);
          try { fs.unlinkSync(tmpPath); } catch {}
        } else {
          fs.renameSync(tmpPath, this.dbPath);
        }
      } catch {
        // Fallback for file lock or cross-volume rename
        fs.copyFileSync(tmpPath, this.dbPath);
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    } catch (err) {
      console.error('Error saving db.json:', err);
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
    const filtered = deviceId ? list.filter((s) => s.deviceId === deviceId) : list;
    return filtered.sort((a, b) => {
      const aPinned = Boolean(a.isPinned);
      const bPinned = Boolean(b.isPinned);
      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }
      return b.updatedAt - a.updatedAt;
    });
  }

  public getSession(id: string): ChatSession | undefined {
    return this.data.sessions[id];
  }

  public saveSession(session: ChatSession) {
    this.data.sessions[session.id] = this.sanitizeSession(session);
    this.scheduleSave();
  }

  public deleteSession(id: string) {
    delete this.data.sessions[id];
    this.scheduleSave();
  }

  // Project methods
  public getProjects(): Project[] {
    const list = Object.values(this.data.projects);
    return list.sort((a, b) => {
      const aPinned = Boolean(a.isPinned);
      const bPinned = Boolean(b.isPinned);
      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }
      return b.updatedAt - a.updatedAt;
    });
  }

  public getProject(id: string): Project | undefined {
    return this.data.projects[id];
  }

  public saveProject(project: Project) {
    this.data.projects[project.id] = project;
    this.scheduleSave();
  }

  public deleteProject(id: string) {
    delete this.data.projects[id];
    // Unassign deleted project from all sessions so they aren't lost
    for (const session of Object.values(this.data.sessions)) {
      if (session.projectId === id) {
        session.projectId = undefined;
        this.saveSession(session);
      }
    }
    this.scheduleSave();
  }
}

export const db = new JsonDb();
