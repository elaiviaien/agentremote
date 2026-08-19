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
import { ChatSanitizer, SanitizedChatResult, CleanMessage } from '../shared/chatSanitizer';

export interface LocalTranscriptInfo {
  id: string;
  source: 'antigravity' | 'cursor' | 'claude_code';
  title: string;
  updatedAt: number;
  messageCount: number;
  filePath: string;
  workspacePath?: string;
}

export class TranscriptScanner {
  /**
   * Scans Antigravity transcripts, Cursor IDE workspace sessions, and Claude Code CLI sessions
   */
  public static scanAllLocalTranscripts(): LocalTranscriptInfo[] {
    const antigravity = this.scanAntigravityTranscripts();
    const cursor = this.scanCursorWorkspaceTranscripts();
    const claudeCode = this.scanClaudeCodeTranscripts();
    return [...antigravity, ...cursor, ...claudeCode].sort((a, b) => b.updatedAt - a.updatedAt);
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
   * Scans Claude Code CLI sessions from ~/.claude/projects/
   */
  public static scanClaudeCodeTranscripts(): LocalTranscriptInfo[] {
    const results: LocalTranscriptInfo[] = [];
    const homeDir = os.homedir();
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');

    if (!fs.existsSync(claudeProjectsDir)) return results;

    try {
      const projectDirs = fs.readdirSync(claudeProjectsDir);
      for (const pDir of projectDirs) {
        const fullProjPath = path.join(claudeProjectsDir, pDir);
        if (!fs.statSync(fullProjPath).isDirectory()) continue;

        // Reconstruct approximate workspace path
        let wsPath = pDir.replace(/--/g, ':\\').replace(/-/g, '\\');
        if (pDir.startsWith('c--') || pDir.startsWith('C--')) {
          wsPath = 'C:\\' + pDir.slice(3).replace(/-/g, '\\');
        }

        const files = fs.readdirSync(fullProjPath);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;

          const jsonlPath = path.join(fullProjPath, file);
          try {
            const stats = fs.statSync(jsonlPath);
            if (stats.size < 100) continue; // skip empty/corrupted

            const rawContent = fs.readFileSync(jsonlPath, 'utf8');
            const sanitized = ChatSanitizer.parseClaudeCodeJsonl(rawContent);

            if (sanitized.messages.length > 0) {
              results.push({
                id: `claude-${file.replace('.jsonl', '')}`,
                source: 'claude_code',
                title: sanitized.title || `Claude Code: ${path.basename(wsPath)}`,
                updatedAt: stats.mtimeMs,
                messageCount: sanitized.messages.length,
                filePath: jsonlPath,
                workspacePath: wsPath,
              });
            }
          } catch {
            // Ignored
          }
        }
      }
    } catch (err) {
      console.warn('[TranscriptScanner] Error scanning Claude Code projects:', err);
    }

    return results;
  }

  /**
   * Reads and parses a local transcript file by path
   */
  public static readLocalTranscript(filePath: string): SanitizedChatResult | null {
    if (filePath.startsWith('vscdb:')) {
      const dbPath = filePath.replace('vscdb:', '');
      try {
        if (DatabaseSync && fs.existsSync(dbPath)) {
          const db = new DatabaseSync(dbPath);
          const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'").get() as any;
          db.close();

          if (!row || !row.value) return null;

          const parsed = JSON.parse(row.value);
          const cleanMessages: CleanMessage[] = [];
          let totalMetadataRemoved = 0;
          let totalSecretsRedacted = 0;

          if (parsed.tabs && Array.isArray(parsed.tabs)) {
            parsed.tabs.forEach((tab: any) => {
              if (tab.bubbles && Array.isArray(tab.bubbles)) {
                tab.bubbles.forEach((b: any) => {
                  const rawText = b.text || b.rawText || '';
                  const role: 'user' | 'assistant' = b.type === 'user' ? 'user' : 'assistant';
                  const { cleanText, metadataRemoved, secretsRedacted } = ChatSanitizer.sanitizeText(rawText);
                  totalMetadataRemoved += metadataRemoved;
                  totalSecretsRedacted += secretsRedacted;

                  if (cleanText) {
                    cleanMessages.push({
                      role,
                      content: cleanText,
                      timestamp: b.unixMs || Date.now(),
                    });
                  }
                });
              }
            });
          }

          const cleanSummaryContext = ChatSanitizer.generateCleanContextSummary(cleanMessages);
          return {
            title: 'Cursor Chat',
            sourceType: 'cursor',
            messages: cleanMessages,
            removedMetadataCount: totalMetadataRemoved,
            redactedSecretsCount: totalSecretsRedacted,
            cleanSummaryContext
          };
        }
      } catch (err) {
        console.error('[TranscriptScanner] Error reading Cursor vscdb:', err);
      }
    }

    // Claude Code JSONL reader
    if (filePath.includes('.claude') && filePath.endsWith('.jsonl')) {
      try {
        const rawContent = fs.readFileSync(filePath, 'utf8');
        return ChatSanitizer.parseClaudeCodeJsonl(rawContent);
      } catch (err) {
        console.error('[TranscriptScanner] Error reading Claude Code jsonl:', err);
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

  public static readAndSanitizeLocalTranscript(filePath: string): SanitizedChatResult | null {
    return this.readLocalTranscript(filePath);
  }
}
