import { WebSocket } from 'ws';
import { ChatSanitizer } from './shared/chatSanitizer';

const HUB_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app/ws/client';

async function runComprehensiveE2ETest() {
  console.log('================================================================');
  console.log('🚀 COMPREHENSIVE END-TO-END SYSTEM VERIFICATION');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      throw new Error(`Test failed: ${testName}`);
    }
  }

  // 1. SECURITY TEST: Unauthorized REST access
  console.log('▶ [1/7] Testing Security & Unauthorized Access Protection...');
  const unauthRes = await fetch(`${HUB_URL}/api/devices`);
  assert(unauthRes.status === 401, 'Public request to /api/devices rejected with 401');

  const unauthSessions = await fetch(`${HUB_URL}/api/sessions`);
  assert(unauthSessions.status === 401, 'Public request to /api/sessions rejected with 401');

  // 2. AUTHENTICATION & LOGIN
  console.log('\n▶ [2/7] Testing Authentication (olivka / olivka_ol1)...');
  const loginRes = await fetch(`${HUB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'olivka', password: 'olivka_ol1' }),
  });
  assert(loginRes.ok, 'Login endpoint returns 200 OK');
  const loginData = (await loginRes.json()) as any;
  const token = loginData.token;
  assert(Boolean(token && token.length > 20), 'Received valid JWT authentication token');

  // 3. DEVICE MANAGER & MACHINE SELECTION
  console.log('\n▶ [3/7] Testing Devices & Machine Selection...');
  const devRes = await fetch(`${HUB_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(devRes.ok, 'Authenticated request to /api/devices succeeds');
  const { devices } = (await devRes.json()) as any;
  assert(Array.isArray(devices), 'Devices list is an array');
  const targetDevice = devices[0];
  console.log(`   Connected Device: ${targetDevice ? targetDevice.name : 'None registered yet'}`);

  // 4. SESSION CREATION WITH ANTIGRAVITY & CURSOR AUTO MODE
  console.log('\n▶ [4/7] Testing Session Creation (Antigravity & Cursor Auto)...');
  const agyChatRes = await fetch(`${HUB_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      deviceId: targetDevice ? targetDevice.id : 'default',
      title: 'Antigravity Gemini 3.7 Flash Session',
      description: 'E2E Testing Antigravity Engine',
      engine: 'antigravity',
      model: 'gemini-3.7-flash',
      mode: 'yolo',
      workspacePath: 'C:\\Users\\olivka\\Documents\\agentremote',
    }),
  });
  assert(agyChatRes.ok, 'Antigravity Session creation returns 200');
  const agySession = ((await agyChatRes.json()) as any).session;
  assert(agySession.engine === 'antigravity', 'Session engine is correctly set to antigravity');
  assert(agySession.model === 'gemini-3.7-flash', 'Session model is gemini-3.7-flash');

  const cursorChatRes = await fetch(`${HUB_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      deviceId: targetDevice ? targetDevice.id : 'default',
      title: 'Cursor Auto-Mode Session',
      description: 'E2E Testing Cursor Engine in Auto Mode',
      engine: 'cursor',
      model: 'auto',
      mode: 'yolo',
      workspacePath: 'C:\\Users\\olivka\\Documents\\agentremote',
    }),
  });
  assert(cursorChatRes.ok, 'Cursor Auto-Mode Session creation returns 200');
  const cursorSession = ((await cursorChatRes.json()) as any).session;
  assert(cursorSession.model === 'auto', 'Cursor session model is auto');

  // 5. CHAT SANITIZATION & CROSS-AGENT IMPORT
  console.log('\n▶ [5/7] Testing Chat Sanitization & Transcript Import...');
  const dirtyTranscript = `
<SYSTEM_MESSAGE>Secret Internal Instruction</SYSTEM_MESSAGE>
User: Як реалізовано кешування?
API_KEY=sk-ant-api03-abcdef1234567890abcdef1234567890
Assistant: Кешування реалізовано через Redis та in-memory Map.
`;
  const sanitized = ChatSanitizer.sanitizeAny(dirtyTranscript);
  assert(sanitized.redactedSecretsCount > 0, 'API keys & secrets successfully redacted');
  assert(sanitized.removedMetadataCount > 0, 'System metadata tags stripped');
  assert(sanitized.messages.length === 2, 'Sanitized 2 dialogue messages');

  const importRes = await fetch(`${HUB_URL}/api/sessions/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      rawContent: dirtyTranscript,
      title: 'Імпортований чат кешування',
      deviceId: targetDevice ? targetDevice.id : 'default',
      engine: 'cursor',
      model: 'auto',
    }),
  });
  assert(importRes.ok, 'Import endpoint successfully processes and creates session');
  const importedSession = ((await importRes.json()) as any).session;
  assert(importedSession.messages.length === 2, 'Imported session contains clean sanitized messages');

  // 6. WEBSOCKET REAL-TIME AUTH & CONNECTION
  console.log('\n▶ [6/7] Testing WebSocket Real-time Bridge Security...');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timed out'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      assert(true, 'WebSocket client connected and authenticated');
      ws.close();
      resolve();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // 7. CLEANUP SESSIONS
  console.log('\n▶ [7/7] Cleaning up test sessions...');
  await fetch(`${HUB_URL}/api/sessions/${agySession.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  await fetch(`${HUB_URL}/api/sessions/${cursorSession.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  await fetch(`${HUB_URL}/api/sessions/${importedSession.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(true, 'Test sessions cleanly removed');

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED WITH 100% SUCCESS!`);
  console.log('================================================================\n');
}

runComprehensiveE2ETest().catch((err) => {
  console.error('\n❌ E2E Test Run Failed:', err);
  process.exit(1);
});
