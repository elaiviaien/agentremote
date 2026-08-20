import { ToolCallItem } from './types';

export interface CleanMessage {
  role: 'user' | 'assistant';
  content: string;
  thinkingContent?: string;
  timestamp?: number;
  toolCalls?: ToolCallItem[];
}

export interface SanitizedChatResult {
  title: string;
  sourceType: 'antigravity' | 'claude_code' | 'claude' | 'chatgpt' | 'cursor' | 'generic';
  messages: CleanMessage[];
  removedMetadataCount: number;
  redactedSecretsCount: number;
  cleanSummaryContext: string;
}

export class ChatSanitizer {
  // Regex to detect and remove secret tokens
  private static SECRET_PATTERNS = [
    /3a8ad522-[0-9a-f-]{20,}/gi, // Railway tokens or UUID-like tokens
    /ghp_[0-9a-zA-Z]{20,}/g, // GitHub tokens
    /sk-[0-9a-zA-Z_-]{20,}/g, // OpenAI / Anthropic / API keys
    /Bearer\s+[0-9a-zA-Z._-]{20,}/gi,
    /railway\s+token\s+[0-9a-zA-Z._-]{10,}/gi,
  ];

  // Regex to strip internal agent tags
  private static INTERNAL_TAGS = [
    /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi,
    /<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi,
    /<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi,
    /<TASK_NOTIFICATION>[\s\S]*?<\/TASK_NOTIFICATION>/gi,
    /<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi,
    /<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi,
    /\{\{\s*CHECKPOINT\s*\d*\s*\}\}[\s\S]*?\*\*IMPORTANT:[^\n]*\*\*/gi,
  ];

  /**
   * Sanitizes raw text string by removing secrets, system tags, and agent fingerprints
   */
  public static sanitizeText(text: string): { cleanText: string; metadataRemoved: number; secretsRedacted: number } {
    if (!text) return { cleanText: '', metadataRemoved: 0, secretsRedacted: 0 };

    let clean = text;
    let metadataRemoved = 0;
    let secretsRedacted = 0;

    // 1. Extract content from <USER_REQUEST> if wrapped
    const userReqMatch = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(clean);
    if (userReqMatch) {
      clean = userReqMatch[1];
      metadataRemoved++;
    }

    // 2. Strip other internal system tags
    for (const tagPattern of this.INTERNAL_TAGS) {
      const match = clean.match(tagPattern);
      if (match) {
        metadataRemoved += match.length;
        clean = clean.replace(tagPattern, '');
      }
    }

    // 3. Strip any residual XML-like system headers
    clean = clean.replace(/<[A-Z_]+>[\s\S]*?<\/[A-Z_]+>/g, () => {
      metadataRemoved++;
      return '';
    });

    // 4. Redact potential API keys and secrets
    for (const secretRegex of this.SECRET_PATTERNS) {
      clean = clean.replace(secretRegex, (match) => {
        secretsRedacted++;
        return '[REDACTED_KEY]';
      });
    }

    // 5. Clean trailing/leading whitespace and excess newlines
    clean = clean
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { cleanText: clean, metadataRemoved, secretsRedacted };
  }

  /**
   * Generates a clean, short, human-readable title from a user prompt
   */
  public static cleanTitleFromPrompt(prompt: string, maxLength = 34): string {
    if (!prompt) return 'Новий чат';

    // 1. Sanitize text first
    let text = this.sanitizeText(prompt).cleanText;

    // 2. Remove code blocks, markdown symbols, URLs
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(/`[^`]+`/g, ' ');
    text = text.replace(/https?:\/\/\S+/g, ' ');
    text = text.replace(/[#*_\->~[\]()]+/g, ' ');

    // 3. Take first non-empty line
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let title = lines[0] || '';

    // 4. Strip common conversational prefixes in Ukrainian and English
    const prefixPatterns = [
      /^(?:хочу\s+(?:щоб|якщо)\s+(?:була\s+можливість\s+)?)/i,
      /^(?:треба\s+(?:щоб|зробити|додати)\s+(?:можливість\s+)?)/i,
      /^(?:зроби\s+(?:так\s+щоб|будь\s+ласка\s+)?)/i,
      /^(?:чи\s+(?:можна|працює|є|буде)\s+)/i,
      /^(?:допоможи\s+(?:мені\s+)?(?:з|у|в)?\s+)/i,
      /^(?:як\s+(?:зробити|налаштувати|додати)\s+)/i,
      /^(?:будь\s+ласка[,\s]+)/i,
      /^(?:can\s+you\s+(?:please\s+)?(?:help\s+me\s+with\s+)?)/i,
      /^(?:please\s+(?:help\s+me\s+with\s+)?)/i,
      /^(?:i\s+want\s+(?:to\s+)?)/i,
      /^(?:how\s+to\s+)/i,
      /^(?:could\s+you\s+)/i,
    ];

    for (const pat of prefixPatterns) {
      title = title.replace(pat, '');
    }

    // 5. Clean punctuation and collapse spaces
    title = title.replace(/[?!:;.,]+$/, '').replace(/\s+/g, ' ').trim();

    if (!title) return 'Новий чат';

    // 6. Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    // 7. Truncate smoothly at word boundary
    if (title.length > maxLength) {
      const cut = title.slice(0, maxLength);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace > maxLength * 0.55) {
        title = cut.slice(0, lastSpace).trim() + '…';
      } else {
        title = cut.trim() + '…';
      }
    }

    return title;
  }

  /**
   * Parses Antigravity transcript.jsonl content
   */
  public static parseAntigravityJsonl(jsonlContent: string): SanitizedChatResult {
    const lines = jsonlContent.split('\n');
    const cleanMessages: CleanMessage[] = [];
    let totalMetadataRemoved = 0;
    let totalSecretsRedacted = 0;
    let detectedTitle = 'Antigravity Imported Chat';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const entry = JSON.parse(trimmed);

        // Process User Inputs
        if (entry.type === 'USER_INPUT' && entry.content) {
          const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(entry.content);
          totalMetadataRemoved += metadataRemoved;
          totalSecretsRedacted += secretsRedacted;

          if (cleanText) {
            cleanMessages.push({
              role: 'user',
              content: cleanText,
              timestamp: entry.created_at ? new Date(entry.created_at).getTime() : Date.now(),
            });

            if (detectedTitle === 'Antigravity Imported Chat') {
              detectedTitle = this.cleanTitleFromPrompt(cleanText);
            }
          }
        }
        // Process Assistant Responses
        else if (entry.type === 'PLANNER_RESPONSE' || entry.tool_calls || entry.thought || entry.thinking) {
          let rawContent = entry.content || '';
          let thinkingContent = entry.thought || entry.thinking || '';

          if (!thinkingContent && rawContent) {
            const thinkMatch = rawContent.match(/<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>/i);
            if (thinkMatch) {
              thinkingContent = thinkMatch[1].trim();
              rawContent = rawContent.replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, '').trim();
            }
          }

          const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(rawContent);
          totalMetadataRemoved += metadataRemoved;
          totalSecretsRedacted += secretsRedacted;

          const toolCalls: ToolCallItem[] = [];
          if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
            entry.tool_calls.forEach((tc: any) => {
              let params = tc.args || tc.parameters || tc.arguments || tc.input || {};
              if (typeof params === 'string') {
                try { params = JSON.parse(params); } catch {}
              }
              if (typeof params === 'object' && params !== null) {
                const cleaned: any = {};
                for (const [k, v] of Object.entries(params)) {
                  if (typeof v === 'string') {
                    let s = v.trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
                      try { s = JSON.parse(s); } catch {}
                    }
                    cleaned[k] = s;
                  } else {
                    cleaned[k] = v;
                  }
                }
                params = cleaned;
              }

              const summary = params.toolSummary || params.Description || params.CommandLine || params.TargetFile || params.AbsolutePath || params.Query || params.path || '';
              const action = params.toolAction || params.Instruction || '';
              const item: ToolCallItem = {
                id: tc.id || `tc-${entry.step_index || Math.random().toString(36).substring(2, 8)}`,
                type: tc.name || 'tool',
                name: tc.name || 'Tool Execution',
                summary: truncateString(summary, 200, '...'),
                action: truncateString(action, 100, '...'),
                input: params,
                output: tc.output || tc.result || undefined,
                status: tc.status || 'completed',
              };
              toolCalls.push(truncateToolCallItem(item));
            });
          }

          if (cleanText || toolCalls.length > 0 || thinkingContent) {
            const lastMsg = cleanMessages[cleanMessages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              if (cleanText) {
                lastMsg.content = lastMsg.content ? lastMsg.content + '\n\n' + cleanText : cleanText;
              }
              if (thinkingContent) {
                lastMsg.thinkingContent = lastMsg.thinkingContent ? lastMsg.thinkingContent + '\n\n' + thinkingContent : thinkingContent;
              }
              if (toolCalls.length > 0) {
                lastMsg.toolCalls = [...(lastMsg.toolCalls || []), ...toolCalls];
              }
            } else {
              cleanMessages.push({
                role: 'assistant',
                content: cleanText,
                thinkingContent: thinkingContent || undefined,
                timestamp: entry.created_at ? new Date(entry.created_at).getTime() : Date.now(),
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              });
            }
          }
        } else if ((entry.type === 'GENERIC' || entry.type === 'TOOL_RESPONSE') && entry.content) {
          // Attach output to the last tool call in history that doesn't have an output yet
          let attached = false;
          for (let i = cleanMessages.length - 1; i >= 0; i--) {
            const msg = cleanMessages[i];
            if (msg.toolCalls && msg.toolCalls.length > 0) {
              const pendingTc = [...msg.toolCalls].reverse().find((t) => !t.output);
              if (pendingTc) {
                pendingTc.output = entry.content.trim();
                attached = true;
                break;
              }
            }
          }
          if (!attached) totalMetadataRemoved++;
        } else {
          // Ignored internal tool execution / checkpoint / system message lines
          totalMetadataRemoved++;
        }
      } catch {
        // Non-JSON line
      }
    }

    const cleanSummaryContext = this.generateCleanContextSummary(cleanMessages);

    return {
      title: detectedTitle,
      sourceType: 'antigravity',
      messages: cleanMessages,
      removedMetadataCount: totalMetadataRemoved,
      redactedSecretsCount: totalSecretsRedacted,
      cleanSummaryContext,
    };
  }

  /**
   * Parses Claude Code CLI project transcript (.jsonl)
   */
  public static parseClaudeCodeJsonl(jsonlContent: string): SanitizedChatResult {
    const lines = jsonlContent.split('\n');
    const cleanMessages: CleanMessage[] = [];
    let totalMetadataRemoved = 0;
    let totalSecretsRedacted = 0;
    let detectedTitle = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const entry = JSON.parse(trimmed);

        // Check for AI generated title
        if (entry.type === 'ai-title' && entry.aiTitle) {
          detectedTitle = entry.aiTitle;
          continue;
        }

        // Process User messages
        if (entry.type === 'user' && entry.message) {
          let userText = '';
          if (typeof entry.message.content === 'string') {
            userText = entry.message.content;
          } else if (Array.isArray(entry.message.content)) {
            userText = entry.message.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
          }

          if (userText) {
            const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(userText);
            totalMetadataRemoved += metadataRemoved;
            totalSecretsRedacted += secretsRedacted;

            if (cleanText) {
              cleanMessages.push({
                role: 'user',
                content: cleanText,
                timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
              });

              if (!detectedTitle) {
                detectedTitle = this.cleanTitleFromPrompt(cleanText);
              }
            }
          }
        }
        // Process Assistant messages
        else if (entry.type === 'assistant' && entry.message) {
          let assistantText = '';
          if (typeof entry.message.content === 'string') {
            assistantText = entry.message.content;
          } else if (Array.isArray(entry.message.content)) {
            assistantText = entry.message.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
          }

          if (assistantText) {
            const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(assistantText);
            totalMetadataRemoved += metadataRemoved;
            totalSecretsRedacted += secretsRedacted;

            if (cleanText) {
              const lastMsg = cleanMessages[cleanMessages.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content += '\n\n' + cleanText;
              } else {
                cleanMessages.push({
                  role: 'assistant',
                  content: cleanText,
                  timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
                });
              }
            }
          }
        } else {
          totalMetadataRemoved++;
        }
      } catch {
        // Ignored unparseable line
      }
    }

    if (!detectedTitle) {
      detectedTitle = cleanMessages[0] ? cleanMessages[0].content.slice(0, 40) + '...' : 'Claude Code Imported Session';
    }

    const cleanSummaryContext = this.generateCleanContextSummary(cleanMessages);

    return {
      title: detectedTitle,
      sourceType: 'claude_code',
      messages: cleanMessages,
      removedMetadataCount: totalMetadataRemoved,
      redactedSecretsCount: totalSecretsRedacted,
      cleanSummaryContext,
    };
  }

  /**
   * Parses Claude JSON or ChatGPT JSON export format
   */
  public static parseJsonExport(rawJson: string): SanitizedChatResult {
    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return this.parseGenericMarkdown(rawJson);
    }

    const cleanMessages: CleanMessage[] = [];
    let totalMetadataRemoved = 0;
    let totalSecretsRedacted = 0;
    let title = parsed.title || parsed.name || 'Imported AI Chat';

    // A. Claude Web JSON Export format ({ chat_messages: [...] })
    const messagesArray = parsed.chat_messages || parsed.messages || (Array.isArray(parsed) ? parsed : []);

    for (const msg of messagesArray) {
      const sender = (msg.sender || msg.role || msg.author?.role || '').toLowerCase();
      const role: 'user' | 'assistant' = sender.includes('human') || sender.includes('user') ? 'user' : 'assistant';

      let rawText = '';
      if (typeof msg.text === 'string') rawText = msg.text;
      else if (typeof msg.content === 'string') rawText = msg.content;
      else if (Array.isArray(msg.content)) {
        rawText = msg.content
          .map((c: any) => (typeof c === 'string' ? c : c.text || ''))
          .join('\n');
      }

      const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(rawText);
      totalMetadataRemoved += metadataRemoved;
      totalSecretsRedacted += secretsRedacted;

      if (cleanText) {
        cleanMessages.push({
          role,
          content: cleanText,
          timestamp: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
        });
      }
    }

    const cleanSummaryContext = this.generateCleanContextSummary(cleanMessages);

    return {
      title,
      sourceType: 'claude',
      messages: cleanMessages,
      removedMetadataCount: totalMetadataRemoved,
      redactedSecretsCount: totalSecretsRedacted,
      cleanSummaryContext,
    };
  }

  /**
   * Parses Generic Markdown with "User:" / "Assistant:" / "Human:" / "AI:" headers
   */
  public static parseGenericMarkdown(rawMarkdown: string): SanitizedChatResult {
    const cleanMessages: CleanMessage[] = [];
    let totalMetadataRemoved = 0;
    let totalSecretsRedacted = 0;

    const sections = rawMarkdown.split(/(?=^(?:#+\s*)?(?:User|Human|Користувач|Assistant|AI|Claude|Cursor|ChatGPT):\s*)/gim);

    for (const sec of sections) {
      const trimmed = sec.trim();
      if (!trimmed) continue;

      const headerMatch = /^(?:#+\s*)?(User|Human|Користувач|Assistant|AI|Claude|Cursor|ChatGPT):\s*([\s\S]*)/i.exec(trimmed);
      if (headerMatch) {
        const header = headerMatch[1].toLowerCase();
        const role: 'user' | 'assistant' = header.includes('user') || header.includes('human') || header.includes('користувач') ? 'user' : 'assistant';
        const rawContent = headerMatch[2];

        const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(rawContent);
        totalMetadataRemoved += metadataRemoved;
        totalSecretsRedacted += secretsRedacted;

        if (cleanText) {
          cleanMessages.push({ role, content: cleanText, timestamp: Date.now() });
        }
      } else {
        // Plain text segment without header -> Treat as user prompt
        const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(trimmed);
        totalMetadataRemoved += metadataRemoved;
        totalSecretsRedacted += secretsRedacted;
        if (cleanText) {
          cleanMessages.push({ role: 'user', content: cleanText, timestamp: Date.now() });
        }
      }
    }

    const title = cleanMessages[0] ? cleanMessages[0].content.slice(0, 45) + '...' : 'Imported Document';
    const cleanSummaryContext = this.generateCleanContextSummary(cleanMessages);

    return {
      title,
      sourceType: 'generic',
      messages: cleanMessages,
      removedMetadataCount: totalMetadataRemoved,
      redactedSecretsCount: totalSecretsRedacted,
      cleanSummaryContext,
    };
  }

  /**
   * Automatically detects the format and returns a sanitized chat result
   */
  public static sanitizeAny(rawContent: string): SanitizedChatResult {
    const trimmed = (rawContent || '').trim();

    // Check if it's JSONL from Antigravity
    if (trimmed.startsWith('{') && (trimmed.includes('"step_index"') || trimmed.includes('"USER_INPUT"') || trimmed.includes('"PLANNER_RESPONSE"'))) {
      return this.parseAntigravityJsonl(trimmed);
    }

    // Check if it's standard JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return this.parseJsonExport(trimmed);
      } catch {
        // Fallback
      }
    }

    // Default to markdown parser
    return this.parseGenericMarkdown(trimmed);
  }

  /**
   * Generates a safe, concise Markdown summary of the conversation to bootstrap a new agent
   */
  public static generateCleanContextSummary(messages: CleanMessage[]): string {
    if (messages.length === 0) return '';

    let summary = '### 📋 Перенесений контекст завдання з попередньої розмови:\n\n';
    messages.forEach((msg, idx) => {
      const roleName = msg.role === 'user' ? '👤 Користувач' : '🤖 Асистент';
      summary += `**${roleName}:**\n${msg.content}\n\n---\n\n`;
    });

    return summary.trim();
  }
}

/**
 * Truncates string to a maximum length with indicator
 */
export function truncateString(str: string | undefined | null, maxLen: number = 2000, suffix = '\n... [обрізано для оптимізації]'): string {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + suffix;
}

/**
 * Truncates tool call inputs and outputs to prevent memory/database bloat
 */
export function truncateToolCallItem(toolCall: ToolCallItem, maxInputLen = 2000, maxOutputLen = 3000): ToolCallItem {
  if (!toolCall) return toolCall;
  const cloned: ToolCallItem = { ...toolCall };

  if (typeof cloned.summary === 'string') {
    cloned.summary = truncateString(cloned.summary, 200, '...');
  }
  if (typeof cloned.action === 'string') {
    cloned.action = truncateString(cloned.action, 100, '...');
  }

  if (typeof cloned.input === 'string') {
    cloned.input = truncateString(cloned.input, maxInputLen);
  } else if (cloned.input && typeof cloned.input === 'object') {
    const truncatedInput: Record<string, any> = {};
    for (const [key, val] of Object.entries(cloned.input)) {
      if (typeof val === 'string') {
        const isBigCodeKey = /content|code|replacement|script|diff/i.test(key);
        const limit = isBigCodeKey ? 800 : maxInputLen;
        truncatedInput[key] = truncateString(val, limit);
      } else {
        truncatedInput[key] = val;
      }
    }
    cloned.input = truncatedInput;
  }

  if (typeof cloned.output === 'string') {
    cloned.output = truncateString(cloned.output, maxOutputLen);
  }

  return cloned;
}

