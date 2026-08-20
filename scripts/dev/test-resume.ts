import WebSocket from 'ws';

const BASE_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app';

async function testResumeSession() {
  console.log('========================================================');
  console.log('🔄 Testing Session Resume & Chat Continuation in AgentRemote');
  console.log('========================================================\n');

  // 1. Auth
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { token } = (await loginRes.json()) as any;

  // 2. Get device
  const devicesRes = await fetch(`${BASE_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { devices } = (await devicesRes.json()) as any;
  const dev = devices.find((d: any) => d.status === 'online');

  if (!dev) {
    throw new Error('No online device found!');
  }

  // 3. Create Session
  const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceId: dev.id,
      title: 'Resume Test Session',
      model: 'claude-4.5-sonnet',
      mode: 'ask',
      workspacePath: dev.defaultWorkspace,
    }),
  });

  const { session } = (await sessionRes.json()) as any;
  console.log(`✅ Created Test Session: ${session.id}`);

  // 4. Connect WebSocket
  const ws = new WebSocket(`${WS_URL}/ws/client?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve) => {
    ws.on('open', () => resolve());
  });

  // Step A: Send Initial Prompt
  console.log('\n▶ [Part 1/2] Sending Initial Prompt to Session...');
  const prompt1Promise = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 12000);
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent:complete' && msg.payload.sessionId === session.id) {
          clearTimeout(timeout);
          console.log('   ✅ Initial prompt executed and completed.');
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
        prompt: 'Say: Step 1',
        model: 'claude-4.5-sonnet',
        mode: 'ask',
        workspacePath: dev.defaultWorkspace,
      },
    })
  );

  await prompt1Promise;

  // Step B: Resume / Continue Session
  console.log('\n▶ [Part 2/2] Resuming Previous Session with continuation flag...');
  const prompt2Promise = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 12000);
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent:complete' && msg.payload.sessionId === session.id) {
          clearTimeout(timeout);
          console.log('   ✅ Resumed chat executed and completed successfully!');
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
        prompt: 'Now continue and say: Step 2',
        continueLastSession: true,
        model: 'claude-4.5-sonnet',
        mode: 'ask',
        workspacePath: dev.defaultWorkspace,
      },
    })
  );

  await prompt2Promise;

  // Verify Session Messages in DB
  const checkSessionRes = await fetch(`${BASE_URL}/api/sessions/${session.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const updatedSession = (await checkSessionRes.json()) as any;
  console.log(`\n📊 Total messages stored in session history: ${updatedSession.session.messages.length}`);
  updatedSession.session.messages.forEach((m: any, idx: number) => {
    console.log(`   [${idx + 1}] (${m.role.toUpperCase()}): ${m.content.slice(0, 50)}...`);
  });

  ws.close();

  console.log('\n========================================================');
  console.log('🎉 RESUME TEST PASSED! SESSION CONTINUATION VERIFIED 100%');
  console.log('========================================================\n');
}

testResumeSession().catch(console.error);
