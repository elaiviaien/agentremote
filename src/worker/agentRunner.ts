import { spawn, ChildProcess } from 'child_process';
import { AgentRunOptions, ToolCallItem } from '../shared/types';
import { DiscoveredTools } from './cursorDetector';

export interface StreamCallbacks {
  onChunk: (chunk: string, delta?: string) => void;
  onThinking?: (thinkingText: string, delta?: string) => void;
  onToolCall: (toolCall: ToolCallItem) => void;
  onToolResult: (toolCallId: string, result: string, status: 'completed' | 'failed') => void;
  onComplete: (fullContent: string, cursorChatId?: string, success?: boolean, error?: string) => void;
  onError: (error: string) => void;
}

function quoteForShell(value: string): string {
  if (!/[\s"^&|<>()]/.test(value)) return value;
  return '"' + value.split('"').join('""') + '"';
}

export class AgentRunner {
  private activeProcesses = new Map<string, { proc: ChildProcess; isAborted: boolean }>();

  constructor(private tools: DiscoveredTools) {}

  public updateTools(tools: DiscoveredTools) {
    this.tools = tools;
  }

  public triggerAuth(onAuthUrl: (url: string) => void, onComplete: (success: boolean) => void) {
    if (!this.tools.cursorAgentCmd) {
      onComplete(false);
      return;
    }

    console.log(`[AgentRunner] Running cursor-agent login...`);
    const proc = spawn(this.tools.cursorAgentCmd, ['login'], {
      shell: true,
      env: { ...process.env, NO_OPEN_BROWSER: '1' },
    });

    let detectedUrl = false;
    let authBuffer = '';

    proc.stdout?.on('data', (d) => {
      const text = d.toString();
      authBuffer += text;
      console.log(`[AgentRunner Login] ${text}`);
      const match = authBuffer.match(/https:\/\/cursor\.com\/loginDeepControl[^\s\r\n"'>]+/);
      if (match && !detectedUrl) {
        detectedUrl = true;
        console.log(`[AgentRunner] Found OAuth URL: ${match[0]}`);
        onAuthUrl(match[0]);
      }
    });

    proc.stderr?.on('data', (d) => {
      const text = d.toString();
      authBuffer += text;
      console.error(`[AgentRunner Login Err] ${text}`);
      const match = authBuffer.match(/https:\/\/cursor\.com\/loginDeepControl[^\s\r\n"'>]+/);
      if (match && !detectedUrl) {
        detectedUrl = true;
        onAuthUrl(match[0]);
      }
    });

    proc.on('close', (code) => {
      console.log(`[AgentRunner Login] Process exited with code ${code}`);
      onComplete(code === 0);
    });
  }

  public async createNewChat(workspacePath?: string): Promise<string | null> {
    if (!this.tools.cursorAgentCmd) return null;

    return new Promise((resolve) => {
      try {
        const proc = spawn(this.tools.cursorAgentCmd!, ['create-chat'], {
          cwd: workspacePath || process.cwd(),
          shell: true,
          env: { ...process.env },
        });

        let output = '';
        proc.stdout?.on('data', (d) => (output += d.toString()));
        proc.on('close', (code) => {
          if (code === 0) {
            const chatId = output.trim().split('\n').pop()?.trim() || null;
            resolve(chatId);
          } else {
            resolve(null);
          }
        });
        proc.on('error', () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Cursor encodes reasoning effort in the model id itself (`-high`, `-xhigh`),
   * so never append `[effort=...]` here: cursor-agent rejects the whole id.
   */
  private buildCursorArgs(args: string[], options: AgentRunOptions) {
    const { prompt, model, mode, workspacePath, cursorChatId, continueLastSession } = options;

    args.push(
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--approve-mcps'
    );

    if (process.env.CURSOR_API_KEY) {
      args.push('--api-key', process.env.CURSOR_API_KEY);
    }

    if (cursorChatId) {
      args.push('--resume', cursorChatId);
    } else if (continueLastSession) {
      args.push('--continue');
    }

    if (model && model !== 'auto' && model !== 'default') {
      args.push('--model', model);
      console.log(`[AgentRunner] Cursor model: ${model}`);
    } else {
      console.log('[AgentRunner] Cursor model: auto (CLI default, no --model)');
    }

    if (mode === 'plan') {
      args.push('--mode', 'plan');
    } else if (mode === 'ask') {
      args.push('--mode', 'ask');
    } else if (mode === 'yolo' || mode === 'auto') {
      args.push('--yolo');
    } else if (mode === 'auto-review') {
      args.push('--auto-review');
    }

    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }

    args.push(prompt);
  }

  /**
   * Antigravity runs on its own CLI and its own Google account quota — it never
   * goes through cursor-agent. Effort is an Antigravity-only knob.
   */
  private buildAntigravityArgs(args: string[], options: AgentRunOptions) {
    const { prompt, model, mode, workspacePath, cursorChatId, continueLastSession, thinkingEffort } = options;

    args.push('--output-format', 'stream-json', '--disable-slash-commands');

    if (model && model !== 'auto' && model !== 'default') {
      args.push('--model', model);
    }

    // agy takes effort as its own flag, but model ids that already carry a level
    // (gemini-3.7-flash-high) conflict with it: "--model X conflicts with --effort".
    const modelCarriesEffort = Boolean(model && /-(low|medium|high)$/i.test(model));
    if (thinkingEffort && thinkingEffort !== 'off' && !modelCarriesEffort) {
      args.push('--effort', thinkingEffort);
    }

    // `ask` stays on agy's default mode: it answers directly, and a tool it is
    // not allowed to run comes back as a clear permission error.
    if (mode === 'plan') {
      args.push('--mode', 'plan');
    } else if (mode !== 'ask') {
      args.push('--mode', 'accept-edits', '--dangerously-skip-permissions');
    }

    if (cursorChatId) {
      args.push('--conversation', cursorChatId);
    } else if (continueLastSession) {
      args.push('--continue');
    }

    if (workspacePath) {
      args.push('--add-dir', workspacePath);
    }

    console.log(`[AgentRunner] Antigravity model: ${model || 'default'} effort: ${thinkingEffort || 'default'}`);

    args.push('--print', prompt);
  }

  public run(options: AgentRunOptions, callbacks: StreamCallbacks) {
    const { sessionId, engine, prompt, model, mode, workspacePath, cursorChatId, continueLastSession, thinkingEffort } = options;

    if (this.activeProcesses.has(sessionId)) {
      this.abort(sessionId);
    }

    const isAntigravity = engine === 'antigravity';

    const useDirectNode = !isAntigravity && Boolean(this.tools.nodeExe && this.tools.agentIndexJs);
    const binary = isAntigravity
      ? this.tools.antigravityCliCmd
      : (useDirectNode ? this.tools.nodeExe! : this.tools.cursorAgentCmd);

    if (!binary) {
      const missing = isAntigravity
        ? 'Antigravity CLI не знайдено на цій машині. Встанови Antigravity CLI або вкажи шлях у змінній ANTIGRAVITY_CLI_CMD.'
        : 'Cursor Agent CLI не знайдено на цій машині.';
      callbacks.onError(missing);
      callbacks.onComplete('⚠️ ' + missing, undefined, false, missing);
      return;
    }

    const args: string[] = [];
    if (useDirectNode) {
      args.push(this.tools.agentIndexJs!);
    }

    if (isAntigravity) {
      this.buildAntigravityArgs(args, options);
    } else {
      this.buildCursorArgs(args, options);
    }

    const cwd = workspacePath || process.cwd();
    console.log(`[AgentRunner] Spawning ${isAntigravity ? 'antigravity' : 'cursor'} agent: ${binary} ${args.join(' ')} (cwd: ${cwd})`);

    let fullOutput = '';
    let accumulatedText = '';
    let accumulatedThinking = '';
    let buffer = '';
    let detectedChatId: string | undefined = cursorChatId;
    let explicitError: string | undefined;

    // Node refuses to spawn .cmd/.bat wrappers without a shell on Windows (EINVAL),
    // and under a shell we have to quote the arguments ourselves.
    const needsShell = process.platform === 'win32' && /[.](cmd|bat)$/i.test(binary);
    const spawnArgs = needsShell ? args.map((a) => quoteForShell(a)) : args;

    const proc = spawn(needsShell ? quoteForShell(binary) : binary, spawnArgs, {
      cwd,
      shell: needsShell,
      env: {
        ...process.env,
        NO_OPEN_BROWSER: '1',
      },
    });

    const processEntry = { proc, isAborted: false };
    this.activeProcesses.set(sessionId, processEntry);
    console.log(`[AgentRunner] Child PID ${proc.pid} for session ${sessionId}`);

    proc.stdout?.on('data', (data: Buffer) => {
      if (processEntry.isAborted) return;
      const text = data.toString();
      fullOutput += text;
      buffer += text;

      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep trailing incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);

          if (parsed.session_id) detectedChatId = parsed.session_id;
          if (parsed.conversation_id) detectedChatId = parsed.conversation_id;

          // Antigravity (`agy`) speaks its own event dialect.
          if (isAntigravity && parsed.event) {
            if (parsed.event === 'init') {
              continue;
            }

            if (parsed.event === 'step_update' && parsed.step_update) {
              const step = parsed.step_update;
              if (step.conversation_id) detectedChatId = step.conversation_id;
              const delta = step.text_delta || '';
              const stepType = step.step_type || '';

              if (stepType === 'thinking' || stepType === 'reasoning') {
                if (delta && callbacks.onThinking) {
                  accumulatedThinking += delta;
                  callbacks.onThinking(accumulatedThinking, delta);
                }
              } else if (stepType === 'agent_response') {
                if (delta) {
                  accumulatedText += delta;
                  callbacks.onChunk(accumulatedText, delta);
                }
              } else if (stepType && stepType !== 'user_input' && stepType !== 'checkpoint') {
                const toolId = `${stepType}-${step.step_index}`;
                if (step.state === 'ACTIVE') {
                  callbacks.onToolCall({
                    id: toolId,
                    type: stepType,
                    name: step.tool_name || stepType,
                    input: step.tool_input || step.command || step.text_delta,
                    status: 'running',
                    startTime: Date.now(),
                  });
                } else if (step.state === 'DONE') {
                  callbacks.onToolResult(toolId, step.result || step.text_delta || '', 'completed');
                }
              }
              continue;
            }

            if (parsed.event === 'result' && parsed.result) {
              const res = parsed.result;
              if (res.conversation_id) detectedChatId = res.conversation_id;
              const answer = typeof res.response === 'string' ? res.response.trim() : '';
              // agy reports a failed tool call as status ERROR even when the turn
              // still produced an answer — keep the answer, drop the noise.
              if (typeof res.error === 'string' && res.error.trim() && !answer) {
                explicitError = res.error.trim();
              }
              if (answer) {
                accumulatedText = answer;
                callbacks.onChunk(accumulatedText, '');
              }
              continue;
            }

            continue;
          }

          // 0. Thinking / Reasoning chunks
          if (parsed.type === 'thinking' || parsed.thinking || parsed.thought || (parsed.type === 'message' && parsed.role === 'thought')) {
            const thinkText = parsed.thinking || parsed.thought || parsed.content || (parsed.message && parsed.message.content) || '';
            if (thinkText) {
              accumulatedThinking += (typeof thinkText === 'string' ? thinkText : JSON.stringify(thinkText));
              if (callbacks.onThinking) callbacks.onThinking(accumulatedThinking, typeof thinkText === 'string' ? thinkText : JSON.stringify(thinkText));
            }
          }
          // 1. Assistant message object
          else if (parsed.type === 'assistant' && parsed.message?.content) {
            let rawContent = Array.isArray(parsed.message.content)
              ? parsed.message.content.map((c: any) => c.text || '').join('')
              : (parsed.message.content || '');

            if (rawContent) {
              const thinkMatch = rawContent.match(/<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>/i);
              if (thinkMatch) {
                const extractedThink = thinkMatch[1].trim();
                accumulatedThinking += (accumulatedThinking ? '\n' : '') + extractedThink;
                if (callbacks.onThinking) callbacks.onThinking(accumulatedThinking, extractedThink);
                rawContent = rawContent.replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, '').trim();
              }

              if (parsed.timestamp_ms) {
                // Incremental stream delta
                accumulatedText += rawContent;
                callbacks.onChunk(accumulatedText, rawContent);
              } else {
                // Snapshot of the full turn — empty delta means replace, not append
                accumulatedText = rawContent;
                callbacks.onChunk(accumulatedText, '');
              }
            }
          }
          // 2. Direct delta / text chunk
          else if (parsed.delta) {
            let deltaText = parsed.delta;
            const thinkMatch = deltaText.match(/<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>/i);
            if (thinkMatch) {
              const extractedThink = thinkMatch[1].trim();
              accumulatedThinking += (accumulatedThinking ? '\n' : '') + extractedThink;
              if (callbacks.onThinking) callbacks.onThinking(accumulatedThinking, extractedThink);
              deltaText = deltaText.replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, '').trim();
            }

            accumulatedText += deltaText;
            callbacks.onChunk(accumulatedText, deltaText);
          }
          // 3. Tool use / call / action
          else if (parsed.type === 'tool_use' || parsed.tool_call || parsed.type === 'call' || parsed.type === 'action' || parsed.type === 'tool_call') {
            const toolCallObj = parsed.tool_call || parsed.call || parsed.tool || parsed;
            
            // Handle Cursor-agent specific schema (e.g. { shellToolCall: { args: {...} } })
            const cursorToolKey = Object.keys(toolCallObj).find(k => k.endsWith('ToolCall'));
            const targetObj = cursorToolKey ? toolCallObj[cursorToolKey] : toolCallObj;

            // If it's Cursor's completed tool event
            if (parsed.type === 'tool_call' && parsed.subtype === 'completed') {
              const resId = parsed.call_id || parsed.id || toolCallObj.id || toolCallObj.toolCallId || targetObj.toolCallId || '';
              const resObj = targetObj.result || targetObj.output || {};
              let resContent = resObj.success ? (resObj.success.stdout || resObj.success.output || resObj.success) : (resObj.error || resObj);
              callbacks.onToolResult(
                resId,
                typeof resContent === 'string' ? resContent : JSON.stringify(resContent, null, 2),
                resObj.error ? 'failed' : 'completed'
              );
              continue;
            }

            const rawInput = targetObj.input || targetObj.arguments || targetObj.parameters || targetObj.args || parsed.input || parsed.arguments || {};
            
            // Extract properly formatted name
            let toolName = targetObj.name || cursorToolKey || toolCallObj.name || toolCallObj.tool || parsed.name || parsed.tool || parsed.type || 'tool';
            if (toolName.includes(':')) {
              toolName = toolName.split(':').pop() || toolName;
            }

            let summary = '';
            if (typeof rawInput === 'object' && rawInput !== null) {
              summary = rawInput.toolSummary || rawInput.command || rawInput.CommandLine || rawInput.path || rawInput.TargetFile || rawInput.AbsolutePath || rawInput.query || rawInput.pattern || '';
            } else if (typeof rawInput === 'string') {
              summary = rawInput.slice(0, 100);
            }

            const action = (typeof rawInput === 'object' && rawInput !== null && rawInput.toolAction) || '';

            const resId = parsed.call_id || parsed.id || toolCallObj.id || toolCallObj.toolCallId || targetObj.toolCallId || Math.random().toString(36).substring(2, 8);

            const toolCall: ToolCallItem = {
              id: resId,
              type: toolName,
              name: toolName,
              summary: summary || undefined,
              action: action || undefined,
              input: rawInput,
              status: 'running',
              startTime: Date.now(),
            };
            callbacks.onToolCall(toolCall);
          }
          // 4. Official end-of-turn from cursor-agent
          else if (parsed.type === 'result') {
            const isErr = Boolean(parsed.is_error) || parsed.subtype === 'error';
            if (!isErr && parsed.result && typeof parsed.result === 'string') {
              accumulatedText = parsed.result;
              callbacks.onChunk(accumulatedText, '');
            }
            if (isErr) {
              const errorMsg = this.extractHumanError(
                typeof parsed.result === 'string' ? parsed.result : fullOutput,
                accumulatedText,
                1
              );
              callbacks.onComplete(errorMsg, detectedChatId, false, errorMsg);
            } else {
              callbacks.onComplete(accumulatedText, detectedChatId, true);
            }
            this.abort(sessionId);
            continue;
          }
          // 5. Tool result
          else if (parsed.type === 'tool_result' || parsed.type === 'call_result' || parsed.type === 'tool_output' || parsed.type === 'step_result') {
              const resContent = parsed.result !== undefined ? parsed.result : parsed.output !== undefined ? parsed.output : parsed.content;
              const resId = parsed.id || parsed.tool_call_id || parsed.call_id || (parsed.tool_result && parsed.tool_result.id) || '';
              callbacks.onToolResult(
                resId,
                typeof resContent === 'string' ? resContent : JSON.stringify(resContent, null, 2),
                parsed.is_error ? 'failed' : 'completed'
              );
          }
        } catch {
          // Ignore raw JSONL / noise — never dump stream-json into the chat
          if (!trimmed.startsWith('{')) {
            accumulatedText += trimmed + '\n';
            callbacks.onChunk(accumulatedText, trimmed + '\n');
          }
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (processEntry.isAborted) return;
      const errText = data.toString();
      fullOutput += errText;
      console.error(`[AgentRunner] stderr: ${errText}`);
      // Do not stream raw stderr/JSON into the chat UI
    });

    proc.on('close', (code) => {
      const wasAborted = processEntry.isAborted;
      this.activeProcesses.delete(sessionId);
      console.log(`[AgentRunner] Process for session ${sessionId} exited with code ${code} (aborted: ${wasAborted})`);

      if (wasAborted) {
        console.log(`[AgentRunner] Suppressing onComplete callbacks for aborted session ${sessionId}`);
        return;
      }

      // Flush remainder of buffer only if it looks like assistant text (not JSONL)
      if (buffer.trim() && !buffer.trim().startsWith('{')) {
        accumulatedText += buffer;
        callbacks.onChunk(accumulatedText, buffer);
      }

      // A non-zero exit still counts as an answer when the agent produced one
      // (agy exits 1 on a failed tool call even after answering).
      if ((code === 0 || accumulatedText.trim()) && !explicitError) {
        const content = this.pickHumanContent(accumulatedText, fullOutput);
        callbacks.onComplete(content, detectedChatId, true);
      } else {
        const errorMsg = explicitError
          ? `⚠️ ${explicitError}`
          : this.extractHumanError(fullOutput, accumulatedText, code);
        callbacks.onComplete(errorMsg, detectedChatId, false, errorMsg);
      }
    });

    proc.on('error', (err) => {
      const wasAborted = processEntry.isAborted;
      this.activeProcesses.delete(sessionId);
      if (wasAborted) return;
      console.error(`[AgentRunner] Spawn error:`, err);
      callbacks.onError(err.message);
      callbacks.onComplete(err.message, cursorChatId, false, err.message);
    });
  }

  public abortAll() {
    for (const sessionId of [...this.activeProcesses.keys()]) {
      this.abort(sessionId);
    }
  }

  public getActiveSessionIds(): string[] {
    return [...this.activeProcesses.keys()];
  }

  public abort(sessionId: string) {
    const processEntry = this.activeProcesses.get(sessionId);
    if (processEntry) {
      processEntry.isAborted = true;
      console.log(`[AgentRunner] Aborting session: ${sessionId}`);
      try {
        if (process.platform === 'win32' && processEntry.proc.pid) {
          spawn('taskkill', ['/pid', processEntry.proc.pid.toString(), '/f', '/t']);
        } else {
          processEntry.proc.kill('SIGINT');
        }
      } catch (err) {
        console.error('Error terminating process:', err);
      }
      this.activeProcesses.delete(sessionId);
    }
  }

  /** Prefer assistant text; never fall back to raw stream-json dumps. */
  private pickHumanContent(accumulatedText: string, fullOutput: string): string {
    const trimmed = (accumulatedText || '').trim();
    if (trimmed && !this.looksLikeStreamJson(trimmed)) {
      return trimmed;
    }
    const fromOutput = this.extractPlainTextFromOutput(fullOutput);
    return fromOutput || trimmed || '';
  }

  private looksLikeStreamJson(text: string): boolean {
    const t = text.trim();
    return t.startsWith('{') && /"type"\s*:/.test(t);
  }

  private extractPlainTextFromOutput(output: string): string {
    if (!output) return '';
    const lines = output.split(/\r?\n/);
    const texts: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed?.type === 'assistant' && typeof parsed?.message?.content === 'string') {
            texts.push(parsed.message.content);
          } else if (parsed?.type === 'result' && typeof parsed?.result === 'string') {
            texts.push(parsed.result);
          } else if (typeof parsed?.error === 'string') {
            texts.push(parsed.error);
          } else if (typeof parsed?.message === 'string' && parsed.type !== 'system' && parsed.type !== 'user') {
            texts.push(parsed.message);
          }
        } catch {
          // ignore non-JSON
        }
      } else if (!trimmed.startsWith('{')) {
        texts.push(trimmed);
      }
    }
    return texts.join('\n').trim();
  }

  private extractHumanError(fullOutput: string, accumulatedText: string, code: number | null): string {
    const blob = `${fullOutput}\n${accumulatedText}`;

    if (/Authentication required|not logged in|cursor-agent login/i.test(blob)) {
      return '⚠️ Cursor CLI потребує авторизації. Виконайте `cursor-agent login` у терміналі або встановіть `CURSOR_API_KEY`.';
    }

    const actionRequired = blob.match(/ActionRequiredError:\s*([^\n{]+)/i);
    if (actionRequired?.[1]) {
      return `⚠️ ${actionRequired[1].trim()}`;
    }

    if (/usage limit|spend limit|rate limit|quota/i.test(blob)) {
      const m = blob.match(/(You've hit your usage limit[^.]*\.[^.]*\.)/i)
        || blob.match(/(usage limit[^.]*\.)/i);
      if (m?.[1]) return `⚠️ ${m[1].trim()}`;
      return '⚠️ Вичерпано ліміт використання Cursor. Змініть модель або збільште Spend Limit.';
    }

    // Prefer result/error fields from stream-json
    const lines = blob.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.type === 'result' && parsed?.is_error) {
          const msg = parsed.result || parsed.error || parsed.message;
          if (typeof msg === 'string' && msg.trim() && !this.looksLikeStreamJson(msg)) {
            return `⚠️ ${msg.trim()}`;
          }
        }
        if (typeof parsed?.error === 'string' && parsed.error.trim()) {
          return `⚠️ ${parsed.error.trim()}`;
        }
      } catch {
        // continue
      }
    }

    // CLIs print a lot of noise (startup warnings, extension loader chatter);
    // an explicit error line is always a better answer than the first line.
    const noise = /^(warning:|\[extensionmanager\]|tools\.\d+:|\s*at\s)/i;
    const meaningful = lines
      .map((l) => l.trim())
      .filter((l) => l && !noise.test(l) && !l.startsWith('{'));

    const errorLine = meaningful.find((l) =>
      /(error|not logged in|ineligible|unauthorized|forbidden|quota|limit|failed)/i.test(l)
    );
    if (errorLine) {
      return `⚠️ ${errorLine.slice(0, 500)}`;
    }

    const plain = this.extractPlainTextFromOutput(fullOutput);
    if (plain && !this.looksLikeStreamJson(plain)) {
      const cleaned = plain
        .split(/\r?\n/)
        .filter((l) => l.trim() && !noise.test(l.trim()))
        .join('\n')
        .trim();
      if (cleaned) return `⚠️ ${cleaned.slice(0, 800)}`;
    }

    const acc = (accumulatedText || '').trim();
    if (acc && !this.looksLikeStreamJson(acc)) {
      return `⚠️ ${acc.slice(0, 800)}`;
    }

    return `⚠️ Агент завершився з помилкою (код ${code ?? '?'}). Перевірте логи воркера або ліміти Cursor.`;
  }
}
