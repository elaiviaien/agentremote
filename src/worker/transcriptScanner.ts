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

  private static pushComposerResult(
    results: LocalTranscriptInfo[],
    seenIds: Set<string>,
    c: {
      composerId?: string;
      name?: string;
      subtitle?: string;
      lastUpdatedAt?: number;
      conversationCheckpointLastUpdatedAt?: number;
      createdAt?: number;
      filesChangedCount?: number;
      messageCount?: number;
      workspaceIdentifier?: { uri?: { fsPath?: string; path?: string } };
      trackedGitRepos?: Array<{ repoPath?: string }>;
    }
  ): void {
    if (!c.composerId || seenIds.has(c.composerId)) return;
    seenIds.add(c.composerId);

    const wsPath =
      c.workspaceIdentifier?.uri?.fsPath ||
      c.trackedGitRepos?.[0]?.repoPath ||
      (c.workspaceIdentifier?.uri?.path
        ? c.workspaceIdentifier.uri.path.replace(/^\/([a-zA-Z]:)/, '$1')
        : '');
    const wsName = wsPath ? path.basename(wsPath) : 'Cursor';
    const title = c.name || c.subtitle || `Composer (${c.composerId.slice(0, 8)})`;
    const updatedAt =
      c.lastUpdatedAt || c.conversationCheckpointLastUpdatedAt || c.createdAt || Date.now();
    const messageCount = c.messageCount || c.filesChangedCount || 1;

    results.push({
      id: c.composerId,
      source: 'cursor',
      title: `Cursor [${wsName}]: ${title}`,
      updatedAt,
      messageCount,
      filePath: `composer:${c.composerId}`,
      workspacePath: wsPath || undefined,
    });
  }

  private static decodeCursorProjectDirName(name: string): string {
    if (/^[A-Za-z]-/.test(name)) {
      return `${name[0].toUpperCase()}:${name.slice(1).replace(/-/g, '\\')}`;
    }
    return name;
  }

  public static scanCursorWorkspaceTranscripts(): LocalTranscriptInfo[] {
    const results: LocalTranscriptInfo[] = [];
    const seenIds = new Set<string>();
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const homeDir = os.homedir();
    const globalDbPath = path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');

    // 1. Global composer headers (sidebar index — often incomplete)
    if (fs.existsSync(globalDbPath) && DatabaseSync) {
      try {
        const db = new DatabaseSync(globalDbPath, { readonly: true });
        const headersRow: any = db
          .prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'")
          .get();
        if (headersRow?.value) {
          const parsed = JSON.parse(headersRow.value);
          if (Array.isArray(parsed.allComposers)) {
            for (const c of parsed.allComposers) {
              this.pushComposerResult(results, seenIds, c);
            }
          }
        }

        // 2. Full composer bodies in cursorDiskKV (includes chats missing from headers)
        try {
          const kvKeys: any[] = db
            .prepare("SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
            .all();
          const valueStmt = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
          for (const row of kvKeys) {
            const composerId = String(row.key || '').replace(/^composerData:/, '');
            if (!composerId || seenIds.has(composerId)) continue;
            let data: any;
            try {
              const valueRow: any = valueStmt.get(row.key);
              if (!valueRow?.value) continue;
              data = JSON.parse(valueRow.value);
            } catch {
              continue;
            }
            const msgCount = Array.isArray(data.fullConversationHeadersOnly)
              ? data.fullConversationHeadersOnly.length
              : 0;
            if (!data.name && !data.subtitle && msgCount === 0 && !data.filesChangedCount) {
              continue; // empty shell / draft stub
            }
            this.pushComposerResult(results, seenIds, {
              composerId: data.composerId || composerId,
              name: data.name,
              subtitle: data.subtitle,
              lastUpdatedAt: data.lastUpdatedAt,
              conversationCheckpointLastUpdatedAt: data.conversationCheckpointLastUpdatedAt,
              createdAt: data.createdAt,
              filesChangedCount: data.filesChangedCount,
              messageCount: msgCount || data.filesChangedCount || 1,
              workspaceIdentifier: data.workspaceIdentifier,
              trackedGitRepos: data.trackedGitRepos,
            });
          }
        } catch (err) {
          console.warn('[TranscriptScanner] Error scanning cursorDiskKV composerData:', err);
        }

        db.close();
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning global Cursor DB:', err);
      }
    }

    // 3. Per-workspace composer.composerData (IDE sidebar index per folder)
    const wsStorage = path.join(appData, 'Cursor', 'User', 'workspaceStorage');
    if (fs.existsSync(wsStorage) && DatabaseSync) {
      try {
        for (const f of fs.readdirSync(wsStorage)) {
          const wsDir = path.join(wsStorage, f);
          const wsJson = path.join(wsDir, 'workspace.json');
          const dbPath = path.join(wsDir, 'state.vscdb');
          if (!fs.existsSync(dbPath)) continue;

          let rawWsPath = '';
          if (fs.existsSync(wsJson)) {
            try {
              const wsMeta = JSON.parse(fs.readFileSync(wsJson, 'utf8'));
              rawWsPath = wsMeta.folder || wsMeta.workspace || '';
              if (rawWsPath.startsWith('file:///')) {
                rawWsPath = decodeURIComponent(rawWsPath.replace('file:///', ''));
              }
            } catch {}
          }

          try {
            const db = new DatabaseSync(dbPath, { readonly: true });
            const composerRow: any = db
              .prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'")
              .get();
            if (composerRow?.value) {
              const parsed = JSON.parse(composerRow.value);
              const composers = parsed.allComposers || parsed.composers || [];
              if (Array.isArray(composers)) {
                for (const c of composers) {
                  if (!c.workspaceIdentifier && rawWsPath) {
                    c.workspaceIdentifier = { uri: { fsPath: rawWsPath } };
                  }
                  this.pushComposerResult(results, seenIds, c);
                }
              }
            }

            // Legacy aiService generations (one aggregate entry per workspace)
            const genRow: any = db
              .prepare("SELECT value FROM ItemTable WHERE key = 'aiService.generations'")
              .get();
            const promptRow: any = db
              .prepare("SELECT value FROM ItemTable WHERE key = 'aiService.prompts'")
              .get();
            let msgCount = 0;
            let firstPrompt = '';
            if (genRow?.value) {
              const gens = JSON.parse(genRow.value);
              msgCount += Array.isArray(gens) ? gens.length : 0;
              if (Array.isArray(gens) && gens[0]) {
                firstPrompt = gens[0].textDescription || '';
              }
            }
            if (promptRow?.value && !firstPrompt) {
              const prompts = JSON.parse(promptRow.value);
              if (Array.isArray(prompts) && prompts[0]) {
                firstPrompt = prompts[0].text || '';
              }
            }
            db.close();

            if (msgCount > 0 || firstPrompt) {
              const wsName = rawWsPath.split(/[/\\]/).pop() || f;
              const title = firstPrompt
                ? firstPrompt.split('\n')[0].slice(0, 45) + '...'
                : `Cursor IDE: ${wsName}`;
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
                  workspacePath: rawWsPath || undefined,
                });
              }
            }
          } catch {}
        }
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning Cursor workspace storage:', err);
      }
    }

    // 4. AI tracking db (code-edit conversations only)
    const trackingDbPath = path.join(homeDir, '.cursor', 'ai-tracking', 'ai-code-tracking.db');
    if (fs.existsSync(trackingDbPath) && DatabaseSync) {
      try {
        const db = new DatabaseSync(trackingDbPath, { readonly: true });
        const query =
          'SELECT conversationId, count(*) as hashesCount, max(createdAt) as lastTime, max(fileName) as sampleFile, max(model) as model FROM ai_code_hashes WHERE conversationId IS NOT NULL AND length(conversationId) > 5 GROUP BY conversationId';
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
            workspacePath: wsPath || undefined,
          });
        }
        db.close();
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning ai-code-tracking.db:', err);
      }
    }

    // 5. ~/.cursor/projects/*/agent-transcripts/**/*.jsonl (Agent/IDE transcript files)
    const projectsDir = path.join(homeDir, '.cursor', 'projects');
    if (fs.existsSync(projectsDir)) {
      try {
        for (const projectName of fs.readdirSync(projectsDir)) {
          const agentDir = path.join(projectsDir, projectName, 'agent-transcripts');
          if (!fs.existsSync(agentDir)) continue;
          const wsPath = this.decodeCursorProjectDirName(projectName);
          const wsName = path.basename(wsPath) || projectName;

          const walkTranscripts = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                walkTranscripts(full);
                continue;
              }
              if (!entry.name.endsWith('.jsonl')) continue;
              const id = entry.name.replace(/\.jsonl$/i, '');
              if (seenIds.has(id)) continue;
              try {
                const stats = fs.statSync(full);
                if (stats.size < 50) continue;
                const raw = fs.readFileSync(full, 'utf8');
                const lines = raw.split('\n').filter((l) => l.trim());
                let title = `Agent (${id.slice(0, 8)})`;
                let msgCount = 0;
                for (const line of lines) {
                  try {
                    const obj = JSON.parse(line);
                    if (obj.role === 'user' || obj.role === 'assistant') msgCount++;
                    if (obj.role === 'user' && title.startsWith('Agent (')) {
                      const text =
                        obj.message?.content?.find?.((c: any) => c.type === 'text')?.text ||
                        obj.message?.content?.[0]?.text ||
                        '';
                      const cleaned = String(text)
                        .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, '')
                        .replace(/<\/?user_query>/gi, '')
                        .trim();
                      if (cleaned) title = cleaned.split('\n')[0].slice(0, 60);
                    }
                  } catch {}
                }
                if (msgCount === 0) continue;
                seenIds.add(id);
                results.push({
                  id,
                  source: 'cursor',
                  title: `Cursor Transcript [${wsName}]: ${title}`,
                  updatedAt: stats.mtimeMs,
                  messageCount: msgCount,
                  filePath: full,
                  workspacePath: /^[A-Za-z]:/.test(wsPath) ? wsPath : undefined,
                });
              } catch {}
            }
          };
          walkTranscripts(agentDir);
        }
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning agent-transcripts:', err);
      }
    }

    // 6. ~/.cursor/chats (CLI/local chat store meta — fill gaps)
    const chatsDir = path.join(homeDir, '.cursor', 'chats');
    if (fs.existsSync(chatsDir)) {
      try {
        for (const projectHash of fs.readdirSync(chatsDir)) {
          const pdir = path.join(chatsDir, projectHash);
          if (!fs.statSync(pdir).isDirectory()) continue;
          for (const chatId of fs.readdirSync(pdir)) {
            if (seenIds.has(chatId)) continue;
            const metaPath = path.join(pdir, chatId, 'meta.json');
            const storePath = path.join(pdir, chatId, 'store.db');
            if (!fs.existsSync(metaPath)) continue;
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              if (meta.hasConversation === false) continue;
              const stats = fs.existsSync(storePath) ? fs.statSync(storePath) : fs.statSync(metaPath);
              const wsPath = meta.cwd || '';
              const wsName = wsPath ? path.basename(wsPath) : 'Cursor';
              seenIds.add(chatId);
              results.push({
                id: chatId,
                source: 'cursor',
                title: `Cursor Chat [${wsName}]: ${chatId.slice(0, 8)}`,
                updatedAt: meta.updatedAtMs || stats.mtimeMs,
                messageCount: 1,
                filePath: fs.existsSync(storePath) ? `cursor-chat:${storePath}` : metaPath,
                workspacePath: wsPath || undefined,
              });
            } catch {}
          }
        }
      } catch (err) {
        console.warn('[TranscriptScanner] Error scanning .cursor/chats:', err);
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
            const db = new DatabaseSync(globalDbPath, { readonly: true });
            const headersRow: any = db
              .prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'")
              .get();
            if (headersRow?.value) {
              const parsed = JSON.parse(headersRow.value);
              const found = parsed.allComposers?.find((c: any) => c.composerId === composerId);
              if (found) {
                title = found.name || found.subtitle || title;
                subtitle = found.subtitle || '';
                wsPath =
                  found.workspaceIdentifier?.uri?.fsPath ||
                  found.trackedGitRepos?.[0]?.repoPath ||
                  '';
              }
            }

            // Prefer full composerData + bubbles when available
            try {
              const composerRow: any = db
                .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
                .get(`composerData:${composerId}`);
              if (composerRow?.value) {
                const data = JSON.parse(composerRow.value);
                title = data.name || data.subtitle || title;
                subtitle = data.subtitle || subtitle;
                wsPath = data.trackedGitRepos?.[0]?.repoPath || wsPath;
                model = data.modelConfig?.modelName || data.model || model;

                const headers = Array.isArray(data.fullConversationHeadersOnly)
                  ? data.fullConversationHeadersOnly
                  : [];
                let removedMetadataCount = 0;
                let redactedSecretsCount = 0;
                // Cap bubble reads for import bootstrap (full history can be huge)
                const maxBubbles = 80;
                for (const h of headers.slice(0, maxBubbles)) {
                  const bubbleId = h.bubbleId;
                  if (!bubbleId) continue;
                  try {
                    const brow: any = db
                      .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
                      .get(`bubbleId:${composerId}:${bubbleId}`);
                    if (!brow?.value) continue;
                    const bubble = JSON.parse(brow.value);
                    const rawText = bubble.text || bubble.rawText || '';
                    if (!rawText.trim()) continue;
                    const role: 'user' | 'assistant' = bubble.type === 1 ? 'user' : 'assistant';
                    const { cleanText, metadataRemoved, secretsRedacted } =
                      ChatSanitizer.sanitizeText(rawText);
                    removedMetadataCount += metadataRemoved;
                    redactedSecretsCount += secretsRedacted;
                    if (cleanText) {
                      cleanMessages.push({
                        role,
                        content: cleanText,
                        timestamp: bubble.createdAt || bubble.unixMs || Date.now(),
                      });
                    }
                  } catch {}
                }

                if (cleanMessages.length > 0) {
                  db.close();
                  return {
                    title,
                    sourceType: 'cursor',
                    messages: cleanMessages,
                    removedMetadataCount,
                    redactedSecretsCount,
                    cleanSummaryContext: ChatSanitizer.generateCleanContextSummary(cleanMessages),
                  };
                }
              }
            } catch {}

            db.close();
          } catch {}
        }

        const trackingDbPath = path.join(homeDir, '.cursor', 'ai-tracking', 'ai-code-tracking.db');
        if (fs.existsSync(trackingDbPath) && DatabaseSync) {
          try {
            const db = new DatabaseSync(trackingDbPath, { readonly: true });
            const rows: any[] = db
              .prepare('SELECT DISTINCT fileName, model FROM ai_code_hashes WHERE conversationId = ? LIMIT 10')
              .all(composerId);
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

        if (cleanMessages.length === 0) {
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
        }

        return {
          title,
          sourceType: 'cursor',
          messages: cleanMessages,
          removedMetadataCount: 0,
          redactedSecretsCount: 0,
          cleanSummaryContext: ChatSanitizer.generateCleanContextSummary(cleanMessages),
        };
      } catch (err) {
        console.error('[TranscriptScanner] Error reading composer transcript:', err);
      }
    }

    if (filePath.startsWith('cursor-chat:')) {
      const storePath = filePath.replace('cursor-chat:', '');
      return {
        title: `Cursor Chat (${path.basename(path.dirname(storePath)).slice(0, 8)})`,
        sourceType: 'cursor',
        messages: [
          {
            role: 'user',
            content: `Імпортована локальна Cursor chat-сесія.\nStore: ${storePath}`,
            timestamp: Date.now() - 60000,
          },
          {
            role: 'assistant',
            content: 'Сесію підключено. Можете продовжити роботу з наступного повідомлення.',
            timestamp: Date.now(),
          },
        ],
        removedMetadataCount: 0,
        redactedSecretsCount: 0,
        cleanSummaryContext: `Cursor chat store: ${storePath}`,
      };
    }

    if (filePath.startsWith('vscdb:')) {
      const dbPath = filePath.replace('vscdb:', '');
      try {
        if (DatabaseSync && fs.existsSync(dbPath)) {
          const db = new DatabaseSync(dbPath, { readonly: true });
          const row: any = db
            .prepare("SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'")
            .get();
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
                  const { cleanText, metadataRemoved, secretsRedacted } =
                    ChatSanitizer.sanitizeText(rawText);
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
            cleanSummaryContext,
          };
        }
      } catch (err) {
        console.error('[TranscriptScanner] Error reading Cursor vscdb:', err);
      }
    }

    if (filePath.includes('agent-transcripts') && filePath.endsWith('.jsonl')) {
      try {
        const rawContent = fs.readFileSync(filePath, 'utf8');
        return this.parseCursorAgentTranscriptJsonl(rawContent, path.basename(filePath, '.jsonl'));
      } catch (err) {
        console.error('[TranscriptScanner] Error reading agent transcript:', err);
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

  private static parseCursorAgentTranscriptJsonl(
    jsonlContent: string,
    fallbackId: string
  ): SanitizedChatResult {
    const cleanMessages: CleanMessage[] = [];
    let title = `Cursor Agent (${fallbackId.slice(0, 8)})`;
    let removedMetadataCount = 0;
    let redactedSecretsCount = 0;

    for (const line of jsonlContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj.role !== 'user' && obj.role !== 'assistant') continue;
        const parts = obj.message?.content;
        let text = '';
        if (Array.isArray(parts)) {
          text = parts
            .filter((p: any) => p?.type === 'text' && p.text)
            .map((p: any) => p.text)
            .join('\n');
        } else if (typeof obj.message?.content === 'string') {
          text = obj.message.content;
        } else if (typeof obj.content === 'string') {
          text = obj.content;
        }
        if (!text.trim()) continue;
        const { cleanText, metadataRemoved, secretsRedacted } = ChatSanitizer.sanitizeText(
          text
            .replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/gi, '')
            .replace(/<\/?user_query>/gi, '')
            .trim()
        );
        removedMetadataCount += metadataRemoved;
        redactedSecretsCount += secretsRedacted;
        if (!cleanText) continue;
        if (obj.role === 'user' && cleanMessages.length === 0) {
          title = cleanText.split('\n')[0].slice(0, 80);
        }
        cleanMessages.push({
          role: obj.role,
          content: cleanText,
          timestamp: Date.now(),
        });
      } catch {}
    }

    return {
      title,
      sourceType: 'cursor',
      messages: cleanMessages,
      removedMetadataCount,
      redactedSecretsCount,
      cleanSummaryContext: ChatSanitizer.generateCleanContextSummary(cleanMessages),
    };
  }

  public static readAndSanitizeLocalTranscript(filePath: string): SanitizedChatResult | null {
    return this.readLocalTranscript(filePath);
  }
}
