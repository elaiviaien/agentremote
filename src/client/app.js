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
    this.themeToggleBtn = document.getElementById('theme-toggle-btn');
    this.themeIcon = document.getElementById('theme-icon');

    // Sidebar
    this.newChatBtn = document.getElementById('new-chat-btn');
    this.newAntigravityChatBtn = document.getElementById('new-antigravity-chat-btn');
    this.importChatBtn = document.getElementById('import-chat-btn');
    this.sessionSearch = document.getElementById('session-search');
    this.sessionList = document.getElementById('session-list');
    this.sessionCount = document.getElementById('session-count');
    this.modelSelect = document.getElementById('model-select');
    this.modeSelect = document.getElementById('mode-select');
    this.workspaceInput = document.getElementById('workspace-input');
    this.sidebarBackdrop = document.getElementById('sidebar-backdrop');

    // Import Modal Elements
    this.importModal = document.getElementById('import-modal');
    this.closeImportModalBtn = document.getElementById('close-import-modal-btn');
    this.cancelImportBtn = document.getElementById('cancel-import-btn');
    this.executeImportBtn = document.getElementById('execute-import-btn');
    this.importTabAuto = document.getElementById('import-tab-auto');
    this.importTabPaste = document.getElementById('import-tab-paste');
    this.importViewAuto = document.getElementById('import-view-auto');
    this.importViewPaste = document.getElementById('import-view-paste');
    this.localTranscriptsList = document.getElementById('local-transcripts-list');
    this.importPasteInput = document.getElementById('import-paste-input');
    this.importTargetEngine = document.getElementById('import-target-engine');
    this.importSessionTitle = document.getElementById('import-session-title');
    this.importSanitizationReport = document.getElementById('import-sanitization-report');
    this.selectedTranscriptFilePath = '';

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
    this.filesCountBadge = document.getElementById('files-count-badge');
    this.filePreviewPanel = document.getElementById('file-preview-panel');
    this.fsClosePreviewMobile = document.getElementById('fs-close-preview-mobile');
    this.previewFilename = document.getElementById('preview-filename');
    this.previewFileIcon = document.getElementById('preview-file-icon');
    this.previewFileSize = document.getElementById('preview-file-size');
    this.previewContent = document.getElementById('preview-content');
    this.previewCodeBlock = document.getElementById('preview-code-block');
    this.codeEditorContainer = document.getElementById('code-editor-container');
    this.lineNumbersGutter = document.getElementById('line-numbers-gutter');
    this.fileEmptyState = document.getElementById('file-empty-state');
    this.mdRenderedContainer = document.getElementById('md-rendered-container');
    this.imgPreviewContainer = document.getElementById('img-preview-container');
    this.imgPreviewEl = document.getElementById('img-preview-el');
    this.mdPreviewToggleBtn = document.getElementById('md-preview-toggle-btn');
    this.askAgentFileBtn = document.getElementById('ask-agent-file-btn');
    this.copyFileContentBtn = document.getElementById('copy-file-content-btn');
    this.isMdRenderedMode = false;
    this.currentFileRawContent = '';

    // Terminal
    this.terminalOutput = document.getElementById('terminal-output');
    this.terminalScreen = document.getElementById('terminal-screen');
    this.terminalForm = document.getElementById('terminal-form');
    this.terminalInput = document.getElementById('terminal-input');
    this.clearTermBtn = document.getElementById('clear-term-btn');
    this.copyTermBtn = document.getElementById('copy-term-btn');
    this.termDeviceTitle = document.getElementById('term-device-title');
    this.termPromptPath = document.getElementById('term-prompt-path');
    this.termHistory = [];
    this.termHistoryIndex = -1;

    // Limits Modal Elements
    this.openLimitsBtn = document.getElementById('open-limits-btn');
    this.limitsModal = document.getElementById('limits-modal');
    this.closeLimitsModalBtn = document.getElementById('close-limits-modal-btn');
    this.closeLimitsFooterBtn = document.getElementById('close-limits-footer-btn');
    this.cursorTierBadge = document.getElementById('cursor-tier-badge');
    this.cursorLimitEmail = document.getElementById('cursor-limit-email');
    this.cursorLimitModel = document.getElementById('cursor-limit-model');
    this.cursorLimitVer = document.getElementById('cursor-limit-ver');
    this.antigravityTierBadge = document.getElementById('antigravity-tier-badge');
    this.antigravityLimitStatus = document.getElementById('antigravity-limit-status');
    this.antigravityLimitConvs = document.getElementById('antigravity-limit-convs');
    this.antigravityLimitSize = document.getElementById('antigravity-limit-size');
    this.antigravity5hVal = document.getElementById('antigravity-5h-val');
    this.antigravity5hProgress = document.getElementById('antigravity-5h-progress');
    this.antigravity5hPercent = document.getElementById('antigravity-5h-percent');
    this.antigravity5hReset = document.getElementById('antigravity-5h-reset');
    this.antigravityWeeklyVal = document.getElementById('antigravity-weekly-val');
    this.antigravityWeeklyProgress = document.getElementById('antigravity-weekly-progress');
    this.antigravityWeeklyPercent = document.getElementById('antigravity-weekly-percent');
    this.antigravityWeeklyReset = document.getElementById('antigravity-weekly-reset');
    this.limitsMachineName = document.getElementById('limits-machine-name');
    this.limitsMachineRam = document.getElementById('limits-machine-ram');

    // New Chat Modal Elements
    this.newChatModal = document.getElementById('new-chat-modal');
    this.closeNewChatModalBtn = document.getElementById('close-new-chat-modal-btn');
    this.cancelNewChatBtn = document.getElementById('cancel-new-chat-btn');
    this.submitNewChatBtn = document.getElementById('submit-new-chat-btn');
    this.selectEngineCursor = document.getElementById('select-engine-cursor');
    this.selectEngineAntigravity = document.getElementById('select-engine-antigravity');
    this.modalWorkspaceInput = document.getElementById('modal-workspace-input');
    this.modalModelSelect = document.getElementById('modal-model-select');
    this.modalModeSelect = document.getElementById('modal-mode-select');
    this.modalSessionTitle = document.getElementById('modal-session-title');
    this.modalSessionDesc = document.getElementById('modal-session-desc');
    this.modalOpenImportBtn = document.getElementById('modal-open-import-btn');
    this.openImportHeaderBtn = document.getElementById('open-import-header-btn');
    this.currentSelectedEngine = 'cursor';
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

    // Sidebar Toggle (Mobile & Desktop)
    if (this.toggleSidebarBtn) {
      this.toggleSidebarBtn.addEventListener('click', () => {
        const isOpen = this.appSidebar.classList.toggle('open');
        if (this.sidebarBackdrop) {
          this.sidebarBackdrop.classList.toggle('show', isOpen);
        }
      });
    }

    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.addEventListener('click', () => {
        this.appSidebar.classList.remove('open');
        this.sidebarBackdrop.classList.remove('show');
      });
    }

    if (this.fsClosePreviewMobile) {
      this.fsClosePreviewMobile.addEventListener('click', () => {
        this.filesTree.classList.remove('hide-on-mobile');
        this.filePreviewPanel.classList.remove('show-on-mobile');
      });
    }

    // Device Switcher
    this.deviceSelect.addEventListener('change', (e) => {
      this.selectDevice(e.target.value);
    });

    // Import Chat Button
    if (this.importChatBtn) {
      this.importChatBtn.addEventListener('click', () => {
        this.openImportModal();
      });
    }

    if (this.closeImportModalBtn) {
      this.closeImportModalBtn.addEventListener('click', () => {
        this.importModal.style.display = 'none';
      });
    }

    if (this.cancelImportBtn) {
      this.cancelImportBtn.addEventListener('click', () => {
        this.importModal.style.display = 'none';
      });
    }

    if (this.importTabAuto) {
      this.importTabAuto.addEventListener('click', () => {
        this.importTabAuto.classList.add('active');
        this.importTabPaste.classList.remove('active');
        this.importViewAuto.style.display = 'block';
        this.importViewPaste.style.display = 'none';
      });
    }

    if (this.importTabPaste) {
      this.importTabPaste.addEventListener('click', () => {
        this.importTabPaste.classList.add('active');
        this.importTabAuto.classList.remove('active');
        this.importViewPaste.style.display = 'block';
        this.importViewAuto.style.display = 'none';
      });
    }

    if (this.executeImportBtn) {
      this.executeImportBtn.addEventListener('click', () => {
        this.executeImport();
      });
    }

    // Limits Modal
    if (this.openLimitsBtn) {
      this.openLimitsBtn.addEventListener('click', () => {
        this.openLimitsModal();
      });
    }

    if (this.closeLimitsModalBtn) {
      this.closeLimitsModalBtn.addEventListener('click', () => {
        this.limitsModal.style.display = 'none';
      });
    }

    if (this.closeLimitsFooterBtn) {
      this.closeLimitsFooterBtn.addEventListener('click', () => {
        this.limitsModal.style.display = 'none';
      });
    }

    // Theme Toggle
    this.initTheme();
    if (this.themeToggleBtn) {
      this.themeToggleBtn.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // New Chat Buttons -> Opens New Chat Modal
    if (this.newChatBtn) {
      this.newChatBtn.addEventListener('click', () => {
        this.openNewChatModal('cursor');
      });
    }

    if (this.newAntigravityChatBtn) {
      this.newAntigravityChatBtn.addEventListener('click', () => {
        this.openNewChatModal('antigravity');
      });
    }

    // New Chat Modal Controls
    if (this.closeNewChatModalBtn) {
      this.closeNewChatModalBtn.addEventListener('click', () => {
        this.newChatModal.style.display = 'none';
      });
    }

    if (this.cancelNewChatBtn) {
      this.cancelNewChatBtn.addEventListener('click', () => {
        this.newChatModal.style.display = 'none';
      });
    }

    if (this.submitNewChatBtn) {
      this.submitNewChatBtn.addEventListener('click', () => {
        this.submitNewChatModal();
      });
    }

    if (this.selectEngineCursor) {
      this.selectEngineCursor.addEventListener('click', () => {
        this.setModalEngine('cursor');
      });
    }

    if (this.selectEngineAntigravity) {
      this.selectEngineAntigravity.addEventListener('click', () => {
        this.setModalEngine('antigravity');
      });
    }

    if (this.modalOpenImportBtn) {
      this.modalOpenImportBtn.addEventListener('click', () => {
        this.newChatModal.style.display = 'none';
        this.openImportModal();
      });
    }

    // Import Chat Buttons
    if (this.openImportHeaderBtn) {
      this.openImportHeaderBtn.addEventListener('click', () => {
        this.openImportModal();
      });
    }

    if (this.importChatBtn) {
      this.importChatBtn.addEventListener('click', () => {
        this.openImportModal();
      });
    }

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

    if (this.copyFileContentBtn) {
      this.copyFileContentBtn.addEventListener('click', () => {
        const code = this.currentFileRawContent || (this.previewCodeBlock ? this.previewCodeBlock.innerText : '');
        navigator.clipboard.writeText(code);
        this.showToast('📋 Вміст файлу скопійовано в буфер обміну');
      });
    }

    if (this.askAgentFileBtn) {
      this.askAgentFileBtn.addEventListener('click', () => {
        const fileName = this.activeOpenedPath ? this.activeOpenedPath.split(/[/\\]/).pop() : 'файлу';
        this.switchTab('chat');
        this.promptInput.value = `Проаналізуй файл ${fileName} (${this.activeOpenedPath}):\n`;
        this.promptInput.focus();
      });
    }

    if (this.mdPreviewToggleBtn) {
      this.mdPreviewToggleBtn.addEventListener('click', () => {
        this.toggleMdPreview();
      });
    }

    // Terminal Quick Commands
    document.querySelectorAll('.term-quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        this.execTerminalCommand(cmd);
      });
    });

    if (this.clearTermBtn) {
      this.clearTermBtn.addEventListener('click', () => {
        this.terminalOutput.innerHTML = `
          <div class="term-welcome-msg">
            <div class="term-welcome-title">🚀 AgentRemote Cloud Terminal Console v1.0</div>
            <div class="term-welcome-sub">Консоль очищено • Готовий до нових команд</div>
          </div>
        `;
      });
    }

    if (this.copyTermBtn) {
      this.copyTermBtn.addEventListener('click', () => {
        const text = this.terminalOutput.innerText;
        navigator.clipboard.writeText(text);
        this.showToast('📋 Текст консолі скопійовано у буфер');
      });
    }

    if (this.terminalInput) {
      this.terminalInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.termHistory.length > 0) {
            if (this.termHistoryIndex > 0) {
              this.termHistoryIndex--;
            } else if (this.termHistoryIndex === -1) {
              this.termHistoryIndex = this.termHistory.length - 1;
            }
            this.terminalInput.value = this.termHistory[this.termHistoryIndex] || '';
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (this.termHistory.length > 0 && this.termHistoryIndex !== -1) {
            if (this.termHistoryIndex < this.termHistory.length - 1) {
              this.termHistoryIndex++;
              this.terminalInput.value = this.termHistory[this.termHistoryIndex] || '';
            } else {
              this.termHistoryIndex = -1;
              this.terminalInput.value = '';
            }
          }
        }
      });
    }

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
      if (this.filesTree && this.filePreviewPanel) {
        this.filesTree.classList.remove('hide-on-mobile');
        this.filePreviewPanel.classList.remove('show-on-mobile');
      }
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
        this.renderOpenedFileContent(filePath, msg.payload.content || msg.payload.error || '');
        break;
      }

      case 'transcripts:list_result': {
        this.renderLocalTranscripts(msg.payload.transcripts);
        break;
      }

      case 'transcripts:read_result': {
        const res = msg.payload.result;
        if (res) {
          this.selectedTranscriptContent = res.cleanSummaryContext || '';
          this.importSanitizationReport.style.display = 'block';
          this.importSanitizationReport.innerHTML = `
            <span>🛡️ <strong>Санітизація виконана:</strong> Виявлено <strong>${res.messages.length}</strong> повідомлень. Очищено <strong>${res.removedMetadataCount}</strong> системних тегів/трейсів, замасковано <strong>${res.redactedSecretsCount}</strong> секретів.</span>
          `;
        }
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

      // Check Cursor CLI auth status and conditionally hide login button
      const isCursorLoggedIn = Boolean(activeDev && activeDev.cursorAuthStatus && activeDev.cursorAuthStatus.loggedIn);
      if (isCursorLoggedIn) {
        this.loginCursorBtn.style.display = 'none';
        const emailLabel = activeDev.cursorAuthStatus.email ? ` • ${activeDev.cursorAuthStatus.email}` : ' • 🔑 Вхід виконано';
        this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev.name} (${isOnline ? 'ONLINE' : 'OFFLINE'})${emailLabel}`;
      } else {
        this.loginCursorBtn.style.display = 'inline-flex';
        this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev ? activeDev.name : 'Не обрано'} (${isOnline ? 'ONLINE' : 'OFFLINE'})`;
      }

      if (activeDev && activeDev.defaultWorkspace && !this.workspaceInput.value) {
        this.workspaceInput.value = activeDev.defaultWorkspace;
      }

      if (this.termDeviceTitle && activeDev) {
        this.termDeviceTitle.innerText = `PowerShell (${activeDev.name})`;
      }
      if (this.termPromptPath && this.workspaceInput && this.workspaceInput.value) {
        const wsName = this.workspaceInput.value.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
        this.termPromptPath.innerText = `~/${wsName}`;
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

  initTheme() {
    const savedTheme = localStorage.getItem('agentremote_theme') || 'light';
    this.applyTheme(savedTheme);
  }

  toggleTheme() {
    const current = document.body.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
  }

  applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('agentremote_theme', theme);
    if (this.themeIcon) {
      this.themeIcon.innerText = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  renderSessions() {
    const query = (this.sessionSearch.value || '').toLowerCase().trim();
    const filtered = this.sessions.filter(
      (s) => !query || (s.title && s.title.toLowerCase().includes(query)) || (s.description && s.description.toLowerCase().includes(query))
    );

    this.sessionCount.innerText = filtered.length;

    if (filtered.length === 0) {
      this.sessionList.innerHTML = '<p class="meta-text" style="padding:16px 6px; text-align:center;">Сесій не знайдено</p>';
      return;
    }

    this.sessionList.innerHTML = '';
    filtered.forEach((s) => {
      const item = document.createElement('div');
      item.className = `session-item ${s.id === this.activeSessionId ? 'active' : ''}`;
      
      const formattedDate = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isAntigravity = s.engine === 'antigravity' || (s.model && s.model.includes('gemini'));
      const engineTag = isAntigravity
        ? '<span class="session-engine-tag antigravity">🚀 AGY</span>'
        : '<span class="session-engine-tag cursor">🤖 CURSOR</span>';

      const descText = s.description || (s.workspacePath ? `📂 ${s.workspacePath.split(/[/\\]/).pop()}` : 'Робоча сесія');

      item.innerHTML = `
        <div class="session-info">
          <div class="session-header-line">
            ${engineTag}
            <div class="session-title">${this.escapeHtml(s.title || (isAntigravity ? 'Чат Antigravity' : 'Чат Cursor'))}</div>
          </div>
          <div class="session-desc">${this.escapeHtml(descText)}</div>
          <div class="session-date">${formattedDate} • ${s.model || (isAntigravity ? 'Gemini 2.5' : 'Claude')} • ${s.messages ? s.messages.length : 0} повід.</div>
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
    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.classList.remove('show');
    }
  }

  async createNewSession(engine = 'cursor') {
    const activeDev = this.getActiveDevice();
    const isAgy = engine === 'antigravity';
    const defaultModel = isAgy ? 'gemini-3.1-pro' : this.modelSelect.value;
    const defaultTitle = isAgy ? 'Новий чат Antigravity' : 'Новий чат Cursor';
    const defaultDesc = isAgy ? 'Сесія Google Antigravity (Gemini)' : 'Сесія Cursor AI Agent';

    const newSession = {
      deviceId: activeDev ? activeDev.id : 'default',
      title: defaultTitle,
      description: defaultDesc,
      engine: engine,
      model: defaultModel,
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
    
    if (this.filesCountBadge) {
      const count = items.length;
      let word = 'файлів';
      if (count % 10 === 1 && count % 100 !== 11) word = 'файл';
      else if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) word = 'файли';
      this.filesCountBadge.innerText = `${count} ${word}`;
    }

    // Sort: directories first, then files
    const sorted = [...items].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const list = document.createElement('div');

    sorted.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'tree-node';
      const icon = item.isDirectory ? '📁' : this.getFileIcon(item.name);
      const sizeText = item.size ? this.formatFileSize(item.size) : '';

      el.innerHTML = `
        <div class="node-left">
          <span style="font-size: 14px;">${icon}</span>
          <span style="font-weight: ${item.isDirectory ? '600' : '400'};">${this.escapeHtml(item.name)}</span>
        </div>
        ${sizeText ? `<span class="node-size">${sizeText}</span>` : ''}
      `;

      el.addEventListener('click', () => {
        this.filesTree.querySelectorAll('.tree-node').forEach((n) => n.classList.remove('active'));
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
      case 'mjs':
      case 'cjs':
        return '🟨';
      case 'json':
        return '⚙️';
      case 'html':
      case 'htm':
        return '🌐';
      case 'css':
      case 'scss':
      case 'less':
        return '🎨';
      case 'py':
        return '🐍';
      case 'md':
      case 'markdown':
        return '📝';
      case 'sh':
      case 'ps1':
      case 'cmd':
      case 'bat':
        return '⚡';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'webp':
      case 'ico':
        return '🖼️';
      case 'env':
      case 'gitignore':
      case 'dockerignore':
      case 'yml':
      case 'yaml':
      case 'toml':
        return '🔧';
      default:
        return '📄';
    }
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  openFile(filePath) {
    this.activeOpenedPath = filePath;
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    this.previewFilename.innerText = fileName;
    this.previewFileIcon.innerText = this.getFileIcon(fileName);
    this.previewFileSize.innerText = 'Завантаження...';

    if (this.fileEmptyState) this.fileEmptyState.style.display = 'none';
    if (this.codeEditorContainer) this.codeEditorContainer.style.display = 'flex';
    if (this.mdRenderedContainer) this.mdRenderedContainer.style.display = 'none';
    if (this.imgPreviewContainer) this.imgPreviewContainer.style.display = 'none';

    this.lineNumbersGutter.innerHTML = '1';
    this.previewCodeBlock.innerText = '// Завантаження вмісту файлу...';

    if (this.filesTreePanel && this.filePreviewPanel) {
      this.filesTreePanel.classList.add('hide-on-mobile');
      this.filePreviewPanel.classList.add('show-on-mobile');
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'fs:read',
          payload: { deviceId: this.activeDeviceId, path: filePath },
        })
      );
    }
  }

  renderOpenedFileContent(filePath, content) {
    this.currentFileRawContent = content;
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const ext = fileName.split('.').pop().toLowerCase();

    this.previewFilename.innerText = fileName;
    this.previewFileIcon.innerText = this.getFileIcon(fileName);

    if (this.fileEmptyState) this.fileEmptyState.style.display = 'none';
    if (this.copyFileContentBtn) this.copyFileContentBtn.style.display = 'inline-flex';
    if (this.askAgentFileBtn) this.askAgentFileBtn.style.display = 'inline-flex';

    // 1. Check if Image
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);
    if (isImage) {
      if (this.codeEditorContainer) this.codeEditorContainer.style.display = 'none';
      if (this.mdRenderedContainer) this.mdRenderedContainer.style.display = 'none';
      if (this.mdPreviewToggleBtn) this.mdPreviewToggleBtn.style.display = 'none';
      if (this.imgPreviewContainer) {
        this.imgPreviewContainer.style.display = 'flex';
        this.imgPreviewEl.src = ext === 'svg' ? `data:image/svg+xml;utf8,${encodeURIComponent(content)}` : `data:image/${ext};base64,${content}`;
      }
      this.previewFileSize.innerText = `Зображення (${ext.toUpperCase()})`;
      return;
    }

    // 2. Setup Code Editor / Line Numbers
    if (this.imgPreviewContainer) this.imgPreviewContainer.style.display = 'none';
    const lines = content.split('\n');
    const lineCount = lines.length;
    const fileSize = new Blob([content]).size;
    this.previewFileSize.innerText = `${lineCount} ${lineCount === 1 ? 'рядок' : 'рядків'} • ${this.formatFileSize(fileSize)}`;

    // Build line numbers gutter
    let numbersText = '';
    for (let i = 1; i <= lineCount; i++) {
      numbersText += i + '\n';
    }
    this.lineNumbersGutter.innerText = numbersText;

    // Highlight code
    this.previewCodeBlock.innerText = content;
    this.previewCodeBlock.className = `language-${ext}`;
    if (typeof hljs !== 'undefined') {
      try {
        hljs.highlightElement(this.previewCodeBlock);
      } catch {}
    }

    // 3. Markdown Support
    const isMd = ['md', 'markdown'].includes(ext);
    if (isMd) {
      if (this.mdPreviewToggleBtn) {
        this.mdPreviewToggleBtn.style.display = 'inline-flex';
        this.isMdRenderedMode = true;
        this.mdPreviewToggleBtn.innerHTML = '<span>💻 Код</span>';
      }
      if (this.mdRenderedContainer) {
        if (typeof marked !== 'undefined') {
          this.mdRenderedContainer.innerHTML = marked.parse(content);
        } else {
          this.mdRenderedContainer.innerText = content;
        }
        this.mdRenderedContainer.style.display = 'block';
        if (this.codeEditorContainer) this.codeEditorContainer.style.display = 'none';
      }
    } else {
      if (this.mdPreviewToggleBtn) this.mdPreviewToggleBtn.style.display = 'none';
      if (this.mdRenderedContainer) this.mdRenderedContainer.style.display = 'none';
      if (this.codeEditorContainer) this.codeEditorContainer.style.display = 'flex';
      this.isMdRenderedMode = false;
    }
  }

  toggleMdPreview() {
    this.isMdRenderedMode = !this.isMdRenderedMode;
    if (this.isMdRenderedMode) {
      if (this.codeEditorContainer) this.codeEditorContainer.style.display = 'none';
      if (this.mdRenderedContainer) this.mdRenderedContainer.style.display = 'block';
      if (this.mdPreviewToggleBtn) this.mdPreviewToggleBtn.innerHTML = '<span>💻 Код</span>';
    } else {
      if (this.codeEditorContainer) this.codeEditorContainer.style.display = 'flex';
      if (this.mdRenderedContainer) this.mdRenderedContainer.style.display = 'none';
      if (this.mdPreviewToggleBtn) this.mdPreviewToggleBtn.innerHTML = '<span>👁️ Форматований вигляд</span>';
    }
  }

  // ================= TERMINAL LOGIC =================
  execTerminalCommand(cmdText) {
    const cmd = (cmdText || '').trim();
    if (!cmd) return;

    // Record to history
    if (!this.termHistory.length || this.termHistory[this.termHistory.length - 1] !== cmd) {
      this.termHistory.push(cmd);
    }
    this.termHistoryIndex = -1;

    this.activeCommandId = Math.random().toString(36).substring(2, 8);

    // Append visually styled command line
    const cmdEl = document.createElement('div');
    cmdEl.className = 'term-cmd-line';
    cmdEl.innerHTML = `<span class="term-prompt-icon">❯</span> <span>${this.escapeHtml(cmd)}</span>`;
    this.terminalOutput.appendChild(cmdEl);

    this.terminalInput.value = '';
    if (this.terminalScreen) {
      this.terminalScreen.scrollTop = this.terminalScreen.scrollHeight;
    }

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
    if (!text) return;
    
    if (isError) {
      const errEl = document.createElement('div');
      errEl.className = 'term-out-error';
      errEl.innerText = text;
      this.terminalOutput.appendChild(errEl);
    } else {
      const span = document.createElement('span');
      span.className = 'term-out-text';
      span.innerText = text;
      this.terminalOutput.appendChild(span);
    }

    if (this.terminalScreen) {
      this.terminalScreen.scrollTop = this.terminalScreen.scrollHeight;
    } else if (this.terminalOutput) {
      this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
    }
  }

  // ================= CHAT IMPORT LOGIC =================
  // ================= NEW CHAT MODAL LOGIC =================
  openNewChatModal(preferredEngine = 'cursor') {
    const dev = this.getActiveDevice();
    this.currentSelectedEngine = preferredEngine;
    this.setModalEngine(preferredEngine);

    const defaultWs = (dev && dev.defaultWorkspace) || this.workspaceInput.value || '';
    if (this.modalWorkspaceInput) {
      this.modalWorkspaceInput.value = defaultWs;
    }

    if (this.modalSessionTitle) {
      this.modalSessionTitle.value = '';
    }
    if (this.modalSessionDesc) {
      this.modalSessionDesc.value = '';
    }

    this.newChatModal.style.display = 'flex';
  }

  setModalEngine(engine) {
    this.currentSelectedEngine = engine;
    const isAgy = engine === 'antigravity';

    if (this.selectEngineCursor && this.selectEngineAntigravity) {
      if (isAgy) {
        this.selectEngineAntigravity.style.borderColor = 'var(--accent-primary)';
        this.selectEngineAntigravity.style.background = 'var(--bg-card-hover)';
        this.selectEngineCursor.style.borderColor = 'var(--border-subtle)';
        this.selectEngineCursor.style.background = 'var(--bg-card)';
      } else {
        this.selectEngineCursor.style.borderColor = 'var(--accent-primary)';
        this.selectEngineCursor.style.background = 'var(--bg-card-hover)';
        this.selectEngineAntigravity.style.borderColor = 'var(--border-subtle)';
        this.selectEngineAntigravity.style.background = 'var(--bg-card)';
      }
    }

    // Adjust default models
    if (this.modalModelSelect) {
      if (isAgy) {
        this.modalModelSelect.value = 'gemini-3.1-pro';
      } else {
        this.modalModelSelect.value = 'claude-4.5-sonnet';
      }
    }
  }

  async submitNewChatModal() {
    const activeDev = this.getActiveDevice();
    const isAgy = this.currentSelectedEngine === 'antigravity';
    const workspace = (this.modalWorkspaceInput && this.modalWorkspaceInput.value.trim()) || (activeDev && activeDev.defaultWorkspace) || '';
    const title = (this.modalSessionTitle && this.modalSessionTitle.value.trim()) || (isAgy ? 'Новий чат Antigravity' : 'Новий чат Cursor');
    const desc = (this.modalSessionDesc && this.modalSessionDesc.value.trim()) || (isAgy ? 'Сесія Google Antigravity (Gemini)' : 'Сесія Cursor AI Agent');
    const model = (this.modalModelSelect && this.modalModelSelect.value) || (isAgy ? 'gemini-3.1-pro' : 'claude-4.5-sonnet');
    const mode = (this.modalModeSelect && this.modalModeSelect.value) || 'yolo';

    const newSession = {
      deviceId: activeDev ? activeDev.id : 'default',
      title,
      description: desc,
      engine: this.currentSelectedEngine,
      model,
      mode,
      workspacePath: workspace,
    };

    this.submitNewChatBtn.disabled = true;
    this.submitNewChatBtn.innerHTML = '⏳ Створення...';

    try {
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
        this.renderSessions();
        this.selectSession(data.session.id);
        this.newChatModal.style.display = 'none';
        this.promptInput.focus();
        this.showToast(`✨ Створено новий чат: ${data.session.title}`);
      } else {
        alert('Не вдалося створити чат');
      }
    } catch {
      alert('Помилка з\'єднання при створенні чату');
    } finally {
      this.submitNewChatBtn.disabled = false;
      this.submitNewChatBtn.innerHTML = '<span>🚀 Створити чат</span>';
    }
  }

  // ================= IMPORT CHAT LOGIC =================
  openImportModal() {
    this.importModal.style.display = 'flex';
    this.selectedTranscriptFilePath = '';
    this.selectedTranscriptContent = '';
    this.importSanitizationReport.style.display = 'none';
    this.loadLocalTranscripts();
  }

  loadLocalTranscripts() {
    this.localTranscriptsList.innerHTML = '<p class="placeholder-text" style="padding:14px; text-align:center;">Сканування локальних сесій...</p>';
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.pendingTranscriptReqId = Math.random().toString(36).substring(2, 8);
      this.ws.send(
        JSON.stringify({
          type: 'transcripts:list_local',
          payload: { reqId: this.pendingTranscriptReqId, deviceId: this.activeDeviceId },
        })
      );
    }
  }

  renderLocalTranscripts(transcripts) {
    if (!transcripts || transcripts.length === 0) {
      this.localTranscriptsList.innerHTML = `
        <div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">
          Не виявлено локальних сесій на цій машині.<br>
          Перевірте, чи запущено локальний Worker Daemon.
        </div>
      `;
      return;
    }

    this.localTranscriptsList.innerHTML = '';
    transcripts.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.style.border = '1px solid var(--border-subtle)';
      item.style.padding = '10px 14px';
      item.style.marginBottom = '4px';
      item.style.borderRadius = '9px';
      
      const formattedDate = new Date(t.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      
      let badge = '<span class="session-engine-tag antigravity">🚀 AGY</span>';
      if (t.source === 'claude_code') {
        badge = '<span class="session-engine-tag" style="background:rgba(168, 85, 247, 0.15); color:#a855f7; border: 1px solid rgba(168, 85, 247, 0.3);">🟣 CLAUDE CODE</span>';
      } else if (t.source === 'cursor') {
        badge = '<span class="session-engine-tag cursor">🤖 CURSOR</span>';
      }

      const wsDisplay = t.workspacePath ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📂 ${this.escapeHtml(t.workspacePath)}</div>` : '';

      item.innerHTML = `
        <div class="session-info">
          <div class="session-header-line">
            ${badge}
            <strong class="session-title" style="font-size:13px;">${this.escapeHtml(t.title)}</strong>
          </div>
          ${wsDisplay}
          <div class="session-date" style="margin-top:3px;">${formattedDate} • ${t.messageCount} повідомлень</div>
        </div>
      `;

      item.addEventListener('click', () => {
        this.localTranscriptsList.querySelectorAll('.session-item').forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
        this.selectedTranscriptFilePath = t.filePath;
        this.selectedTranscriptWorkspace = t.workspacePath || '';
        this.importSessionTitle.value = t.title.slice(0, 45);

        // Request content & preview
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'transcripts:read_local',
              payload: { reqId: Math.random().toString(36).substring(2, 8), filePath: t.filePath, deviceId: this.activeDeviceId },
            })
          );
        }
      });

      this.localTranscriptsList.appendChild(item);
    });
  }

  async executeImport() {
    let rawContent = this.selectedTranscriptContent || '';
    const isPaste = this.importTabPaste.classList.contains('active');

    if (isPaste) {
      rawContent = this.importPasteInput.value.trim();
    }

    if (!rawContent && !this.selectedTranscriptFilePath) {
      alert('Будь ласка, оберіть розмову зі списку або вставте текст діалогу.');
      return;
    }

    this.executeImportBtn.disabled = true;
    this.executeImportBtn.innerHTML = '⏳ Очищення та імпорт...';

    const targetEngine = this.importTargetEngine ? this.importTargetEngine.value : 'cursor';
    const workspace = this.selectedTranscriptWorkspace || this.workspaceInput.value || '';

    try {
      const res = await fetch('/api/sessions/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          rawContent,
          title: this.importSessionTitle.value.trim(),
          deviceId: this.activeDeviceId,
          engine: targetEngine,
          model: targetEngine === 'antigravity' ? 'gemini-3.1-pro' : this.modelSelect.value,
          mode: this.modeSelect.value,
          workspacePath: workspace,
        }),
      });

      const data = await res.json();
      if (res.ok && data.session) {
        this.sessions.unshift(data.session);
        this.renderSessions();
        this.selectSession(data.session.id);
        this.importModal.style.display = 'none';

        const rep = data.report;
        this.showToast(`🛡️ Чат (${data.session.title}) успішно імпортовано в ${targetEngine.toUpperCase()}! Очищено ${rep.removedMetadataCount} тегів.`);
      } else {
        alert(data.error || 'Помилка імпорту чату');
      }
    } catch {
      alert('Помилка з\'єднання з сервером під час імпорту');
    } finally {
      this.executeImportBtn.disabled = false;
      this.executeImportBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Імпортувати та створити чат</span>
      `;
    }
  }

  // ================= LIMITS & SUBSCRIPTIONS LOGIC =================
  openLimitsModal() {
    const dev = this.getActiveDevice();
    this.limitsModal.style.display = 'flex';

    if (!dev) {
      this.cursorLimitEmail.innerText = 'Немає підключеної машини';
      this.limitsMachineName.innerText = '-';
      this.limitsMachineRam.innerText = '-';
      return;
    }

    const limits = dev.limitsInfo;
    this.limitsMachineName.innerText = `${dev.name} (${dev.os || 'Windows'})`;
    this.limitsMachineRam.innerText = dev.memoryUsage ? `${dev.memoryUsage.used} MB / ${dev.memoryUsage.total} MB` : 'Доступно';

    if (limits && limits.cursor) {
      this.cursorTierBadge.innerText = (limits.cursor.tier || 'PRO').toUpperCase() + ' TIER';
      this.cursorLimitEmail.innerText = limits.cursor.email || (dev.cursorAuthStatus && dev.cursorAuthStatus.email) || 'Авторизовано';
      this.cursorLimitModel.innerText = limits.cursor.defaultModel || 'Claude 4.5 Sonnet';
      this.cursorLimitVer.innerText = limits.cursor.version || '2026.08.11';
    } else if (dev.cursorAuthStatus && dev.cursorAuthStatus.email) {
      this.cursorLimitEmail.innerText = dev.cursorAuthStatus.email;
      this.cursorTierBadge.innerText = 'PRO TIER';
    } else {
      this.cursorLimitEmail.innerText = 'Потрібен вхід (agent login)';
    }

    if (limits && limits.antigravity) {
      const agy = limits.antigravity;
      this.antigravityLimitStatus.innerText = agy.available ? '✓ Доступно на машині' : 'Не виявлено';
      this.antigravityLimitConvs.innerText = `${agy.brainConversationsCount} діалогів`;
      this.antigravityLimitSize.innerText = `${agy.brainStorageSizeMb} MB`;
      if (this.antigravityTierBadge) this.antigravityTierBadge.innerText = (agy.tier || 'PRO QUOTA').toUpperCase();

      if (agy.fiveHourLimit && this.antigravity5hVal) {
        const fh = agy.fiveHourLimit;
        this.antigravity5hVal.innerText = `${fh.remaining} / ${fh.total} запитів`;
        if (this.antigravity5hProgress) this.antigravity5hProgress.style.width = `${fh.percentRemaining}%`;
        if (this.antigravity5hPercent) this.antigravity5hPercent.innerText = `${fh.percentRemaining}%`;
        if (this.antigravity5hReset) this.antigravity5hReset.innerText = `Скидання через ${fh.resetsIn}`;
      }

      if (agy.weeklyLimit && this.antigravityWeeklyVal) {
        const wk = agy.weeklyLimit;
        this.antigravityWeeklyVal.innerText = `${wk.remaining} / ${wk.total} запитів`;
        if (this.antigravityWeeklyProgress) this.antigravityWeeklyProgress.style.width = `${wk.percentRemaining}%`;
        if (this.antigravityWeeklyPercent) this.antigravityWeeklyPercent.innerText = `${wk.percentRemaining}%`;
        if (this.antigravityWeeklyReset) this.antigravityWeeklyReset.innerText = wk.resetsIn;
      }
    } else {
      this.antigravityLimitStatus.innerText = dev.antigravityAvailable ? '✓ Доступно на машині' : 'Не виявлено';
      this.antigravityLimitConvs.innerText = 'Доступно';
      this.antigravityLimitSize.innerText = '-';
    }
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
