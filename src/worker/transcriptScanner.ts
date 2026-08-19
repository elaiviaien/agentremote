import fs from 'fs';
import path from 'path';
import os from 'os';
// Dynamic require for node:sqlite supported in Node 22+
let DatabaseSync: any;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  // fallback if not available
}
import { ChatSanitizer, SanitizedChatResult } from '../shared/chatSanitizer';

export interface LocalTranscriptInfo {
  id: string;
  source: 'antigravity' | 'cursor';
  title: string;
  updatedAt: number;
  messageCount: number;
  filePath: string;
  workspacePath?: string;
}

export class TranscriptScanner {
  /**
   * Scans both Antigravity transcripts and Cursor IDE workspace sessions
   */
  public static scanAllLocalTranscripts(): LocalTranscriptInfo[] {
    const antigravity = this.scanAntigravityTranscripts();
    const cursor = this.scanCursorWorkspaceTranscripts();
    return [...antigravity, ...cursor].sort((a, b) => b.updatedAt - a.updatedAt);
  }

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

          try {
            const content = fs.readFileSync(transcriptPath, 'utf8');
            const sanitized = ChatSanitizer.parseAntigravityJsonl(content);

            results.push({
              id: convId,
              source: 'antigravity',
              title: sanitized.title || `Antigravity (${convId.slice(0, 8)})`,
              updatedAt: stats.mtimeMs,
              messageCount: sanitized.messages.length,
              filePath: transcriptPath,
            });
          } catch {
            results.push({
              id: convId,
              source: 'antigravity',
              title: `Antigravity (${convId.slice(0, 8)})`,
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

    return results;
  }

  /**
   * Scans Cursor IDE workspaceStorage SQLite databases for sessions (e.g. polym_agent, UCProfile)
   */
  public static scanCursorWorkspaceTranscripts(): LocalTranscriptInfo[] {
    const results: LocalTranscriptInfo[] = [];
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const wsStorage = path.join(appData, 'Cursor', 'User', 'workspaceStorage');

    if (!fs.existsSync(wsStorage)) return results;

    try {
      const folders = fs.readdirSync(wsStorage);
      for (const f of folders) {
        const wsDir = path.join(wsStorage, f);
        const wsJson = path.join(wsDir, 'workspace.json');
        const dbPath = path.join(wsDir, 'state.vscdb');

        if (fs.existsSync(wsJson) && fs.existsSync(dbPath)) {
          try {
            const wsMeta = JSON.parse(fs.readFileSync(wsJson, 'utf8'));
            let rawWsPath = wsMeta.folder || wsMeta.workspace || '';
            if (rawWsPath.startsWith('file:///')) {
              rawWsPath = decodeURIComponent(rawWsPath.replace('file:///', ''));
            }

            const db = new DatabaseSync(dbPath);
            const genRow: any = db.prepare("SELECT value FROM ItemTable WHERE key = 'aiService.generations'").get();
            const promptRow: any = db.prepare("SELECT value FROM ItemTable WHERE key = 'aiService.prompts'").get();

            let msgCount = 0;
            let firstPrompt = '';

            if (genRow) {
              const gens = JSON.parse(genRow.value);
              msgCount += Array.isArray(gens) ? gens.length : 0;
              if (Array.isArray(gens) && gens[0]) {
                firstPrompt = gens[0].textDescription || '';
              }
            }
            if (promptRow && !firstPrompt) {
              const prompts = JSON.parse(promptRow.value);
              if (Array.isArray(prompts) && prompts[0]) {
                firstPrompt = prompts[0].text || '';
              }
            }

            if (msgCount > 0 || firstPrompt) {
              const wsName = rawWsPath.split(/[/\\]/).pop() || f;
              const title = firstPrompt ? firstPrompt.split('\n')[0].slice(0, 45) + '...' : `Cursor IDE: ${wsName}`;
              const stats = fs.statSync(dbPath);

              results.push({
                id: `cursor-ws-${f}`,
                source: 'cursor',
                title: `Cursor IDE [${wsName}]: ${title}`,
                updatedAt: stats.mtimeMs,
                messageCount: msgCount,
                filePath: dbPath,
                workspacePath: rawWsPath,
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[TranscriptScanner] Error scanning Cursor workspace storage:', err);
    }

    return results;
  }

  /**
   * Reads and sanitizes a local transcript file (Antigravity JSONL or Cursor SQLite DB)
   */
  public static readAndSanitizeLocalTranscript(filePath: string): SanitizedChatResult | null {
    if (!fs.existsSync(filePath)) return null;

    // Check if it's a Cursor SQLite database
    if (filePath.endsWith('.vscdb')) {
      try {
        const db = new DatabaseSync(filePath);
        const genRow: any = db.prepare("SELECT value FROM ItemTable WHERE key = 'aiService.generations'").get();
        if (genRow) {
          const gens = JSON.parse(genRow.value);
          const cleanMessages: any[] = [];
          let totalMetadataRemoved = 0;
          let totalSecretsRedacted = 0;

          if (Array.isArray(gens)) {
            gens.forEach((g: any) => {
              if (g.textDescription) {
                const { cleanText, metadataRemoved, secretsRedacted } = ChatSanitizer.sanitizeText(g.textDescription);
                totalMetadataRemoved += metadataRemoved;
                totalSecretsRedacted += secretsRedacted;
                if (cleanText) {
                  cleanMessages.push({
                    role: 'user',
                    content: cleanText,
                    timestamp: g.unixMs || Date.now(),
                  });
                }
              }
            });
          }

          const cleanSummaryContext = ChatSanitizer.generateCleanContextSummary(cleanMessages);
          const title = cleanMessages[0] ? cleanMessages[0].content.slice(0, 45) + '...' : 'Cursor Workspace Chat';

          return {
            title,
            sourceType: 'cursor',
            messages: cleanMessages,
            removedMetadataCount: totalMetadataRemoved,
            redactedSecretsCount: totalSecretsRedacted,
            cleanSummaryContext,
          };
        }
      } catch (err) {
        console.error('[TranscriptScanner] Error reading Cursor vscdb:', err);
      }
    }

    // Default JSONL / Text reader
    try {
      const rawContent = fs.readFileSync(filePath, 'utf8');
      return ChatSanitizer.sanitizeAny(rawContent);
    } catch (err) {
      console.error('[TranscriptScanner] Error reading transcript:', err);
      return null;
    }
  }
}
