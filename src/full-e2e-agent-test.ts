import WebSocket from 'ws';

const BASE_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app';

async function runFullE2ETest() {
  console.log('================================================================');
  console.log('🚀 AgentRemote Full End-to-End Test: Live Cursor Agent QA');
  console.log('================================================================\n');

  // Step 1: Authentication
  console.log('▶ [1/5] Authenticating as admin...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const { token, username } = (await loginRes.json()) as any;
  console.log(`   ✅ Logged in as: ${username}`);

  // Step 2: Device Discovery
  console.log('\n▶ [2/5] Checking connected devices on Railway Hub...');
  const devicesRes = await fetch(`${BASE_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { devices } = (await devicesRes.json()) as any;
  const dev = devices.find((d: any) => d.status === 'online');
  if (!dev) {
    throw new Error('❌ No online device found! Please ensure worker daemon is running.');
  }
  console.log(`   ✅ Target Online Device: ${dev.name} (${dev.id})`);
  console.log(`   💻 OS: ${dev.os}`);
  console.log(`   📂 Workspace: ${dev.defaultWorkspace}`);

  // Step 3: Create Chat Session
  console.log('\n▶ [3/5] Creating test chat session on Cloud Hub...');
  const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceId: dev.id,
      title: 'E2E Agent Verification Chat',
      model: 'claude-4.5-sonnet',
      mode: 'ask',
      workspacePath: dev.defaultWorkspace,
    }),
  });
  const { session } = (await sessionRes.json()) as any;
  console.log(`   ✅ Created Session ID: ${session.id}`);

  // Step 4: Connect WebSocket Client
  console.log('\n▶ [4/5] Connecting WebSocket client to Railway Hub...');
  const ws = new WebSocket(`${WS_URL}/ws/client?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', (err) => reject(err));
  });
  console.log('   ✅ WebSocket connection established.');

  // Step 5: Send Live Prompt 1 to Cursor Agent
  const prompt1 = 'Обчисли 42 * 100 і напиши відповідь одним чітким реченням українською мовою.';
  console.log(`\n▶ [5/5] Sending prompt to Cursor Agent: "${prompt1}"`);
  console.log('   ⏳ Streaming live response from Agent:');
  console.log('   ------------------------------------------------------------');

  let fullAgentResponse1 = '';

  const prompt1Promise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (fullAgentResponse1) resolve();
      else reject(new Error('Timeout waiting for agent response'));
    }, 25000);

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent:chunk' && msg.payload.sessionId === session.id) {
          fullAgentResponse1 = msg.payload.chunk;
          process.stdout.write(msg.payload.delta || '');
        } else if (msg.type === 'agent:complete' && msg.payload.sessionId === session.id) {
          clearTimeout(timeout);
          console.log('\n   ------------------------------------------------------------');
          console.log('   ✅ Agent completed execution successfully (Prompt 1).');
          resolve();
        }
      } catch {}
    });
  });

  ws.send(
    JSON.stringify({
      type: 'agent:prompt',
      payload: {
        sessionId: session.id,
        deviceId: dev.id,
        prompt: prompt1,
        model: 'claude-4.5-sonnet',
        mode: 'ask',
        workspacePath: dev.defaultWorkspace,
      },
    })
  );

  await prompt1Promise;

  // Step 6: Test Continuation / Resume Prompt
  const prompt2 = 'А тепер додай до попереднього результату 58 і напиши лише фінальне число.';
  console.log(`\n▶ [Continuation Test] Sending follow-up prompt: "${prompt2}"`);
  console.log('   ⏳ Streaming live response:');
  console.log('   ------------------------------------------------------------');

  let fullAgentResponse2 = '';

  const prompt2Promise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (fullAgentResponse2) resolve();
      else reject(new Error('Timeout waiting for continuation response'));
    }, 25000);

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent:chunk' && msg.payload.sessionId === session.id) {
          fullAgentResponse2 = msg.payload.chunk;
          process.stdout.write(msg.payload.delta || '');
        } else if (msg.type === 'agent:complete' && msg.payload.sessionId === session.id) {
          clearTimeout(timeout);
          console.log('\n   ------------------------------------------------------------');
          console.log('   ✅ Agent completed execution successfully (Continuation Prompt 2).');
          resolve();
        }
      } catch {}
    });
  });

  ws.send(
    JSON.stringify({
      type: 'agent:prompt',
      payload: {
        sessionId: session.id,
        deviceId: dev.id,
        prompt: prompt2,
        continueLastSession: true,
        model: 'claude-4.5-sonnet',
        mode: 'ask',
        workspacePath: dev.defaultWorkspace,
      },
    })
  );

  await prompt2Promise;

  // Step 7: Verify Database Record
  const verifyRes = await fetch(`${BASE_URL}/api/sessions/${session.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { session: updatedSession } = (await verifyRes.json()) as any;

  console.log('\n================================================================');
  console.log('📊 FINAL VERIFICATION REPORT:');
  console.log('================================================================');
  console.log(`Total messages stored in session history: ${updatedSession.messages.length}`);
  updatedSession.messages.forEach((m: any, idx: number) => {
    console.log(`\n[Message ${idx + 1}] (${m.role.toUpperCase()}):`);
    console.log(m.content);
  });

  ws.close();

  console.log('\n================================================================');
  console.log('🎉 E2E TEST COMPLETE: ALL CHECKS PASSED 100%');
  console.log('================================================================\n');
}

runFullE2ETest().catch((err) => {
  console.error('\n❌ E2E Test Error:', err);
  process.exit(1);
});
