import assert from 'assert';
import { SessionManager } from '../src/server/sessionManager';

console.log('▶ Testing Queue operations (enqueue, edit, remove, clear)...');
const sessionMgr = new SessionManager();

const session = sessionMgr.createSession({
  deviceId: 'default',
  title: 'Queue Test Session',
  engine: 'antigravity',
});

// 1. Enqueue prompts
sessionMgr.enqueuePrompt(session.id, 'Task 1: Run linter');
sessionMgr.enqueuePrompt(session.id, 'Task 2: Fix bug in auth');
sessionMgr.enqueuePrompt(session.id, 'Task 3: Run unit tests');

let s = sessionMgr.getSession(session.id)!;
assert(s.promptQueue && s.promptQueue.length === 3, 'Queue contains 3 tasks');
assert(s.promptQueue[1] === 'Task 2: Fix bug in auth', 'Task 2 text matches');

// 2. Edit/Update queued prompt at index 1
sessionMgr.updateQueuedPrompt(session.id, 1, 'Task 2: Fix bug in auth and add JWT test');
s = sessionMgr.getSession(session.id)!;
assert(s.promptQueue && s.promptQueue[1] === 'Task 2: Fix bug in auth and add JWT test', 'Queued prompt updated');
console.log('✔ Queue prompt editing verified');

// 3. Remove queued prompt at index 0
sessionMgr.removeQueuedPrompt(session.id, 0);
s = sessionMgr.getSession(session.id)!;
assert(s.promptQueue && s.promptQueue.length === 2, 'Queue has 2 items after removal');
assert(s.promptQueue[0] === 'Task 2: Fix bug in auth and add JWT test', 'Items shifted properly');
console.log('✔ Queue item removal verified');

// 4. Dequeue prompt
const nextPrompt = sessionMgr.dequeuePrompt(session.id);
assert(nextPrompt === 'Task 2: Fix bug in auth and add JWT test', 'Dequeued prompt matches');
s = sessionMgr.getSession(session.id)!;
assert(s.promptQueue && s.promptQueue.length === 1, 'Queue has 1 item left');

// 5. Clear queue
sessionMgr.clearQueue(session.id);
s = sessionMgr.getSession(session.id)!;
assert(s.promptQueue && s.promptQueue.length === 0, 'Queue is empty after clear');
console.log('✔ Queue clear verified');

// Cleanup
sessionMgr.deleteSession(session.id);

console.log('\n🎉 ALL QUEUE EDITING TESTS PASSED!\n');
