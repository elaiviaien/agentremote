import WebSocket from 'ws';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.HUB_URL || 'http://127.0.0.1:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws');
const USERNAME = process.env.ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const WORKSPACE = process.env.DEFAULT_WORKSPACE || process.cwd();
const PROMPT =
  process.env.E2E_PROMPT ||
  'Треба покращити мобільну верстку. Зараз екран чату занадто насичений на телефоні, а також є багато проблем відображення у різних місцях. Зроби реальні CSS/HTML правки в цьому репозиторії AgentRemote (src/client), щоб чат, сайдбар, інпут і tool-call картки нормально виглядали на ширині 390px. Не зупиняйся після двох tool call — доведи до робочого результату і коротко підсумуй, що змінилось.';

function now() {
  return new Date().toISOString();
}

async function snapshotProcesses() {
  return await new Promise<string>((resolve) => {
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|cursor-agent' -and $_.CommandLine -match 'dist\\\\server|dist\\\\worker|agent-cli|--print' } | ForEach-Object { '{0} pid={1} {2}' -f $_.Name, $_.ProcessId, ($_.CommandLine.Substring(0, [Math]::Min(160, $_.CommandLine.Length))) }`,
      ],
      { windowsHide: true }
    );
    let buf = '';
    ps.stdout.on('data', (d) => (buf += d.toString()));
    ps.stderr.on('data', (d) => (buf += d.toString()));
    ps.on('close', () => resolve(buf.trim() || '(none)'));
  });
}

async function main() {
  console.log(`[${now()}] E2E large run against ${BASE_URL}`);
  console.log(`[${now()}] workspace=${WORKSPACE}`);

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`login failed ${loginRes.status} ${await loginRes.text()}`);
  }
  const { token } = (await loginRes.json()) as { token: string };

  const devicesRes = await fetch(`${BASE_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { devices } = (await devicesRes.json()) as { devices: any[] };
  const dev = devices.find((d) => d.status === 'online') || devices[0];
  if (!dev) throw new Error('No worker device registered');
  console.log(`[${now()}] device=${dev.name} id=${dev.id} status=${dev.status}`);

  const createRes = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: dev.id,
      engine: 'cursor',
      model: 'auto',
      mode: 'yolo',
      workspacePath: WORKSPACE,
      title: 'E2E mobile layout',
    }),
  });
  const { session } = (await createRes.json()) as { session: { id: string } };
  console.log(`[${now()}] session=${session.id}`);

  const ws = new WebSocket(`${WS_URL}/ws/client?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  console.log(`[${now()}] client websocket open`);

  const counts = { chunk: 0, thinking: 0, tool: 0, toolResult: 0, complete: 0, error: 0, other: 0 };
  let lastEvent = Date.now();
  let completed = false;
  let completePayload: any = null;
  const toolNames: string[] = [];

  ws.on('close', (code, reason) => {
    console.log(`[${now()}] CLIENT WS CLOSED code=${code} reason=${reason || 'none'} completed=${completed}`);
  });
  ws.on('error', (err) => {
    console.log(`[${now()}] CLIENT WS ERROR ${err.message}`);
  });

  ws.on('message', (raw) => {
    lastEvent = Date.now();
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const sid = msg.payload?.sessionId;
    if (sid && sid !== session.id && msg.type.startsWith('agent:')) return;

    if (msg.type === 'agent:chunk') {
      counts.chunk += 1;
      const delta = msg.payload?.delta || '';
      if (delta) process.stdout.write(delta);
    } else if (msg.type === 'agent:thinking') {
      counts.thinking += 1;
    } else if (msg.type === 'agent:tool_call') {
      counts.tool += 1;
      const name = msg.payload?.toolCall?.name || msg.payload?.toolCall?.type || 'tool';
      toolNames.push(String(name));
      console.log(`\n[${now()}] TOOL START ${name} id=${msg.payload?.toolCall?.id || ''}`);
    } else if (msg.type === 'agent:tool_result') {
      counts.toolResult += 1;
      console.log(`\n[${now()}] TOOL RESULT ${msg.payload?.toolCallId} ${msg.payload?.status}`);
    } else if (msg.type === 'agent:complete') {
      counts.complete += 1;
      completed = true;
      completePayload = msg.payload;
      console.log(`\n[${now()}] COMPLETE aborted=${msg.payload?.aborted} success=${msg.payload?.success} error=${msg.payload?.error || ''}`);
    } else if (msg.type === 'agent:error') {
      counts.error += 1;
      console.log(`\n[${now()}] AGENT ERROR ${msg.payload?.error}`);
    } else if (msg.type === 'device:status') {
      console.log(`\n[${now()}] DEVICE STATUS ${JSON.stringify(msg.payload)}`);
    } else {
      counts.other += 1;
    }
  });

  const procTimer = setInterval(async () => {
    const idleSec = Math.round((Date.now() - lastEvent) / 1000);
    const snap = await snapshotProcesses();
    console.log(`\n[${now()}] MONITOR idle=${idleSec}s events=${JSON.stringify(counts)}\n${snap}`);
  }, 15000);

  ws.send(
    JSON.stringify({
      type: 'agent:prompt',
      payload: {
        sessionId: session.id,
        deviceId: dev.id,
        prompt: PROMPT,
        model: 'auto',
        mode: 'yolo',
        workspacePath: WORKSPACE,
      },
    })
  );
  console.log(`[${now()}] prompt sent (${PROMPT.length} chars)`);

  const deadline = Date.now() + 12 * 60 * 1000;
  while (!completed && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (Date.now() - lastEvent > 180000 && counts.tool + counts.chunk + counts.thinking > 0) {
      console.log(`[${now()}] STALL: no websocket events for 180s`);
      break;
    }
  }

  clearInterval(procTimer);
  const finalSnap = await snapshotProcesses();
  console.log(`\n[${now()}] FINAL processes:\n${finalSnap}`);
  console.log(`[${now()}] counts=${JSON.stringify(counts)} tools=${toolNames.join(',')}`);
  console.log(`[${now()}] completed=${completed} payload=${JSON.stringify(completePayload)}`);

  if (!completed) {
    ws.send(JSON.stringify({ type: 'agent:abort', payload: { sessionId: session.id } }));
    await new Promise((r) => setTimeout(r, 2000));
  }
  ws.close();

  if (!completed) {
    process.exitCode = 2;
    console.log(`[${now()}] FAIL: agent did not complete`);
  } else if (completePayload?.aborted) {
    process.exitCode = 3;
    console.log(`[${now()}] FAIL: run aborted`);
  } else {
    console.log(`[${now()}] PASS: agent completed`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
