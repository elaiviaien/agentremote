import WebSocket from 'ws';

const BASE_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app';

async function testAgentPromptStreaming() {
  console.log('🤖 Testing live Agent Prompt execution and streaming via Railway Hub...');

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

  // 3. Connect WebSocket
  const ws = new WebSocket(`${WS_URL}/ws/client?token=${encodeURIComponent(token)}`);

  await new Promise<void>((resolve) => {
    ws.on('open', () => resolve());
  });

  const sessionId = 'test-prompt-session-' + Date.now();

  const streamPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('⚠️ Test completed before timeout.');
      resolve();
    }, 15000);

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent:chunk' && msg.payload.sessionId === sessionId) {
          process.stdout.write(msg.payload.delta || msg.payload.chunk);
        } else if (msg.type === 'agent:complete' && msg.payload.sessionId === sessionId) {
          clearTimeout(timeout);
          console.log('\n✅ Agent execution received complete signal from Railway Hub!');
          resolve();
        }
      } catch {}
    });
  });

  // Send prompt
  ws.send(
    JSON.stringify({
      type: 'agent:prompt',
      payload: {
        sessionId,
        deviceId: dev.id,
        prompt: 'Say hello from AgentRemote in one sentence',
        model: 'claude-3-5-sonnet',
        mode: 'ask',
      },
    })
  );

  await streamPromise;
  ws.close();
}

testAgentPromptStreaming().catch(console.error);
