const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const globalDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb';
const wsDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\workspaceStorage\\61a62f172c19277420d67c71974df40b\\state.vscdb';

console.log('--- Inspecting Workspace state.vscdb ---');
try {
  const db = new DatabaseSync(wsDbPath);
  const rows = db.prepare('SELECT key, length(value) as len FROM ItemTable').all();
  console.log('Keys in workspace state.vscdb:');
  rows.forEach((r) => console.log(`  key: ${r.key} (len: ${r.len})`));
} catch (e) {
  console.error('WS DB error:', e.message);
}

console.log('\n--- Inspecting Global state.vscdb ---');
try {
  const db = new DatabaseSync(globalDbPath);
  const rows = db.prepare("SELECT key, length(value) as len FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%chat%' OR key LIKE '%prompt%'").all();
  console.log('Chat/Composer Keys in global state.vscdb:');
  rows.forEach((r) => console.log(`  key: ${r.key} (len: ${r.len})`));

  // Check composer.composerData
  const composerRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get();
  if (composerRow) {
    const composerData = JSON.parse(composerRow.value);
    console.log('\nComposer Data details:');
    console.log('Total Composers/Chats:', composerData.allComposers ? composerData.allComposers.length : 0);
    if (composerData.allComposers) {
      composerData.allComposers.forEach((c, idx) => {
        console.log(`[${idx + 1}] ID: ${c.composerId} | Text: "${(c.text || c.name || '').slice(0, 50)}" | Workspace: ${c.workspaceId || c.workspacePath}`);
      });
    }
  }
} catch (e) {
  console.error('Global DB error:', e.message);
}
