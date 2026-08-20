const { DatabaseSync } = require('node:sqlite');
const globalDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb';

const db = new DatabaseSync(globalDbPath);
const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData' OR key = 'composer.composerHeaders'").get();

if (row) {
  const data = JSON.parse(row.value);
  console.log('--- Cursor IDE Composer Headers & Sessions ---');
  const composers = data.allComposers || data.composers || (Array.isArray(data) ? data : []);
  console.log(`Total Cursor IDE Sessions: ${composers.length}`);

  composers.forEach((c, idx) => {
    const title = c.text || c.name || c.subtitle || c.lastUpdatedAt || 'Untitled Chat';
    console.log(`[${idx + 1}] ID: ${c.composerId} | Title: "${title.slice(0, 60)}" | Workspace: ${c.workspaceId || c.workspacePath || c.unifiedChatId || '-'}`);
  });
}
