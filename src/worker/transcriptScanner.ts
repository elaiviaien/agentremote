import fs from 'fs';
import path from 'path';
import os from 'os';

let DatabaseSync: any;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  // fallback
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
  public static scanAllLocalTranscripts(): LocalTranscriptInfo[] {
    const antigravity = this.scanAntigravityTranscripts();
    const cursor = this.scanCursorWorkspaceTranscripts();
    const claudeCode = this.scanClaudeCodeTranscripts();
    return [...antigravity, ...cursor, ...claudeCode].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public static scanAntigravityTranscripts(): LocalTranscriptInfo[] {
    const results: LocalTranscriptInfo[] = [];
    const homeDir = os.homedir();
    const brainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');

    if (!fs.existsSync(brainDir)) return results;

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

  public static scanCursorWorkspaceTranscripts(): LocalTranscriptInfo[] {
    const results: LocalTranscriptInfo[] = [];
    const seenIds = new Set<string>();
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const homeDir = os.homedir();

    // 1. Global composer headers
    const globalDbPath = path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    if (fs.existsSync(globalDbPath) && DatabaseSync) {
      try {
        const db = new DatabaseSync(globalDbPath);
        const headersRow: any = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'").get();
        if (headersRow && headersRow.value) {
          const parsed = JSON.parse(headersRow.value);
          if (parsed.allComposers && Array.isArray(parsed.allComposers)) {
            for (const c of parsed.allComposers) {
              if (!c.composerId || seenIds.has(c.composerId)) continue;
              seenIds.add(c.composerId);

              const wsPath = c.workspaceIdentifier?.uri?.fsPath || 
                             c.trackedGitRepos?.[0]?.repoPath || 
                             (c.workspaceIdentifier?.uri?.path ? c.workspaceIdentifier.uri.path.replace(/^\/([a-zA-Z]:)/, '$1') : '');
              const wsName = wsPath ? path.basename(wsPath) : 'Cursor';
              const title = c.name || c.subtitle || `Composer (${c.composerId.slice(0, 8)})`;
              const updatedAt = c.lastUpdatedAt || c.conversationCheckpointLastUpdatedAt || c.createdAt || Date.now();

              results.push({
                id: c.composerId,
                source: 'cursor',
                title: `Cursor [${wsName}]: ${title}`,
                updatedAt,
                messageCount: c.filesChangedCount || 1,
                filePath: `composer:${c.composerId}`,
                workspacePath: wsPath,
              });
            }
          }
        }
        db.close();
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning global composerHeaders:', err);
      }
    }

    // 2. AI tracking db
    const trackingDbPath = path.join(homeDir, '.cursor', 'ai-tracking', 'ai-code-tracking.db');
    if (fs.existsSync(trackingDbPath) && DatabaseSync) {
      try {
        const db = new DatabaseSync(trackingDbPath);
        const query = 'SELECT conversationId, count(*) as hashesCount, max(createdAt) as lastTime, max(fileName) as sampleFile, max(model) as model FROM ai_code_hashes WHERE conversationId IS NOT NULL AND length(conversationId) > 5 GROUP BY conversationId';
        const rows: any[] = db.prepare(query).all();

        for (const r of rows) {
          if (!r.conversationId || seenIds.has(r.conversationId)) continue;
          seenIds.add(r.conversationId);

          let wsPath = '';
          if (r.sampleFile) {
            const clean = r.sampleFile.replace(/^\/([a-zA-Z]:)/, '$1');
            wsPath = path.dirname(path.dirname(clean));
          }
          const wsName = wsPath ? path.basename(wsPath) : 'Cursor';

          results.push({
            id: r.conversationId,
            source: 'cursor',
            title: `Cursor Agent [${wsName}]: Chat ${r.conversationId.slice(0, 8)} (${r.model || 'Auto'})`,
            updatedAt: r.lastTime || Date.now(),
            messageCount: r.hashesCount,
            filePath: `composer:${r.conversationId}`,
            workspacePath: wsPath,
          });
        }
        db.close();
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning ai-code-tracking.db:', err);
      }
    }

    // 3. Workspace storage databases
    const wsStorage = path.join(appData, 'Cursor', 'User', 'workspaceStorage');
    if (fs.existsSync(wsStorage) && DatabaseSync) {
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

              if (genRow && genRow.value) {
                const gens = JSON.parse(genRow.value);
                msgCount += Array.isArray(gens) ? gens.length : 0;
                if (Array.isArray(gens) && gens[0]) {
                  firstPrompt = gens[0].textDescription || '';
                }
              }
              if (promptRow && promptRow.value && !firstPrompt) {
                const prompts = JSON.parse(promptRow.value);
                if (Array.isArray(prompts) && prompts[0]) {
                  firstPrompt = prompts[0].text || '';
                }
              }
              db.close();

              if (msgCount > 0 || firstPrompt) {
                const wsName = rawWsPath.split(/[/\\]/).pop() || f;
                const title = firstPrompt ? firstPrompt.split('\n')[0].slice(0, 45) + '...' : `Cursor IDE: ${wsName}`;
                const stats = fs.statSync(dbPath);
                const wsId = `cursor-ws-${f}`;

                if (!seenIds.has(wsId)) {
                  seenIds.add(wsId);
                  results.push({
                    id: wsId,
                    source: 'cursor',
                    title: `Cursor IDE [${wsName}]: ${title}`,
                    updatedAt: stats.mtimeMs,
                    messageCount: msgCount,
                    filePath: `vscdb:${dbPath}`,
                    workspacePath: rawWsPath,
                  });
                }
              }
            } catch {}
          }
        }
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning Cursor workspace storage:', err);
      }
    }

    return results;
  }

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
            if (stats.size < 100) continue;

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
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[TranscriptScanner] Error scanning Claude Code projects:', err);
    }

    return results;
  }

  public static readLocalTranscript(filePath: string): SanitizedChatResult | null {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const homeDir = os.homedir();

    if (filePath.startsWith('composer:')) {
      const composerId = filePath.replace('composer:', '');
      try {
        let title = `Cursor Session (${composerId.slice(0, 8)})`;
        let subtitle = '';
        let wsPath = '';
        let model = 'default';
        const cleanMessages: CleanMessage[] = [];

        const globalDbPath = path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
        if (fs.existsSync(globalDbPath) && DatabaseSync) {
          try {
            const db = new DatabaseSync(globalDbPath);
            const headersRow: any = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'").get();
            if (headersRow && headersRow.value) {
              const parsed = JSON.parse(headersRow.value);
              const found = parsed.allComposers?.find((c: any) => c.composerId === composerId);
              if (found) {
                title = found.name || found.subtitle || title;
                subtitle = found.subtitle || '';
                wsPath = found.workspaceIdentifier?.uri?.fsPath || found.trackedGitRepos?.[0]?.repoPath || '';
              }
            }
            db.close();
          } catch {}
        }

        const trackingDbPath = path.join(homeDir, '.cursor', 'ai-tracking', 'ai-code-tracking.db');
        if (fs.existsSync(trackingDbPath) && DatabaseSync) {
          try {
            const db = new DatabaseSync(trackingDbPath);
            const rows: any[] = db.prepare("SELECT DISTINCT fileName, model FROM ai_code_hashes WHERE conversationId = ? LIMIT 10").all(composerId);
            if (rows.length > 0) {
              model = rows[0].model || model;
              const files = rows.map((r: any) => r.fileName).filter(Boolean);
              if (files.length > 0 && !subtitle) {
                subtitle = `Змінені файли: ${files.map((f: string) => path.basename(f)).join(', ')}`;
              }
            }
            db.close();
          } catch {}
        }

        cleanMessages.push({
          role: 'user',
          content: `Імпортована сесія Cursor: ${title}\n${subtitle ? `Опис: ${subtitle}\n` : ''}${wsPath ? `Робоча папка: ${wsPath}\n` : ''}ID сесії: ${composerId}`,
          timestamp: Date.now() - 60000,
        });
        cleanMessages.push({
          role: 'assistant',
          content: `Готовий продовжити роботу з сесією Cursor **${title}** (модель: ${model}). Введіть ваше наступне завдання!`,
          timestamp: Date.now(),
        });

        return {
          title,
          sourceType: 'cursor',
          messages: cleanMessages,
          removedMetadataCount: 0,
          redactedSecretsCount: 0,
          cleanSummaryContext: `Cursor Composer Session: ${title} (${composerId})`
        };
      } catch (err) {
        console.error('[TranscriptScanner] Error reading composer transcript:', err);
      }
    }

    if (filePath.startsWith('vscdb:')) {
      const dbPath = filePath.replace('vscdb:', '');
      try {
        if (DatabaseSync && fs.existsSync(dbPath)) {
          const db = new DatabaseSync(dbPath);
          const row: any = db.prepare("SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'").get();
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

    if (filePath.includes('.claude') && filePath.endsWith('.jsonl')) {
      try {
        const rawContent = fs.readFileSync(filePath, 'utf8');
        return ChatSanitizer.parseClaudeCodeJsonl(rawContent);
      } catch (err) {
        console.error('[TranscriptScanner] Error reading Claude Code jsonl:', err);
      }
    }

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
