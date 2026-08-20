import assert from 'assert';
import { SessionManager } from '../src/server/sessionManager';

console.log('▶ [Test 1/5] Testing Project CRUD...');
const sessionMgr = new SessionManager();

const createdProject = sessionMgr.createProject({
  name: 'Mobile App Project',
  description: 'iOS and Android client',
  icon: '📱',
  color: '#ec4899',
  workspacePath: '/src/mobile',
  defaultEngine: 'antigravity',
  defaultModel: 'gemini-3.7-flash',
});

assert(createdProject.id, 'Project ID generated');
assert(createdProject.name === 'Mobile App Project', 'Project name matches');
assert(createdProject.icon === '📱', 'Project icon matches');
assert(createdProject.color === '#ec4899', 'Project color matches');

const fetchedProject = sessionMgr.getProject(createdProject.id);
assert(fetchedProject?.id === createdProject.id, 'Fetched project matches');

const updatedProject = sessionMgr.updateProject(createdProject.id, {
  name: 'Mobile & Web App',
  icon: '🚀',
});
assert(updatedProject?.name === 'Mobile & Web App', 'Project name updated');
assert(updatedProject?.icon === '🚀', 'Project icon updated');
console.log('✔ Project CRUD verified successfully');

console.log('▶ [Test 2/5] Testing Session creation with Project & Pin status...');
const session1 = sessionMgr.createSession({
  deviceId: 'default',
  title: 'Unpinned Chat 1',
  engine: 'cursor',
  projectId: createdProject.id,
  isPinned: false,
});

const session2 = sessionMgr.createSession({
  deviceId: 'default',
  title: 'Pinned Chat 2',
  engine: 'antigravity',
  projectId: createdProject.id,
  isPinned: true,
});

const session3 = sessionMgr.createSession({
  deviceId: 'default',
  title: 'General Chat 3',
  engine: 'cursor',
  isPinned: false,
});

assert(session1.projectId === createdProject.id, 'Session 1 has projectId');
assert(session2.projectId === createdProject.id, 'Session 2 has projectId');
assert(session2.isPinned === true, 'Session 2 is pinned');
assert(!session3.projectId, 'Session 3 is unassigned');
console.log('✔ Session project assignment and pin state verified');

console.log('▶ [Test 3/5] Testing Pinned Session sorting order...');
const sessions = sessionMgr.getSessions();
const s2Idx = sessions.findIndex((s) => s.id === session2.id);
const s1Idx = sessions.findIndex((s) => s.id === session1.id);
const s3Idx = sessions.findIndex((s) => s.id === session3.id);

assert(s2Idx < s1Idx, 'Pinned session 2 is sorted before unpinned session 1');
assert(s2Idx < s3Idx, 'Pinned session 2 is sorted before unpinned session 3');
console.log('✔ Pinned sessions always sorted to top');

console.log('▶ [Test 4/5] Testing Pin toggle...');
const toggled = sessionMgr.togglePin(session1.id);
assert(toggled?.isPinned === true, 'Session 1 is now pinned');
const reToggled = sessionMgr.togglePin(session1.id);
assert(reToggled?.isPinned === false, 'Session 1 is now unpinned');
console.log('✔ Pin toggle works');

console.log('▶ [Test 5/5] Testing Project deletion cascade (graceful unassign)...');
sessionMgr.deleteProject(createdProject.id);
const deletedProject = sessionMgr.getProject(createdProject.id);
assert(!deletedProject, 'Project successfully deleted');

const refreshedSession1 = sessionMgr.getSession(session1.id);
assert(refreshedSession1 !== undefined, 'Session 1 still exists');
assert(refreshedSession1.projectId === undefined, 'Session 1 projectId gracefully unassigned');

sessionMgr.deleteSession(session1.id);
sessionMgr.deleteSession(session2.id);
sessionMgr.deleteSession(session3.id);

console.log('✔ Project deletion cascade gracefully preserved sessions');
console.log('\n🎉 ALL PINNING & PROJECT TESTS PASSED SUCCESSFULLY!\n');
