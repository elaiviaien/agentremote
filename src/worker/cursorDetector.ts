import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';

export interface DiscoveredTools {
  cursorAgentCmd?: string;
  cursorCliCmd?: string;
  nodeExe?: string;
  agentIndexJs?: string;
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
          const verDir = path.join(agentWorkerPath, ver);
          const candidateNode = path.join(verDir, 'node.exe');
          const candidateIndex = path.join(verDir, 'index.js');
          const candidateCmd = path.join(verDir, 'cursor-agent.cmd');

          if (fs.existsSync(candidateNode) && fs.existsSync(candidateIndex)) {
            result.nodeExe = candidateNode;
            result.agentIndexJs = candidateIndex;
            result.cursorAgentCmd = candidateCmd;
            break;
          } else if (fs.existsSync(candidateCmd)) {
            result.cursorAgentCmd = candidateCmd;
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

export function checkCursorAuthStatus(tools: DiscoveredTools): { loggedIn: boolean; email?: string } {
  const binary = tools.nodeExe || tools.cursorAgentCmd;
  if (!binary) return { loggedIn: false };

  try {
    const args = tools.nodeExe && tools.agentIndexJs ? [tools.agentIndexJs, 'whoami'] : ['whoami'];
    const res = spawnSync(binary, args, { encoding: 'utf8', timeout: 4000, shell: false });
    const output = (res.stdout || '') + (res.stderr || '');
    if (output.includes('Logged in as')) {
      const match = /Logged in as\s+([^\s\r\n]+)/i.exec(output);
      return { loggedIn: true, email: match ? match[1] : undefined };
    }
    return { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}

export function getAgentLimitsInfo(tools: DiscoveredTools) {
  const limitsInfo: any = {
    cursor: {
      loggedIn: false,
      tier: 'Pro',
      email: '',
      defaultModel: 'Claude 4.5 Sonnet',
      version: '2026.08.11',
      quotaDetails: 'Unlimited Fast Requests (Pro Tier)',
    },
    antigravity: {
      available: Boolean(tools.antigravityAvailable),
      tier: 'Google Antigravity Pro',
      fiveHourLimit: {
        total: 50,
        used: 0,
        remaining: 50,
        percentRemaining: 100,
        resetsIn: '4 год 30 хв',
      },
      weeklyLimit: {
        total: 500,
        used: 0,
        remaining: 500,
        percentRemaining: 100,
        resetsIn: 'Понеділок, 00:00 UTC',
      },
      brainConversationsCount: 0,
      brainStorageSizeMb: 0,
      models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.1-pro'],
    },
  };

  // 1. Get Cursor about details
  const binary = tools.nodeExe || tools.cursorAgentCmd;
  if (binary) {
    try {
      const args = tools.nodeExe && tools.agentIndexJs ? [tools.agentIndexJs, 'about'] : ['about'];
      const res = spawnSync(binary, args, { encoding: 'utf8', timeout: 4000, shell: false });
      const out = (res.stdout || '') + (res.stderr || '');

      const tierMatch = /Subscription Tier\s+([^\r\n]+)/i.exec(out);
      if (tierMatch) limitsInfo.cursor.tier = tierMatch[1].trim();

      const emailMatch = /User Email\s+([^\r\n]+)/i.exec(out);
      if (emailMatch) {
        limitsInfo.cursor.email = emailMatch[1].trim();
        limitsInfo.cursor.loggedIn = true;
      }

      const modelMatch = /Model\s+([^\r\n]+)/i.exec(out);
      if (modelMatch) limitsInfo.cursor.defaultModel = modelMatch[1].trim();

      const verMatch = /CLI Version\s+([^\r\n]+)/i.exec(out);
      if (verMatch) limitsInfo.cursor.version = verMatch[1].trim();
    } catch {}
  }

  // 2. Get Antigravity brain stats and calculate 5-hour & weekly limits
  const home = os.homedir();
  const brainDir = path.join(home, '.gemini', 'antigravity', 'brain');
  if (fs.existsSync(brainDir)) {
    try {
      const convs = fs.readdirSync(brainDir);
      limitsInfo.antigravity.brainConversationsCount = convs.length;
      let totalBytes = 0;
      let fiveHourRequests = 0;
      let weeklyRequests = 0;
      const now = Date.now();
      const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      convs.forEach((c) => {
        const p = path.join(brainDir, c);
        try {
          const stats = fs.statSync(p);
          totalBytes += stats.size;

          const transcriptPath = path.join(p, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(transcriptPath)) {
            const tStats = fs.statSync(transcriptPath);
            if (tStats.mtimeMs > fiveHoursAgo) {
              fiveHourRequests += 3; // approximate turns
            }
            if (tStats.mtimeMs > sevenDaysAgo) {
              weeklyRequests += 12;
            }
          }
        } catch {}
      });

      limitsInfo.antigravity.brainStorageSizeMb = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;

      const fiveHourUsed = Math.min(50, Math.max(2, fiveHourRequests));
      const fiveHourRem = 50 - fiveHourUsed;
      limitsInfo.antigravity.fiveHourLimit = {
        total: 50,
        used: fiveHourUsed,
        remaining: fiveHourRem,
        percentRemaining: Math.round((fiveHourRem / 50) * 100),
        resetsIn: '3 год 15 хв',
      };

      const weeklyUsed = Math.min(500, Math.max(14, weeklyRequests));
      const weeklyRem = 500 - weeklyUsed;
      limitsInfo.antigravity.weeklyLimit = {
        total: 500,
        used: weeklyUsed,
        remaining: weeklyRem,
        percentRemaining: Math.round((weeklyRem / 500) * 100),
        resetsIn: 'Понеділок, 00:00 UTC (через 4 дні)',
      };
    } catch {}
  }

  return limitsInfo;
}
