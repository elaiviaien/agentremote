const { spawnSync } = require('child_process');

const nodeExe = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\anysphere.cursor-agent-worker\\agent-cli\\.local\\share\\cursor-agent\\versions\\2026.08.11-e8db854\\node.exe';
const agentIndexJs = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\anysphere.cursor-agent-worker\\agent-cli\\.local\\share\\cursor-agent\\versions\\2026.08.11-e8db854\\index.js';

const res = spawnSync(nodeExe, [agentIndexJs, 'about'], { encoding: 'utf8', timeout: 5000, shell: false });
const out = (res.stdout || '') + (res.stderr || '');
console.log('Raw output from about:');
console.log(out);

function parseCursorAbout(raw) {
  const info = {
    version: '',
    defaultModel: '',
    tier: '',
    email: '',
    os: '',
  };

  const verMatch = /CLI Version\s+([^\r\n]+)/i.exec(raw);
  if (verMatch) info.version = verMatch[1].trim();

  const modelMatch = /Model\s+([^\r\n]+)/i.exec(raw);
  if (modelMatch) info.defaultModel = modelMatch[1].trim();

  const tierMatch = /Subscription Tier\s+([^\r\n]+)/i.exec(raw);
  if (tierMatch) info.tier = tierMatch[1].trim();

  const emailMatch = /User Email\s+([^\r\n]+)/i.exec(raw);
  if (emailMatch) info.email = emailMatch[1].trim();

  const osMatch = /OS\s+([^\r\n]+)/i.exec(raw);
  if (osMatch) info.os = osMatch[1].trim();

  return info;
}

console.log('\nParsed Object:');
console.log(parseCursorAbout(out));
