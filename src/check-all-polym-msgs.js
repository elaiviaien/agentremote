const HUB_URL = 'https://agentremote-production.up.railway.app';

async function checkAllPolymMessages() {
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

  sessions.forEach((s) => {
    if (s.title.includes('polym') || (s.workspacePath && s.workspacePath.includes('polym'))) {
      console.log(`\n======================================================`);
      console.log(`Session: ${s.id} | Title: "${s.title}" | Messages: ${s.messages.length}`);
      s.messages.forEach((m, idx) => {
        console.log(`\n[Msg ${idx + 1}] [${m.role}]:\n${m.content.slice(0, 300)}`);
      });
    }
  });
}

checkAllPolymMessages();
