// Universal Cross-Agent Chat Sanitizer
// Strips all proprietary metadata, internal system prompts, tool traces, thinking tokens, and secret keys

export interface CleanMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface SanitizedChatResult {
  title: string;
  sourceType: 'antigravity' | 'claude' | 'chatgpt' | 'cursor' | 'generic';
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
    /sk-[0-9a-zA-Z]{20,}/g, // OpenAI / API keys
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
              detectedTitle = cleanText.split('\n')[0].slice(0, 45) + '...';
            }
          }
        }
        // Process Assistant Responses
        else if (entry.type === 'PLANNER_RESPONSE' && entry.content) {
          const { cleanText, metadataRemoved, secretsRedacted } = this.sanitizeText(entry.content);
          totalMetadataRemoved += metadataRemoved;
          totalSecretsRedacted += secretsRedacted;

          if (cleanText) {
            // Merge with last assistant message if consecutive
            const lastMsg = cleanMessages[cleanMessages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content += '\n\n' + cleanText;
            } else {
              cleanMessages.push({
                role: 'assistant',
                content: cleanText,
                timestamp: entry.created_at ? new Date(entry.created_at).getTime() : Date.now(),
              });
            }
          }
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
