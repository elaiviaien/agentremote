const { spawn } = require('child_process');
const path = require('path');
const versionDir =
  'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\anysphere.cursor-agent-worker\\agent-cli\\.local\\share\\cursor-agent\\versions\\2026.08.11-e8db854';
const nodePath = path.join(versionDir, 'node.exe');
const indexPath = path.join(versionDir, 'index.js');

const args = [
  indexPath,
  '--print',
  '--output-format',
  'stream-json',
  '--stream-partial-output',
  '--trust',
  '--approve-mcps',
  '--workspace',
  'C:\\Users\\olivka\\Documents\\agentremote',
  'Say hello in exactly three words',
];

console.log('Spawning direct Node:', nodePath);
const proc = spawn(nodePath, args, {
  cwd: 'C:\\Users\\olivka\\Documents\\agentremote',
  shell: false,
});

proc.stdout.on('data', (d) => process.stdout.write(d.toString()));
proc.stderr.on('data', (d) => process.stderr.write(d.toString()));
proc.on('close', (code) => console.log('\nExit code:', code));
