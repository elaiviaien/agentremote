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

    const binary = this.tools.cursorAgentCmd;

    if (!binary) {
      // Fallback runner with helpful guide if cursor agent CLI is not detected
      callbacks.onError(
        'Cursor Agent CLI not found on this machine. Please make sure Cursor is installed, or add cursor-agent to PATH.'
      );
      callbacks.onComplete(
        '⚠️ Cursor Agent CLI is not detected on this machine.\n\nMake sure Cursor is installed and you have opened it at least once so the agent CLI is initialized.',
        undefined,
        false
      );
      return;
    }

    const args: string[] = ['--print', '--output-format', 'stream-json', '--stream-partial-output'];

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
    console.log(`[AgentRunner] Spawning: ${binary} ${args.join(' ')} (cwd: ${cwd})`);

    let fullOutput = '';
    let accumulatedText = '';
    let buffer = '';

    const proc = spawn(binary, args, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        // Prevent interactive browser login popups if running headless
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
          // Attempt JSON stream parsing
          const parsed = JSON.parse(trimmed);

          // Handle streaming text chunks
          if (parsed.delta || parsed.text || parsed.content) {
            const delta = parsed.delta || parsed.text || parsed.content;
            accumulatedText += delta;
            callbacks.onChunk(accumulatedText, delta);
          } else if (parsed.type === 'tool_use' || parsed.tool_call || parsed.type === 'call') {
            const toolCall: ToolCallItem = {
              id: parsed.id || Math.random().toString(36).substring(2, 8),
              type: parsed.tool || parsed.name || 'tool',
              name: parsed.name || parsed.tool || 'Tool Execution',
              input: parsed.input || parsed.arguments,
              status: 'running',
            };
            callbacks.onToolCall(toolCall);
          } else if (parsed.type === 'tool_result' || parsed.result) {
            callbacks.onToolResult(
              parsed.id || parsed.tool_call_id || '',
              typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result, null, 2),
              parsed.is_error ? 'failed' : 'completed'
            );
          } else if (parsed.type === 'message' || parsed.message) {
            const msgContent = parsed.message?.content || parsed.message;
            if (typeof msgContent === 'string') {
              accumulatedText = msgContent;
              callbacks.onChunk(accumulatedText, msgContent);
            }
          }
        } catch {
          // Non-JSON output (plain text log or error stream)
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
        const errorMsg = `Process exited with code ${code}`;
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
