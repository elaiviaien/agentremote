import WebSocket from 'ws';

const BASE_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app';

async function testTriggerAuthRoundtrip() {
  console.log('🔑 Testing 1-click Cursor CLI OAuth trigger over WebSocket...');

  // 1. Auth
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { token } = (await loginRes.json()) as any;

  // 2. Devices
  const devicesRes = await fetch(`${BASE_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { devices } = (await devicesRes.json()) as any;
  const dev = devices.find((d: any) => d.status === 'online');

  if (!dev) {
    throw new Error('No online device found!');
  }

  // 3. Connect WS
  const ws = new WebSocket(`${WS_URL}/ws/client?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve) => ws.on('open', () => resolve()));

  const authPromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for auth URL')), 12000);
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent:auth_url') {
          clearTimeout(timeout);
          resolve(msg.payload.url);
        }
      } catch {}
    });
  });

  // Trigger Auth
  console.log(`▶ Sending agent:trigger_auth for device ${dev.name}...`);
  ws.send(
    JSON.stringify({
      type: 'agent:trigger_auth',
      payload: { deviceId: dev.id },
    })
  );

  const authUrl = await authPromise;
  console.log('\n🎉 SUCCESS! Received live Cursor OAuth URL:');
  console.log(authUrl);
  console.log('========================================================\n');

  ws.close();
}

testTriggerAuthRoundtrip().catch(console.error);
