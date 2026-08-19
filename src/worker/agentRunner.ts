import { spawn, ChildProcess } from 'child_process';
import { AgentRunOptions, ToolCallItem } from '../shared/types';
import { DiscoveredTools } from './cursorDetector';

export interface StreamCallbacks {
  onChunk: (chunk: string, delta?: string) => void;
  onToolCall: (toolCall: ToolCallItem) => void;
  onToolResult: (toolCallId: string, result: string, status: 'completed' | 'failed') => void;
  onComplete: (fullContent: string, cursorChatId?: string, success?: boolean, error?: string) => void;
  onError: (error: string) => void;
}

export class AgentRunner {
  private activeProcesses = new Map<string, ChildProcess>();

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

  public run(options: AgentRunOptions, callbacks: StreamCallbacks) {
    const { sessionId, prompt, model, mode, workspacePath, cursorChatId, continueLastSession } = options;

    if (this.activeProcesses.has(sessionId)) {
      this.abort(sessionId);
    }

    const useDirectNode = Boolean(this.tools.nodeExe && this.tools.agentIndexJs);
    const binary = useDirectNode ? this.tools.nodeExe! : this.tools.cursorAgentCmd;

    if (!binary) {
      callbacks.onError('Cursor Agent CLI not found on this machine.');
      callbacks.onComplete('⚠️ Cursor Agent CLI is not detected on this machine.', undefined, false);
      return;
    }

    const args: string[] = [];
    if (useDirectNode) {
      args.push(this.tools.agentIndexJs!);
    }

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

    if (model) {
      args.push('--model', model);
    }

    if (mode === 'plan') {
      args.push('--mode', 'plan');
    } else if (mode === 'ask') {
      args.push('--mode', 'ask');
    } else if (mode === 'yolo') {
      args.push('--yolo');
    }

    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }

    args.push(prompt);

    const cwd = workspacePath || process.cwd();
    console.log(`[AgentRunner] Spawning (direct: ${useDirectNode}): ${binary} ${args.join(' ')} (cwd: ${cwd})`);

    let fullOutput = '';
    let accumulatedText = '';
    let buffer = '';

    const proc = spawn(binary, args, {
      cwd,
      shell: false,
      env: {
        ...process.env,
        NO_OPEN_BROWSER: '1',
      },
    });

    this.activeProcesses.set(sessionId, proc);

    proc.stdout?.on('data', (data: Buffer) => {
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

          // 1. Check assistant message object
          if (parsed.type === 'assistant' && parsed.message?.content) {
            if (Array.isArray(parsed.message.content)) {
              const chunk = parsed.message.content.map((c: any) => c.text || '').join('');
              if (chunk) {
                accumulatedText += chunk;
                callbacks.onChunk(accumulatedText, chunk);
              }
            } else if (typeof parsed.message.content === 'string') {
              accumulatedText = parsed.message.content;
              callbacks.onChunk(accumulatedText, parsed.message.content);
            }
          }
          // 2. Check direct delta/text
          else if (parsed.delta || parsed.text || parsed.content) {
            const delta = parsed.delta || parsed.text || parsed.content;
            accumulatedText += delta;
            callbacks.onChunk(accumulatedText, delta);
          }
          // 3. Check tool use/call
          else if (parsed.type === 'tool_use' || parsed.tool_call || parsed.type === 'call') {
            const toolCall: ToolCallItem = {
              id: parsed.id || Math.random().toString(36).substring(2, 8),
              type: parsed.tool || parsed.name || 'tool',
              name: parsed.name || parsed.tool || 'Tool Execution',
              input: parsed.input || parsed.arguments,
              status: 'running',
            };
            callbacks.onToolCall(toolCall);
          }
          // 4. Check tool result
          else if (parsed.type === 'tool_result' || parsed.result) {
            if (parsed.type === 'result' && parsed.subtype === 'success') {
              if (parsed.result && !accumulatedText) {
                accumulatedText = parsed.result;
                callbacks.onChunk(accumulatedText, parsed.result);
              }
            } else {
              callbacks.onToolResult(
                parsed.id || parsed.tool_call_id || '',
                typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result, null, 2),
                parsed.is_error ? 'failed' : 'completed'
              );
            }
          }
        } catch {
          // Plain text fallback
          accumulatedText += trimmed + '\n';
          callbacks.onChunk(accumulatedText, trimmed + '\n');
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const errText = data.toString();
      fullOutput += errText;
      console.error(`[AgentRunner] stderr: ${errText}`);
      callbacks.onChunk(accumulatedText + '\n' + errText, errText);
    });

    proc.on('close', (code) => {
      this.activeProcesses.delete(sessionId);
      console.log(`[AgentRunner] Process for session ${sessionId} exited with code ${code}`);

      // Flush remainder of buffer
      if (buffer.trim()) {
        accumulatedText += buffer;
        callbacks.onChunk(accumulatedText, buffer);
      }

      if (code === 0) {
        callbacks.onComplete(accumulatedText || fullOutput, cursorChatId, true);
      } else {
        let errorMsg = `Process exited with code ${code}`;
        if (fullOutput.includes('Authentication required')) {
          errorMsg = '⚠️ Cursor CLI потребує авторизації. Будь ласка, виконайте `cursor-agent login` у терміналі або встановіть змінну `CURSOR_API_KEY`.';
          if (!accumulatedText.includes(errorMsg)) {
            accumulatedText = errorMsg + '\n\n' + accumulatedText;
          }
        }
        callbacks.onComplete(accumulatedText || fullOutput || errorMsg, cursorChatId, false, errorMsg);
      }
    });

    proc.on('error', (err) => {
      this.activeProcesses.delete(sessionId);
      console.error(`[AgentRunner] Spawn error:`, err);
      callbacks.onError(err.message);
      callbacks.onComplete(err.message, cursorChatId, false, err.message);
    });
  }

  public abort(sessionId: string) {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      console.log(`[AgentRunner] Aborting session: ${sessionId}`);
      try {
        if (process.platform === 'win32' && proc.pid) {
          spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
        } else {
          proc.kill('SIGINT');
        }
      } catch (err) {
        console.error('Error terminating process:', err);
      }
      this.activeProcesses.delete(sessionId);
    }
  }
}
