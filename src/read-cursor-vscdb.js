const sqlite3 = require('node:sqlite'); // In newer node or fallback with regex/buffer read
const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\workspaceStorage\\61a62f172c19277420d67c71974df40b\\state.vscdb';

console.log('Reading state.vscdb buffer size:', fs.statSync(dbPath).size);

// Read raw buffer and extract strings/JSON for composerData / chat data
const buf = fs.readFileSync(dbPath, 'utf8');

// Look for composer or chat keys
const matches = buf.match(/composer\.composerData|chat\.ChatSessionStore|workbench\.panel\.chat/g);
console.log('Matches found in state.vscdb:', matches);

// Check globalStorage state.vscdb
const globalDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb';
if (fs.existsSync(globalDbPath)) {
  console.log('Global state.vscdb size:', fs.statSync(globalDbPath).size);
}
