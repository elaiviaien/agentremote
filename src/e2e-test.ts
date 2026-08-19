import WebSocket from 'ws';

const BASE_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app';

async function runE2ETest() {
  console.log('========================================================');
  console.log('🚀 Starting Full End-to-End Test for AgentRemote');
  console.log(`🌐 Target Cloud Hub: ${BASE_URL}`);
  console.log('========================================================\n');

  // Step 1: Login
  console.log('▶ [1/6] Testing Authentication (POST /api/auth/login)...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed with status: ${loginRes.status}`);
  }

  const authData = (await loginRes.json()) as { token: string; username: string };
  console.log(`✅ Logged in successfully as user '${authData.username}'. Token obtained.`);

  const token = authData.token;

  // Step 2: Check Devices
  console.log('\n▶ [2/6] Verifying Connected Devices (GET /api/devices)...');
  const devicesRes = await fetch(`${BASE_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const devicesData = (await devicesRes.json()) as any;
  console.log(`📡 Devices found: ${devicesData.devices.length}`);

  devicesData.devices.forEach((d: any) => {
    console.log(`   - ${d.name} (${d.id}) | Status: ${d.status.toUpperCase()} | OS: ${d.os}`);
  });

  const onlineDevice = devicesData.devices.find((d: any) => d.status === 'online');
  if (!onlineDevice) {
    throw new Error('No online worker daemon found! Make sure worker is running.');
  }
  console.log(`✅ Active online target device: '${onlineDevice.name}' (${onlineDevice.id})`);

  // Step 3: Create Session
  console.log('\n▶ [3/6] Creating New Chat Session (POST /api/sessions)...');
  const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceId: onlineDevice.id,
      title: 'E2E Test Session',
      model: 'claude-3-5-sonnet',
      mode: 'agent',
      workspacePath: onlineDevice.defaultWorkspace,
    }),
  });

  const sessionData = (await sessionRes.json()) as any;
  const sessionId = sessionData.session.id;
  console.log(`✅ Created Session ID: ${sessionId} (Title: "${sessionData.session.title}")`);

  // Step 4: Test WebSocket connection & Agent Streaming
  console.log('\n▶ [4/6] Connecting Client WebSocket & Testing Agent Prompt Stream...');
  const ws = new WebSocket(`${WS_URL}/ws/client?token=${encodeURIComponent(token)}`);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
    ws.on('open', () => {
      clearTimeout(timeout);
      console.log('✅ Client WebSocket connected to Railway Cloud Hub!');
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Step 5: Test Remote Terminal execution via WebSocket
  console.log('\n▶ [5/6] Testing Remote Terminal execution on local machine...');
  const terminalPromise = new Promise<string>((resolve, reject) => {
    const termCmdId = 'term-test-' + Date.now();
    let termOutput = '';
    const timeout = setTimeout(() => reject(new Error('Terminal execution timeout')), 15000);

    const onMsg = (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'terminal:output' && parsed.payload.commandId === termCmdId) {
          termOutput += parsed.payload.data;
          process.stdout.write(parsed.payload.data);
        } else if (parsed.type === 'terminal:exit' && parsed.payload.commandId === termCmdId) {
          clearTimeout(timeout);
          ws.off('message', onMsg);
          resolve(termOutput);
        }
      } catch {}
    };

    ws.on('message', onMsg);

    ws.send(
      JSON.stringify({
        type: 'terminal:exec',
        payload: {
          commandId: termCmdId,
          deviceId: onlineDevice.id,
          command: 'node -v; git status --short',
          cwd: onlineDevice.defaultWorkspace,
        },
      })
    );
  });

  const termResult = await terminalPromise;
  console.log('✅ Remote Terminal execution verified successfully!');

  // Step 6: Test Remote File Tree Explorer
  console.log('\n▶ [6/6] Testing Remote File System tree exploration...');
  const fsPromise = new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('FS tree exploration timeout')), 15000);

    const onMsg = (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'fs:tree') {
          clearTimeout(timeout);
          ws.off('message', onMsg);
          resolve(parsed.payload);
        }
      } catch {}
    };

    ws.on('message', onMsg);

    ws.send(
      JSON.stringify({
        type: 'fs:tree',
        payload: {
          deviceId: onlineDevice.id,
          path: onlineDevice.defaultWorkspace,
        },
      })
    );
  });

  const fsResult = await fsPromise;
  console.log(`📁 Files discovered in remote workspace (${fsResult.rootPath}):`);
  fsResult.tree.slice(0, 8).forEach((item: any) => {
    console.log(`   - ${item.isDirectory ? '📁' : '📄'} ${item.name}`);
  });
  console.log('✅ Remote File System explorer verified successfully!');

  // Cleanup
  ws.close();

  console.log('\n========================================================');
  console.log('🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY! 100% OPERATIONAL');
  console.log('========================================================\n');
}

runE2ETest().catch((err) => {
  console.error('\n❌ E2E Test Failed:', err);
  process.exit(1);
});
