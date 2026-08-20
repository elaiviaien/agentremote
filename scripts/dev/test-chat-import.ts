import fs from 'fs';
import path from 'path';
import os from 'os';
import { ChatSanitizer } from './shared/chatSanitizer';
import { TranscriptScanner } from './worker/transcriptScanner';

const BASE_URL = 'https://agentremote-production.up.railway.app';

async function testChatImportFlow() {
  console.log('================================================================');
  console.log('🛡️ Testing Cross-Agent Chat Import & Metadata Sanitization');
  console.log('================================================================\n');

  // Step 1: Scan local transcripts on this machine
  console.log('▶ [1/4] Scanning local Antigravity transcripts...');
  const localTranscripts = TranscriptScanner.scanAntigravityTranscripts();
  console.log(`   ✅ Discovered ${localTranscripts.length} Antigravity conversations locally:`);
  localTranscripts.forEach((t, i) => {
    console.log(`      [${i + 1}] ID: ${t.id} | Title: "${t.title}" | Messages: ${t.messageCount}`);
  });

  if (localTranscripts.length === 0) {
    throw new Error('No local transcripts found for testing');
  }

  // Step 2: Test Sanitizer on real transcript file
  const targetTranscript = localTranscripts[0];
  console.log(`\n▶ [2/4] Sanitizing transcript: ${targetTranscript.filePath}...`);
  const rawFileContent = fs.readFileSync(targetTranscript.filePath, 'utf8');
  
  const sanitized = ChatSanitizer.parseAntigravityJsonl(rawFileContent);
  console.log('   ✅ Sanitization completed:');
  console.log(`      • Clean Messages Extracted: ${sanitized.messages.length}`);
  console.log(`      • Removed Internal Metadata/System Tags: ${sanitized.removedMetadataCount}`);
  console.log(`      • Redacted Secret Tokens: ${sanitized.redactedSecretsCount}`);

  // Safety Assertion: Verify no internal tags exist in clean messages
  sanitized.messages.forEach((m, idx) => {
    if (m.content.includes('<USER_REQUEST>') || m.content.includes('<ADDITIONAL_METADATA>') || m.content.includes('task_id')) {
      throw new Error(`❌ Unsafe tag leaked in message [${idx + 1}]!`);
    }
  });
  console.log('   🔒 Verification Passed: ZERO system wrappers or leaked metadata found.');

  // Step 3: Authenticate with Railway Hub
  console.log('\n▶ [3/4] Authenticating with Cloud Hub...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { token } = (await loginRes.json()) as any;

  // Step 4: Import sanitized conversation to create a new session
  console.log('\n▶ [4/4] Importing sanitized chat into new session via API...');
  const importRes = await fetch(`${BASE_URL}/api/sessions/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      rawContent: rawFileContent,
      title: 'Imported Antigravity Task: ' + sanitized.title.slice(0, 30),
      model: 'claude-4.5-sonnet',
      mode: 'ask',
    }),
  });

  const importData = (await importRes.json()) as any;
  if (!importRes.ok || !importData.success) {
    throw new Error(`Import failed: ${JSON.stringify(importData)}`);
  }

  const createdSession = importData.session;
  console.log(`   ✅ Created Imported Session: ${createdSession.id}`);
  console.log(`   📊 Total Clean Messages in Database: ${createdSession.messages.length}`);
  console.log(`   📝 First Message Preview: "${createdSession.messages[0]?.content.slice(0, 80)}..."`);

  console.log('\n================================================================');
  console.log('🎉 CHAT IMPORT & SANITIZATION TEST PASSED 100%');
  console.log('================================================================\n');
}

testChatImportFlow().catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
