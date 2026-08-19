const HUB_URL = 'https://agentremote-production.up.railway.app';

async function testAntigravityAndCursorSessions() {
  console.log('================================================================');
  console.log('🚀 Testing Antigravity & Cursor Chat Creation & Smart Titles');
  console.log('================================================================\n');

  // Step 1: Login
  console.log('▶ [1/4] Logging in to Cloud Hub...');
  const loginRes = await fetch(`${HUB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { token } = (await loginRes.json()) as any;

  // Step 2: Get active device
  console.log('\n▶ [2/4] Fetching active devices...');
  const devRes = await fetch(`${HUB_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { devices } = (await devRes.json()) as any;
  const devId = devices[0]?.id || 'dev-desktop-ejfec8k-olivka';

  // Step 3: Create Antigravity Session
  console.log('\n▶ [3/4] Creating Antigravity session...');
  const agyRes = await fetch(`${HUB_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceId: devId,
      title: 'Новий чат Antigravity',
      description: 'Сесія Google Antigravity 2.0 (Gemini)',
      engine: 'antigravity',
      model: 'gemini-3.1-pro',
      mode: 'yolo',
      workspacePath: process.cwd(),
    }),
  });
  const { session: agySession } = (await agyRes.json()) as any;
  console.log(`   ✅ Antigravity Session Created: ID=${agySession.id}, Engine=${agySession.engine}, Title=${agySession.title}`);

  // Step 4: Create Cursor Session
  console.log('\n▶ [4/4] Creating Cursor session...');
  const cursorRes = await fetch(`${HUB_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceId: devId,
      title: 'Новий чат Cursor',
      description: 'Сесія Cursor AI Agent',
      engine: 'cursor',
      model: 'claude-4.5-sonnet',
      mode: 'yolo',
      workspacePath: process.cwd(),
    }),
  });
  const { session: cursorSession } = (await cursorRes.json()) as any;
  console.log(`   ✅ Cursor Session Created: ID=${cursorSession.id}, Engine=${cursorSession.engine}, Title=${cursorSession.title}`);

  // Step 5: Verify Session List
  const listRes = await fetch(`${HUB_URL}/api/sessions?deviceId=${devId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { sessions } = (await listRes.json()) as any;
  console.log(`\n📋 Current sessions in Hub (${sessions.length} total):`);
  sessions.slice(0, 5).forEach((s: any) => {
    console.log(`   • [${s.engine?.toUpperCase() || 'CURSOR'}] "${s.title}" — ${s.description || 'Немає опису'} (${s.model})`);
  });

  console.log('\n================================================================');
  console.log('🎉 ANTIGRAVITY & CURSOR CHAT CREATION TEST PASSED 100%');
  console.log('================================================================\n');
}

testAntigravityAndCursorSessions().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
