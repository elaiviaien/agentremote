import fs from 'fs';
import path from 'path';
import os from 'os';
import { TranscriptScanner } from './transcriptScanner';
import { CleanMessage } from '../shared/chatSanitizer';

export interface SyncUpdatePayload {
  sessionId?: string;
  sourceSessionId?: string;
  sourceFilePath?: string;
  messages: CleanMessage[];
  title?: string;
}

export class TranscriptWatcher {
  private fileTimestamps = new Map<string, { mtime: number; size: number; msgCount: number }>();
  private checkInterval: NodeJS.Timeout | null = null;
  private isChecking = false;

  constructor(private onSyncUpdate: (payload: SyncUpdatePayload) => void) {}

  public start(intervalMs = 15000) {
    this.stop();
    this.scanAndSync(true);
    this.checkInterval = setInterval(() => {
      this.scanAndSync(false);
    }, intervalMs);
  }

  public stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  public forceSync(sourceSessionId?: string, sourceFilePath?: string, sessionId?: string): boolean {
    const filePath = sourceFilePath || this.resolveFilePath(sourceSessionId);
    if (!filePath) return false;

    const result = TranscriptScanner.readAndSanitizeLocalTranscript(filePath);
    if (!result) return false;

    this.onSyncUpdate({
      sessionId,
      sourceSessionId,
      sourceFilePath: filePath,
      messages: result.messages,
      title: result.title,
    });
    return true;
  }

  private resolveFilePath(sourceId?: string): string | null {
    if (!sourceId) return null;
    const homeDir = os.homedir();
    const agyPath = path.join(homeDir, '.gemini', 'antigravity', 'brain', sourceId, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(agyPath)) return agyPath;
    return null;
  }

  private scanAndSync(isInitial = false) {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const homeDir = os.homedir();
      const brainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');
      if (fs.existsSync(brainDir)) {
        const convDirs = fs.readdirSync(brainDir);
        for (const convId of convDirs) {
          const tPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(tPath)) {
            this.checkFile(tPath, convId, isInitial);
          }
        }
      }
    } catch (err) {
      console.warn('[TranscriptWatcher] scan error:', err);
    } finally {
      this.isChecking = false;
    }
  }

  private checkFile(filePath: string, sourceSessionId: string, isInitial: boolean) {
    try {
      const stats = fs.statSync(filePath);
      const prev = this.fileTimestamps.get(filePath);

      if (!prev) {
        this.fileTimestamps.set(filePath, {
          mtime: stats.mtimeMs,
          size: stats.size,
          msgCount: 0,
        });
        if (!isInitial) {
          this.triggerSync(filePath, sourceSessionId);
        }
        return;
      }

      if (stats.mtimeMs !== prev.mtime || stats.size !== prev.size) {
        prev.mtime = stats.mtimeMs;
        prev.size = stats.size;
        this.triggerSync(filePath, sourceSessionId);
      }
    } catch {
      // ignore
    }
  }

  private triggerSync(filePath: string, sourceSessionId: string) {
    try {
      const result = TranscriptScanner.readAndSanitizeLocalTranscript(filePath);
      if (!result) return;

      const prev = this.fileTimestamps.get(filePath);
      if (prev) {
        prev.msgCount = result.messages.length;
      }

      console.log(`[TranscriptWatcher] Syncing external updates for ${sourceSessionId} (${result.messages.length} msgs)`);
      this.onSyncUpdate({
        sourceSessionId,
        sourceFilePath: filePath,
        messages: result.messages,
        title: result.title,
      });
    } catch (err) {
      console.warn('[TranscriptWatcher] triggerSync error:', err);
    }
  }
}
