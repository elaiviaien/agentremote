const { DatabaseSync } = require('node:sqlite');
const globalDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb';

const db = new DatabaseSync(globalDbPath);
const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData' OR key = 'composer.composerHeaders'").get();

if (row) {
  const data = JSON.parse(row.value);
  const composers = data.allComposers || data.composers || (Array.isArray(data) ? data : []);

  console.log(`Total Composers: ${composers.length}`);
  const workspaces = {};

  composers.forEach((c) => {
    const ws = c.workspaceIdentifier?.uri?.fsPath || c.workspaceIdentifier?.uri?.path || c.workspaceIdentifier?.id || 'Unknown';
    if (!workspaces[ws]) workspaces[ws] = [];
    workspaces[ws].push({
      composerId: c.composerId,
      name: c.name || c.subtitle || 'Untitled Chat',
      updatedAt: c.lastUpdatedAt || c.createdAt,
    });
  });

  console.log('Workspaces with Cursor IDE Chats:');
  Object.keys(workspaces).forEach((wsPath) => {
    console.log(`\n📂 [${wsPath}] (${workspaces[wsPath].length} chats):`);
    workspaces[wsPath].slice(0, 5).forEach((item, idx) => {
      console.log(`   ${idx + 1}. ID: ${item.composerId} | "${item.name}"`);
    });
  });
}
