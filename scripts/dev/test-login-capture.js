const { spawn } = require('child_process');
const path = require('path');
const appData = process.env.APPDATA || '';
const cmd = path.join(
  appData,
  'Cursor',
  'User',
  'globalStorage',
  'anysphere.cursor-agent-worker',
  'agent-cli',
  '.local',
  'share',
  'cursor-agent',
  'versions',
  '2026.08.11-e8db854',
  'cursor-agent.cmd'
);

console.log('Testing cmd:', cmd);
const proc = spawn(cmd, ['login'], {
  shell: true,
  env: { ...process.env, NO_OPEN_BROWSER: '1' },
});

let detected = false;
let buffer = '';

proc.stdout.on('data', (d) => {
  const text = d.toString();
  buffer += text;
  console.log('STDOUT CHUNK:', text);
  const match = buffer.match(/https:\/\/cursor\.com\/loginDeepControl[^\s\r\n"'>]+/);
  if (match && !detected) {
    detected = true;
    console.log('\n>>> SUCCESS! DETECTED AUTH URL:', match[0], '\n');
    proc.kill();
    process.exit(0);
  }
});

proc.stderr.on('data', (d) => {
  console.log('STDERR:', d.toString());
});

setTimeout(() => {
  console.log('Timeout after 12s');
  proc.kill();
  process.exit(1);
}, 12000);
