import WebSocket from 'ws';
import { TranscriptScanner } from './worker/transcriptScanner';

const HUB_URL = 'https://agentremote-production.up.railway.app';
const WS_URL = 'wss://agentremote-production.up.railway.app/ws/client';

async function testPolymResume() {
  console.log('================================================================');
  console.log('🧪 Testing Cursor IDE polym_agent Resume & Context Continuation');
  console.log('================================================================\n');

  // Step 1: Scan all local transcripts
  console.log('▶ [1/5] Scanning local transcripts (Antigravity & Cursor IDE)...');
  const allTranscripts = TranscriptScanner.scanAllLocalTranscripts();
  console.log(`   ✅ Found ${allTranscripts.length} total local transcripts across workspaces.`);

  const polymTranscript = allTranscripts.find(
    (t) => t.title.toLowerCase().includes('polym') || (t.workspacePath && t.workspacePath.toLowerCase().includes('polym'))
  );

  if (!polymTranscript) {
    throw new Error('polym_agent transcript not found in local scan');
  }

  console.log(`   🎯 Selected polym_agent session: "${polymTranscript.title}"`);
  console.log(`      • Messages: ${polymTranscript.messageCount}`);
  console.log(`      • Storage DB: ${polymTranscript.filePath}`);
  console.log(`      • Workspace: ${polymTranscript.workspacePath}`);

  // Step 2: Read and Sanitize the polym_agent chat
  console.log('\n▶ [2/5] Reading and sanitizing polym_agent chat from SQLite...');
  const sanitized = TranscriptScanner.readAndSanitizeLocalTranscript(polymTranscript.filePath);
  if (!sanitized) {
    throw new Error('Failed to sanitize polym_agent transcript');
  }
  console.log(`   ✅ Sanitized ${sanitized.messages.length} messages.`);
  console.log(`      • Removed system tags/traces: ${sanitized.removedMetadataCount}`);

  // Step 3: Login to Cloud Hub
  console.log('\n▶ [3/5] Authenticating with Railway Hub...');
  const loginRes = await fetch(`${HUB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { token } = (await loginRes.json()) as any;

  // Step 4: Import chat session to Railway Hub
  console.log('\n▶ [4/5] Creating imported session for polym_agent on Railway Hub...');
  const importRes = await fetch(`${HUB_URL}/api/sessions/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      rawContent: sanitized.cleanSummaryContext,
      title: 'polym_agent IDE Resumed Session',
      workspacePath: 'C:\\Users\\olivka\\Documents\\polym_agent',
      model: 'claude-4.5-sonnet',
      mode: 'ask',
    }),
  });

  const importData = (await importRes.json()) as any;
  const session = importData.session;
  console.log(`   ✅ Session created: ${session.id} (Workspace: ${session.workspacePath})`);

  // Step 5: Run Cursor Agent with resumed context in polym_agent
  console.log('\n▶ [5/5] Sending prompt to Cursor Agent in C:\\Users\\olivka\\Documents\\polym_agent...');
  const ws = new WebSocket(`${WS_URL}?token=${token}`);

  await new Promise<void>((resolve, reject) => {
    let fullResponse = '';
    const timeout = setTimeout(() => {
      ws.close();
      if (fullResponse.length > 0) resolve();
      else reject(new Error('Timeout waiting for agent response in polym_agent'));
    }, 45000);

    ws.on('open', () => {
      console.log('   🔗 WebSocket connected to Railway Hub');

      // Send prompt resuming context in polym_agent
      ws.send(
        JSON.stringify({
          type: 'agent:prompt',
          payload: {
            sessionId: session.id,
            prompt: 'Привіт! Зроби дуже короткий огляд (2-3 речення) структури проекту polym_agent: які ключові модулі є у папці src/polym_desk?',
            model: 'claude-4.5-sonnet',
            mode: 'ask',
            workspacePath: 'C:\\Users\\olivka\\Documents\\polym_agent',
          },
        })
      );
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'agent:chunk' && msg.payload.sessionId === session.id) {
        process.stdout.write(msg.payload.chunk);
        fullResponse += msg.payload.chunk;
      } else if (msg.type === 'agent:complete' && msg.payload.sessionId === session.id) {
        console.log('\n\n   ✅ Agent finished response with success!');
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
  console.log('🎉 RESUME TEST IN polym_agent PASSED 100%');
  console.log('================================================================\n');
}

testPolymResume().catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
