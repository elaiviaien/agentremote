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

    this.initElements();
    this.initEvents();
    this.checkAuth();
  }

  initElements() {
    this.loginModal = document.getElementById('login-modal');
    this.loginForm = document.getElementById('login-form');
    this.loginUsername = document.getElementById('login-username');
    this.loginPassword = document.getElementById('login-password');
    this.loginError = document.getElementById('login-error');
    this.loginBtn = document.getElementById('login-btn');

    this.appContainer = document.getElementById('app');
    this.statusDot = document.getElementById('status-dot');
    this.deviceSelect = document.getElementById('device-select');
    this.sessionList = document.getElementById('session-list');
    this.sessionCount = document.getElementById('session-count');
    this.newChatBtn = document.getElementById('new-chat-btn');
    this.resumeChatBtn = document.getElementById('resume-chat-btn');
    this.loginCursorBtn = document.getElementById('login-cursor-btn');
    this.logoutBtn = document.getElementById('logout-btn');

    this.currentChatTitle = document.getElementById('current-chat-title');
    this.chatMeta = document.getElementById('chat-meta');
    this.chatMessages = document.getElementById('chat-messages');
    this.promptInput = document.getElementById('prompt-input');
    this.sendBtn = document.getElementById('send-btn');
    this.stopAgentBtn = document.getElementById('stop-agent-btn');
    this.activeDeviceIndicator = document.getElementById('active-device-indicator');

    this.modelSelect = document.getElementById('model-select');
    this.modeSelect = document.getElementById('mode-select');
    this.workspaceInput = document.getElementById('workspace-input');

    // Tabs
    this.navTabs = document.querySelectorAll('.nav-tab');
    this.tabContents = document.querySelectorAll('.tab-content');
    this.toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    this.appSidebar = document.getElementById('app-sidebar');

    // Files
    this.filesTree = document.getElementById('files-tree');
    this.previewFilename = document.getElementById('preview-filename');
    this.previewContent = document.getElementById('preview-content');
    this.refreshFilesBtn = document.getElementById('refresh-files-btn');

    // Terminal
    this.terminalOutput = document.getElementById('terminal-output');
    this.terminalForm = document.getElementById('terminal-form');
    this.terminalInput = document.getElementById('terminal-input');

    // Devices View
    this.devicesFullList = document.getElementById('devices-full-list');
    this.copyCmdBtn = document.getElementById('copy-cmd-btn');
    this.daemonCommandText = document.getElementById('daemon-command-text');
  }

  initEvents() {
    // Login form
    this.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.login(this.loginUsername.value, this.loginPassword.value);
    });

    // Logout
    this.logoutBtn.addEventListener('click', () => this.logout());

    // Tabs
    this.navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        this.switchTab(targetTab);
      });
    });

    // Mobile sidebar toggle
    this.toggleSidebarBtn.addEventListener('click', () => {
      this.appSidebar.classList.toggle('open');
    });

    // Device change
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

    // Login Cursor CLI
    this.loginCursorBtn.addEventListener('click', () => {
      this.triggerCursorAuth();
    });

    // Prompt Send
    this.sendBtn.addEventListener('click', () => this.sendPrompt());
    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendPrompt();
      }
    });

    // Stop Agent
    this.stopAgentBtn.addEventListener('click', () => this.abortAgent());

    // Refresh Files
    this.refreshFilesBtn.addEventListener('click', () => this.loadFilesTree());

    // Terminal command
    this.terminalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.execTerminalCommand();
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
      this.loadFilesTree();
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
    this.loginBtn.innerText = 'Вхід...';
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
    } catch (err) {
      this.loginError.innerText = 'Помилка з\'єднання з сервером';
    } finally {
      this.loginBtn.innerText = 'Увійти в IDE';
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

      case 'agent:chunk': {
        if (this.activeSessionId === msg.payload.sessionId) {
          this.setStreamingState(true);
          this.updateStreamingMessage(msg.payload.chunk);
        }
        break;
      }

      case 'agent:auth_url': {
        this.showAuthModal(msg.payload.url);
        break;
      }

      case 'agent:auth_success': {
        alert('✅ Успішна авторизація в Cursor CLI!');
        if (this.authModalEl) this.authModalEl.remove();
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
        this.appendTerminalOutput(`\n[Process finished with code ${msg.payload.code}]\n\n`, false);
        break;
      }

      case 'fs:tree': {
        this.renderFilesTree(msg.payload.tree, msg.payload.rootPath);
        break;
      }

      case 'fs:file': {
        this.previewFilename.innerText = msg.payload.path;
        this.previewContent.innerHTML = `<code>${this.escapeHtml(msg.payload.content || msg.payload.error || '')}</code>`;
        break;
      }
    }
  }

  renderDevices() {
    this.deviceSelect.innerHTML = '';
    if (this.devices.length === 0) {
      this.deviceSelect.innerHTML = '<option value="">Немає підключених машин</option>';
      this.statusDot.className = 'status-dot offline';
      this.activeDeviceIndicator.innerText = 'Пристрій: Не підключено';
    } else {
      this.devices.forEach((dev) => {
        const opt = document.createElement('option');
        opt.value = dev.id;
        const isOnline = dev.status === 'online';
        opt.innerText = `${isOnline ? '🟢' : '🔴'} ${dev.name} (${dev.os || 'Local'})`;
        if (dev.id === this.activeDeviceId) {
          opt.selected = true;
        }
        this.deviceSelect.appendChild(opt);
      });

      const activeDev = this.getActiveDevice();
      const isOnline = activeDev && activeDev.status === 'online';
      this.statusDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
      this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev ? activeDev.name : 'Не обрано'}`;

      if (activeDev && activeDev.defaultWorkspace && !this.workspaceInput.value) {
        this.workspaceInput.value = activeDev.defaultWorkspace;
      }
    }

    // Render Full Devices Grid in settings
    this.devicesFullList.innerHTML = this.devices
      .map(
        (dev) => `
      <div class="device-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${dev.name}</strong>
          <span class="status-dot ${dev.status === 'online' ? 'online' : 'offline'}"></span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary);">
          <div>OS: ${dev.os || 'Unknown'}</div>
          <div>Hostname: ${dev.hostname || '-'}</div>
          <div>Cursor CLI: ${dev.cursorCliPath ? '✅ Виявлено' : '❌ Не знайдено'}</div>
          <div>Antigravity: ${dev.antigravityAvailable ? '✅ Доступно' : '❌ Не знайдено'}</div>
          ${dev.memoryUsage ? `<div>RAM: ${dev.memoryUsage.used}MB / ${dev.memoryUsage.total}MB</div>` : ''}
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
    this.sessionCount.innerText = this.sessions.length;
    if (this.sessions.length === 0) {
      this.sessionList.innerHTML = '<p class="meta-text" style="padding:10px;">Сесій ще немає</p>';
      return;
    }

    this.sessionList.innerHTML = '';
    this.sessions.forEach((s) => {
      const item = document.createElement('div');
      item.className = `session-item ${s.id === this.activeSessionId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="session-info">
          <div class="session-title">${this.escapeHtml(s.title || 'Чат Cursor')}</div>
          <div class="session-date">${new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${s.model || 'Claude'}</div>
        </div>
        <button class="session-delete-btn" title="Видалити">✕</button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('session-delete-btn')) {
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
    // Close sidebar on mobile
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
    }
  }

  async deleteSession(sessionId) {
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
      this.chatMeta.innerText = 'Оберіть сесію або створіть нову';
      this.chatMessages.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-icon">🤖</div>
          <h3>Створіть або оберіть сесію</h3>
          <p>Натисніть "+ Новий чат Cursor" у бічній панелі щоб почати.</p>
        </div>
      `;
      return;
    }

    this.currentChatTitle.innerText = session.title || 'Чат Cursor';
    this.chatMeta.innerText = `ID: ${session.id} | Модель: ${session.model} | Режим: ${session.mode}`;

    if (session.messages.length === 0) {
      this.chatMessages.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-icon">⚡</div>
          <h3>Готовий до роботи!</h3>
          <p>Напишіть запит, і агент запустить виконання на комп'ютері.</p>
        </div>
      `;
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

    el.innerHTML = `
      <div class="message-header">
        <span>${msg.role === 'user' ? 'Ви' : '🤖 Cursor Agent'}</span>
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

  triggerCursorAuth() {
    if (!this.activeDeviceId) {
      alert('Будь ласка, оберіть підключену машину');
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:trigger_auth',
          payload: { deviceId: this.activeDeviceId },
        })
      );
      this.showAuthModal(null);
    }
  }

  showAuthModal(url) {
    if (this.authModalEl) {
      this.authModalEl.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="login-card" style="max-width: 440px;">
        <div class="login-header">
          <div class="logo-icon">🔑</div>
          <h2>Авторизація Cursor CLI</h2>
          <p>${url ? 'Перейдіть за посиланням для входу у ваш акаунт Cursor:' : 'Отримання посилання авторизації...'}</p>
        </div>
        ${
          url
            ? `
          <div style="margin-bottom: 16px; text-align: center;">
            <a href="${url}" target="_blank" class="btn btn-primary btn-block" style="text-decoration: none; padding: 12px;">
              🔗 Відкрити сторінку входу Cursor
            </a>
          </div>
          <p style="font-size: 11px; color: var(--text-muted); text-align: center; margin-bottom: 16px;">
            Після підтвердження в браузері поверніться сюди.
          </p>
        `
            : '<div style="text-align:center; padding: 20px;"><span style="color:var(--text-secondary)">Генерація запиту...</span></div>'
        }
        <button id="close-auth-modal" class="btn btn-secondary btn-block">Закрити</button>
      </div>
    `;

    modal.querySelector('#close-auth-modal').addEventListener('click', () => {
      modal.remove();
    });

    document.body.appendChild(modal);
    this.authModalEl = modal;
  }

  resumeCurrentSession() {
    if (!this.activeSessionId) return;
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) return;

    const resumePrompt = 'Continue previous task.';
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

  // Files Tab
  loadFilesTree() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.filesTree.innerHTML = '<p class="placeholder-text">Завантаження файлів...</p>';
      this.ws.send(
        JSON.stringify({
          type: 'fs:tree',
          payload: { deviceId: this.activeDeviceId, path: this.workspaceInput.value },
        })
      );
    }
  }

  renderFilesTree(tree, rootPath) {
    if (!tree || tree.length === 0) {
      this.filesTree.innerHTML = '<p class="placeholder-text">Директорія порожня</p>';
      return;
    }

    this.filesTree.innerHTML = `<div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">${rootPath}</div>`;
    const container = document.createElement('div');

    const renderNode = (node, depth = 0) => {
      const el = document.createElement('div');
      el.className = 'tree-node';
      el.style.paddingLeft = `${depth * 12 + 6}px`;
      el.innerHTML = `
        <span>${node.isDirectory ? '📁' : '📄'}</span>
        <span>${this.escapeHtml(node.name)}</span>
      `;

      el.addEventListener('click', () => {
        if (!node.isDirectory) {
          this.openFile(node.path);
        }
      });

      container.appendChild(el);
      if (node.children) {
        node.children.forEach((c) => renderNode(c, depth + 1));
      }
    };

    tree.forEach((n) => renderNode(n));
    this.filesTree.appendChild(container);
  }

  openFile(filePath) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.previewFilename.innerText = `Завантаження ${filePath}...`;
      this.ws.send(
        JSON.stringify({
          type: 'fs:read',
          payload: { deviceId: this.activeDeviceId, path: filePath },
        })
      );
    }
  }

  // Terminal Tab
  execTerminalCommand() {
    const cmd = this.terminalInput.value.trim();
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
    span.style.color = isError ? '#f85149' : '#a9b7c6';
    span.innerText = text;
    this.terminalOutput.appendChild(span);
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
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

// Start application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AgentRemoteApp();
});
