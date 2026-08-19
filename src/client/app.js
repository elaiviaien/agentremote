// AgentRemote Web IDE Client Logic
class AgentRemoteApp {
  constructor() {
    this.token = localStorage.getItem('agentremote_token') || '';
    this.ws = null;
    this.devices = [];
    this.activeDeviceId = null;
    this.sessions = [];
    this.activeSessionId = null;
    this.isStreaming = false;
    this.activeCommandId = null;

    // File Explorer Navigation State
    this.currentFsPath = '';
    this.fsHistoryStack = [];
    this.currentFsTree = [];
    this.currentFsRoot = '';

    this.initElements();
    this.initEvents();
    this.checkAuth();
  }

  initElements() {
    // Login
    this.loginModal = document.getElementById('login-modal');
    this.loginForm = document.getElementById('login-form');
    this.loginUsername = document.getElementById('login-username');
    this.loginPassword = document.getElementById('login-password');
    this.loginError = document.getElementById('login-error');
    this.loginBtn = document.getElementById('login-btn');

    // App & Header
    this.appContainer = document.getElementById('app');
    this.deviceStatusDot = document.getElementById('device-status-dot');
    this.deviceSelect = document.getElementById('device-select');
    this.logoutBtn = document.getElementById('logout-btn');

    // Sidebar
    this.newChatBtn = document.getElementById('new-chat-btn');
    this.sessionSearch = document.getElementById('session-search');
    this.sessionList = document.getElementById('session-list');
    this.sessionCount = document.getElementById('session-count');
    this.modelSelect = document.getElementById('model-select');
    this.modeSelect = document.getElementById('mode-select');
    this.workspaceInput = document.getElementById('workspace-input');

    // Chat
    this.currentChatTitle = document.getElementById('current-chat-title');
    this.chatMeta = document.getElementById('chat-meta');
    this.chatMessages = document.getElementById('chat-messages');
    this.promptInput = document.getElementById('prompt-input');
    this.sendBtn = document.getElementById('send-btn');
    this.stopAgentBtn = document.getElementById('stop-agent-btn');
    this.loginCursorBtn = document.getElementById('login-cursor-btn');
    this.resumeChatBtn = document.getElementById('resume-chat-btn');
    this.activeDeviceIndicator = document.getElementById('active-device-indicator');

    // Tabs
    this.navTabs = document.querySelectorAll('.nav-pill');
    this.tabContents = document.querySelectorAll('.tab-content');
    this.toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    this.appSidebar = document.getElementById('app-sidebar');

    // Files Explorer
    this.fsBackBtn = document.getElementById('fs-back-btn');
    this.fsUpBtn = document.getElementById('fs-up-btn');
    this.fsBreadcrumbs = document.getElementById('fs-breadcrumbs');
    this.fsSearchInput = document.getElementById('fs-search-input');
    this.refreshFilesBtn = document.getElementById('refresh-files-btn');
    this.filesTree = document.getElementById('files-tree');
    this.previewFilename = document.getElementById('preview-filename');
    this.previewFileIcon = document.getElementById('preview-file-icon');
    this.previewContent = document.getElementById('preview-content');
    this.copyFileContentBtn = document.getElementById('copy-file-content-btn');

    // Terminal
    this.terminalOutput = document.getElementById('terminal-output');
    this.terminalForm = document.getElementById('terminal-form');
    this.terminalInput = document.getElementById('terminal-input');
    this.clearTermBtn = document.getElementById('clear-term-btn');

    // Devices View
    this.devicesFullList = document.getElementById('devices-full-list');
    this.copyCmdBtn = document.getElementById('copy-cmd-btn');
    this.daemonCommandText = document.getElementById('daemon-command-text');
  }

  initEvents() {
    // Login
    this.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.login(this.loginUsername.value, this.loginPassword.value);
    });

    // Logout
    this.logoutBtn.addEventListener('click', () => this.logout());

    // Navigation Tabs
    this.navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      });
    });

    // Mobile Sidebar Toggle
    this.toggleSidebarBtn.addEventListener('click', () => {
      this.appSidebar.classList.toggle('open');
    });

    // Device Switcher
    this.deviceSelect.addEventListener('change', (e) => {
      this.selectDevice(e.target.value);
    });

    // New Chat
    this.newChatBtn.addEventListener('click', () => {
      this.createNewSession();
    });

    // Resume Chat
    this.resumeChatBtn.addEventListener('click', () => {
      this.resumeCurrentSession();
    });

    // Login Cursor OAuth
    this.loginCursorBtn.addEventListener('click', () => {
      this.triggerCursorAuth();
    });

    // Session Search Filter
    this.sessionSearch.addEventListener('input', () => {
      this.renderSessions();
    });

    // Prompt Sending
    this.sendBtn.addEventListener('click', () => this.sendPrompt());
    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendPrompt();
      }
    });

    // Quick Prompt Chips
    document.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        this.promptInput.value = prompt;
        this.promptInput.focus();
      });
    });

    // Stop Agent Execution
    this.stopAgentBtn.addEventListener('click', () => this.abortAgent());

    // Files Navigation Events
    this.refreshFilesBtn.addEventListener('click', () => this.loadFilesTree(this.currentFsPath));
    
    this.fsBackBtn.addEventListener('click', () => {
      if (this.fsHistoryStack.length > 0) {
        const prev = this.fsHistoryStack.pop();
        this.loadFilesTree(prev, false);
      } else {
        this.navigateUpDirectory();
      }
    });

    this.fsUpBtn.addEventListener('click', () => {
      this.navigateUpDirectory();
    });

    this.fsSearchInput.addEventListener('input', (e) => {
      this.filterFilesTree(e.target.value);
    });

    this.copyFileContentBtn.addEventListener('click', () => {
      const code = this.previewContent.innerText;
      navigator.clipboard.writeText(code);
      this.copyFileContentBtn.innerText = 'Скопійовано!';
      setTimeout(() => (this.copyFileContentBtn.innerText = 'Скопіювати вміст'), 2000);
    });

    // Terminal Quick Commands
    document.querySelectorAll('.term-quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        this.execTerminalCommand(cmd);
      });
    });

    this.clearTermBtn.addEventListener('click', () => {
      this.terminalOutput.innerHTML = '';
    });

    this.terminalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.execTerminalCommand(this.terminalInput.value);
    });

    // Copy command
    this.copyCmdBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(this.daemonCommandText.innerText);
      this.copyCmdBtn.innerText = 'Скопійовано!';
      setTimeout(() => (this.copyCmdBtn.innerText = 'Скопіювати команду'), 2000);
    });
  }

  switchTab(tabName) {
    this.navTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));
    this.tabContents.forEach((c) => c.classList.toggle('active', c.id === `tab-${tabName}`));

    if (tabName === 'files') {
      if (!this.currentFsPath) {
        const activeDev = this.getActiveDevice();
        this.currentFsPath = (activeDev && activeDev.defaultWorkspace) || this.workspaceInput.value || '';
      }
      this.loadFilesTree(this.currentFsPath);
    }
  }

  async checkAuth() {
    try {
      const res = await fetch('/api/auth/me', {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        this.onAuthSuccess(data);
      } else {
        this.showLogin();
      }
    } catch {
      this.showLogin();
    }
  }

  async login(username, password) {
    this.loginError.innerText = '';
    this.loginBtn.disabled = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        this.token = data.token;
        localStorage.setItem('agentremote_token', this.token);
        this.onAuthSuccess(data);
      } else {
        this.loginError.innerText = data.error || 'Невірний логін або пароль';
      }
    } catch {
      this.loginError.innerText = 'Помилка з\'єднання з сервером';
    } finally {
      this.loginBtn.disabled = false;
    }
  }

  logout() {
    localStorage.removeItem('agentremote_token');
    fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  }

  showLogin() {
    this.loginModal.style.display = 'flex';
    this.appContainer.style.display = 'none';
  }

  onAuthSuccess(data) {
    this.loginModal.style.display = 'none';
    this.appContainer.style.display = 'flex';
    this.connectWs();
  }

  connectWs() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/client?token=${encodeURIComponent(this.token)}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Connected to AgentRemote Hub');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleWsMessage(msg);
      } catch (err) {
        console.error('WS Parse Error:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('WS Disconnected, retrying in 3s...');
      setTimeout(() => this.connectWs(), 3000);
    };
  }

  handleWsMessage(msg) {
    switch (msg.type) {
      case 'state:init': {
        this.devices = msg.payload.devices || [];
        this.activeDeviceId = msg.payload.activeDeviceId || (this.devices[0] ? this.devices[0].id : null);
        this.sessions = msg.payload.sessions || [];
        this.renderDevices();
        this.renderSessions();

        if (this.sessions.length > 0) {
          this.selectSession(this.sessions[0].id);
        }
        break;
      }

      case 'device:updated': {
        const dev = msg.payload;
        const idx = this.devices.findIndex((d) => d.id === dev.id);
        if (idx >= 0) {
          this.devices[idx] = dev;
        } else {
          this.devices.push(dev);
        }
        if (!this.activeDeviceId) {
          this.activeDeviceId = dev.id;
        }
        this.renderDevices();
        break;
      }

      case 'device:status': {
        const dev = this.devices.find((d) => d.id === msg.payload.deviceId);
        if (dev) {
          dev.status = msg.payload.status;
          this.renderDevices();
        }
        break;
      }

      case 'session:updated': {
        const session = msg.payload;
        const idx = this.sessions.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
          this.sessions[idx] = session;
        } else {
          this.sessions.unshift(session);
        }
        this.renderSessions();
        if (this.activeSessionId === session.id) {
          this.renderActiveChat();
        }
        break;
      }

      case 'session:deleted': {
        this.sessions = this.sessions.filter((s) => s.id !== msg.payload.sessionId);
        this.renderSessions();
        if (this.activeSessionId === msg.payload.sessionId) {
          this.activeSessionId = this.sessions[0] ? this.sessions[0].id : null;
          this.renderActiveChat();
        }
        break;
      }

      case 'agent:auth_url': {
        this.showAuthModal(msg.payload.url);
        break;
      }

      case 'agent:auth_success': {
        this.showToast('✅ Авторизація Cursor CLI успішно завершена!');
        if (this.authModalEl) this.authModalEl.remove();
        break;
      }

      case 'agent:chunk': {
        if (this.activeSessionId === msg.payload.sessionId) {
          this.setStreamingState(true);
          this.updateStreamingMessage(msg.payload.chunk);
        }
        break;
      }

      case 'agent:tool_call': {
        if (this.activeSessionId === msg.payload.sessionId) {
          this.appendToolCallCard(msg.payload.toolCall);
        }
        break;
      }

      case 'agent:tool_result': {
        if (this.activeSessionId === msg.payload.sessionId) {
          this.updateToolCallResult(msg.payload.toolCallId, msg.payload.result, msg.payload.status);
        }
        break;
      }

      case 'agent:complete': {
        if (this.activeSessionId === msg.payload.sessionId) {
          this.setStreamingState(false);
        }
        break;
      }

      case 'terminal:output': {
        this.appendTerminalOutput(msg.payload.data, msg.payload.isError);
        break;
      }

      case 'terminal:exit': {
        this.appendTerminalOutput(`\n[Process completed: code ${msg.payload.code}]\n\n`, false);
        break;
      }

      case 'fs:tree': {
        this.renderFilesTree(msg.payload.tree, msg.payload.rootPath);
        break;
      }

      case 'fs:file': {
        const filePath = msg.payload.path || this.activeOpenedPath || 'file';
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        this.previewFilename.innerText = fileName;
        this.previewFileIcon.innerText = this.getFileIcon(fileName);
        
        const codeEl = document.createElement('code');
        codeEl.innerText = msg.payload.content || msg.payload.error || '';
        this.previewContent.innerHTML = '';
        this.previewContent.appendChild(codeEl);
        
        if (typeof hljs !== 'undefined') {
          try {
            hljs.highlightElement(codeEl);
          } catch {}
        }
        
        this.copyFileContentBtn.style.display = 'inline-flex';
        break;
      }
    }
  }

  renderDevices() {
    this.deviceSelect.innerHTML = '';
    if (this.devices.length === 0) {
      this.deviceSelect.innerHTML = '<option value="">Немає підключених машин</option>';
      this.deviceStatusDot.className = 'device-status-indicator offline';
      this.activeDeviceIndicator.innerText = 'Пристрій: Не підключено';
    } else {
      this.devices.forEach((dev) => {
        const opt = document.createElement('option');
        opt.value = dev.id;
        const isOnline = dev.status === 'online';
        opt.innerText = `${isOnline ? '🟢' : '🔴'} ${dev.name} (${dev.os ? dev.os.split(' ')[0] : 'Local'})`;
        if (dev.id === this.activeDeviceId) {
          opt.selected = true;
        }
        this.deviceSelect.appendChild(opt);
      });

      const activeDev = this.getActiveDevice();
      const isOnline = activeDev && activeDev.status === 'online';
      this.deviceStatusDot.className = `device-status-indicator ${isOnline ? 'online' : 'offline'}`;
      this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev ? activeDev.name : 'Не обрано'} (${isOnline ? 'ONLINE' : 'OFFLINE'})`;

      if (activeDev && activeDev.defaultWorkspace && !this.workspaceInput.value) {
        this.workspaceInput.value = activeDev.defaultWorkspace;
      }
    }

    // Render Full Settings Grid
    this.devicesFullList.innerHTML = this.devices
      .map(
        (dev) => `
      <div class="device-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>💻 ${dev.name}</strong>
          <span class="device-status-indicator ${dev.status === 'online' ? 'online' : 'offline'}"></span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.6; margin-top:6px;">
          <div><strong>ID:</strong> <code>${dev.id}</code></div>
          <div><strong>OS:</strong> ${dev.os || 'Windows/Linux/macOS'}</div>
          <div><strong>Cursor CLI:</strong> ${dev.cursorCliPath ? '✅ Виявлено' : '❌ Не знайдено'}</div>
          <div><strong>Antigravity:</strong> ${dev.antigravityAvailable ? '✅ Доступно' : '❌ Не виявлено'}</div>
          ${dev.memoryUsage ? `<div><strong>RAM:</strong> ${dev.memoryUsage.used} MB / ${dev.memoryUsage.total} MB</div>` : ''}
          <div><strong>Робоча папка:</strong> <code>${dev.defaultWorkspace || '-'}</code></div>
        </div>
      </div>
    `
      )
      .join('');
  }

  getActiveDevice() {
    return this.devices.find((d) => d.id === this.activeDeviceId) || this.devices[0];
  }

  selectDevice(deviceId) {
    this.activeDeviceId = deviceId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'device:select', deviceId }));
    }
    this.renderDevices();
  }

  renderSessions() {
    const query = (this.sessionSearch.value || '').toLowerCase().trim();
    const filtered = this.sessions.filter(
      (s) => !query || (s.title && s.title.toLowerCase().includes(query))
    );

    this.sessionCount.innerText = filtered.length;

    if (filtered.length === 0) {
      this.sessionList.innerHTML = '<p class="meta-text" style="padding:12px 6px; text-align:center;">Сесій не знайдено</p>';
      return;
    }

    this.sessionList.innerHTML = '';
    filtered.forEach((s) => {
      const item = document.createElement('div');
      item.className = `session-item ${s.id === this.activeSessionId ? 'active' : ''}`;
      
      const formattedDate = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <div class="session-info">
          <div class="session-title">${this.escapeHtml(s.title || 'Чат Cursor')}</div>
          <div class="session-date">${formattedDate} • ${s.model || 'Claude'}</div>
        </div>
        <button class="session-delete-btn" title="Видалити сесію">✕</button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('session-delete-btn')) {
          e.stopPropagation();
          this.deleteSession(s.id);
        } else {
          this.selectSession(s.id);
        }
      });

      this.sessionList.appendChild(item);
    });
  }

  selectSession(sessionId) {
    this.activeSessionId = sessionId;
    this.renderSessions();
    this.renderActiveChat();
    this.appSidebar.classList.remove('open');
  }

  async createNewSession() {
    const activeDev = this.getActiveDevice();
    const newSession = {
      deviceId: activeDev ? activeDev.id : 'default',
      title: 'Новий чат Cursor',
      model: this.modelSelect.value,
      mode: this.modeSelect.value,
      workspacePath: this.workspaceInput.value,
    };

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(newSession),
    });

    if (res.ok) {
      const data = await res.json();
      this.sessions.unshift(data.session);
      this.selectSession(data.session.id);
      this.promptInput.focus();
    }
  }

  async deleteSession(sessionId) {
    if (!confirm('Видалити цю сесію?')) return;
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0] ? this.sessions[0].id : null;
    }
    this.renderSessions();
    this.renderActiveChat();
  }

  renderActiveChat() {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) {
      this.currentChatTitle.innerText = 'Новий чат Cursor';
      this.chatMeta.innerText = 'Оберіть сесію або почніть нову';
      this.chatMessages.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-badge">⚡ AgentRemote IDE</div>
          <h3>Створіть або оберіть сесію</h3>
          <p>Натисніть "+ Новий чат Cursor" у бічній панелі щоб почати.</p>
        </div>
      `;
      return;
    }

    this.currentChatTitle.innerText = session.title || 'Чат Cursor';
    this.chatMeta.innerText = `ID: ${session.id.slice(0, 8)}... | ${session.model} | ${session.mode.toUpperCase()}`;

    if (session.messages.length === 0) {
      this.chatMessages.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-badge">⚡ Готовий до роботи</div>
          <h3>${this.escapeHtml(session.title)}</h3>
          <p>Напишіть запит або оберіть одну зі швидких дій нижче:</p>
          <div class="quick-prompt-chips">
            <button class="chip-btn" data-prompt="Зроби огляд проекту і поясни структуру коду">📂 Огляд проекту</button>
            <button class="chip-btn" data-prompt="Перевір git статус та останні коміти">🔍 Перевірити git статус</button>
            <button class="chip-btn" data-prompt="Запусти тести та перевір білд">⚡ Запустити тести</button>
            <button class="chip-btn" data-prompt="Знайди та виправ помилки у коді">🐛 Пошук багів</button>
          </div>
        </div>
      `;
      // rebind chip buttons
      this.chatMessages.querySelectorAll('.chip-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.promptInput.value = btn.dataset.prompt;
          this.promptInput.focus();
        });
      });
      return;
    }

    this.chatMessages.innerHTML = '';
    session.messages.forEach((msg) => {
      this.appendMessageElement(msg);
    });

    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  appendMessageElement(msg) {
    const el = document.createElement('div');
    el.className = `message ${msg.role}`;
    const formattedTime = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let renderedContent = '';
    if (typeof marked !== 'undefined' && msg.role === 'assistant') {
      renderedContent = marked.parse(msg.content || '');
    } else {
      renderedContent = `<p>${this.escapeHtml(msg.content || '')}</p>`;
    }

    const roleName = msg.role === 'user' ? 'Ви' : `🤖 Cursor Agent (${this.modelSelect.value})`;

    el.innerHTML = `
      <div class="message-header">
        <span>${roleName}</span>
        <span>${formattedTime}</span>
      </div>
      <div class="message-bubble">
        ${renderedContent}
      </div>
    `;

    // Render tool calls if any
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const bubble = el.querySelector('.message-bubble');
      msg.toolCalls.forEach((tc) => {
        const tcEl = document.createElement('div');
        tcEl.className = 'tool-call-card';
        tcEl.id = `tool-call-${tc.id}`;
        tcEl.innerHTML = `
          <div class="tool-call-header">
            <span>🔨 ${this.escapeHtml(tc.name)}</span>
            <span>${tc.status === 'running' ? '⏳ виконується...' : '✅ завершено'}</span>
          </div>
          ${tc.output ? `<div class="tool-call-output">${this.escapeHtml(tc.output)}</div>` : ''}
        `;
        bubble.appendChild(tcEl);
      });
    }

    // Highlight code blocks
    if (typeof hljs !== 'undefined') {
      el.querySelectorAll('pre code').forEach((block) => {
        try {
          hljs.highlightElement(block);
        } catch {}
      });
    }

    this.chatMessages.appendChild(el);
  }

  sendPrompt() {
    const text = this.promptInput.value.trim();
    if (!text || this.isStreaming) return;

    if (!this.activeSessionId) {
      this.createNewSession().then(() => this.sendPrompt());
      return;
    }

    const payload = {
      sessionId: this.activeSessionId,
      deviceId: this.activeDeviceId,
      prompt: text,
      model: this.modelSelect.value,
      mode: this.modeSelect.value,
      workspacePath: this.workspaceInput.value,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent:prompt', payload }));
      this.promptInput.value = '';
      this.setStreamingState(true);
    }
  }

  resumeCurrentSession() {
    if (!this.activeSessionId) {
      alert('Будь ласка, оберіть сесію для продовження');
      return;
    }
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) return;

    const resumePrompt = prompt('Введіть наступну інструкцію для продовження чату:', 'Continue previous task.');
    if (!resumePrompt) return;

    const payload = {
      sessionId: this.activeSessionId,
      deviceId: this.activeDeviceId,
      prompt: resumePrompt,
      continueLastSession: true,
      cursorChatId: session.cursorChatId,
      model: this.modelSelect.value,
      mode: this.modeSelect.value,
      workspacePath: this.workspaceInput.value,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent:prompt', payload }));
      this.setStreamingState(true);
    }
  }

  triggerCursorAuth() {
    const activeDev = this.getActiveDevice();
    const targetDevId = activeDev ? activeDev.id : this.activeDeviceId;

    if (!targetDevId) {
      alert('Будь ласка, переконайтеся що комп\'ютер підключений');
      return;
    }

    this.showAuthModal(null);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:trigger_auth',
          payload: { deviceId: targetDevId },
        })
      );
    }
  }

  showAuthModal(url) {
    if (this.authModalEl) {
      this.authModalEl.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="login-card glass-panel" style="max-width: 460px;">
        <div class="login-header">
          <div class="brand-logo-badge">🔑</div>
          <h2>Авторизація Cursor CLI</h2>
          <p>${url ? 'Підтвердіть вхід у ваш акаунт Cursor:' : 'Генерація посилання авторизації з машини...'}</p>
        </div>
        ${
          url
            ? `
          <div style="margin-bottom: 18px; text-align: center;">
            <a href="${url}" target="_blank" class="btn btn-primary btn-block btn-lg" style="text-decoration: none;">
              <span>🔗 Відкрити сторінку входу Cursor</span>
            </a>
          </div>
          <div class="code-copy-box" style="margin-bottom: 16px;">
            <pre style="font-size:11px; word-break:break-all; white-space:pre-wrap;">${url}</pre>
          </div>
          <p style="font-size: 11.5px; color: var(--text-muted); text-align: center; margin-bottom: 18px;">
            Після підтвердження у браузері поверніться сюди. Авторизація збережеться автоматично.
          </p>
        `
            : `
          <div style="text-align:center; padding: 24px;">
            <div style="font-size:24px; margin-bottom:8px;">⏳</div>
            <span style="color:var(--text-secondary)">Запуск процесу авторизації на машині...</span>
          </div>
        `
        }
        <button id="close-auth-modal" class="btn btn-secondary btn-block">Закрити</button>
      </div>
    `;

    modal.querySelector('#close-auth-modal').addEventListener('click', () => {
      modal.remove();
    });

    document.body.appendChild(modal);
    this.authModalEl = modal;

    // If URL is ready, open automatically in new tab
    if (url) {
      window.open(url, '_blank');
    }
  }

  abortAgent() {
    if (this.activeSessionId && this.ws) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:abort',
          payload: { sessionId: this.activeSessionId },
        })
      );
      this.setStreamingState(false);
    }
  }

  setStreamingState(streaming) {
    this.isStreaming = streaming;
    this.stopAgentBtn.style.display = streaming ? 'inline-flex' : 'none';
    this.sendBtn.disabled = streaming;
  }

  updateStreamingMessage(fullContent) {
    let lastMsg = this.chatMessages.querySelector('.message.assistant:last-child');
    if (!lastMsg) {
      this.appendMessageElement({
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
      });
      lastMsg = this.chatMessages.querySelector('.message.assistant:last-child');
    }

    if (lastMsg) {
      const bubble = lastMsg.querySelector('.message-bubble');
      if (typeof marked !== 'undefined') {
        bubble.innerHTML = marked.parse(fullContent);
      } else {
        bubble.innerHTML = `<p>${this.escapeHtml(fullContent)}</p>`;
      }
    }
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  appendToolCallCard(tc) {
    const lastMsg = this.chatMessages.querySelector('.message.assistant:last-child');
    if (!lastMsg) return;
    const bubble = lastMsg.querySelector('.message-bubble');

    let card = document.getElementById(`tool-call-${tc.id}`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'tool-call-card';
      card.id = `tool-call-${tc.id}`;
      bubble.appendChild(card);
    }

    card.innerHTML = `
      <div class="tool-call-header">
        <span>🔨 ${this.escapeHtml(tc.name)}</span>
        <span>⏳ виконується...</span>
      </div>
      ${tc.input ? `<div class="tool-call-output">${this.escapeHtml(JSON.stringify(tc.input, null, 2))}</div>` : ''}
    `;
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  updateToolCallResult(toolCallId, result, status) {
    const card = document.getElementById(`tool-call-${toolCallId}`);
    if (card) {
      const header = card.querySelector('.tool-call-header span:last-child');
      if (header) header.innerText = status === 'completed' ? '✅ завершено' : '❌ помилка';
      let out = card.querySelector('.tool-call-output');
      if (!out) {
        out = document.createElement('div');
        out.className = 'tool-call-output';
        card.appendChild(out);
      }
      out.innerText = result;
    }
  }

  // ================= FILES EXPLORER LOGIC =================
  loadFilesTree(dirPath, recordHistory = true) {
    if (recordHistory && this.currentFsPath && this.currentFsPath !== dirPath) {
      this.fsHistoryStack.push(this.currentFsPath);
    }
    this.currentFsPath = dirPath || '';

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.filesTree.innerHTML = '<p class="placeholder-text" style="padding:20px; text-align:center;">Завантаження файлів...</p>';
      this.ws.send(
        JSON.stringify({
          type: 'fs:tree',
          payload: { deviceId: this.activeDeviceId, path: dirPath },
        })
      );
    }
  }

  renderFilesTree(tree, rootPath) {
    this.currentFsTree = tree || [];
    this.currentFsRoot = rootPath || '';
    this.currentFsPath = rootPath || '';

    this.renderBreadcrumbs(rootPath);

    if (!tree || tree.length === 0) {
      this.filesTree.innerHTML = '<p class="placeholder-text" style="padding:20px; text-align:center;">Папка порожня</p>';
      return;
    }

    this.displayFiles(this.currentFsTree);
  }

  renderBreadcrumbs(rootPath) {
    if (!rootPath) {
      this.fsBreadcrumbs.innerHTML = '<span class="breadcrumb-segment">Workspace</span>';
      return;
    }

    const separator = rootPath.includes('\\') ? '\\' : '/';
    const parts = rootPath.split(/[/\\]/).filter(Boolean);

    this.fsBreadcrumbs.innerHTML = '';
    let accumulated = rootPath.startsWith('/') ? '/' : '';

    parts.forEach((part, index) => {
      if (index === 0 && !rootPath.startsWith('/')) {
        accumulated += part;
      } else {
        accumulated += (accumulated.endsWith(separator) ? '' : separator) + part;
      }

      const segment = document.createElement('span');
      segment.className = 'breadcrumb-segment';
      segment.innerText = part;
      const targetPath = accumulated;
      segment.addEventListener('click', () => {
        this.loadFilesTree(targetPath);
      });

      this.fsBreadcrumbs.appendChild(segment);

      if (index < parts.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.innerText = ' / ';
        this.fsBreadcrumbs.appendChild(sep);
      }
    });
  }

  navigateUpDirectory() {
    if (!this.currentFsRoot) return;
    const isWindows = this.currentFsRoot.includes('\\');
    const separator = isWindows ? '\\' : '/';
    const parts = this.currentFsRoot.split(/[/\\]/).filter(Boolean);

    if (parts.length > 1) {
      parts.pop();
      let parentPath = parts.join(separator);
      if (this.currentFsRoot.startsWith('/')) {
        parentPath = '/' + parentPath;
      }
      this.loadFilesTree(parentPath);
    }
  }

  filterFilesTree(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      this.displayFiles(this.currentFsTree);
      return;
    }

    const filtered = this.currentFsTree.filter((item) =>
      item.name.toLowerCase().includes(q)
    );
    this.displayFiles(filtered);
  }

  displayFiles(items) {
    this.filesTree.innerHTML = '';
    const list = document.createElement('div');

    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'tree-node';
      const icon = item.isDirectory ? '📁' : this.getFileIcon(item.name);
      const sizeText = item.size ? this.formatFileSize(item.size) : '';

      el.innerHTML = `
        <div class="node-left">
          <span>${icon}</span>
          <span>${this.escapeHtml(item.name)}</span>
        </div>
        ${sizeText ? `<span class="node-size">${sizeText}</span>` : ''}
      `;

      el.addEventListener('click', () => {
        document.querySelectorAll('.tree-node').forEach((n) => n.classList.remove('active'));
        el.classList.add('active');

        if (item.isDirectory) {
          this.loadFilesTree(item.path);
        } else {
          this.openFile(item.path);
        }
      });

      list.appendChild(el);
    });

    this.filesTree.appendChild(list);
  }

  getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return '📘';
      case 'js':
      case 'jsx':
        return '🟨';
      case 'json':
        return '⚙️';
      case 'html':
        return '🌐';
      case 'css':
      case 'scss':
        return '🎨';
      case 'py':
        return '🐍';
      case 'md':
        return '📝';
      case 'sh':
      case 'ps1':
      case 'cmd':
      case 'bat':
        return '⚡';
      default:
        return '📄';
    }
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  openFile(filePath) {
    this.activeOpenedPath = filePath;
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    this.previewFilename.innerText = fileName;
    this.previewFileIcon.innerText = this.getFileIcon(fileName);
    this.previewContent.innerHTML = '<code>Завантаження вмісту файлу...</code>';

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'fs:read',
          payload: { deviceId: this.activeDeviceId, path: filePath },
        })
      );
    }
  }

  // ================= TERMINAL LOGIC =================
  execTerminalCommand(cmdText) {
    const cmd = (cmdText || '').trim();
    if (!cmd) return;

    this.activeCommandId = Math.random().toString(36).substring(2, 8);
    this.appendTerminalOutput(`\n> ${cmd}\n`, false);
    this.terminalInput.value = '';

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'terminal:exec',
          payload: {
            commandId: this.activeCommandId,
            deviceId: this.activeDeviceId,
            command: cmd,
            cwd: this.workspaceInput.value,
          },
        })
      );
    }
  }

  appendTerminalOutput(text, isError) {
    const span = document.createElement('span');
    span.style.color = isError ? '#f87171' : '#cbd5e1';
    span.innerText = text;
    this.terminalOutput.appendChild(span);
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
  }

  showToast(text) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.background = 'var(--accent-gradient)';
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    toast.style.zIndex = '99999';
    toast.style.fontWeight = '600';
    toast.innerText = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new AgentRemoteApp();
});
