import assert from 'assert';
import { truncateToolCallItem, truncateString } from '../src/shared/chatSanitizer';
import { SessionManager } from '../src/server/sessionManager';
import { db } from '../src/server/db';
import { ToolCallItem } from '../src/shared/types';

console.log('▶ [Test 1/3] Testing truncateString & truncateToolCallItem...');

const hugeCode = 'export const test = ' + 'A'.repeat(50000);
const rawToolCall: ToolCallItem = {
  id: 'tc-123',
  type: 'write_to_file',
  name: 'write_to_file',
  summary: 'Writing very large file '.repeat(20),
  action: 'Writing file',
  input: {
    TargetFile: '/path/to/large.ts',
    CodeContent: hugeCode,
  },
  output: 'Success: ' + 'B'.repeat(50000),
  status: 'completed',
};

const truncated = truncateToolCallItem(rawToolCall);
assert(truncated.id === 'tc-123', 'ToolCall ID preserved');
assert(truncated.input.TargetFile === '/path/to/large.ts', 'TargetFile preserved');
assert(truncated.input.CodeContent.length < 1500, 'CodeContent aggressively truncated');
assert(truncated.output!.length < 3500, 'Output aggressively truncated');
console.log('✔ Truncation logic works: raw 100KB+ -> truncated under 5KB');

console.log('▶ [Test 2/3] Testing getSessionSummaries lightweight response...');
const sessionMgr = new SessionManager();
const summaries = sessionMgr.getSessionSummaries();
assert(Array.isArray(summaries), 'Summaries is an array');

summaries.forEach((summary) => {
  assert(!('messages' in summary), 'Summary MUST NOT contain messages array');
  assert(typeof summary.messageCount === 'number', 'Summary contains messageCount number');
  assert(typeof summary.id === 'string', 'Summary contains id');
});

const summariesSize = JSON.stringify(summaries).length;
console.log(`✔ Sessions list payload size: ${(summariesSize / 1024).toFixed(2)} KB for ${summaries.length} sessions`);

console.log('▶ [Test 3/3] Testing getSession with full messages on demand...');
if (summaries.length > 0) {
  const firstId = summaries[0].id;
  const fullSession = sessionMgr.getSession(firstId);
  assert(fullSession !== undefined, 'Full session retrieved');
  assert(Array.isArray(fullSession.messages), 'Full session contains messages');
  console.log(`✔ Full session '${fullSession.title}' loaded with ${fullSession.messages.length} messages`);
}

console.log('\n🎉 ALL OPTIMIZATION TESTS PASSED!\n');
