const fs = require('fs');
const indexJsPath = 'C:\\Users\\olivka\\AppData\\Roaming\\Cursor\\User\\globalStorage\\anysphere.cursor-agent-worker\\agent-cli\\.local\\share\\cursor-agent\\versions\\2026.08.11-e8db854\\index.js';

const content = fs.readFileSync(indexJsPath, 'utf8');

const regex = /Subscription Tier/i;
const match = regex.exec(content);
if (match) {
  console.log('Found match at index:', match.index);
  console.log(content.slice(match.index - 500, match.index + 800));
} else {
  console.log('No direct string match');
}
