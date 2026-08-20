const fs = require('fs');
const path = require('path');
const os = require('os');

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const wsStorage = path.join(appData, 'Cursor', 'User', 'workspaceStorage');

console.log('Scanning Cursor workspaceStorage at:', wsStorage);

if (fs.existsSync(wsStorage)) {
  const folders = fs.readdirSync(wsStorage);
  console.log(`Found ${folders.length} workspace folders in Cursor storage.`);

  for (const f of folders) {
    const p = path.join(wsStorage, f);
    const wsJson = path.join(p, 'workspace.json');
    if (fs.existsSync(wsJson)) {
      try {
        const data = JSON.parse(fs.readFileSync(wsJson, 'utf8'));
        const folderPath = data.folder || data.workspace;
        console.log(`- Workspace ID: ${f} -> Path: ${folderPath}`);
        
        // List files in workspace storage
        const files = fs.readdirSync(p);
        console.log(`   Storage contents:`, files);
      } catch (e) {
        console.error(e);
      }
    }
  }
} else {
  console.log('workspaceStorage not found.');
}
