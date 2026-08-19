const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const wsDbPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\workspaceStorage\\61a62f172c19277420d67c71974df40b\\state.vscdb';

const db = new DatabaseSync(wsDbPath);
const genRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'aiService.generations'").get();
const promptRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'aiService.prompts'").get();

console.log('--- polym_agent Full Chat History ---');
if (genRow) {
  const generations = JSON.parse(genRow.value);
  console.log(`Total generations in polym_agent: ${generations.length}`);
  
  generations.forEach((g, idx) => {
    console.log(`\n[${idx + 1}] (${g.type || 'composer'} | ${new Date(g.unixMs).toLocaleString()}):`);
    console.log(`Text: ${(g.textDescription || '').slice(0, 150)}...`);
  });
}
