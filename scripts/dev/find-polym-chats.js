const { DatabaseSync } = require('node:sqlite');
const globalDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb';

const db = new DatabaseSync(globalDbPath);
const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData' OR key = 'composer.composerHeaders'").get();

if (row) {
  const data = JSON.parse(row.value);
  const composers = data.allComposers || data.composers || (Array.isArray(data) ? data : []);

  console.log('Sample Composer Object:');
  console.log(JSON.stringify(composers[0], null, 2));

  // Find all composers containing polym or matching workspace
  console.log('\n--- Searching for polym_agent chats ---');
  composers.forEach((c) => {
    const str = JSON.stringify(c).toLowerCase();
    if (str.includes('polym') || str.includes('61a62f172c19277420d67c71974df40b')) {
      console.log('Found polym_agent session:', {
        composerId: c.composerId,
        name: c.name || c.text,
        lastUpdatedAt: c.lastUpdatedAt,
      });
    }
  });
}
