import assert from 'assert';
import { ChatSanitizer } from '../src/shared/chatSanitizer';

console.log('▶ Testing Antigravity Tool Metadata Parsing...');

const step0 = JSON.stringify({
  step_index: 0,
  source: 'USER_EXPLICIT',
  type: 'USER_INPUT',
  status: 'DONE',
  content: '<USER_REQUEST>\nствори файл\n</USER_REQUEST>'
});

const step1 = JSON.stringify({
  step_index: 1,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  tool_calls: [
    {
      name: 'write_to_file',
      args: {
        TargetFile: '"C:\\\\test\\\\hello.txt"',
        CodeContent: '"Hello World"',
        toolAction: '"Creating hello.txt file"',
        toolSummary: '"Create hello.txt file"'
      }
    }
  ]
});

const step2 = JSON.stringify({
  step_index: 2,
  source: 'MODEL',
  type: 'GENERIC',
  status: 'DONE',
  content: 'Created At: 2026-08-20\nFile created successfully.'
});

const sampleJsonl = [step0, step1, step2].join('\n');

const res = ChatSanitizer.parseAntigravityJsonl(sampleJsonl);
assert.strictEqual(res.messages.length, 2, 'Parsed 2 messages (1 user, 1 assistant)');

const assistantMsg = res.messages[1];
assert(assistantMsg.toolCalls && assistantMsg.toolCalls.length === 1, 'Found 1 tool call');

const tc = assistantMsg.toolCalls[0];
console.log('Parsed Tool Call:', JSON.stringify(tc, null, 2));

assert.strictEqual(tc.name, 'write_to_file', 'Tool name is write_to_file');
assert.strictEqual(tc.input.TargetFile, 'C:\\test\\hello.txt', 'TargetFile unescaped correctly');
assert.strictEqual(tc.action, 'Creating hello.txt file', 'toolAction captured');
assert.strictEqual(tc.summary, 'Create hello.txt file', 'toolSummary captured');
assert(tc.output && tc.output.includes('File created successfully'), 'Tool output matched from GENERIC step');

console.log('\n🎉 ANTIGRAVITY TOOL METADATA TEST PASSED!\n');
process.exit(0);
