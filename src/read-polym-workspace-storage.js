const { DatabaseSync } = require('node:sqlite');
const wsDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\workspaceStorage\\61a62f172c19277420d67c71974df40b\\state.vscdb';

const db = new DatabaseSync(wsDbPath);
const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%prompt%' OR key LIKE '%generation%' OR key LIKE '%chat%'").all();

console.log(`Found ${rows.length} relevant entries in polym_agent workspace storage:`);
rows.forEach((r) => {
  console.log(`\nKey: ${r.key}`);
  try {
    const val = JSON.parse(r.value);
    console.log('Value preview:', typeof val === 'object' ? Object.keys(val) : String(val).slice(0, 100));
    if (r.key === 'aiService.prompts' || r.key === 'aiService.generations') {
      console.log('Content sample:', JSON.stringify(val).slice(0, 300));
    }
  } catch {
    console.log('Raw value:', r.value.slice(0, 100));
  }
});
