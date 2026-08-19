import { spawn, ChildProcess } from 'child_process';

export interface TerminalCallbacks {
  onOutput: (data: string, isError?: boolean) => void;
  onExit: (code: number) => void;
}

export class TerminalRunner {
  private runningCommands = new Map<string, ChildProcess>();

  public run(commandId: string, command: string, cwd: string | undefined, callbacks: TerminalCallbacks) {
    if (this.runningCommands.has(commandId)) {
      this.kill(commandId);
    }

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/bash';
    const args = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

    console.log(`[TerminalRunner] Executing: ${command} in ${cwd || process.cwd()}`);

    const proc = spawn(shell, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
    });

    this.runningCommands.set(commandId, proc);

    proc.stdout?.on('data', (data: Buffer) => {
      callbacks.onOutput(data.toString(), false);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      callbacks.onOutput(data.toString(), true);
    });

    proc.on('close', (code) => {
      this.runningCommands.delete(commandId);
      callbacks.onExit(code || 0);
    });

    proc.on('error', (err) => {
      this.runningCommands.delete(commandId);
      callbacks.onOutput(`Process error: ${err.message}\n`, true);
      callbacks.onExit(1);
    });
  }

  public kill(commandId: string) {
    const proc = this.runningCommands.get(commandId);
    if (proc) {
      if (process.platform === 'win32' && proc.pid) {
        try {
          spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
        } catch {}
      } else {
        proc.kill('SIGKILL');
      }
      this.runningCommands.delete(commandId);
    }
  }
}
