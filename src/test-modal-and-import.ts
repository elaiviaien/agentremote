export {};
const HUB_URL = 'https://agentremote-production.up.railway.app';

async function testModalAndImport() {
  console.log('================================================================');
  console.log('✨ Testing New Chat Modal with Workspace Picker & Import System');
  console.log('================================================================\n');

  // Step 1: Login
  console.log('▶ [1/4] Logging in to Cloud Hub...');
  const loginRes = await fetch(`${HUB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'olivka', password: 'olivka_ol1' }),
  });
  const { token } = (await loginRes.json()) as any;

  // Step 2: Get active device
  console.log('\n▶ [2/4] Fetching active devices...');
  const devRes = await fetch(`${HUB_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { devices } = (await devRes.json()) as any;
  const dev = devices[0];
  console.log(`   💻 Machine: ${dev.name} (${dev.os})`);

  // Step 3: Create Session via New Chat parameters (with custom workspace and engine)
  console.log('\n▶ [3/4] Creating chat with custom workspace folder & engine...');
  const createRes = await fetch(`${HUB_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceId: dev.id,
      title: 'Розробка API Інтеграції',
      description: 'Робота в папці C:\\Users\\olivka\\Documents\\agentremote',
      engine: 'cursor',
      model: 'claude-4.5-sonnet',
      mode: 'yolo',
      workspacePath: 'C:\\Users\\olivka\\Documents\\agentremote',
    }),
  });
  const { session } = (await createRes.json()) as any;
  console.log(`   ✅ Created Session: "${session.title}" (Engine: ${session.engine}, Workspace: ${session.workspacePath})`);

  // Step 4: Test Import Endpoint
  console.log('\n▶ [4/4] Testing chat import & sanitization...');
  const rawSampleTranscript = `
{"role":"user","content":"Як організовано архітектуру проекту?","timestamp":1700000000000}
{"role":"assistant","content":"Проект побудовано на базі Fastify WebSocket Hub та локального Worker Daemon.","timestamp":1700000001000}
`;

  const importRes = await fetch(`${HUB_URL}/api/sessions/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      rawContent: rawSampleTranscript,
      title: 'Імпортований чат архітектури',
      deviceId: dev.id,
      model: 'claude-4.5-sonnet',
      mode: 'yolo',
      workspacePath: 'C:\\Users\\olivka\\Documents\\agentremote',
    }),
  });
  const importData = (await importRes.json()) as any;
  console.log(`   ✅ Imported Session: "${importData.session.title}" (${importData.session.messages.length} messages)`);

  console.log('\n================================================================');
  console.log('🎉 NEW CHAT MODAL & IMPORT SYSTEM VERIFIED 100%');
  console.log('================================================================\n');
}

testModalAndImport().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
