const fs = require('fs');
const path = require('path');

const indexJsPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\anysphere.cursor-agent-worker\\agent-cli\\.local\\share\\cursor-agent\\versions\\2026.08.11-e8db854\\index.js';

const content = fs.readFileSync(indexJsPath, 'utf8');

// Find occurrences of usage, tier, quota, /api/auth/stripe, etc.
const matches = content.match(/api2\.cursor\.sh\/[a-zA-Z0-9_\/-]+/g);
console.log('Endpoints in cursor index.js:', Array.from(new Set(matches)).slice(0, 30));

// Search for about/status logic
const aboutIdx = content.indexOf('Subscription Tier');
if (aboutIdx !== -1) {
  console.log('\nContext around Subscription Tier:');
  console.log(content.slice(aboutIdx - 300, aboutIdx + 500));
}
