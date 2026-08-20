// AgentRemote Web IDE Client Logic
function applyStreamText(previous, payload) {
  const prev = previous || '';
  if (typeof payload.delta === 'string') {
    if (payload.delta.length > 0) return prev + payload.delta;
    if (typeof payload.chunk === 'string' && payload.chunk.length > 0) return payload.chunk;
    return prev;
  }
  const chunk = payload.chunk || '';
  if (!chunk) return prev;
  if (chunk.startsWith(prev)) return chunk;
  return prev + chunk;
}

class AgentRemoteApp {
  constructor() {
    this.token = localStorage.getItem('agentremote_token') || sessionStorage.getItem('agentremote_token') || '';
    this.ws = null;
    this.devices = [];
    this.activeDeviceId = null;
    this.sessions = [];
    this.activeSessionId = null;
    this.isStreaming = false;
    this.lastAgentActivityAt = 0;
    this.agentStallTimer = null;
    this.AGENT_STALL_TIMEOUT_MS = 45000;
    this.currentToolCallElements = new Map();
    this.loadedTranscripts = [];
    this.thinkingMode = 'auto'; // 'auto' | 'on' | 'off'

    // Terminal History, Path & CWD tracking
    this.termHistory = [];
    this.termHistoryIndex = -1;
    this.termCurrentPath = '';   // resolved CWD on remote machine
    this.termDisplayPath = '~';  // display version

    // File Preview State
    this.activeOpenedPath = '';
    this.activeOpenedContent = '';
    this.isMarkdownMode = false;

    // Recent workspace folders (max 8)
    this.recentFolders = JSON.parse(localStorage.getItem('agentremote_recent_folders') || '[]');

    this.initElements();
    this.initEvents();
    this.initCustomSelects();
    this.initTheme();
    this.initFilesResizer();
    this.initVoiceMode();
    this.checkAuth();
  }

  initVoiceMode() {
    if (typeof window.VoiceModeController !== 'function') return;
    this.voiceMode = new window.VoiceModeController(this);
    this.voiceMode.init();
  }

  initElements() {
    // Auth & App wrappers
    this.loginModal = document.getElementById('login-modal');
    this.loginForm = document.getElementById('login-form');
    this.loginUsername = document.getElementById('login-username');
    this.loginPassword = document.getElementById('login-password');
    this.loginError = document.getElementById('login-error');
    this.loginBtn = document.getElementById('login-btn');
    this.appContainer = document.getElementById('app');

    // Header elements
    this.deviceSelect = document.getElementById('device-select');
    this.deviceStatusDot = document.getElementById('device-status-dot');
    this.activeDeviceIndicator = document.getElementById('active-device-indicator');
    this.themeToggleBtn = document.getElementById('theme-toggle-btn');
    this.themeIcon = document.getElementById('theme-icon');
    this.logoutBtn = document.getElementById('logout-btn');
    this.toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    this.appSidebar = document.getElementById('app-sidebar');
    this.sidebarBackdrop = document.getElementById('sidebar-backdrop');
    this.navTabs = document.querySelectorAll('.nav-pill[data-tab]');
    this.tabContents = document.querySelectorAll('.tab-content');

    // Sidebar elements
    this.newChatBtn = document.getElementById('new-chat-btn');
    this.newAntigravityChatBtn = document.getElementById('new-antigravity-chat-btn');
    this.importChatBtn = document.getElementById('import-chat-btn');
    this.sessionSearch = document.getElementById('session-search');
    this.sessionList = document.getElementById('session-list');
    this.sessionCount = document.getElementById('session-count');
    this.modelSelect = document.getElementById('model-select');
    this.chatModelSelect = document.getElementById('chat-model-select');
    this.modeSelect = document.getElementById('mode-select');
    this.workspaceInput = document.getElementById('workspace-input');
    this.workspaceSetBtn = document.getElementById('workspace-set-btn');
    this.workspaceBrowseBtn = document.getElementById('workspace-browse-btn');
    this.recentFoldersDropdown = document.getElementById('recent-folders-dropdown');
    this.recentFoldersList = document.getElementById('recent-folders-list');
    this.clearRecentFoldersBtn = document.getElementById('clear-recent-folders-btn');

    // Header Brand
    this.brandLogoBtn = document.getElementById('brand-logo-btn');

    // Chat Tab elements
    this.currentChatTitle = document.getElementById('current-chat-title');
    this.sessionBadge = document.getElementById('session-badge');
    this.chatMeta = document.getElementById('chat-meta');
    this.syncIdeChatBtn = document.getElementById('sync-ide-chat-btn');
    this.chatMessages = document.getElementById('chat-messages');
    this.promptInput = document.getElementById('prompt-input');
    this.sendBtn = document.getElementById('send-btn');
    this.stopAgentBtn = document.getElementById('stop-agent-btn');
    this.loginCursorBtn = document.getElementById('login-cursor-btn');
    this.thinkingEffortSelect = document.getElementById('thinking-effort-select');
    this.thinkingEffortWrapper = document.getElementById('thinking-effort-wrapper');
    this.chatQueueContainer = document.getElementById('chat-queue-container');
    this.queueCount = document.getElementById('queue-count');
    this.queueItemsList = document.getElementById('queue-items-list');
    this.clearQueueBtn = document.getElementById('clear-queue-btn');
    this.sendShortcutHint = document.getElementById('send-shortcut-hint');

    // Files Tab elements
    this.filesTreePanel = document.getElementById('files-tree-panel');
    this.filesResizer = document.getElementById('files-resizer');
    this.filePreviewPanel = document.getElementById('file-preview-panel');
    this.filesTree = document.getElementById('files-tree');
    this.fsBreadcrumbs = document.getElementById('fs-breadcrumbs');
    this.fsSearchInput = document.getElementById('fs-search-input');
    this.refreshFilesBtn = document.getElementById('refresh-files-btn');
    this.fsBackBtn = document.getElementById('fs-back-btn');
    this.fsUpBtn = document.getElementById('fs-up-btn');
    this.filesCountBadge = document.getElementById('files-count-badge');
    this.previewFilename = document.getElementById('preview-filename');
    this.previewFileSize = document.getElementById('preview-file-size');
    this.previewFileIcon = document.getElementById('preview-file-icon');
    this.fileEmptyState = document.getElementById('file-empty-state');
    this.codeEditorContainer = document.getElementById('code-editor-container');
    this.lineNumbersGutter = document.getElementById('line-numbers-gutter');
    this.previewCodeBlock = document.getElementById('preview-code-block');
    this.mdRenderedContainer = document.getElementById('md-rendered-container');
    this.imgPreviewContainer = document.getElementById('img-preview-container');
    this.imgPreviewEl = document.getElementById('img-preview-el');
    this.mdPreviewToggleBtn = document.getElementById('md-preview-toggle-btn');
    this.copyFileContentBtn = document.getElementById('copy-file-content-btn');
    this.askAgentFileBtn = document.getElementById('ask-agent-file-btn');
    this.fsClosePreviewMobile = document.getElementById('fs-close-preview-mobile');

    // Terminal Tab elements
    this.terminalOutput = document.getElementById('terminal-output');
    this.terminalScreen = document.getElementById('terminal-screen');
    this.terminalForm = document.getElementById('terminal-form');
    this.terminalInput = document.getElementById('terminal-input');
    this.termPromptPath = document.getElementById('term-prompt-path');
    this.termDeviceTitle = document.getElementById('term-device-title');
    this.copyTermBtn = document.getElementById('copy-term-btn');
    this.clearTermBtn = document.getElementById('clear-term-btn');

    // Devices & Settings Tab elements
    this.devicesFullList = document.getElementById('devices-full-list');
    this.copyCmdBtn = document.getElementById('copy-cmd-btn');
    this.daemonCommandText = document.getElementById('daemon-command-text');

    // New Chat Modal Elements
    this.newChatModal = document.getElementById('new-chat-modal');
    this.closeNewChatModalBtn = document.getElementById('close-new-chat-modal-btn');
    this.cancelNewChatBtn = document.getElementById('cancel-new-chat-btn');
    this.submitNewChatBtn = document.getElementById('submit-new-chat-btn');
    this.selectEngineCursor = document.getElementById('select-engine-cursor');
    this.selectEngineAntigravity = document.getElementById('select-engine-antigravity');
    this.modalDeviceSelect = document.getElementById('modal-device-select');
    this.modalDeviceStatusBadge = document.getElementById('modal-device-status-badge');
    this.modalWorkspaceInput = document.getElementById('modal-workspace-input');
    this.modalModelSelect = document.getElementById('modal-model-select');
    this.modalModeSelect = document.getElementById('modal-mode-select');
    this.modalSessionTitle = document.getElementById('modal-session-title');
    this.modalSessionDesc = document.getElementById('modal-session-desc');
    this.modalOpenImportBtn = document.getElementById('modal-open-import-btn');
    this.currentSelectedEngine = 'cursor';

    // Import Modal Elements
    this.importModal = document.getElementById('import-modal');
    this.closeImportModalBtn = document.getElementById('close-import-modal-btn');
    this.cancelImportBtn = document.getElementById('cancel-import-btn');
    this.executeImportBtn = document.getElementById('execute-import-btn');
    this.importTabAuto = document.getElementById('import-tab-auto');
    this.importTabPaste = document.getElementById('import-tab-paste');
    this.importViewAuto = document.getElementById('import-view-auto');
    this.importViewPaste = document.getElementById('import-view-paste');
    this.importSearchInput = document.getElementById('import-search-input');
    this.transcriptsCountBadge = document.getElementById('transcripts-count-badge');
    this.localTranscriptsList = document.getElementById('local-transcripts-list');
    this.importPasteInput = document.getElementById('import-paste-input');
    this.importTargetEngine = document.getElementById('import-target-engine');
    this.importSessionTitle = document.getElementById('import-session-title');
    this.importSanitizationReport = document.getElementById('import-sanitization-report');
  }

  initEvents() {
    this.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.login(this.loginUsername.value, this.loginPassword.value);
    });

    this.logoutBtn.addEventListener('click', () => this.logout());

    if (this.brandLogoBtn) {
      this.brandLogoBtn.addEventListener('click', () => {
        this.switchTab('chat');
        if (this.promptInput) this.promptInput.focus();
      });
    }

    this.navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      });
    });

    if (this.toggleSidebarBtn) {
      this.toggleSidebarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
          const isOpen = this.appSidebar.classList.toggle('open');
          if (this.sidebarBackdrop) {
            this.sidebarBackdrop.classList.toggle('show', isOpen);
          }
        } else {
          this.appSidebar.classList.toggle('collapsed');
        }
      });
    }

    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    if (closeSidebarBtn) {
      closeSidebarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMobileSidebar();
      });
    }

    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.addEventListener('click', () => {
        this.closeMobileSidebar();
      });
    }

    if (this.fsClosePreviewMobile) {
      this.fsClosePreviewMobile.addEventListener('click', () => {
        this.filesTreePanel.classList.remove('hide-on-mobile');
        this.filePreviewPanel.classList.remove('show-on-mobile');
      });
    }

    this.deviceSelect.addEventListener('change', (e) => {
      this.selectDevice(e.target.value);
    });

    if (this.modalDeviceSelect) {
      this.modalDeviceSelect.addEventListener('change', (e) => {
        const dev = this.devices.find((d) => d.id === e.target.value);
        if (dev) {
          if (this.modalWorkspaceInput && dev.defaultWorkspace) {
            this.modalWorkspaceInput.value = dev.defaultWorkspace;
          }
          if (this.modalDeviceStatusBadge) {
            const isOnline = dev.status === 'online';
            this.modalDeviceStatusBadge.innerText = isOnline ? '● Онлайн' : '○ Офлайн';
            this.modalDeviceStatusBadge.style.color = isOnline ? 'var(--success)' : 'var(--text-muted)';
          }
        }
      });
    }

    if (this.importChatBtn) {
      this.importChatBtn.addEventListener('click', () => this.openImportModal());
    }
    if (this.modalOpenImportBtn) {
      this.modalOpenImportBtn.addEventListener('click', () => {
        this.newChatModal.style.display = 'none';
        this.openImportModal();
      });
    }

    if (this.closeImportModalBtn) {
      this.closeImportModalBtn.addEventListener('click', () => (this.importModal.style.display = 'none'));
    }
    if (this.cancelImportBtn) {
      this.cancelImportBtn.addEventListener('click', () => (this.importModal.style.display = 'none'));
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
    if (this.importSearchInput) {
      this.importSearchInput.addEventListener('input', () => {
        this.filterTranscriptsList();
      });
    }
    if (this.executeImportBtn) {
      this.executeImportBtn.addEventListener('click', () => this.executeImport());
    }

    // Workspace folder management
    if (this.workspaceSetBtn) {
      this.workspaceSetBtn.addEventListener('click', () => {
        const val = this.workspaceInput.value.trim();
        if (val) this.applyWorkspace(val);
      });
    }
    this.workspaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = this.workspaceInput.value.trim();
        if (val) this.applyWorkspace(val);
      }
    });
    if (this.workspaceBrowseBtn) {
      this.workspaceBrowseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleRecentFolders();
      });
    }
    if (this.clearRecentFoldersBtn) {
      this.clearRecentFoldersBtn.addEventListener('click', () => {
        this.recentFolders = [];
        localStorage.setItem('agentremote_recent_folders', '[]');
        this.renderRecentFolders();
      });
    }
    const onModelChange = (newModel) => {
      if (this.modelSelect) this.modelSelect.value = newModel;
      if (this.chatModelSelect) this.chatModelSelect.value = newModel;

      if (this.activeSessionId) {
        const session = this.sessions.find((s) => s.id === this.activeSessionId);
        if (session) {
          session.model = newModel;
          if (this.chatMeta) {
            this.chatMeta.innerText = `ID: ${session.id.slice(0, 8)}... | ${session.model || 'auto'} | ${(session.mode || 'yolo').toUpperCase()}`;
          }
          this.renderSessions();
          this.syncEffortVisibility(session.engine === 'antigravity' ? 'antigravity' : 'cursor', newModel);
          fetch(`/api/sessions/${session.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
            body: JSON.stringify({ model: newModel }),
          }).catch(() => {});
          this.showToast(`✨ Модель змінено на: ${newModel}`);
        }
      }
    };

    if (this.modelSelect) {
      this.modelSelect.addEventListener('change', (e) => onModelChange(e.target.value));
    }
    if (this.chatModelSelect) {
      this.chatModelSelect.addEventListener('change', (e) => onModelChange(e.target.value));
    }

    if (this.modeSelect) {
      this.modeSelect.addEventListener('change', (e) => {
        const newMode = e.target.value;
        if (this.activeSessionId) {
          const session = this.sessions.find((s) => s.id === this.activeSessionId);
          if (session) {
            session.mode = newMode;
            if (this.chatMeta) {
              this.chatMeta.innerText = `ID: ${session.id.slice(0, 8)}... | ${session.model || 'auto'} | ${(session.mode || 'yolo').toUpperCase()}`;
            }
            fetch(`/api/sessions/${session.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
              body: JSON.stringify({ mode: newMode }),
            }).catch(() => {});
          }
        }
      });
    }

    this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());

    this.promptInput.addEventListener('input', () => {
      this.promptInput.style.height = 'auto';
      this.promptInput.style.height = `${Math.min(this.promptInput.scrollHeight, 160)}px`;
    });

    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendPrompt();
      }
    });

    this.sendBtn.addEventListener('click', () => this.sendPrompt());
    this.stopAgentBtn.addEventListener('click', () => this.stopAgent());

    if (this.thinkingEffortSelect) {
      this.thinkingEffortSelect.addEventListener('change', (e) => {
        const effort = e.target.value;
        if (this.activeSessionId) {
          const session = this.sessions.find((s) => s.id === this.activeSessionId);
          if (session) {
            session.thinkingEffort = effort;
            fetch(`/api/sessions/${session.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
              body: JSON.stringify({ thinkingEffort: effort }),
            }).catch(() => {});
            this.showToast(`🧠 Thinking Effort: ${effort.toUpperCase()}`);
          }
        }
      });
    }

    if (this.clearQueueBtn) {
      this.clearQueueBtn.addEventListener('click', () => this.clearActiveSessionQueue());
    }

    if (this.syncIdeChatBtn) {
      this.syncIdeChatBtn.addEventListener('click', () => this.syncCurrentChatWithIde());
    }

    this.loginCursorBtn.addEventListener('click', () => this.triggerCursorLogin());

    this.newChatBtn.addEventListener('click', () => this.openNewChatModal('cursor'));
    this.newAntigravityChatBtn.addEventListener('click', () => this.openNewChatModal('antigravity'));
    this.closeNewChatModalBtn.addEventListener('click', () => (this.newChatModal.style.display = 'none'));
    this.cancelNewChatBtn.addEventListener('click', () => (this.newChatModal.style.display = 'none'));
    this.submitNewChatBtn.addEventListener('click', () => this.submitNewChatModal());

    this.selectEngineCursor.addEventListener('click', () => this.setModalEngine('cursor'));
    this.selectEngineAntigravity.addEventListener('click', () => this.setModalEngine('antigravity'));

    this.sessionSearch.addEventListener('input', () => this.renderSessions());

    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-btn');
      if (chip && chip.dataset.prompt) {
        this.promptInput.value = chip.dataset.prompt;
        this.promptInput.focus();
      }
    });

    if (this.copyCmdBtn && this.daemonCommandText) {
      this.copyCmdBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(this.daemonCommandText.innerText.trim());
        this.showToast('📋 Команду запуску воркера скопійовано!');
      });
    }

    if (this.mdPreviewToggleBtn) {
      this.mdPreviewToggleBtn.addEventListener('click', () => this.toggleMarkdownPreview());
    }
    if (this.copyFileContentBtn) {
      this.copyFileContentBtn.addEventListener('click', () => {
        if (this.activeOpenedContent) {
          navigator.clipboard.writeText(this.activeOpenedContent);
          this.showToast('📋 Вміст файлу скопійовано!');
        }
      });
    }
    if (this.askAgentFileBtn) {
      this.askAgentFileBtn.addEventListener('click', () => {
        const fileName = this.activeOpenedPath.split(/[/\\]/).pop() || 'файл';
        this.switchTab('chat');
        this.promptInput.value = `Проаналізуй файл \`${this.activeOpenedPath}\` та поясни його логіку:\n\n\`\`\`\n${this.activeOpenedContent.slice(0, 3000)}\n\`\`\``;
        this.promptInput.focus();
        this.promptInput.style.height = 'auto';
        this.promptInput.style.height = `${Math.min(this.promptInput.scrollHeight, 160)}px`;
      });
    }
    if (this.refreshFilesBtn) {
      this.refreshFilesBtn.addEventListener('click', () => {
        this.loadFilesTree(this.activeOpenedDirectory || this.workspaceInput.value);
      });
    }
    if (this.fsSearchInput) {
      this.fsSearchInput.addEventListener('input', (e) => {
        this.filterFilesTree(e.target.value);
      });
    }
    if (this.fsBackBtn) {
      this.fsBackBtn.addEventListener('click', () => this.navigateFsHistory(-1));
    }
    if (this.fsUpBtn) {
      this.fsUpBtn.addEventListener('click', () => this.navigateFsUp());
    }

    if (this.terminalForm) {
      this.terminalForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.executeTerminalCommand();
      });
    }
    if (this.terminalInput) {
      this.terminalInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.termHistory.length > 0) {
            if (this.termHistoryIndex < this.termHistory.length - 1) {
              this.termHistoryIndex++;
            }
            this.terminalInput.value = this.termHistory[this.termHistory.length - 1 - this.termHistoryIndex] || '';
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (this.termHistoryIndex > 0) {
            this.termHistoryIndex--;
            this.terminalInput.value = this.termHistory[this.termHistory.length - 1 - this.termHistoryIndex] || '';
          } else if (this.termHistoryIndex === 0) {
            this.termHistoryIndex = -1;
            this.terminalInput.value = '';
          }
        }
      });
    }
    if (this.copyTermBtn) {
      this.copyTermBtn.addEventListener('click', () => {
        if (this.terminalOutput) {
          navigator.clipboard.writeText(this.terminalOutput.innerText);
          this.showToast('📋 Вивід консолі скопійовано!');
        }
      });
    }
    if (this.clearTermBtn) {
      this.clearTermBtn.addEventListener('click', () => {
        if (this.terminalOutput) {
          this.terminalOutput.innerHTML = '<div class="term-welcome-msg"><div class="term-welcome-title">LiuLiu Terminal · Spearhead link</div></div>';
        }
      });
    }

    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.term-chip');
      if (chip && chip.dataset.cmd && this.terminalInput) {
        this.terminalInput.value = chip.dataset.cmd;
        this.executeTerminalCommand();
      }
    });
  }

  initFilesResizer() {
    if (!this.filesResizer || !this.filesTreePanel) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 280;

    const onMouseDown = (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = this.filesTreePanel.getBoundingClientRect().width;
      this.filesResizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isResizing) return;
      const diff = e.clientX - startX;
      const newWidth = Math.max(180, Math.min(550, startWidth + diff));
      this.filesTreePanel.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      if (!isResizing) return;
      isResizing = false;
      this.filesResizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.filesResizer.addEventListener('mousedown', onMouseDown);

    this.filesResizer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isResizing = true;
        startX = e.touches[0].clientX;
        startWidth = this.filesTreePanel.getBoundingClientRect().width;
        this.filesResizer.classList.add('active');
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isResizing || e.touches.length !== 1) return;
      const diff = e.touches[0].clientX - startX;
      const newWidth = Math.max(180, Math.min(550, startWidth + diff));
      this.filesTreePanel.style.width = `${newWidth}px`;
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isResizing = false;
      if (this.filesResizer) this.filesResizer.classList.remove('active');
    });
  }

  async checkAuth() {
    if (!this.token) {
      this.showLogin();
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (res.ok) {
        this.showApp();
        this.connectWebSocket();
        await this.loadInitialData();
        this.voiceMode?.refreshAvailability?.();
      } else {
        this.showLogin();
      }
    } catch {
      this.showApp();
      this.connectWebSocket();
    }
  }

  async login(username, password) {
    this.loginError.innerText = '';
    this.loginBtn.disabled = true;
    this.loginBtn.innerHTML = '<span>Перевірка...</span>';

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
        sessionStorage.setItem('agentremote_token', this.token);
        this.showApp();
        this.connectWebSocket();
        await this.loadInitialData();
        this.voiceMode?.refreshAvailability?.();
      } else {
        this.loginError.innerText = data.error || 'Невірний логін або пароль';
      }
    } catch (err) {
      this.loginError.innerText = 'Помилка підключення до сервера';
    } finally {
      this.loginBtn.disabled = false;
      this.loginBtn.innerHTML = '<span>Увійти в Web IDE</span>';
    }
  }

  logout() {
    this.voiceMode?.setEnabled?.(false);
    this.token = '';
    localStorage.removeItem('agentremote_token');
    sessionStorage.removeItem('agentremote_token');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    this.showLogin();
  }

  showLogin() {
    this.loginModal.style.display = 'flex';
    this.appContainer.style.display = 'none';
  }

  showApp() {
    this.loginModal.style.display = 'none';
    this.appContainer.style.display = 'flex';
  }

  connectWebSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/client?token=${this.token}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WebSocket] Connected to Cloud Hub');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleWsMessage(msg);
      } catch (err) {
        console.error('[WebSocket] Message parse error:', err);
      }
    };

    this.ws.onclose = (e) => {
      setTimeout(() => {
        if (this.token) this.connectWebSocket();
      }, 2000);
    };

    this.ws.onerror = (err) => {
      console.error('[WebSocket] Error:', err);
    };
  }

  handleWsMessage(msg) {
    switch (msg.type) {
      case 'agent:chunk': {
        this.markAgentActivity();
        const sessionId = msg.payload?.sessionId;
        const s = this.sessions.find((x) => x.id === sessionId);
        if (s) {
          if (!s.isStreaming) {
            s.isStreaming = true;
            s.status = 'running';
            this.renderSessions();
          }
          const lastMsg = [...(s.messages || [])].reverse().find((m) => m.role === 'assistant');
          if (lastMsg) {
            lastMsg.content = applyStreamText(lastMsg.content || '', {
              chunk: msg.payload?.chunk,
              delta: msg.payload?.delta,
            });
            lastMsg.isStreaming = true;
          }
        }

        if (sessionId === this.activeSessionId) {
          this.appendAssistantChunk(sessionId, {
            chunk: msg.payload?.chunk,
            delta: msg.payload?.delta,
          });
        }
        break;
      }

      case 'agent:thinking': {
        this.markAgentActivity();
        const sessionId = msg.payload?.sessionId;
        const s = this.sessions.find((x) => x.id === sessionId);
        if (s) {
          if (!s.isStreaming) {
            s.isStreaming = true;
            s.status = 'running';
            this.renderSessions();
          }
          const lastMsg = [...(s.messages || [])].reverse().find((m) => m.role === 'assistant');
          if (lastMsg) {
            lastMsg.thinkingContent = applyStreamText(lastMsg.thinkingContent || '', {
              chunk: msg.payload?.thinking,
              delta: msg.payload?.delta,
            });
            lastMsg.isStreaming = true;
          }
        }

        if (sessionId === this.activeSessionId) {
          this.appendAssistantThinking(sessionId, {
            thinking: msg.payload?.thinking,
            delta: msg.payload?.delta,
          });
        }
        break;
      }

      case 'session:updated': {
        const updatedSession = msg.payload;
        if (updatedSession && updatedSession.id) {
          const idx = this.sessions.findIndex((x) => x.id === updatedSession.id);
          if (idx >= 0) {
            this.sessions[idx] = updatedSession;
          } else {
            this.sessions.unshift(updatedSession);
          }
          this.renderSessions();
          if (this.activeSessionId === updatedSession.id) {
            this.renderActiveChat();
          }
        }
        break;
      }

      case 'agent:tool_call': {
        this.markAgentActivity();
        const { sessionId, toolCall } = msg.payload;
        const s = this.sessions.find((x) => x.id === sessionId);
        if (s) {
          s.isStreaming = true;
          s.status = 'running';
          this.renderSessions();
        }
        if (sessionId === this.activeSessionId) {
          this.renderToolCall(sessionId, toolCall);
        }
        break;
      }

      case 'agent:tool_result': {
        this.markAgentActivity();
        const { sessionId, toolCallId, result, status } = msg.payload;
        if (sessionId === this.activeSessionId) {
          this.renderToolResult(sessionId, toolCallId, result, status);
        }
        break;
      }

      case 'agent:complete': {
        const { sessionId, cursorChatId, aborted, success, error } = msg.payload;
        const s = this.sessions.find((x) => x.id === sessionId);
        const alreadyIdle = s && !s.isStreaming && s.status !== 'running';
        if (s) {
          s.isStreaming = false;
          s.status = 'idle';
          if (cursorChatId) s.cursorChatId = cursorChatId;
          this.renderSessions();
        }
        if (sessionId === this.activeSessionId) {
          this.handleAgentComplete(sessionId, cursorChatId, {
            aborted,
            success: success !== false,
            error,
            silent: Boolean(aborted && alreadyIdle),
          });
        }
        break;
      }

      case 'agent:error': {
        const { sessionId, error } = msg.payload;
        const s = this.sessions.find((x) => x.id === sessionId);
        if (s) {
          s.isStreaming = false;
          s.status = 'idle';
          this.renderSessions();
        }
        if (sessionId === this.activeSessionId) {
          this.handleAgentError(sessionId, error);
        }
        break;
      }

      case 'device:registered':
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
        const { deviceId, status } = msg.payload;
        const dev = this.devices.find((d) => d.id === deviceId);
        if (dev) {
          dev.status = status;
          if (status !== 'online' && this.activeDeviceId === deviceId) {
            const online = this.devices.find((d) => d.status === 'online');
            if (online) this.activeDeviceId = online.id;
          }
          this.renderDevices();
        }
        break;
      }

      case 'agent:auth_url':
      case 'cursor:auth_url': {
        const { url } = msg.payload;
        this.showOAuthModal(url);
        break;
      }

      case 'fs:tree':
      case 'fs:tree_result': {
        const payload = msg.payload || {};
        if (payload.reqId === this.pendingFsReqId || !this.pendingFsReqId) {
          const items = payload.items || payload.tree || [];
          this.displayFiles(items, payload.path || payload.rootPath);
        }
        break;
      }

      case 'fs:file':
      case 'fs:file_result': {
        const payload = msg.payload || {};
        if (payload.reqId === this.pendingFileReqId || !this.pendingFileReqId) {
          this.displayFileContent(payload.path, payload.content, payload.size, payload.error);
        }
        break;
      }

      case 'transcripts:list_result': {
        if (msg.payload.reqId === this.pendingTranscriptReqId || !this.pendingTranscriptReqId) {
          this.loadedTranscripts = msg.payload.transcripts || [];
          this.renderLocalTranscripts();
        }
        break;
      }

      case 'transcripts:read_result': {
        const res = msg.payload.result || msg.payload;
        if (res) {
          this.selectedTranscriptContent = typeof res === 'string' ? res : JSON.stringify(res);
          if (this.importSanitizationReport) {
            this.importSanitizationReport.style.display = 'block';
            if (this.importSanitizedCount) {
              const count = res.messages ? res.messages.length : (res.messageCount || 1);
              this.importSanitizedCount.innerText = `Готово до імпорту • ${count} повідомлень`;
            }
          }
        }
        break;
      }
    }
  }

  async loadInitialData() {
    await Promise.all([this.loadDevices(), this.loadSessions()]);
  }

  async loadDevices() {
    try {
      const res = await fetch('/api/devices', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        this.devices = data.devices || [];
        const online = this.devices.find((d) => d.status === 'online');
        const selected = this.devices.find((d) => d.id === data.activeDeviceId && d.status === 'online');
        this.activeDeviceId = (selected && selected.id) || (online && online.id) || data.activeDeviceId || (this.devices[0] ? this.devices[0].id : null);
        this.renderDevices();
      }
    } catch (err) {
      console.error('[App] Failed to load devices:', err);
    }
  }

  async loadSessions() {
    try {
      const res = await fetch('/api/sessions', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        this.sessions = data.sessions || [];

        // Restore active session from localStorage on reload
        const savedSessionId = localStorage.getItem('agentremote_active_session_id');
        if (savedSessionId && this.sessions.some((s) => s.id === savedSessionId)) {
          this.activeSessionId = savedSessionId;
        } else if (this.sessions.length > 0 && !this.activeSessionId) {
          this.activeSessionId = this.sessions[0].id;
        }

        this.renderSessions();
        this.renderActiveChat();
      }
    } catch (err) {
      console.error('[App] Failed to load sessions:', err);
    }
  }

  renderDevices() {
    this.deviceSelect.innerHTML = '';
    if (this.devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.innerText = 'Немає підключених машин';
      this.deviceSelect.appendChild(opt);
      this.deviceStatusDot.className = 'device-status-indicator offline';
      this.activeDeviceIndicator.innerText = 'Пристрій: Очікування підключення...';
    } else {
      this.devices.forEach((dev) => {
        const opt = document.createElement('option');
        opt.value = dev.id;
        const isOnline = dev.status === 'online';
        opt.innerText = `${isOnline ? '●' : '○'} ${dev.name} (${dev.os ? dev.os.split(' ')[0] : 'Local'})`;
        if (dev.id === this.activeDeviceId) {
          opt.selected = true;
        }
        this.deviceSelect.appendChild(opt);
      });

      const activeDev = this.getActiveDevice();
      const isOnline = activeDev && activeDev.status === 'online';
      this.deviceStatusDot.className = `device-status-indicator ${isOnline ? 'online' : 'offline'}`;

      const shortName = activeDev ? (activeDev.name || 'PC').slice(0, 14) : '—';
      const isNarrow = window.innerWidth <= 480;
      const isCursorLoggedIn = Boolean(activeDev && activeDev.cursorAuthStatus && activeDev.cursorAuthStatus.loggedIn);
      if (isNarrow) {
        this.activeDeviceIndicator.innerText = `${shortName}${isOnline ? '' : ' ○'}`;
        this.activeDeviceIndicator.title = activeDev
          ? `${activeDev.name} (${isOnline ? 'ONLINE' : 'OFFLINE'})`
          : 'Не обрано';
      } else if (isCursorLoggedIn) {
        this.loginCursorBtn.style.display = 'none';
        const emailLabel = activeDev.cursorAuthStatus.email ? ` • ${activeDev.cursorAuthStatus.email}` : ' • 🔑 Вхід виконано';
        this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev.name} (${isOnline ? 'ONLINE' : 'OFFLINE'})${emailLabel}`;
      } else {
        this.loginCursorBtn.style.display = 'inline-flex';
        this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev ? activeDev.name : 'Не обрано'} (${isOnline ? 'ONLINE' : 'OFFLINE'})`;
      }

      if (!isNarrow) {
        // keep login button visibility from branches above
      } else if (isCursorLoggedIn) {
        this.loginCursorBtn.style.display = 'none';
      } else {
        this.loginCursorBtn.style.display = 'inline-flex';
      }

      if (activeDev && activeDev.defaultWorkspace && !this.workspaceInput.value) {
        this.workspaceInput.value = activeDev.defaultWorkspace;
        if (!this.termCurrentPath) {
          this.termCurrentPath = activeDev.defaultWorkspace;
          this.updateTerminalPrompt(activeDev.defaultWorkspace);
        }
      }

      if (this.termDeviceTitle && activeDev) {
        this.termDeviceTitle.innerText = `PowerShell (${activeDev.name})`;
      }
      if (this.termPromptPath && !this.termCurrentPath && this.workspaceInput && this.workspaceInput.value) {
        const wsName = this.workspaceInput.value.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
        this.termPromptPath.innerText = `~/${wsName}`;
      }
    }

    if (this.modalDeviceSelect) {
      this.modalDeviceSelect.innerHTML = '';
      this.devices.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.id;
        const isOnline = d.status === 'online';
        opt.innerText = `${isOnline ? '●' : '○'} ${d.name} (${d.os ? d.os.split(' ')[0] : 'Local'})`;
        if (d.id === this.activeDeviceId) {
          opt.selected = true;
        }
        this.modalDeviceSelect.appendChild(opt);
      });
    }

    this.devicesFullList.innerHTML = this.devices
      .map(
        (dev) => `
      <div class="device-card">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <strong style="font-size:13.5px; color:var(--text-primary);">💻 ${this.escapeHtml(dev.name)}</strong>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="device-status-indicator ${dev.status === 'online' ? 'online' : 'offline'}"></span>
            <button type="button" class="btn btn-secondary btn-sm device-delete-btn" data-device-id="${this.escapeHtml(dev.id)}" title="Видалити зі списку">Видалити</button>
          </div>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.65; margin-top:8px;">
          <div><strong>ID:</strong> <code>${this.escapeHtml(dev.id)}</code></div>
          <div><strong>OS:</strong> ${this.escapeHtml(dev.os || 'Windows/Linux/macOS')}</div>
          <div><strong>Cursor CLI:</strong> ${dev.cursorCliPath ? '✓ Виявлено' : '✕ Не знайдено'}</div>
          <div><strong>Antigravity:</strong> ${dev.antigravityAvailable ? '✓ Доступно' : '✕ Не знайдено'}</div>
          ${dev.memoryUsage ? `<div><strong>RAM:</strong> ${dev.memoryUsage.used} MB / ${dev.memoryUsage.total} MB</div>` : ''}
          <div><strong>Робоча папка:</strong> <code>${this.escapeHtml(dev.defaultWorkspace || '-')}</code></div>
        </div>
      </div>
    `
      )
      .join('');

    this.devicesFullList.querySelectorAll('.device-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteDevice(btn.dataset.deviceId));
    });
  }

  getActiveDevice() {
    const selected = this.devices.find((d) => d.id === this.activeDeviceId);
    if (selected && selected.status === 'online') return selected;
    return this.devices.find((d) => d.status === 'online') || selected || this.devices[0];
  }

  selectDevice(deviceId) {
    this.activeDeviceId = deviceId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'device:select', deviceId }));
    }
    this.renderDevices();
  }

  initTheme() {
    const saved =
      localStorage.getItem('liuliu_theme') ||
      (localStorage.getItem('agentremote_theme') === 'dark' ? 'dark' : 'ashen');
    this.applyTheme(saved);
  }

  toggleTheme() {
    const current = document.body.getAttribute('data-theme') || 'ashen';
    const order = ['ashen', 'light', 'dark'];
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    this.applyTheme(next);
    const labels = { ashen: 'Ashen', light: 'Light', dark: 'Dark' };
    this.showToast?.(`Тема: ${labels[next] || next}`);
  }

  applyTheme(theme) {
    const safe = ['ashen', 'light', 'dark'].includes(theme) ? theme : 'ashen';
    document.body.setAttribute('data-theme', safe);
    localStorage.setItem('liuliu_theme', safe);
    localStorage.setItem('agentremote_theme', safe === 'ashen' ? 'dark' : safe);
    if (this.themeToggleBtn) {
      this.themeToggleBtn.title = `Тема: ${safe} (клік — наступна)`;
    }
    if (this.themeIcon) {
      if (safe === 'light') {
        this.themeIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
      } else if (safe === 'dark') {
        this.themeIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
      } else {
        this.themeIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20 L12 4 L20 20 Z" opacity="0.9"/><path d="M8 20h8" stroke-width="1.6"/><circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none"/></svg>`;
      }
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
        ? '<span class="session-engine-tag antigravity">AGY</span>'
        : '<span class="session-engine-tag cursor">CURSOR</span>';

      const isRunning = Boolean(s.isStreaming || s.status === 'running');
      const runningTag = isRunning
        ? '<span class="session-running-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:9.5px; padding:1px 5px; border-radius:4px; background:rgba(56,189,248,0.15); color:var(--accent-primary); font-weight:700; border:1px solid rgba(56,189,248,0.3);"><span class="pulse-dot"></span> виконується</span>'
        : '';

      const descText = s.description || (s.workspacePath ? s.workspacePath.split(/[/\\]/).filter(Boolean).pop() : 'Робоча сесія');

      item.innerHTML = `
        <div class="session-info">
          <div class="session-header-line">
            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
              ${engineTag}
              ${runningTag}
            </div>
            <div class="session-title">${this.escapeHtml(s.title || (isAntigravity ? 'Чат Antigravity' : 'Чат Cursor'))}</div>
          </div>
          <div class="session-desc">${this.escapeHtml(descText)}</div>
          <div class="session-date">${formattedDate} • ${s.model === 'auto' ? 'Auto' : s.model || (isAntigravity ? 'Gemini' : 'Claude')} • ${s.messages ? s.messages.length : 0} повід.</div>
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
    if (sessionId) {
      localStorage.setItem('agentremote_active_session_id', sessionId);
    } else {
      localStorage.removeItem('agentremote_active_session_id');
    }
    this.renderSessions();
    this.renderActiveChat();
    this.appSidebar.classList.remove('open');
    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.classList.remove('show');
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
      if (this.activeSessionId) {
        localStorage.setItem('agentremote_active_session_id', this.activeSessionId);
      } else {
        localStorage.removeItem('agentremote_active_session_id');
      }
    }
    this.renderSessions();
    this.renderActiveChat();
  }

  renderActiveChat() {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) {
      this.currentChatTitle.innerText = 'Новий чат Cursor';
      this.chatMeta.innerText = 'Оберіть сесію або почніть нову';
      this.isStreaming = false;
      this.stopAgentBtn.style.display = 'none';
      this.sendBtn.disabled = false;
      this.chatMessages.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-badge">LiuLiu · Ashen</div>
          <h3>Створіть або оберіть сесію</h3>
          <p>Натисніть "+ Cursor" або "+ Antigravity" у бічній панелі щоб почати розробку.</p>
        </div>
      `;
      return;
    }

    const isSessionStreaming = Boolean(session.isStreaming || session.status === 'running');
    this.isStreaming = isSessionStreaming;
    if (isSessionStreaming) {
      this.startAgentStallWatchdog();
    } else {
      this.stopAgentStallWatchdog();
    }
    this.stopAgentBtn.style.display = isSessionStreaming ? 'inline-flex' : 'none';
    this.sendBtn.disabled = false;

    if (isSessionStreaming) {
      this.sendBtn.title = 'Додати повідомлення у чергу';
      if (this.sendShortcutHint) this.sendShortcutHint.innerText = 'Enter — додати в чергу';
    } else {
      this.sendBtn.title = 'Надіслати';
      if (this.sendShortcutHint) this.sendShortcutHint.innerText = '⌘ + Enter / Enter';
    }

    this.currentChatTitle.innerText = session.title || 'Чат розробки';
    if (isSessionStreaming && this.chatMeta) {
      this.chatMeta.innerHTML = `<span style="color:var(--accent-primary); font-weight:600;"><span class="pulse-dot"></span> Агент виконує завдання...</span>`;
    } else if (this.chatMeta) {
      this.chatMeta.innerText = `ID: ${session.id.slice(0, 8)}... | ${session.model || 'auto'} | ${(session.mode || 'yolo').toUpperCase()}`;
    }

    if (session.engine === 'antigravity') {
      if (!session.model || session.model === 'auto') session.model = this.defaultModelFor('antigravity');
      if (!session.thinkingEffort) session.thinkingEffort = 'high';
    }

    const sessionEngine = session.engine === 'antigravity' ? 'antigravity' : 'cursor';
    const activeModel = session.model && session.model !== 'auto' ? session.model : this.defaultModelFor(sessionEngine);

    [this.modelSelect, this.chatModelSelect].forEach((sel) => {
      if (!sel) return;
      sel.innerHTML = this.buildModelOptionsHtml(sessionEngine, activeModel);
      sel.value = activeModel;
      this.refreshCustomSelect(sel);
    });
    session.model = activeModel;

    if (session.mode && this.modeSelect) {
      this.modeSelect.value = session.mode;
    }
    if (this.thinkingEffortSelect) {
      this.thinkingEffortSelect.value = session.thinkingEffort || (sessionEngine === 'antigravity' ? 'high' : 'medium');
    }
    this.syncEffortVisibility(sessionEngine, activeModel);

    this.renderQueue();

    if (session.messages.length === 0) {
      this.chatMessages.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-badge">Готовий до роботи</div>
          <h3>${this.escapeHtml(session.title)}</h3>
          <p>Напишіть завдання або оберіть одну зі швидких дій нижче:</p>
          <div class="quick-prompt-chips">
            <button class="chip-btn" data-prompt="Зроби огляд проекту і поясни структуру коду">Огляд структури проекту</button>
            <button class="chip-btn" data-prompt="Перевір git статус та останні зміни">Перевірити git статус</button>
            <button class="chip-btn" data-prompt="Запусти тести та перевір чи все збирається">Запустити білд і тести</button>
            <button class="chip-btn" data-prompt="Знайди потенційні баги або невикористаний код">Пошук проблем у коді</button>
          </div>
        </div>
      `;
      return;
    }

    this.chatMessages.innerHTML = '';
    session.messages.forEach((msg, idx) => {
      const isLast = idx === session.messages.length - 1;
      const isLastStreaming = isLast && isSessionStreaming && msg.role === 'assistant';
      this.renderChatMessageElement(msg.role, msg.content, msg.toolCalls, isLastStreaming, msg.thinkingContent);
    });
    this.scrollToBottom();
  }

  renderQueue() {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!this.chatQueueContainer || !this.queueItemsList) return;

    const queue = (session && session.promptQueue) || [];
    if (queue.length === 0) {
      this.chatQueueContainer.style.display = 'none';
      return;
    }

    this.chatQueueContainer.style.display = 'block';
    if (this.queueCount) this.queueCount.innerText = queue.length;

    this.queueItemsList.innerHTML = '';
    queue.forEach((promptText, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'queue-item';
      itemEl.innerHTML = `
        <div class="queue-item-info">
          <span class="queue-item-num">#${idx + 1}</span>
          <span class="queue-item-text" title="${this.escapeHtml(promptText)}">${this.escapeHtml(promptText)}</span>
        </div>
        <button class="queue-item-del-btn" title="Видалити з черги">✕</button>
      `;

      itemEl.querySelector('.queue-item-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeQueuedPrompt(idx);
      });

      this.queueItemsList.appendChild(itemEl);
    });
  }

  removeQueuedPrompt(index) {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session || !session.promptQueue) return;
    session.promptQueue.splice(index, 1);
    this.renderQueue();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:remove_queued_prompt',
          payload: { sessionId: this.activeSessionId, index },
        })
      );
    }
  }

  clearActiveSessionQueue() {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session || !session.promptQueue) return;
    session.promptQueue = [];
    this.renderQueue();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:clear_queue',
          payload: { sessionId: this.activeSessionId },
        })
      );
    }
    this.showToast('🗑️ Чергу завдань очищено');
  }

  formatThinkingHtml(thinkingText, isStreaming = false) {
    if (!thinkingText && !isStreaming) return '';
    const hasContent = Boolean(thinkingText && thinkingText.trim());
    return `
      <div class="thinking-accordion ${isStreaming ? 'streaming open' : ''}">
        <div class="thinking-accordion-header" onclick="this.closest('.thinking-accordion').classList.toggle('open')">
          <div class="thinking-accordion-title">
            <span class="thinking-brain-icon">🧠</span>
            <span>Міркування моделі</span>
            ${isStreaming ? '<span class="thinking-live-badge"><span class="pulse-dot"></span> міркує...</span>' : ''}
          </div>
          <button type="button" class="thinking-accordion-toggle-btn" title="Розгорнути/Згорнути">
            <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
        </div>
        <div class="thinking-accordion-body" style="display: ${hasContent ? 'block' : 'none'};">
          <div class="thinking-text">${this.escapeHtml(thinkingText || '')}</div>
        </div>
      </div>
    `;
  }

  renderChatMessageElement(role, content, toolCalls, isStreaming = false, thinkingContent = '') {
    const el = document.createElement('div');
    el.className = `message ${role} ${isStreaming ? 'streaming' : ''}`;

    const isUser = role === 'user';
    const isAssistant = role === 'assistant';

    const avatarHtml = isUser
      ? `<div class="message-avatar" style="background:var(--accent-primary); color:#fff; font-weight:700; font-size:11px;">ВИ</div>`
      : `<div class="message-avatar" style="background:var(--accent-primary); color:#fff; font-weight:700; font-size:10px;">AI</div>`;

    let parsedContent = '';
    if (isAssistant && window.marked && content) {
      parsedContent = this.renderMarkdownSafe(content);
    } else if (content) {
      parsedContent = this.escapeHtml(content).replace(/\n/g, '<br>');
    } else if (isStreaming && !thinkingContent && (!toolCalls || toolCalls.length === 0)) {
      parsedContent = `
        <div class="agent-thinking-wrapper" style="display:inline-flex; align-items:center; gap:8px; padding:2px 0; color:var(--text-secondary); font-size:12.5px;">
          <span class="thinking-spinner"></span>
          <span>Агент підключається та формує план дій...</span>
        </div>
      `;
    }

    const thinkingHtml = thinkingContent
      ? `<div class="thinking-container">${this.formatThinkingHtml(thinkingContent, isStreaming)}</div>`
      : '';

    let toolCallsHtml = '';
    if (toolCalls && toolCalls.length > 0) {
      toolCallsHtml = `
        <div class="tool-calls-container">
          ${toolCalls.map((tc) => this.formatToolCallHtml(tc)).join('')}
        </div>
      `;
    }

    const hasBubble = Boolean(parsedContent || (!thinkingContent && (!toolCalls || toolCalls.length === 0)));

    el.innerHTML = `
      ${avatarHtml}
      <div class="message-bubble-wrapper" style="flex:1; min-width:0;">
        ${thinkingHtml}
        ${toolCallsHtml}
        ${hasBubble ? `<div class="message-bubble">${parsedContent}</div>` : ''}
      </div>
    `;

    el.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
    });

    this.chatMessages.appendChild(el);
  }

  getToolMeta(toolName, input = {}) {
    const name = (toolName || '').toLowerCase();
    
    if (name.includes('command') || name.includes('terminal') || name.includes('bash') || name.includes('exec') || name.includes('shell')) {
      const cmd = input.command || input.CommandLine || input.cmd || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
        label: 'Термінал',
        badgeClass: 'badge-terminal',
        summary: cmd ? `$ ${cmd}` : 'Виконання команди',
      };
    }
    if (name.includes('replace') || name.includes('edit') || name.includes('write')) {
      const file = input.TargetFile || input.file || input.path || input.target || '';
      const fileName = file ? file.split(/[/\\]/).pop() : '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
        label: 'Редагування',
        badgeClass: 'badge-edit',
        summary: fileName || file || 'Модифікація файлу',
      };
    }
    if (name.includes('view') || name.includes('read')) {
      const file = input.AbsolutePath || input.path || input.TargetFile || input.file || '';
      const fileName = file ? file.split(/[/\\]/).pop() : '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
        label: 'Перегляд',
        badgeClass: 'badge-view',
        summary: fileName || file || 'Читання файлу',
      };
    }
    if (name.includes('grep') || name.includes('search') || name.includes('find')) {
      const query = input.Query || input.query || input.Pattern || input.pattern || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
        label: 'Пошук',
        badgeClass: 'badge-search',
        summary: query ? `"${query}"` : 'Пошук у проекті',
      };
    }
    if (name.includes('subagent') || name.includes('agent')) {
      const role = input.Role || input.role || input.TypeName || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
        label: 'Субагент',
        badgeClass: 'badge-subagent',
        summary: role || 'Фоновий агент',
      };
    }
    if (name.includes('url') || name.includes('web') || name.includes('browser')) {
      const url = input.Url || input.url || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
        label: 'Веб',
        badgeClass: 'badge-web',
        summary: url || 'Веб-сторінка',
      };
    }

    return {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
      label: toolName || 'Дія',
      badgeClass: 'badge-generic',
      summary: '',
    };
  }

  formatToolCallHtml(tc) {
    const rawInput = tc.input || tc.arguments;
    const meta = this.getToolMeta(tc.name || tc.type, rawInput);
    const summaryText = tc.summary || meta.summary || '';
    const isRunning = tc.status === 'running';
    const isError = tc.status === 'failed' || tc.status === 'error';
    const statusLabel = isRunning ? '<span class="pulse-dot"></span> виконується...' : isError ? '✕ помилка' : '✓ завершено';
    const statusClass = isRunning ? 'running' : isError ? 'error' : 'completed';

    const inputJson = rawInput ? (typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput, null, 2)) : '';
    const outputText = tc.output || tc.result || '';
    const hasDetails = Boolean(inputJson || outputText || isRunning);

    return `
      <div class="tool-call-card ${statusClass}" id="tool-call-${tc.id}">
        <div class="tool-call-header" onclick="this.closest('.tool-call-card').classList.toggle('expanded')">
          <div class="tool-call-header-left">
            <span class="tool-call-category-badge ${meta.badgeClass}">
              ${meta.icon}
              <span>${meta.label}</span>
            </span>
            <span class="tool-call-fn-name">${this.escapeHtml(tc.name || tc.type || 'tool')}</span>
            ${summaryText ? `<span class="tool-call-summary" title="${this.escapeHtml(summaryText)}">${this.escapeHtml(summaryText)}</span>` : ''}
          </div>
          <div class="tool-call-header-right">
            <span class="tool-call-status ${statusClass}">
              ${statusLabel}
            </span>
            ${hasDetails ? `
              <button type="button" class="tool-call-toggle-btn" title="Розгорнути/Згорнути деталі">
                <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
            ` : ''}
          </div>
        </div>
        ${hasDetails ? `
          <div class="tool-call-body">
            ${inputJson ? `
              <div class="tool-call-section">
                <div class="tool-call-section-title">
                  <span>Параметри виклику (Input):</span>
                  <button type="button" class="btn-copy-mini" onclick="navigator.clipboard.writeText(this.dataset.copy); window.app.showToast('📋 Параметри скопійовано!');" data-copy="${this.escapeHtml(inputJson)}">копіювати</button>
                </div>
                <div class="tool-call-code-block"><pre><code>${this.escapeHtml(inputJson)}</code></pre></div>
              </div>
            ` : ''}
            ${outputText ? `
              <div class="tool-call-section" style="margin-top: 8px;">
                <div class="tool-call-section-title">
                  <span>Результат виконання (Output):</span>
                  <button type="button" class="btn-copy-mini" onclick="navigator.clipboard.writeText(this.dataset.copy); window.app.showToast('📋 Результат скопійовано!');" data-copy="${this.escapeHtml(outputText)}">копіювати</button>
                </div>
                <div class="tool-call-output-block"><pre><code>${this.escapeHtml(outputText)}</code></pre></div>
              </div>
            ` : `
              <div class="tool-call-output-pending" style="display: ${isRunning ? 'flex' : 'none'};">
                <span class="thinking-spinner"></span>
                <span>Очікування результату виконання...</span>
              </div>
            `}
          </div>
        ` : ''}
      </div>
    `;
  }

  appendAssistantThinking(sessionId, payload) {
    if (sessionId !== this.activeSessionId) return;
    const delta = typeof payload === 'string' ? payload : payload?.delta;
    const thinking = typeof payload === 'string' ? undefined : payload?.thinking;

    if (this.chatMeta) {
      this.chatMeta.innerHTML = `<span style="color:#a78bfa; font-weight:600;"><span class="pulse-dot"></span> Агент міркує над завданням...</span>`;
    }

    let assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    if (!assistantMsgEl) {
      this.renderChatMessageElement('assistant', '', [], true, '');
      assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    }

    const wrapper = assistantMsgEl.querySelector('.message-bubble-wrapper');
    
    // Clear initial loading placeholder if thinking starts
    const initialPlaceholder = wrapper.querySelector('.agent-thinking-wrapper');
    if (initialPlaceholder) {
      const bubble = initialPlaceholder.closest('.message-bubble');
      if (bubble && !bubble.rawMarkdown) bubble.remove();
    }

    let thinkingContainer = wrapper.querySelector('.thinking-container');
    if (!thinkingContainer) {
      thinkingContainer = document.createElement('div');
      thinkingContainer.className = 'thinking-container';
      wrapper.insertBefore(thinkingContainer, wrapper.firstChild);
    }

    let thinkingAccordion = thinkingContainer.querySelector('.thinking-accordion');
    if (!thinkingAccordion) {
      thinkingContainer.innerHTML = this.formatThinkingHtml('', true);
      thinkingAccordion = thinkingContainer.querySelector('.thinking-accordion');
    }

    const body = thinkingAccordion.querySelector('.thinking-accordion-body');
    const textEl = thinkingAccordion.querySelector('.thinking-text');
    if (textEl) {
      const next = applyStreamText(textEl.textContent || '', { chunk: thinking, delta: typeof payload === 'string' ? payload : delta });
      if (next !== (textEl.textContent || '')) {
        textEl.textContent = next;
        if (body) body.style.display = 'block';
      }
    }

    this.scrollToBottom();
  }

  appendAssistantChunk(sessionId, payload) {
    if (sessionId !== this.activeSessionId) return;
    const streamPayload = typeof payload === 'string' ? { delta: payload } : payload;

    if (this.chatMeta) {
      this.chatMeta.innerHTML = `<span style="color:var(--accent-primary); font-weight:600;"><span class="pulse-dot"></span> Агент друкує відповідь...</span>`;
    }

    let assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    if (!assistantMsgEl) {
      this.renderChatMessageElement('assistant', '', [], true, '');
      assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    }

    const wrapper = assistantMsgEl.querySelector('.message-bubble-wrapper');
    
    // Clear initial placeholder if any
    const initialPlaceholder = wrapper.querySelector('.agent-thinking-wrapper');
    if (initialPlaceholder) {
      const bubble = initialPlaceholder.closest('.message-bubble');
      if (bubble && !bubble.rawMarkdown) {
        bubble.innerHTML = '';
      }
    }

    let bubble = wrapper.querySelector('.message-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      wrapper.appendChild(bubble);
    }

    if (!bubble.rawMarkdown) {
      bubble.rawMarkdown = '';
      bubble.innerHTML = ''; // Clear initial placeholder
    }

    const next = applyStreamText(bubble.rawMarkdown || '', streamPayload);
    if (next === (bubble.rawMarkdown || '') && !streamPayload?.delta) {
      this.scrollToBottom();
      return;
    }
    bubble.rawMarkdown = next;

    if (bubble.rawMarkdown) {
      if (window.marked) {
        bubble.innerHTML = this.renderMarkdownSafe(bubble.rawMarkdown);
        bubble.querySelectorAll('pre code').forEach((b) => {
          if (window.hljs) hljs.highlightElement(b);
        });
      } else {
        bubble.innerText = bubble.rawMarkdown;
      }
    }

    this.scrollToBottom();
  }

  renderToolCall(sessionId, toolCall) {
    if (sessionId !== this.activeSessionId) return;

    const rawInput = toolCall.input || toolCall.arguments;
    const meta = this.getToolMeta(toolCall.name || toolCall.type, rawInput);
    const summary = toolCall.summary || meta.summary || toolCall.name || 'дія';

    if (this.chatMeta) {
      this.chatMeta.innerHTML = `<span style="color:#fbbf24; font-weight:600;"><span class="pulse-dot"></span> [${meta.label}] ${this.escapeHtml(summary)}...</span>`;
    }

    let assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    if (!assistantMsgEl) {
      this.renderChatMessageElement('assistant', '', [], true, '');
      assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    }

    const wrapper = assistantMsgEl.querySelector('.message-bubble-wrapper');
    
    // Clear initial loading placeholder when tools start
    const initialPlaceholder = wrapper.querySelector('.agent-thinking-wrapper');
    if (initialPlaceholder) {
      const bubble = initialPlaceholder.closest('.message-bubble');
      if (bubble && !bubble.rawMarkdown) bubble.remove();
    }

    let toolContainer = wrapper.querySelector('.tool-calls-container');
    if (!toolContainer) {
      toolContainer = document.createElement('div');
      toolContainer.className = 'tool-calls-container';
      const bubble = wrapper.querySelector('.message-bubble');
      if (bubble) {
        wrapper.insertBefore(toolContainer, bubble);
      } else {
        wrapper.appendChild(toolContainer);
      }
    }

    const existingTc = toolContainer.querySelector(`#tool-call-${toolCall.id}`);
    if (existingTc) {
      const temp = document.createElement('div');
      temp.innerHTML = this.formatToolCallHtml(toolCall);
      if (temp.firstElementChild) {
        existingTc.replaceWith(temp.firstElementChild);
      }
    } else {
      const temp = document.createElement('div');
      temp.innerHTML = this.formatToolCallHtml(toolCall);
      const card = temp.firstElementChild;
      if (card) {
        toolContainer.appendChild(card);
        this.currentToolCallElements.set(toolCall.id, card);
      }
    }

    this.scrollToBottom();
  }

  renderToolResult(sessionId, toolCallId, result, status) {
    const tcEl = this.currentToolCallElements.get(toolCallId) || document.getElementById(`tool-call-${toolCallId}`);
    if (tcEl) {
      const isOk = status === 'completed' || status === 'success' || !status;
      tcEl.className = `tool-call-card ${isOk ? 'completed' : 'error'}`;
      
      const statusBadge = tcEl.querySelector('.tool-call-status');
      if (statusBadge) {
        statusBadge.className = `tool-call-status ${isOk ? 'completed' : 'error'}`;
        statusBadge.innerText = isOk ? '✓ завершено' : '✕ помилка';
      }

      const pendingIndicator = tcEl.querySelector('.tool-call-output-pending');
      if (pendingIndicator) pendingIndicator.style.display = 'none';

      if (result) {
        let body = tcEl.querySelector('.tool-call-body');
        if (!body) {
          body = document.createElement('div');
          body.className = 'tool-call-body';
          tcEl.appendChild(body);
        }

        let outputSection = body.querySelector('.tool-call-section-output');
        if (!outputSection) {
          outputSection = document.createElement('div');
          outputSection.className = 'tool-call-section tool-call-section-output';
          outputSection.style.marginTop = '8px';
          outputSection.innerHTML = `
            <div class="tool-call-section-title">
              <span>Результат виконання (Output):</span>
              <button type="button" class="btn-copy-mini" onclick="navigator.clipboard.writeText(this.dataset.copy); window.app.showToast('📋 Результат скопійовано!');" data-copy="${this.escapeHtml(result)}">копіювати</button>
            </div>
            <div class="tool-call-output-block"><pre><code>${this.escapeHtml(result)}</code></pre></div>
          `;
          body.appendChild(outputSection);
        } else {
          outputSection.querySelector('.tool-call-output-block pre code').innerText = result;
        }
      }
    }
  }

  markAgentActivity() {
    this.lastAgentActivityAt = Date.now();
  }

  startAgentStallWatchdog() {
    if (!this.agentStallTimer) this.markAgentActivity();
    if (this.agentStallTimer) return;
    this.agentStallTimer = setInterval(() => {
      if (!this.isStreaming) {
        this.stopAgentStallWatchdog();
        return;
      }
      const idleFor = Date.now() - (this.lastAgentActivityAt || 0);
      if (idleFor < this.AGENT_STALL_TIMEOUT_MS) return;

      const sessionId = this.activeSessionId;
      if (this.ws && this.ws.readyState === WebSocket.OPEN && sessionId) {
        this.ws.send(JSON.stringify({ type: 'agent:abort', payload: { sessionId } }));
      }
      const session = this.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.isStreaming = false;
        session.status = 'idle';
      }
      this.handleAgentComplete(sessionId, undefined, { aborted: true, silent: true });
      this.showToast('⚠️ Агент не відповідає — ввід розблоковано', 6000);
    }, 5000);
  }

  stopAgentStallWatchdog() {
    if (this.agentStallTimer) {
      clearInterval(this.agentStallTimer);
      this.agentStallTimer = null;
    }
  }

  handleAgentComplete(sessionId, cursorChatId, options = {}) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.isStreaming = false;
      session.status = 'idle';
      if (cursorChatId) session.cursorChatId = cursorChatId;
      if (this.chatMeta) {
        this.chatMeta.innerText = `ID: ${session.id.slice(0, 8)}... | ${session.model || 'auto'} | ${(session.mode || 'yolo').toUpperCase()}`;
      }
    }

    const hasQueue = Boolean(session && session.promptQueue && session.promptQueue.length > 0);

    this.isStreaming = Boolean(hasQueue && !options.aborted);
    if (this.isStreaming) {
      this.markAgentActivity();
    } else {
      this.stopAgentStallWatchdog();
    }
    this.stopAgentBtn.style.display = this.isStreaming ? 'inline-flex' : 'none';
    this.sendBtn.disabled = false;
    if (!this.isStreaming) {
      if (this.sendShortcutHint) this.sendShortcutHint.innerText = '⌘ + Enter / Enter';
      this.sendBtn.title = 'Надіслати';
      if (!options.silent) {
        if (options.aborted) {
          this.showToast('🛑 Запит до агента зупинено');
        } else if (options.success === false) {
          this.showToast(`⚠️ ${options.error || 'Агент завершився з помилкою'}`, 6000);
        } else {
          this.showToast('✨ Агент завершив виконання завдання');
        }
      }
    }

    const streamingMsg = this.chatMessages.querySelector('.message.assistant.streaming');
    if (streamingMsg) {
      streamingMsg.classList.remove('streaming');
      
      const liveThinkingBadge = streamingMsg.querySelector('.thinking-live-badge');
      if (liveThinkingBadge) liveThinkingBadge.remove();

      // Collapse thinking if there's content
      const thinkingAccordion = streamingMsg.querySelector('.thinking-accordion');
      if (thinkingAccordion) {
        thinkingAccordion.classList.remove('streaming');
        const body = thinkingAccordion.querySelector('.thinking-accordion-body');
        if (body && body.textContent.trim() !== '') {
          thinkingAccordion.classList.remove('open'); // Auto collapse when done
        }
      }

      // Mark any still-running tool calls as completed silently
      const runningTools = streamingMsg.querySelectorAll('.tool-call-card:not(.completed):not(.error)');
      runningTools.forEach(tcEl => {
        tcEl.classList.add('completed');
        const statusBadge = tcEl.querySelector('.tool-call-status');
        if (statusBadge) {
          statusBadge.classList.add('completed');
          statusBadge.innerText = '✓ завершено';
        }
        const pendingIndicator = tcEl.querySelector('.tool-call-output-pending');
        if (pendingIndicator) pendingIndicator.style.display = 'none';
      });

      const bubble = streamingMsg.querySelector('.message-bubble');
      if (bubble && options.success === false && options.error) {
        bubble.rawMarkdown = String(options.error);
        bubble.innerHTML = this.renderMarkdownSafe(String(options.error));
      } else if (bubble && !bubble.rawMarkdown && bubble.querySelector('.agent-thinking-wrapper')) {
        const fallback =
          options.success === false
            ? `⚠️ ${options.error || 'Агент завершився з помилкою'}`
            : '✅ Завдання успішно виконано агентом.';
        bubble.rawMarkdown = fallback;
        bubble.innerHTML = this.renderMarkdownSafe(fallback);
      }
    }

    this.renderQueue();

    if (this.voiceMode?.enabled) {
      const lastBubble = this.chatMessages.querySelector('.message.assistant:last-of-type .message-bubble');
      const spokenText = (lastBubble && (lastBubble.rawMarkdown || lastBubble.innerText)) || options.error || '';
      const hasToolCalls = Boolean(this.chatMessages.querySelector('.message.assistant:last-of-type .tool-call-card'));
      this.voiceMode.onAgentComplete(session, { ...options, spokenText, hasToolCalls });
    }
  }

  handleAgentError(sessionId, error) {
    this.isStreaming = false;
    this.stopAgentStallWatchdog();
    this.stopAgentBtn.style.display = 'none';
    this.sendBtn.disabled = false;

    const streamingMsg = this.chatMessages.querySelector('.message.assistant.streaming');
    if (streamingMsg) streamingMsg.classList.remove('streaming');

    if (this.chatMeta) {
      this.chatMeta.innerHTML = `<span style="color:var(--accent-error); font-weight:600;">⚠️ Помилка виконання агента</span>`;
    }

    this.renderChatMessageElement('assistant', `⚠️ **Помилка агента:** ${error}`);
    this.showToast(`❌ Помилка: ${error}`, 5000);
    this.scrollToBottom();
    if (this.voiceMode?.enabled) {
      this.voiceMode.onAgentComplete(this.sessions.find((s) => s.id === sessionId), { aborted: true });
    }
  }

  async ensureActiveSession(engine = 'antigravity') {
    if (this.activeSessionId) {
      const existing = this.sessions.find((s) => s.id === this.activeSessionId);
      if (existing) return existing;
    }

    const device = this.getActiveDevice();
    const deviceId = (device && device.id) || this.activeDeviceId || 'default';
    const workspace =
      (this.workspaceInput && this.workspaceInput.value.trim()) ||
      (device && device.defaultWorkspace) ||
      '';
    const isAgy = engine === 'antigravity';

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        deviceId,
        title: isAgy ? 'Новий чат Antigravity' : 'Новий чат Cursor',
        description: isAgy
          ? 'Сесія Google Antigravity (Gemini 3.7 Flash High)'
          : 'Сесія Cursor AI Agent',
        engine,
        model: isAgy ? 'gemini-3.7-flash' : 'auto',
        mode: 'yolo',
        thinkingEffort: isAgy ? 'high' : 'medium',
        workspacePath: workspace,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Не вдалося створити чат');
    }

    const data = await res.json();
    this.sessions.unshift(data.session);
    this.renderSessions();
    this.selectSession(data.session.id);
    if (deviceId && deviceId !== this.activeDeviceId) {
      this.selectDevice(deviceId);
    }
    return data.session;
  }

  async sendPrompt() {
    // 1. Debounce protection against rapid double-clicks or multiple Enter triggers
    const now = Date.now();
    if (this._lastPromptSubmitTime && now - this._lastPromptSubmitTime < 500) {
      return false;
    }

    const text = this.promptInput.value.trim();
    if (!text) return false;

    // No chat selected → create Antigravity session by default
    if (!this.activeSessionId) {
      this._lastPromptSubmitTime = now;
      try {
        this.showToast('✨ Створюю чат Antigravity…');
        await this.ensureActiveSession('antigravity');
      } catch (err) {
        this.showToast(`❌ ${err.message || 'Не вдалося створити чат'}`, 4500);
        return false;
      }
    }

    this._lastPromptSubmitTime = now;
    this.promptInput.value = '';
    this.promptInput.style.height = 'auto';

    const session = this.sessions.find((s) => s.id === this.activeSessionId);

    // 2. If agent is currently executing/streaming, add prompt to QUEUE!
    if (this.isStreaming) {
      if (session) {
        session.promptQueue = session.promptQueue || [];
        // Prevent accidental duplicate enqueue of the same prompt in a row
        if (session.promptQueue.length > 0 && session.promptQueue[session.promptQueue.length - 1] === text) {
          console.warn('[Chat] Suppressed identical duplicate prompt in queue');
          return false;
        }
        session.promptQueue.push(text);
      }
      this.renderQueue();

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'agent:queue_prompt',
            payload: {
              sessionId: this.activeSessionId,
              prompt: text,
            },
          })
        );
      }

      this.showToast(`🕒 Повідомлення додано в чергу (#${(session && session.promptQueue && session.promptQueue.length) || 1})`);
      return true;
    }

    this.renderChatMessageElement('user', text);

    this.isStreaming = true;
    this.startAgentStallWatchdog();
    this.stopAgentBtn.style.display = 'inline-flex';
    this.sendBtn.disabled = false;
    if (this.sendShortcutHint) this.sendShortcutHint.innerText = 'Enter — додати в чергу';
    this.sendBtn.title = 'Додати повідомлення у чергу';
    this.voiceMode?.onAgentStart?.();

    // Immediately render assistant streaming placeholder with animated wave/spinner
    let assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    if (!assistantMsgEl) {
      assistantMsgEl = document.createElement('div');
      assistantMsgEl.className = 'message assistant streaming';
      assistantMsgEl.innerHTML = `
        <div class="message-avatar" style="background:var(--accent-primary); color:#fff; font-weight:700; font-size:10px;">AI</div>
        <div class="message-bubble-wrapper" style="flex:1; min-width:0;">
          <div class="message-bubble">
            <div class="agent-thinking-wrapper" style="display:flex; align-items:center; gap:8px; padding:4px 0; color:var(--text-secondary); font-size:12.5px;">
              <span class="thinking-spinner"></span>
              <span>Агент підключається та міркує...</span>
            </div>
          </div>
        </div>
      `;
      this.chatMessages.appendChild(assistantMsgEl);
    }

    if (this.chatMeta) {
      this.chatMeta.innerHTML = `<span style="color:var(--accent-primary); font-weight:600;"><span class="pulse-dot"></span> Агент думає та аналізує...</span>`;
    }

    this.scrollToBottom();

    const promptEngine = session && session.engine === 'antigravity' ? 'antigravity' : 'cursor';
    let effectiveModel = (this.chatModelSelect && this.chatModelSelect.value) || 
                         (this.modelSelect && this.modelSelect.value) || 
                         (session && session.model) || this.defaultModelFor(promptEngine);
    let effectiveEffort = (this.thinkingEffortSelect && this.thinkingEffortSelect.value) ||
                          (session && session.thinkingEffort) || 'medium';

    // Fresh AGY session defaults if selects still say auto
    if (session && session.engine === 'antigravity') {
      if (!effectiveModel || effectiveModel === 'auto') {
        effectiveModel = session.model || this.defaultModelFor('antigravity');
      }
      if (!effectiveEffort) {
        effectiveEffort = session.thinkingEffort || 'high';
      }
    }

    if (session) {
      session.model = effectiveModel;
      session.thinkingEffort = effectiveEffort;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:prompt',
          payload: {
            sessionId: this.activeSessionId,
            deviceId: (this.getActiveDevice() && this.getActiveDevice().id) || this.activeDeviceId,
            prompt: text,
            model: effectiveModel,
            mode: (session && session.mode) || this.modeSelect.value || 'yolo',
            workspacePath: (session && session.workspacePath) || this.workspaceInput.value,
            cursorChatId: session ? session.cursorChatId : undefined,
            thinkingEffort: effectiveEffort,
          },
        })
      );
      return true;
    }

    this.showToast('Немає зʼєднання з хабом', 4000);
    this.isStreaming = false;
    this.stopAgentStallWatchdog();
    this.stopAgentBtn.style.display = 'none';
    return false;
  }

  stopAgent() {
    if (!this.activeSessionId || !this.isStreaming) return;
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (session) {
      session.isStreaming = false;
      session.status = 'idle';
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent:abort', payload: { sessionId: this.activeSessionId } }));
    }
    this.handleAgentComplete(this.activeSessionId, undefined, { aborted: true });
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  openNewChatModal(preferredEngine = 'cursor') {
    const dev = this.getActiveDevice();
    this.currentSelectedEngine = preferredEngine;
    this.setModalEngine(preferredEngine);

    if (this.modalDeviceSelect) {
      this.modalDeviceSelect.innerHTML = '';
      this.devices.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.id;
        const isOnline = d.status === 'online';
        opt.innerText = `${isOnline ? '●' : '○'} ${d.name} (${d.os ? d.os.split(' ')[0] : 'Local'})`;
        if (d.id === this.activeDeviceId) {
          opt.selected = true;
        }
        this.modalDeviceSelect.appendChild(opt);
      });
      if (this.modalDeviceStatusBadge && dev) {
        const isOnline = dev.status === 'online';
        this.modalDeviceStatusBadge.innerText = isOnline ? '● Онлайн' : '○ Офлайн';
        this.modalDeviceStatusBadge.style.color = isOnline ? 'var(--success)' : 'var(--text-muted)';
      }
    }

    const defaultWs = (dev && dev.defaultWorkspace) || this.workspaceInput.value || '';
    if (this.modalWorkspaceInput) {
      this.modalWorkspaceInput.value = defaultWs;
    }

    if (this.modalSessionTitle) this.modalSessionTitle.value = '';
    if (this.modalSessionDesc) this.modalSessionDesc.value = '';

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

    if (this.modalModelSelect) {
      const engine = isAgy ? 'antigravity' : 'cursor';
      this.modalModelSelect.innerHTML = this.buildModelOptionsHtml(engine, this.defaultModelFor(engine));
      this.refreshCustomSelect(this.modalModelSelect);
    }
  }

  getDeviceModels(engine) {
    const dev = this.getActiveDevice();
    const all = (dev && dev.availableModels) || [];
    return all.filter((m) => m.engine === engine);
  }

  defaultModelFor(engine) {
    const models = this.getDeviceModels(engine);
    if (engine === 'antigravity') {
      const preferred = models.find((m) => m.id === 'gemini-3-pro') || models[0];
      return preferred ? preferred.id : 'gemini-3-pro';
    }
    const composer = models.find((m) => m.id === 'composer-2.5');
    if (composer) return composer.id;
    return models.length ? models[0].id : 'composer-2.5';
  }

  modelSupportsEffort(engine, modelId) {
    const model = this.getDeviceModels(engine).find((m) => m.id === modelId);
    return Boolean(model && model.supportsEffort);
  }

  refreshCustomSelect(selectEl) {
    const instance = selectEl && selectEl._customSelectInstance;
    if (!instance || instance.nativeMode || !instance.menu) return;
    instance.renderOptions();
  }

  buildModelOptionsHtml(engine, selectedId) {
    const models = this.getDeviceModels(engine);
    if (!models.length) {
      return '<option value="auto" selected>Auto (список моделей ще не завантажено)</option>';
    }
    const chosen = selectedId || this.defaultModelFor(engine);
    return models
      .map((m) => {
        const sel = m.id === chosen ? ' selected' : '';
        return `<option value="${this.escapeHtml(m.id)}"${sel}>${this.escapeHtml(m.label)}</option>`;
      })
      .join('');
  }

  syncEffortVisibility(engine, modelId) {
    const wrapper = document.getElementById('thinking-effort-wrapper');
    if (!wrapper) return;
    const supported = this.modelSupportsEffort(engine, modelId);
    wrapper.style.display = supported ? '' : 'none';
  }

  async submitNewChatModal() {
    const chosenDeviceId = (this.modalDeviceSelect && this.modalDeviceSelect.value) || (this.getActiveDevice() && this.getActiveDevice().id) || 'default';
    const chosenDevice = this.devices.find((d) => d.id === chosenDeviceId) || this.getActiveDevice();
    const isAgy = this.currentSelectedEngine === 'antigravity';
    const workspace = (this.modalWorkspaceInput && this.modalWorkspaceInput.value.trim()) || (chosenDevice && chosenDevice.defaultWorkspace) || '';
    const title = (this.modalSessionTitle && this.modalSessionTitle.value.trim()) || (isAgy ? 'Новий чат Antigravity' : 'Новий чат Cursor');
    const desc = (this.modalSessionDesc && this.modalSessionDesc.value.trim()) || (isAgy ? 'Сесія Google Antigravity (Gemini 3.7 Flash High)' : 'Сесія Cursor AI Agent');
    const model = (this.modalModelSelect && this.modalModelSelect.value) || this.defaultModelFor(isAgy ? 'antigravity' : 'cursor');
    const mode = (this.modalModeSelect && this.modalModeSelect.value) || 'yolo';
    const thinkingEffort = isAgy ? 'high' : 'medium';

    const newSession = {
      deviceId: chosenDeviceId,
      title,
      description: desc,
      engine: this.currentSelectedEngine,
      model,
      mode,
      thinkingEffort,
      workspacePath: workspace,
    };

    this.submitNewChatBtn.disabled = true;
    this.submitNewChatBtn.innerHTML = '<span>Створення...</span>';

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
        if (chosenDeviceId && chosenDeviceId !== this.activeDeviceId) {
          this.selectDevice(chosenDeviceId);
        }
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
      this.submitNewChatBtn.innerHTML = '<span>Створити чат</span>';
    }
  }

  openImportModal() {
    this.importModal.style.display = 'flex';
    this.selectedTranscriptFilePath = '';
    this.selectedTranscriptContent = '';
    this.importSanitizationReport.style.display = 'none';
    if (this.importSearchInput) this.importSearchInput.value = '';
    this.loadLocalTranscripts();
  }

  loadLocalTranscripts() {
    this.localTranscriptsList.innerHTML = '<p class="placeholder-text" style="padding:16px; text-align:center;">Сканування сесій на комп\'ютері...</p>';
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

  filterTranscriptsList() {
    const q = (this.importSearchInput ? this.importSearchInput.value : '').toLowerCase().trim();
    const filtered = this.loadedTranscripts.filter(
      (t) => !q || (t.title && t.title.toLowerCase().includes(q)) || (t.workspacePath && t.workspacePath.toLowerCase().includes(q)) || (t.filePath && t.filePath.toLowerCase().includes(q))
    );
    this.renderFilteredTranscripts(filtered);
  }

  renderLocalTranscripts() {
    this.loadedTranscripts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    this.filterTranscriptsList();
  }

  renderFilteredTranscripts(transcripts) {
    if (this.transcriptsCountBadge) {
      this.transcriptsCountBadge.innerText = `${transcripts.length} знайдено`;
    }

    if (!transcripts || transcripts.length === 0) {
      this.localTranscriptsList.innerHTML = `
        <div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">
          Сесій не знайдено за вашим фільтром.<br>
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

      let badge = '<span class="file-badge file-badge-md">AGY</span>';
      if (t.source === 'claude_code') {
        badge = '<span class="file-badge file-badge-ts">CLAUDE</span>';
      } else if (t.source === 'cursor') {
        badge = '<span class="file-badge file-badge-js">CURSOR</span>';
      }

      const wsDisplay = t.workspacePath ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${this.escapeHtml(t.workspacePath)}</div>` : '';

      item.innerHTML = `
        <div class="session-info">
          <div class="session-header-line" style="display:flex; align-items:center; gap:6px;">
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
        this.selectedTranscriptId = t.id;
        this.importSessionTitle.value = t.title.slice(0, 45);

        // Auto-select matching engine
        if (this.importTargetEngine) {
          this.importTargetEngine.value = t.source === 'antigravity' ? 'antigravity' : 'cursor';
        }

        // Check if an existing session is already linked to this local session
        const existing = this.sessions.find(
          (s) => (t.id && (s.cursorChatId === t.id || s.id === t.id)) || (s.title === t.title && s.workspacePath === t.workspacePath)
        );

        if (existing) {
          this.executeImportBtn.innerHTML = '<span>▶ Продовжити існуючу сесію</span>';
        } else {
          this.executeImportBtn.innerHTML = '<span>▶ Підключити та продовжити сесію</span>';
        }

        // Set immediate valid payload
        this.selectedTranscriptContent = JSON.stringify({
          title: t.title,
          filePath: t.filePath,
          workspacePath: t.workspacePath,
          source: t.source,
          messageCount: t.messageCount,
          sourceSessionId: t.id,
        });

        if (this.importSanitizationReport) {
          this.importSanitizationReport.style.display = 'block';
          if (this.importSanitizedCount) {
            this.importSanitizedCount.innerText = `Сесію обрано • ${t.messageCount || 1} повідомлень • ${t.source.toUpperCase()}`;
          }
        }

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
    let content = '';
    const isAuto = this.importTabAuto.classList.contains('active');

    if (isAuto) {
      if (!this.selectedTranscriptContent && !this.selectedTranscriptFilePath) {
        alert('Будь ласка, оберіть сесію зі списку вище');
        return;
      }
      content = this.selectedTranscriptContent || JSON.stringify({ filePath: this.selectedTranscriptFilePath });
    } else {
      content = this.importPasteInput.value.trim();
      if (!content) {
        alert('Вставте текст або JSONL для імпорту');
        return;
      }
    }

    this.executeImportBtn.disabled = true;
    this.executeImportBtn.innerHTML = '<span>Підключення...</span>';

    try {
      const res = await fetch('/api/sessions/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          rawContent: content,
          title: this.importSessionTitle.value.trim(),
          deviceId: this.activeDeviceId,
          engine: this.importTargetEngine.value,
          workspacePath: this.selectedTranscriptWorkspace || this.workspaceInput.value,
          sourceSessionId: this.selectedTranscriptId,
          filePath: this.selectedTranscriptFilePath,
        }),
      });

      const data = await res.json();
      if (res.ok && data.session) {
        const existingIdx = this.sessions.findIndex((s) => s.id === data.session.id);
        if (existingIdx >= 0) {
          this.sessions[existingIdx] = data.session;
        } else {
          this.sessions.unshift(data.session);
        }
        this.renderSessions();
        this.selectSession(data.session.id);
        this.importModal.style.display = 'none';
        this.showToast(data.reusedExisting ? `✨ Продовжуємо сесію: ${data.session.title}` : `✨ Сесію підключено: ${data.session.title}`);
      } else {
        alert(data.error || 'Помилка при підключенні сесії');
      }
    } catch {
      alert('Помилка з\'єднання при підключенні');
    } finally {
      this.executeImportBtn.disabled = false;
      this.executeImportBtn.innerHTML = '<span>▶ Продовжити сесію</span>';
    }
  }

  loadFilesTree(dirPath) {
    const activeDev = this.getActiveDevice();
    const ws = dirPath || (this.workspaceInput && this.workspaceInput.value) || (activeDev && activeDev.defaultWorkspace) || '';
    
    if (!ws) {
      if (this.filesTree) {
        this.filesTree.innerHTML = '<p class="placeholder-text" style="padding:24px; text-align:center; color:var(--text-muted);">Вкажіть робочу папку (Workspace) у бічній панелі</p>';
      }
      return;
    }

    this.activeOpenedDirectory = ws;
    this.renderBreadcrumbs(ws);
    if (this.filesTree) {
      this.filesTree.innerHTML = '<p class="placeholder-text" style="padding:24px; text-align:center;">Завантаження файлів...</p>';
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.pendingFsReqId = Math.random().toString(36).substring(2, 8);
      const reqId = this.pendingFsReqId;
      this.ws.send(
        JSON.stringify({
          type: 'fs:list',
          payload: {
            reqId: this.pendingFsReqId,
            dirPath: ws,
            workspacePath: this.getWorkspaceRoot() || ws,
            deviceId: this.activeDeviceId,
          },
        })
      );

      // Safety timeout guard
      setTimeout(() => {
        if (this.pendingFsReqId === reqId && this.filesTree && this.filesTree.innerText.includes('Завантаження')) {
          this.filesTree.innerHTML = `
            <div style="padding:24px; text-align:center; color:var(--text-muted); font-size:12px;">
              <p style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">Не вдалося отримати список файлів</p>
              <p style="font-size:11px; margin-bottom:12px;">Перевірте чи активна машина в мережі та папка існує</p>
              <button class="btn btn-secondary btn-sm" onclick="window.app.loadFilesTree()">Спробувати знову</button>
            </div>
          `;
        }
      }, 5000);
    } else if (this.filesTree) {
      this.filesTree.innerHTML = '<p class="placeholder-text" style="padding:24px; text-align:center; color:var(--text-muted);">Немає підключення до сервера (WebSocket)</p>';
    }
  }

  displayFiles(items, currentPath) {
    if (!items || items.length === 0) {
      this.filesTree.innerHTML = '<p class="placeholder-text" style="padding:24px; text-align:center;">Папка порожня</p>';
      this.filesCountBadge.innerText = '0 файлів';
      return;
    }

    this.filesCountBadge.innerText = `${items.length} файлів`;
    this.filesTree.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'tree-list';

    const sorted = [...items].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'tree-node';
      const folderSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary); flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
      const icon = item.isDirectory ? folderSvg : this.getFileIcon(item.name);
      const sizeText = item.size ? this.formatFileSize(item.size) : '';

      el.innerHTML = `
        <div class="node-left">
          ${icon}
          <span style="font-weight: ${item.isDirectory ? '600' : '400'}; margin-left: 2px;">${this.escapeHtml(item.name)}</span>
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
        return '<span class="file-badge file-badge-ts">TS</span>';
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return '<span class="file-badge file-badge-js">JS</span>';
      case 'json':
        return '<span class="file-badge file-badge-json">JSON</span>';
      case 'html':
      case 'htm':
        return '<span class="file-badge file-badge-html">HTML</span>';
      case 'css':
      case 'scss':
      case 'less':
        return '<span class="file-badge file-badge-css">CSS</span>';
      case 'py':
        return '<span class="file-badge file-badge-py">PY</span>';
      case 'md':
      case 'markdown':
        return '<span class="file-badge file-badge-md">MD</span>';
      case 'sh':
      case 'ps1':
      case 'cmd':
      case 'bat':
        return '<span class="file-badge file-badge-sh">SH</span>';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'webp':
      case 'ico':
        return '<span class="file-badge file-badge-img">IMG</span>';
      case 'env':
      case 'gitignore':
      case 'dockerignore':
      case 'yml':
      case 'yaml':
      case 'toml':
        return '<span class="file-badge file-badge-cfg">CFG</span>';
      default:
        return '<span class="file-badge file-badge-doc">FILE</span>';
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
    this.previewFileIcon.innerHTML = this.getFileIcon(fileName);

    this.filesTreePanel.classList.add('hide-on-mobile');
    this.filePreviewPanel.classList.add('show-on-mobile');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.pendingFileReqId = Math.random().toString(36).substring(2, 8);
      this.ws.send(
        JSON.stringify({
          type: 'fs:read_file',
          payload: {
            reqId: this.pendingFileReqId,
            filePath,
            workspacePath: this.getWorkspaceRoot() || this.activeOpenedDirectory,
            deviceId: this.activeDeviceId,
          },
        })
      );
    }
  }

  displayFileContent(filePath, content, size, error) {
    if (error) {
      this.fileEmptyState.style.display = 'flex';
      this.codeEditorContainer.style.display = 'none';
      this.mdRenderedContainer.style.display = 'none';
      this.imgPreviewContainer.style.display = 'none';
      this.previewFileSize.innerText = 'Помилка';
      alert(`Не вдалося відкрити файл: ${error}`);
      return;
    }

    this.activeOpenedContent = content;
    const effectiveSize =
      typeof size === 'number' && size > 0
        ? size
        : typeof content === 'string'
          ? new TextEncoder().encode(content).length
          : 0;
    this.previewFileSize.innerText = `• ${this.formatFileSize(effectiveSize)}`;

    const ext = filePath.split('.').pop().toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);
    const isMd = ['md', 'markdown'].includes(ext);

    this.fileEmptyState.style.display = 'none';

    if (isImage) {
      this.codeEditorContainer.style.display = 'none';
      this.mdRenderedContainer.style.display = 'none';
      this.imgPreviewContainer.style.display = 'flex';
      this.imgPreviewEl.src = `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${content}`;
      this.mdPreviewToggleBtn.style.display = 'none';
      this.copyFileContentBtn.style.display = 'none';
      this.askAgentFileBtn.style.display = 'none';
      return;
    }

    this.imgPreviewContainer.style.display = 'none';
    this.copyFileContentBtn.style.display = 'inline-flex';
    this.askAgentFileBtn.style.display = 'inline-flex';

    if (isMd) {
      this.mdPreviewToggleBtn.style.display = 'inline-flex';
      if (this.isMarkdownMode) {
        this.codeEditorContainer.style.display = 'none';
        this.mdRenderedContainer.style.display = 'block';
        this.mdRenderedContainer.innerHTML = window.marked
          ? this.renderMarkdownSafe(content)
          : this.escapeHtml(content);
        return;
      }
    } else {
      this.mdPreviewToggleBtn.style.display = 'none';
    }

    this.mdRenderedContainer.style.display = 'none';
    this.codeEditorContainer.style.display = 'flex';

    const lines = content.split('\n');
    this.lineNumbersGutter.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');

    const langMap = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
      py: 'python', pyw: 'python',
      json: 'json', jsonc: 'json',
      html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
      css: 'css', scss: 'scss', sass: 'scss', less: 'less',
      sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', bat: 'dos', cmd: 'dos',
      go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
      c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'c', hpp: 'cpp',
      cs: 'csharp', sql: 'sql', md: 'markdown', markdown: 'markdown',
      yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', env: 'bash',
      dockerfile: 'dockerfile', vue: 'xml', svelte: 'xml', php: 'php',
      rb: 'ruby', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r',
    };

    const targetLang = langMap[ext];
    let formattedHtml = '';

    if (window.hljs) {
      try {
        if (targetLang && hljs.getLanguage(targetLang)) {
          formattedHtml = hljs.highlight(content, { language: targetLang, ignoreIllegals: true }).value;
        } else {
          formattedHtml = hljs.highlightAuto(content).value;
        }
      } catch (err) {
        formattedHtml = this.escapeHtml(content);
      }
    } else {
      formattedHtml = this.escapeHtml(content);
    }

    this.previewCodeBlock.innerHTML = formattedHtml;
  }

  toggleMarkdownPreview() {
    this.isMarkdownMode = !this.isMarkdownMode;
    this.mdPreviewToggleBtn.innerHTML = this.isMarkdownMode
      ? '<span>Код файлу</span>'
      : '<span>Форматований вигляд</span>';
    this.displayFileContent(this.activeOpenedPath, this.activeOpenedContent, this.activeOpenedContent.length);
  }

  renderBreadcrumbs(fullPath) {
    if (!fullPath) return;
    const parts = fullPath.split(/[/\\]/).filter(Boolean);
    let accum = '';

    this.fsBreadcrumbs.innerHTML = '';
    this.fsBreadcrumbs.classList.add('breadcrumbs-rtl-safe');
    const inner = document.createElement('div');
    inner.className = 'breadcrumbs-inner';

    parts.forEach((p, idx) => {
      // Keep Windows drive letter style (C:) then path segments
      if (/^[A-Za-z]:$/.test(p)) {
        accum = p + '/';
      } else {
        accum += (accum && !accum.endsWith('/') ? '/' : '') + p;
      }
      const targetPath = accum.replace(/\/$/, '') || p;
      const span = document.createElement('span');
      span.className = 'breadcrumb-segment' + (idx === parts.length - 1 ? ' current' : '');
      span.innerText = p;
      span.title = targetPath;
      span.addEventListener('click', () => {
        this.loadFilesTree(targetPath);
      });
      inner.appendChild(span);

      if (idx < parts.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.innerText = '/';
        inner.appendChild(sep);
      }
    });
    this.fsBreadcrumbs.appendChild(inner);
  }

  filterFilesTree(query) {
    const q = (query || '').toLowerCase().trim();
    this.filesTree.querySelectorAll('.tree-node').forEach((node) => {
      const text = node.innerText.toLowerCase();
      node.style.display = !q || text.includes(q) ? 'flex' : 'none';
    });
  }

  navigateFsUp() {
    if (!this.activeOpenedDirectory) return;
    const root = (this.getWorkspaceRoot() || '').replace(/[/\\]+$/, '');
    const parent = this.activeOpenedDirectory.replace(/[/\\][^/\\]+$/, '');
    if (!parent || parent === this.activeOpenedDirectory) return;
    if (root) {
      const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
      if (!norm(parent).startsWith(norm(root))) {
        this.loadFilesTree(root);
        return;
      }
    }
    this.loadFilesTree(parent);
  }

  executeTerminalCommand() {
    const cmd = this.terminalInput.value.trim();
    if (!cmd) return;

    this.termHistory.push(cmd);
    this.termHistoryIndex = -1;
    this.terminalInput.value = '';

    this.appendTerminalOutput(`\n\x1b[34m❯ ${cmd}\x1b[0m\n`);

    // Resolve effective CWD (fallback chain: terminalCwd → workspaceInput → activeDevice default)
    const activeDev = this.getActiveDevice();
    let effectiveCwd = this.termCurrentPath || this.workspaceInput.value || (activeDev && activeDev.defaultWorkspace) || '';

    // Handle cd commands client-side: resolve new path and update display
    const cdMatch = cmd.match(/^(?:cd|Set-Location|sl)\s+(.*)/i);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^["']|["']$/g, ''); // strip quotes
      let newPath = this.resolvePath(effectiveCwd, target);
      // Still send the command to the server so it actually executes on remote
      // But track the new path locally
      this.termCurrentPath = newPath;
      this.updateTerminalPrompt(newPath);
      // Also broadcast pwd after cd to confirm
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'terminal:exec',
            payload: { command: cmd, cwd: effectiveCwd, deviceId: this.activeDeviceId },
          }));
        }
      }, 50);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'terminal:exec',
          payload: { command: cmd, cwd: effectiveCwd, deviceId: this.activeDeviceId },
        })
      );
    }
  }

  /**
   * Resolve a cd target path relative to current dir.
   * Works for both Windows backslash and Unix slash paths.
   */
  resolvePath(cwd, target) {
    if (!target || target === '.') return cwd;

    // Absolute paths (Windows or Unix)
    if (/^[A-Za-z]:[\\\/]/.test(target) || target.startsWith('/')) {
      return target.replace(/[\\\/]+$/, '');
    }

    // ~ means device default workspace
    if (target === '~' || target === '%USERPROFILE%' || target === '$HOME') {
      const dev = this.getActiveDevice();
      return (dev && dev.defaultWorkspace) || cwd;
    }

    const sep = cwd.includes('\\') ? '\\' : '/';
    let parts = cwd.split(/[\\\/]/).filter(Boolean);

    // Handle drive letter for Windows (e.g. "C:")
    const driveLetter = /^[A-Za-z]:$/.test(parts[0]) ? parts[0] : null;

    const targets = target.split(/[\\\/]/);
    for (const t of targets) {
      if (t === '..') {
        if (parts.length > (driveLetter ? 1 : 0)) {
          parts.pop();
        }
      } else if (t && t !== '.') {
        parts.push(t);
      }
    }

    // Rebuild path
    let result = parts.join(sep);
    if (driveLetter && !result.startsWith(driveLetter)) {
      result = driveLetter + sep + result;
    } else if (!driveLetter && cwd.startsWith('/')) {
      result = '/' + result;
    }
    return result;
  }

  updateTerminalPrompt(path) {
    // Extract short display name
    const parts = path.split(/[\\\/]/).filter(Boolean);
    const displayName = parts.slice(-2).join('/') || path;
    this.termDisplayPath = displayName;
    if (this.termPromptPath) {
      this.termPromptPath.innerText = displayName;
    }
  }

  // ============== WORKSPACE / RECENT FOLDERS ==============

  applyWorkspace(path) {
    const cleaned = path.trim();
    if (!cleaned) return;

    this.workspaceInput.value = cleaned;
    this.termCurrentPath = cleaned;
    this.updateTerminalPrompt(cleaned);

    // Save to recent folders
    this.addRecentFolder(cleaned);
    this.recentFoldersDropdown.style.display = 'none';

    this.showToast(`📂 Робоча папка: ${cleaned.split(/[\\\/]/).pop() || cleaned}`);
  }

  addRecentFolder(path) {
    if (!path) return;
    this.recentFolders = this.recentFolders.filter((f) => f !== path);
    this.recentFolders.unshift(path);
    if (this.recentFolders.length > 8) this.recentFolders = this.recentFolders.slice(0, 8);
    localStorage.setItem('agentremote_recent_folders', JSON.stringify(this.recentFolders));
    this.renderRecentFolders();
  }

  toggleRecentFolders() {
    const isVisible = this.recentFoldersDropdown.style.display !== 'none';
    if (isVisible) {
      this.recentFoldersDropdown.style.display = 'none';
    } else {
      this.renderRecentFolders();
      this.recentFoldersDropdown.style.display = 'block';
    }
  }

  renderRecentFolders() {
    if (!this.recentFoldersList) return;
    if (this.recentFolders.length === 0) {
      this.recentFoldersList.innerHTML = `<div style="padding:10px; font-size:11px; color:var(--text-muted); text-align:center;">Немає нещодавніх папок</div>`;
      return;
    }

    this.recentFoldersList.innerHTML = '';
    this.recentFolders.forEach((folder) => {
      const item = document.createElement('div');
      item.className = 'recent-folder-item';
      const name = folder.split(/[\\\/]/).filter(Boolean).pop() || folder;
      item.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis;" title="${this.escapeHtml(folder)}">${this.escapeHtml(name)}</span>
        <span style="font-size:10px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; max-width:110px; direction:rtl;">${this.escapeHtml(folder)}</span>
      `;
      item.addEventListener('click', () => {
        this.workspaceInput.value = folder;
        this.applyWorkspace(folder);
      });
      this.recentFoldersList.appendChild(item);
    });
  }

  appendTerminalOutput(data) {
    const pre = document.createElement('span');
    pre.innerHTML = this.ansiToHtml(data);
    this.terminalOutput.appendChild(pre);
    this.terminalScreen.scrollTop = this.terminalScreen.scrollHeight;
  }

  ansiToHtml(text) {
    return this.escapeHtml(text)
      .replace(/\x1b\[34m/g, '<span style="color:#38bdf8;">')
      .replace(/\x1b\[32m/g, '<span style="color:#4ade80;">')
      .replace(/\x1b\[31m/g, '<span style="color:#f87171;">')
      .replace(/\x1b\[33m/g, '<span style="color:#fbbf24;">')
      .replace(/\x1b\[0m/g, '</span>')
      .replace(/\n/g, '<br>');
  }

  switchTab(tabName) {
    this.navTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));
    this.tabContents.forEach((c) => c.classList.toggle('active', c.id === `tab-${tabName}`));

    if (this.appSidebar && this.appSidebar.classList.contains('open')) {
      this.appSidebar.classList.remove('open');
      if (this.sidebarBackdrop) this.sidebarBackdrop.classList.remove('show');
    }

    if (tabName === 'files') {
      this.loadFilesTree();
    }
  }

  showToast(msg, durationMs = 3200) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
  }

  showOAuthModal(url) {
    if (confirm(`Потрібна авторизація Cursor! Відкрити сторінку входу?\n\n${url}`)) {
      window.open(url, '_blank');
    }
  }

  triggerCursorLogin() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent:trigger_auth', payload: { deviceId: this.activeDeviceId } }));
      this.showToast('🚀 Запущено процес авторизації Cursor...');
    }
  }

  async syncCurrentChatWithIde() {
    if (!this.activeSessionId) return;
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) return;

    this.showToast('🔄 Синхронізація з локальною IDE...');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'sessions:force_sync',
          payload: { sessionId: this.activeSessionId },
        })
      );
    }

    try {
      const res = await fetch(`/api/sessions/${this.activeSessionId}/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        setTimeout(() => this.loadSessions(), 600);
      }
    } catch {}
  }

  initCustomSelects() {
    const selects = [
      { el: this.chatModelSelect, opts: { isSm: true } },
      { el: this.thinkingEffortSelect, opts: { isSm: true } },
      { el: this.modelSelect, opts: { fullWidth: true } },
      { el: this.modeSelect, opts: { fullWidth: true } },
      { el: this.deviceSelect, opts: { fullWidth: true } },
      { el: this.modalDeviceSelect, opts: { fullWidth: true } },
      { el: this.modalModelSelect, opts: { fullWidth: true } },
      { el: this.modalModeSelect, opts: { fullWidth: true } },
      { el: document.getElementById('import-target-engine'), opts: { fullWidth: true } },
    ];

    selects.forEach(({ el, opts }) => {
      if (el) new CustomSelect(el, opts);
    });
  }

  escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  sanitizeMarkdownHtml(html) {
    if (!html) return '';
    if (window.DOMPurify) {
      return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel'],
      });
    }
    // Fallback: strip tags if purify missing
    const tmp = document.createElement('div');
    tmp.textContent = String(html);
    return tmp.innerHTML;
  }

  renderMarkdownSafe(markdown) {
    if (!markdown) return '';
    if (!window.marked) return this.escapeHtml(markdown).replace(/\n/g, '<br>');
    return this.sanitizeMarkdownHtml(marked.parse(markdown));
  }

  getWorkspaceRoot() {
    return (this.workspaceInput && this.workspaceInput.value.trim()) ||
      (this.getActiveDevice() && this.getActiveDevice().defaultWorkspace) ||
      '';
  }

  closeMobileSidebar() {
    if (!this.appSidebar) return;
    this.appSidebar.classList.remove('open');
    if (this.sidebarBackdrop) this.sidebarBackdrop.classList.remove('show');
  }

  async deleteDevice(deviceId) {
    if (!deviceId) return;
    const ok = confirm(`Видалити пристрій «${deviceId}» зі списку?`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.showToast(`❌ ${data.error || 'Не вдалося видалити'}`, 4000);
        return;
      }
      this.devices = this.devices.filter((d) => d.id !== deviceId);
      if (this.activeDeviceId === deviceId) {
        this.activeDeviceId = this.devices[0]?.id || null;
      }
      this.renderDevices();
      this.showToast('🗑️ Пристрій видалено');
    } catch (err) {
      this.showToast(`❌ ${err.message || 'Помилка видалення'}`, 4000);
    }
  }
}

class CustomSelect {
  constructor(selectEl, options = {}) {
    this.select = selectEl;
    if (!this.select || this.select._customSelectInstance) return;
    this.select._customSelectInstance = this;
    this.options = options;
    this.isSm = this.select.classList.contains('custom-select-sm') || options.isSm;
    this.isFullWidth = options.fullWidth || this.select.classList.contains('full-width');
    this.alignRight = options.alignRight;
    this._ignoreDocCloseUntil = 0;

    this.init();
  }

  init() {
    // Mobile/touch: native OS picker is reliable; custom menus get clipped / click-through.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.matchMedia('(max-width: 768px)').matches;
    if (coarse || narrow) {
      this.nativeMode = true;
      this.select.classList.add('mobile-native-select');
      if (this.isFullWidth) this.select.classList.add('mobile-native-select-full');
      this.select.style.display = '';
      this.select.removeAttribute('hidden');
      return;
    }

    this.wrapper = document.createElement('div');
    this.wrapper.className = `custom-dropdown-wrapper ${this.isFullWidth ? 'full-width' : ''} ${this.alignRight ? 'align-right' : ''}`;

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = `custom-dropdown-trigger ${this.isSm ? 'custom-dropdown-trigger-sm' : ''}`;
    this.trigger.innerHTML = `
      <span class="custom-dropdown-label"></span>
      <svg class="custom-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
    `;
    this.label = this.trigger.querySelector('.custom-dropdown-label');

    this.menu = document.createElement('div');
    this.menu.className = 'custom-dropdown-menu';

    this.wrapper.appendChild(this.trigger);
    this.wrapper.appendChild(this.menu);

    // Hide original select and insert wrapper
    this.select.style.display = 'none';
    this.select.parentNode.insertBefore(this.wrapper, this.select.nextSibling);

    this.trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });

    this.renderOptions();

    // Listen to changes on native select
    this.select.addEventListener('change', () => {
      this.updateSelectedLabel();
    });

    // Observer for programmatic option changes
    this.observer = new MutationObserver(() => {
      this.renderOptions();
    });
    this.observer.observe(this.select, { childList: true, subtree: true, attributes: true });
  }

  renderOptions() {
    this.menu.innerHTML = '';
    const optgroups = this.select.querySelectorAll('optgroup');

    if (optgroups.length > 0) {
      const directOptions = Array.from(this.select.children).filter((c) => c.tagName === 'OPTION');
      directOptions.forEach((opt) => this.addOptionItem(opt, this.menu));

      optgroups.forEach((group) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'custom-dropdown-group';
        groupEl.innerHTML = `<div class="custom-dropdown-group-title">${group.label}</div>`;
        group.querySelectorAll('option').forEach((opt) => this.addOptionItem(opt, groupEl));
        this.menu.appendChild(groupEl);
      });
    } else {
      this.select.querySelectorAll('option').forEach((opt) => {
        this.addOptionItem(opt, this.menu);
      });
    }

    this.updateSelectedLabel();
  }

  addOptionItem(optionEl, container) {
    const item = document.createElement('div');
    const isSelected = optionEl.value === this.select.value;
    item.className = `custom-dropdown-item ${isSelected ? 'selected' : ''}`;
    item.dataset.value = optionEl.value;
    item.innerHTML = `
      <span class="custom-dropdown-item-label">${optionEl.textContent}</span>
      <span class="custom-dropdown-item-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
    `;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select.value = optionEl.value;
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
      this.updateSelectedLabel();
      this.close();
    });

    container.appendChild(item);
  }

  updateSelectedLabel() {
    const selectedOpt = this.select.options[this.select.selectedIndex];
    if (selectedOpt) {
      const full = selectedOpt.textContent || '';
      const short = full
        .replace(/^✨\s*/, '')
        .replace(/^🧠\s*|^🚀\s*|^⚡\s*|^🚫\s*/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      this.label.textContent = window.innerWidth <= 480 ? short || full : full;
      this.label.title = full;
    } else {
      this.label.textContent = 'Оберіть...';
    }

    this.menu.querySelectorAll('.custom-dropdown-item').forEach((item) => {
      item.classList.toggle('selected', item.dataset.value === this.select.value);
    });
  }

  toggle() {
    if (this.nativeMode) return;
    if (this.wrapper.classList.contains('open')) {
      this.close();
    } else {
      this.open();
    }
  }

  positionPortalMenu() {
    const rect = this.trigger.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;
    const menuHeight = Math.min(isMobile ? 280 : 320, this.menu.scrollHeight || 240);

    if (isMobile) {
      // Bottom sheet: full-width, above composer, always tappable
      const sheetH = Math.min(menuHeight, Math.floor(window.innerHeight * 0.45));
      this.menu.style.position = 'fixed';
      this.menu.style.left = '8px';
      this.menu.style.right = '8px';
      this.menu.style.width = 'auto';
      this.menu.style.minWidth = '0';
      this.menu.style.maxWidth = 'none';
      this.menu.style.bottom = '8px';
      this.menu.style.top = 'auto';
      this.menu.style.maxHeight = `${sheetH}px`;
      this.menu.style.zIndex = '100000';
      this.wrapper.classList.remove('open-upwards');
      return;
    }

    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + 12 && rect.top > menuHeight + 12;
    const width = Math.max(rect.width, this.isSm ? 180 : 220);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.right - width);
    }
    const top = openUp ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6;
    this.menu.style.position = 'fixed';
    this.menu.style.left = `${Math.round(left)}px`;
    this.menu.style.top = `${Math.round(top)}px`;
    this.menu.style.bottom = 'auto';
    this.menu.style.right = 'auto';
    this.menu.style.width = `${Math.round(width)}px`;
    this.menu.style.minWidth = `${Math.round(width)}px`;
    this.menu.style.zIndex = '100000';
    this.wrapper.classList.toggle('open-upwards', openUp);
  }

  applyOpenVisibility(on) {
    if (!this.menu) return;
    if (on) {
      this.menu.style.setProperty('opacity', '1', 'important');
      this.menu.style.setProperty('visibility', 'visible', 'important');
      this.menu.style.setProperty('pointer-events', 'auto', 'important');
      this.menu.style.setProperty('transform', 'none', 'important');
    } else {
      this.menu.style.removeProperty('opacity');
      this.menu.style.removeProperty('visibility');
      this.menu.style.removeProperty('pointer-events');
      this.menu.style.removeProperty('transform');
    }
  }

  open() {
    if (this.nativeMode || !this.wrapper) return;

    document.querySelectorAll('.custom-dropdown-wrapper.open').forEach((w) => {
      const inst = w._customSelectRef;
      if (inst && inst !== this) inst.close();
      else w.classList.remove('open');
    });

    this.wrapper._customSelectRef = this;
    document.body.appendChild(this.menu);
    this.menu.classList.add('portal-open', 'is-open');
    this.wrapper.classList.add('open');
    this.positionPortalMenu();
    this.applyOpenVisibility(true);
    this._ignoreDocCloseUntil = Date.now() + 350;

    this._onReposition = () => {
      if (this.wrapper.classList.contains('open')) this.positionPortalMenu();
    };
    window.addEventListener('resize', this._onReposition);
    window.addEventListener('scroll', this._onReposition, true);
  }

  close() {
    if (this.nativeMode || !this.wrapper) return;
    this.wrapper.classList.remove('open');
    this.menu.classList.remove('is-open', 'portal-open');
    this.applyOpenVisibility(false);
    if (this._onReposition) {
      window.removeEventListener('resize', this._onReposition);
      window.removeEventListener('scroll', this._onReposition, true);
      this._onReposition = null;
    }
    if (this.menu.parentElement === document.body) {
      this.wrapper.appendChild(this.menu);
    }
    this.menu.style.position = '';
    this.menu.style.left = '';
    this.menu.style.top = '';
    this.menu.style.width = '';
    this.menu.style.minWidth = '';
    this.menu.style.maxWidth = '';
    this.menu.style.maxHeight = '';
    this.menu.style.right = '';
    this.menu.style.bottom = '';
    this.menu.style.zIndex = '';
  }
}

// Global click & escape listeners to dismiss custom dropdowns
document.addEventListener('click', (e) => {
  if (e.target.closest('.custom-dropdown-wrapper') || e.target.closest('.custom-dropdown-menu')) {
    return;
  }
  document.querySelectorAll('.custom-dropdown-wrapper.open').forEach((w) => {
    const inst = w._customSelectRef;
    if (inst && Date.now() < (inst._ignoreDocCloseUntil || 0)) return;
    if (inst) inst.close();
    else w.classList.remove('open');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.custom-dropdown-wrapper.open').forEach((w) => {
      const inst = w._customSelectRef;
      if (inst) inst.close();
      else w.classList.remove('open');
    });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  window.app = new AgentRemoteApp();
});
