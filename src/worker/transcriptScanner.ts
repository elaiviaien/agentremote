import fs from 'fs';
import path from 'path';
import os from 'os';
import { ChatSanitizer, SanitizedChatResult } from '../shared/chatSanitizer';

export interface LocalTranscriptInfo {
  id: string;
  source: 'antigravity' | 'cursor';
  title: string;
  updatedAt: number;
  messageCount: number;
  filePath: string;
}

export class TranscriptScanner {
  /**
   * Scans for Antigravity conversations in ~/.gemini/antigravity/brain
   */
  public static scanAntigravityTranscripts(): LocalTranscriptInfo[] {
    const results: LocalTranscriptInfo[] = [];
    const homeDir = os.homedir();
    const brainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');

    if (!fs.existsSync(brainDir)) {
      return results;
    }

    try {
      const convDirs = fs.readdirSync(brainDir);
      for (const convId of convDirs) {
        const transcriptPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(transcriptPath)) {
          const stats = fs.statSync(transcriptPath);

          // Quick inspect for title and message count
          try {
            const content = fs.readFileSync(transcriptPath, 'utf8');
            const sanitized = ChatSanitizer.parseAntigravityJsonl(content);

            results.push({
              id: convId,
              source: 'antigravity',
              title: sanitized.title || `Antigravity Session (${convId.slice(0, 8)})`,
              updatedAt: stats.mtimeMs,
              messageCount: sanitized.messages.length,
              filePath: transcriptPath,
            });
          } catch {
            results.push({
              id: convId,
              source: 'antigravity',
              title: `Antigravity Session (${convId.slice(0, 8)})`,
              updatedAt: stats.mtimeMs,
              messageCount: 0,
              filePath: transcriptPath,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[TranscriptScanner] Error scanning Antigravity brain:', err);
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Reads and sanitizes a local transcript file by ID or path
   */
  public static readAndSanitizeLocalTranscript(transcriptPath: string): SanitizedChatResult | null {
    if (!fs.existsSync(transcriptPath)) return null;
    try {
      const rawContent = fs.readFileSync(transcriptPath, 'utf8');
      return ChatSanitizer.sanitizeAny(rawContent);
    } catch (err) {
      console.error('[TranscriptScanner] Error reading transcript:', err);
      return null;
    }
  }
}
