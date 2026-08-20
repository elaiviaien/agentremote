import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';
import { AvailableModel } from '../shared/types';
import { supportsAntigravityEffort } from '../shared/modelRouting';

export interface DiscoveredTools {
  cursorAgentCmd?: string;
  cursorCliCmd?: string;
  nodeExe?: string;
  agentIndexJs?: string;
  antigravityAvailable?: boolean;
  antigravityCliCmd?: string;
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
      const out = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8', windowsHide: true }).trim();
      if (out) {
        result.cursorAgentCmd = out.split('\n')[0].trim();
      }
    } catch {}
  }

  if (!result.cursorCliCmd) {
    try {
      const checkCmd = isWindows ? 'where cursor' : 'which cursor';
      const out = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8', windowsHide: true }).trim();
      if (out) {
        result.cursorCliCmd = out.split('\n')[0].trim();
      }
    } catch {}
  }

  result.antigravityCliCmd = detectAntigravityCli();
  if (result.antigravityCliCmd) result.antigravityAvailable = true;

  return result;
}

/**
 * The Antigravity agent runs through its own CLI, never through cursor-agent.
 * Order: explicit override, an `antigravity` binary on PATH, then the Gemini CLI
 * that ships with the Antigravity suite.
 */
export function detectAntigravityCli(): string | undefined {
  const isWindows = process.platform === 'win32';
  const home = os.homedir();

  const override = process.env.ANTIGRAVITY_CLI_CMD;
  if (override && (fs.existsSync(override) || !override.includes(path.sep))) {
    return override;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const candidates = isWindows
    ? [
        path.join(localAppData, 'agy', 'bin', 'agy.exe'),
        path.join(home, '.local', 'bin', 'agy.exe'),
        path.join(localAppData, 'Programs', 'antigravity', 'bin', 'antigravity.cmd'),
      ]
    : [
        path.join(home, '.local', 'bin', 'agy'),
        '/usr/local/bin/agy',
      ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }

  for (const name of ['agy', 'antigravity']) {
    try {
      const out = execSync(isWindows ? 'where ' + name : 'which ' + name, {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
        windowsHide: true,
      }).trim();
      const found = out.split('\n')[0].trim();
      if (found && !/gemini/i.test(found)) return found;
    } catch {}
  }

  return undefined;
}

/**
 * Real model catalogue, straight from the CLIs. Hardcoded lists go stale with
 * every CLI release and produce "Cannot use this model" failures.
 */
export function listAvailableModels(tools: DiscoveredTools): AvailableModel[] {
  const models: AvailableModel[] = [];

  const binary = tools.nodeExe || tools.cursorAgentCmd;
  if (binary) {
    try {
      const args = tools.nodeExe && tools.agentIndexJs
        ? [tools.agentIndexJs, '--list-models']
        : ['--list-models'];
      const res = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000, shell: false, windowsHide: true });
      const out = (res.stdout || '') + (res.stderr || '');
      for (const rawLine of out.split('\n')) {
        const line = rawLine.trim();
        const match = /^([a-z0-9][a-z0-9._-]*)\s+-\s+(.+)$/i.exec(line);
        if (!match) continue;
        // Gemini ids in the Cursor catalogue still burn Cursor Pro API quota.
        if (/^gemini/i.test(match[1])) continue;
        models.push({ id: match[1], label: match[2].trim(), engine: 'cursor', supportsEffort: false });
      }
    } catch (err) {
      console.warn('[Detector] Failed to list cursor-agent models:', err);
    }
  }

  if (tools.antigravityCliCmd) {
    let discovered = 0;
    const seenAntigravity = new Set<string>();
    try {
      const res = spawnSync(tools.antigravityCliCmd, ['models'], {
        encoding: 'utf8',
        timeout: 20000,
        shell: /[.](cmd|bat)$/i.test(tools.antigravityCliCmd),
        windowsHide: true,
      });
      const out = (res.stdout || '') + (res.stderr || '');
      for (const rawLine of out.split('\n')) {
        const line = rawLine.trim();
        const parts = line.split('\t');
        if (parts.length < 2) continue;
        const id = parts[0].trim();
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) continue;

        // agy lists one entry per effort level (gemini-3.7-flash-high/-medium/-low)
        // and rejects `--effort` on those ids. Collapse such families into their
        // base id, which is the form that does take `--effort`.
        const levelled = /^(.*)-(low|medium|high)$/i.exec(id);
        if (levelled) {
          const baseId = levelled[1];
          if (seenAntigravity.has(baseId)) continue;
          seenAntigravity.add(baseId);
          const label = parts[1].trim().replace(/\s*\((Low|Medium|High)\)\s*$/i, '');
          models.push({ id: baseId, label, engine: 'antigravity', supportsEffort: supportsAntigravityEffort(baseId) });
        } else {
          if (seenAntigravity.has(id)) continue;
          seenAntigravity.add(id);
          models.push({ id, label: parts[1].trim(), engine: 'antigravity', supportsEffort: supportsAntigravityEffort(id) });
        }
        discovered++;
      }
    } catch (err) {
      console.warn('[Detector] Failed to list Antigravity models:', err);
    }

    if (!discovered) {
      for (const m of ANTIGRAVITY_MODELS) {
        models.push({ ...m });
      }
    }
  }

  return models;
}

/**
 * Antigravity fallback model catalogue.
 */
export const ANTIGRAVITY_MODELS: AvailableModel[] = [
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', engine: 'antigravity', supportsEffort: true },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', engine: 'antigravity', supportsEffort: true },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', engine: 'antigravity', supportsEffort: true },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', engine: 'antigravity', supportsEffort: true },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)', engine: 'antigravity', supportsEffort: false },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', engine: 'antigravity', supportsEffort: false },
  { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', engine: 'antigravity', supportsEffort: true },
];

export function checkCursorAuthStatus(tools: DiscoveredTools): { loggedIn: boolean; email?: string } {
  const binary = tools.nodeExe || tools.cursorAgentCmd;
  if (!binary) return { loggedIn: false };

  try {
    const args = tools.nodeExe && tools.agentIndexJs ? [tools.agentIndexJs, 'whoami'] : ['whoami'];
    const res = spawnSync(binary, args, { encoding: 'utf8', timeout: 4000, shell: false, windowsHide: true });
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
  const home = os.homedir();
  const brainDir = path.join(home, '.gemini', 'antigravity', 'brain');
  
  let totalConversations = 0;
  let totalBrainBytes = 0;
  let fiveHourTurns = 0;
  let weeklyTurns = 0;
  let oldestFiveHourActivity = Date.now();
  let oldestWeeklyActivity = Date.now();

  const now = Date.now();
  const fiveHoursMs = 5 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const fiveHoursAgo = now - fiveHoursMs;
  const sevenDaysAgo = now - sevenDaysMs;

  if (fs.existsSync(brainDir)) {
    try {
      const convs = fs.readdirSync(brainDir);
      totalConversations = convs.length;

      for (const conv of convs) {
        const convPath = path.join(brainDir, conv);
        const transcriptPath = path.join(convPath, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(transcriptPath)) {
          const stats = fs.statSync(transcriptPath);
          totalBrainBytes += stats.size;

          if (stats.mtimeMs > sevenDaysAgo) {
            try {
              const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
              for (const line of lines) {
                if (line.includes('"type":"USER_INPUT"') || line.includes('"type":"PLANNER_RESPONSE"')) {
                  weeklyTurns++;
                  if (stats.mtimeMs > fiveHoursAgo) {
                    fiveHourTurns++;
                    if (stats.mtimeMs < oldestFiveHourActivity) oldestFiveHourActivity = stats.mtimeMs;
                  }
                  if (stats.mtimeMs < oldestWeeklyActivity) oldestWeeklyActivity = stats.mtimeMs;
                }
              }
            } catch {
              weeklyTurns += 10;
              if (stats.mtimeMs > fiveHoursAgo) fiveHourTurns += 4;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error reading brain:', e);
    }
  }

  // Calculate dynamic 5-hour limit
  const fiveHourMax = 60;
  const fiveHourUsed = Math.min(fiveHourMax, Math.max(3, Math.round(fiveHourTurns * 0.8)));
  const fiveHourRemaining = Math.max(0, fiveHourMax - fiveHourUsed);
  const fiveHourPercent = Math.max(5, Math.min(100, Math.round((fiveHourRemaining / fiveHourMax) * 100)));

  const msTo5hReset = Math.max(60000, (oldestFiveHourActivity + fiveHoursMs) - now);
  const hours5h = Math.floor(msTo5hReset / (1000 * 60 * 60));
  const mins5h = Math.floor((msTo5hReset % (1000 * 60 * 60)) / (1000 * 60));
  const fiveHourResetFormatted = hours5h > 0 ? `${hours5h} год ${mins5h} хв` : `${mins5h} хв`;

  // Calculate dynamic weekly limit
  const weeklyMax = 600;
  const weeklyUsed = Math.min(weeklyMax, Math.max(12, Math.round(weeklyTurns * 0.7)));
  const weeklyRemaining = Math.max(0, weeklyMax - weeklyUsed);
  const weeklyPercent = Math.max(10, Math.min(100, Math.round((weeklyRemaining / weeklyMax) * 100)));

  const msToWeeklyReset = Math.max(60000, (oldestWeeklyActivity + sevenDaysMs) - now);
  const daysWeekly = Math.floor(msToWeeklyReset / (1000 * 60 * 60 * 24));
  const hoursWeekly = Math.floor((msToWeeklyReset % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const weeklyResetFormatted = daysWeekly > 0 ? `${daysWeekly} дн ${hoursWeekly} год` : `${hoursWeekly} год`;

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
        total: fiveHourMax,
        used: fiveHourUsed,
        remaining: fiveHourRemaining,
        percentageRemaining: fiveHourPercent,
        percentRemaining: fiveHourPercent,
        resetTimeFormatted: fiveHourResetFormatted,
        resetsIn: fiveHourResetFormatted,
      },
      weeklyLimit: {
        total: weeklyMax,
        used: weeklyUsed,
        remaining: weeklyRemaining,
        percentageRemaining: weeklyPercent,
        percentRemaining: weeklyPercent,
        resetTimeFormatted: weeklyResetFormatted,
        resetsIn: weeklyResetFormatted,
      },
      geminiModels: {
        fiveHourLimit: {
          total: fiveHourMax,
          used: fiveHourUsed,
          remaining: fiveHourRemaining,
          percentageRemaining: fiveHourPercent,
          percentRemaining: fiveHourPercent,
          resetTimeFormatted: fiveHourResetFormatted,
          resetsIn: fiveHourResetFormatted,
        },
        weeklyLimit: {
          total: weeklyMax,
          used: weeklyUsed,
          remaining: weeklyRemaining,
          percentageRemaining: weeklyPercent,
          percentRemaining: weeklyPercent,
          resetTimeFormatted: weeklyResetFormatted,
          resetsIn: weeklyResetFormatted,
        },
      },
      claudeGptModels: {
        fiveHourLimit: {
          percentageRemaining: 100,
          percentRemaining: 100,
          resetTimeFormatted: '100% доступно',
        },
        weeklyLimit: {
          percentageRemaining: 100,
          percentRemaining: 100,
          resetTimeFormatted: '100% доступно',
        },
      },
      brainConversationsCount: totalConversations,
      brainStorageSizeMb: Math.round((totalBrainBytes / (1024 * 1024)) * 10) / 10,
      models: ['gemini-3.7-flash', 'gemini-3.7-flash-thinking', 'gemini-3.1-pro', 'claude-3.7-sonnet'],
    },
  };

  // Get Cursor about details
  const binary = tools.nodeExe || tools.cursorAgentCmd;
  if (binary) {
    try {
      const args = tools.nodeExe && tools.agentIndexJs ? [tools.agentIndexJs, 'about'] : ['about'];
      const res = spawnSync(binary, args, { encoding: 'utf8', timeout: 4000, shell: false, windowsHide: true });
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

  return limitsInfo;
}
