import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export interface DiscoveredTools {
  cursorAgentCmd?: string;
  cursorCliCmd?: string;
  antigravityAvailable?: boolean;
}

export function detectCursorTools(): DiscoveredTools {
  const result: DiscoveredTools = {};
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  // 1. Search for cursor-agent CLI binary/script
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    // A. Check anysphere.cursor-agent-worker version paths
    const agentWorkerPath = path.join(
      appData,
      'Cursor',
      'User',
      'globalStorage',
      'anysphere.cursor-agent-worker',
      'agent-cli',
      '.local',
      'share',
      'cursor-agent',
      'versions'
    );

    if (fs.existsSync(agentWorkerPath)) {
      try {
        const versions = fs.readdirSync(agentWorkerPath).sort().reverse();
        for (const ver of versions) {
          const candidateCmd = path.join(agentWorkerPath, ver, 'cursor-agent.cmd');
          const candidatePs1 = path.join(agentWorkerPath, ver, 'cursor-agent.ps1');
          if (fs.existsSync(candidateCmd)) {
            result.cursorAgentCmd = candidateCmd;
            break;
          } else if (fs.existsSync(candidatePs1)) {
            result.cursorAgentCmd = candidatePs1;
            break;
          }
        }
      } catch (err) {
        console.warn('Error reading cursor-agent versions:', err);
      }
    }

    // B. Check standard Cursor CLI in Program Files / Local Programs
    const cursorCliCandidates = [
      path.join(localAppData, 'Programs', 'cursor', '_', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(localAppData, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Cursor', 'bin', 'cursor.cmd'),
    ];

    for (const cand of cursorCliCandidates) {
      if (fs.existsSync(cand)) {
        result.cursorCliCmd = cand;
        break;
      }
    }

    // C. Check Antigravity
    const antigravityCandidates = [
      path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
    ];
    for (const cand of antigravityCandidates) {
      if (fs.existsSync(cand)) {
        result.antigravityAvailable = true;
        break;
      }
    }
  } else if (isMac) {
    const home = os.homedir();
    const macAgentPath = path.join(
      home,
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'globalStorage',
      'anysphere.cursor-agent-worker',
      'agent-cli',
      '.local',
      'share',
      'cursor-agent',
      'versions'
    );

    if (fs.existsSync(macAgentPath)) {
      try {
        const versions = fs.readdirSync(macAgentPath).sort().reverse();
        for (const ver of versions) {
          const candidate = path.join(macAgentPath, ver, 'cursor-agent');
          if (fs.existsSync(candidate)) {
            result.cursorAgentCmd = candidate;
            break;
          }
        }
      } catch {}
    }

    const macCli = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
    if (fs.existsSync(macCli)) {
      result.cursorCliCmd = macCli;
    }
  } else if (isLinux) {
    const home = os.homedir();
    const linuxAgentPath = path.join(
      home,
      '.config',
      'Cursor',
      'User',
      'globalStorage',
      'anysphere.cursor-agent-worker',
      'agent-cli',
      '.local',
      'share',
      'cursor-agent',
      'versions'
    );

    if (fs.existsSync(linuxAgentPath)) {
      try {
        const versions = fs.readdirSync(linuxAgentPath).sort().reverse();
        for (const ver of versions) {
          const candidate = path.join(linuxAgentPath, ver, 'cursor-agent');
          if (fs.existsSync(candidate)) {
            result.cursorAgentCmd = candidate;
            break;
          }
        }
      } catch {}
    }
  }

  // 2. Fallback: check PATH
  if (!result.cursorAgentCmd) {
    try {
      const checkCmd = isWindows ? 'where cursor-agent' : 'which cursor-agent';
      const out = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
      if (out) {
        result.cursorAgentCmd = out.split('\n')[0].trim();
      }
    } catch {}
  }

  if (!result.cursorCliCmd) {
    try {
      const checkCmd = isWindows ? 'where cursor' : 'which cursor';
      const out = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
      if (out) {
        result.cursorCliCmd = out.split('\n')[0].trim();
      }
    } catch {}
  }

  return result;
}
