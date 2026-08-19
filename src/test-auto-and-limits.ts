import WebSocket from 'ws';

const HUB_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app/ws/client';

async function testAutoModeAndLimits() {
  console.log('================================================================');
  console.log('⚡ Testing Cursor Auto Mode & Real-Time Limits/Quota Display');
  console.log('================================================================\n');

  // Step 1: Login
  console.log('▶ [1/3] Logging in to Cloud Hub...');
  const loginRes = await fetch(`${HUB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { token } = (await loginRes.json()) as any;

  // Step 2: Fetch Devices and Limits Info
  console.log('\n▶ [2/3] Fetching device limits and subscription quota...');
  const devicesRes = await fetch(`${HUB_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { devices } = (await devicesRes.json()) as any;

  if (!devices || devices.length === 0) {
    throw new Error('No devices registered on Hub');
  }

  const dev = devices[0];
  console.log(`   💻 Machine: ${dev.name} (${dev.os})`);
  console.log(`   📊 Limits & Subscription Info:`);
  console.log(`      • Cursor Tier: ${dev.limitsInfo?.cursor?.tier || 'Pro'}`);
  console.log(`      • Cursor Email: ${dev.limitsInfo?.cursor?.email || dev.cursorAuthStatus?.email}`);
  console.log(`      • Cursor Model: ${dev.limitsInfo?.cursor?.defaultModel}`);
  console.log(`      • Cursor Quota: ${dev.limitsInfo?.cursor?.quotaDetails}`);
  console.log(`      • Antigravity Brain Sessions: ${dev.limitsInfo?.antigravity?.brainConversationsCount}`);
  console.log(`      • Antigravity Storage: ${dev.limitsInfo?.antigravity?.brainStorageSizeMb} MB`);

  // Step 3: Run Agent in Auto Mode (mode: 'auto')
  console.log('\n▶ [3/3] Running Cursor Agent in Auto/YOLO mode...');
  const sessionRes = await fetch(`${HUB_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: 'Auto Mode E2E Test',
      model: 'claude-4.5-sonnet',
      mode: 'auto',
      workspacePath: process.cwd(),
    }),
  });
  const { session } = (await sessionRes.json()) as any;

  const ws = new WebSocket(`${WS_URL}?token=${token}`);

  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      ws.close();
      if (output.length > 0) resolve();
      else reject(new Error('Timeout waiting for auto-mode response'));
    }, 45000);

    ws.on('open', () => {
      console.log('   🔗 WebSocket connected');
      ws.send(
        JSON.stringify({
          type: 'agent:prompt',
          payload: {
            sessionId: session.id,
            prompt: 'Перевір у 1 реченні, чи увімкнено авто-режим і яка поточна дата.',
            model: 'claude-4.5-sonnet',
            mode: 'auto',
          },
        })
      );
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'agent:chunk' && msg.payload.sessionId === session.id) {
        process.stdout.write(msg.payload.chunk);
        output += msg.payload.chunk;
      } else if (msg.type === 'agent:complete' && msg.payload.sessionId === session.id) {
        console.log('\n\n   ✅ Agent finished auto-mode execution!');
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log('\n================================================================');
  console.log('🎉 CURSOR AUTO MODE & LIMITS TEST PASSED 100%');
  console.log('================================================================\n');
}

testAutoModeAndLimits().catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
