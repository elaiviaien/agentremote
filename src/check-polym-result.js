const HUB_URL = 'https://agentremote-production.up.railway.app';

async function checkPolymSession() {
  const loginRes = await fetch(`${HUB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const { token } = await loginRes.json();

  const sessionsRes = await fetch(`${HUB_URL}/api/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { sessions } = await sessionsRes.json();

  const polymSessions = sessions.filter((s) => s.workspacePath && s.workspacePath.includes('polym_agent'));
  console.log(`Found ${polymSessions.length} polym_agent sessions on Hub:`);

  polymSessions.forEach((s) => {
    console.log(`\n======================================================`);
    console.log(`Session ID: ${s.id} | Title: "${s.title}"`);
    console.log(`Workspace: ${s.workspacePath}`);
    console.log(`Messages Count: ${s.messages.length}`);
    const lastMsg = s.messages[s.messages.length - 1];
    if (lastMsg) {
      console.log(`Role: ${lastMsg.role}`);
      console.log(`Content:\n${lastMsg.content}`);
    }
  });
}

checkPolymSession();
