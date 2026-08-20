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

function ensureMessageBlocks(msg) {
  if (!msg.blocks) msg.blocks = [];
  return msg.blocks;
}

function appendTextToMessageBlocks(msg, payload) {
  const blocks = ensureMessageBlocks(msg);
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text') {
    last.content = applyStreamText(last.content, payload);
  } else {
    const initial = applyStreamText('', payload);
    if (initial) blocks.push({ type: 'text', content: initial });
  }
  msg.content = applyStreamText(msg.content || '', payload);
}

function appendToolToMessageBlocks(msg, toolCall) {
  const blocks = ensureMessageBlocks(msg);
  if (!blocks.some((b) => b.type === 'tool' && b.toolCallId === toolCall.id)) {
    blocks.push({ type: 'tool', toolCallId: toolCall.id });
  }
}

function getRenderableMessageBlocks(msg) {
  if (msg.blocks && msg.blocks.length > 0) return msg.blocks;
  const legacy = [];
  if (msg.content) legacy.push({ type: 'text', content: msg.content });
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      legacy.push({ type: 'tool', toolCallId: tc.id });
    }
  }
  return legacy;
}

function isGeminiModelId(model) {
  if (!model) return false;
  const id = String(model).replace(/\[effort=.*?\]/gi, '').trim();
  return /^gemini/i.test(id);
}

function isUsageLimitError(text) {
  return Boolean(text && /usage limit|spend limit|you've hit your usage limit/i.test(text));
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

    // Projects State
    this.projects = [];
    this.activeProjectId = localStorage.getItem('agentremote_active_project_id') || 'all';
    this.editingProjectId = null;
    this.selectedProjectIcon = '📁';
    this.selectedProjectColor = '#38bdf8';

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
    this.projectList = document.getElementById('project-list');
    this.newProjectBtn = document.getElementById('new-project-btn');
    this.sessionListHeaderTitle = document.getElementById('session-list-header-title');
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
    this.chatPinBtn = document.getElementById('chat-pin-btn');
    this.chatProjectBadge = document.getElementById('chat-project-badge');
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

    // Artifact Viewer Elements
    this.sessionArtifactsBtn = document.getElementById('session-artifacts-btn');
    this.sessionArtifactsCount = document.getElementById('session-artifacts-count');
    this.chatArtifactViewer = document.getElementById('chat-artifact-viewer');
    this.artifactViewerIcon = document.getElementById('artifact-viewer-icon');
    this.artifactViewerTitle = document.getElementById('artifact-viewer-title');
    this.artifactViewerPath = document.getElementById('artifact-viewer-path');
    this.artifactViewModeToggle = document.getElementById('artifact-view-mode-toggle');
    this.artifactCopyBtn = document.getElementById('artifact-copy-btn');
    this.artifactDownloadBtn = document.getElementById('artifact-download-btn');
    this.artifactCloseBtn = document.getElementById('artifact-close-btn');
    this.artifactRenderedContent = document.getElementById('artifact-rendered-content');
    this.artifactRawContent = document.getElementById('artifact-raw-content');
    this.artifactRawCode = document.getElementById('artifact-raw-code');

    this.sessionArtifactsModal = document.getElementById('session-artifacts-modal');
    this.sessionArtifactsList = document.getElementById('session-artifacts-list');
    this.closeArtifactsModalBtn = document.getElementById('close-artifacts-modal-btn');
    this.cancelArtifactsModalBtn = document.getElementById('cancel-artifacts-modal-btn');

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
    this.modalProjectSelect = document.getElementById('modal-project-select');
    this.modalOpenImportBtn = document.getElementById('modal-open-import-btn');
    this.currentSelectedEngine = 'cursor';

    // Project Modal Elements
    this.projectModal = document.getElementById('project-modal');
    this.projectModalTitle = document.getElementById('project-modal-title');
    this.projectModalIconBadge = document.getElementById('project-modal-icon-badge');
    this.closeProjectModalBtn = document.getElementById('close-project-modal-btn');
    this.cancelProjectModalBtn = document.getElementById('cancel-project-modal-btn');
    this.saveProjectBtn = document.getElementById('save-project-btn');
    this.deleteProjectBtn = document.getElementById('delete-project-btn');
    this.projectNameInput = document.getElementById('project-name-input');
    this.projectDescInput = document.getElementById('project-desc-input');
    this.projectWorkspaceInput = document.getElementById('project-workspace-input');
    this.projectUseCurrentWsBtn = document.getElementById('project-use-current-ws-btn');
    this.projectEngineSelect = document.getElementById('project-engine-select');
    this.projectIconBtn = document.getElementById('project-icon-btn');
    this.projectIconPicker = document.getElementById('project-icon-picker');
    this.projectColorPicker = document.getElementById('project-color-picker');

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

    if (this.chatPinBtn) {
      this.chatPinBtn.addEventListener('click', () => {
        if (this.activeSessionId) this.togglePinSession(this.activeSessionId);
      });
    }

    if (this.chatProjectBadge) {
      this.chatProjectBadge.addEventListener('click', () => this.promptChangeSessionProject());
    }

    if (this.newProjectBtn) {
      this.newProjectBtn.addEventListener('click', () => this.openProjectModal());
    }
    if (this.closeProjectModalBtn) {
      this.closeProjectModalBtn.addEventListener('click', () => this.closeProjectModal());
    }
    if (this.cancelProjectModalBtn) {
      this.cancelProjectModalBtn.addEventListener('click', () => this.closeProjectModal());
    }
    if (this.saveProjectBtn) {
      this.saveProjectBtn.addEventListener('click', () => this.saveProject());
    }
    if (this.deleteProjectBtn) {
      this.deleteProjectBtn.addEventListener('click', () => this.deleteProject(this.editingProjectId));
    }
    if (this.projectUseCurrentWsBtn) {
      this.projectUseCurrentWsBtn.addEventListener('click', () => {
        this.projectWorkspaceInput.value = this.workspaceInput.value || '';
      });
    }
    if (this.projectIconBtn && this.projectIconPicker) {
      this.projectIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.projectIconPicker.style.display = this.projectIconPicker.style.display === 'none' ? 'grid' : 'none';
      });
      this.projectIconPicker.addEventListener('click', (e) => {
        const btn = e.target.closest('.icon-pick-btn');
        if (btn && btn.dataset.icon) {
          this.selectedProjectIcon = btn.dataset.icon;
          this.projectIconBtn.innerText = this.selectedProjectIcon;
          if (this.projectModalIconBadge) this.projectModalIconBadge.innerText = this.selectedProjectIcon;
          this.projectIconPicker.style.display = 'none';
        }
      });
    }
    if (this.projectColorPicker) {
      this.projectColorPicker.addEventListener('click', (e) => {
        const dot = e.target.closest('.color-dot');
        if (dot && dot.dataset.color) {
          this.selectedProjectColor = dot.dataset.color;
          this.projectColorPicker.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
          dot.classList.add('active');
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (this.projectIconPicker && !e.target.closest('.dropdown-icon-btn-wrapper')) {
        this.projectIconPicker.style.display = 'none';
      }
    });

    if (this.splitLayoutBtns) {
      this.splitLayoutBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const layout = parseInt(btn.dataset.layout, 10);
          this.setSplitLayout(layout);
        });
      });
    }

    if (this.addSplitPaneBtn) {
      this.addSplitPaneBtn.addEventListener('click', () => {
        this.addPane();
      });
    }

    if (this.sessionArtifactsBtn) {
      this.sessionArtifactsBtn.addEventListener('click', () => this.openSessionArtifactsModal());
    }
    if (this.closeArtifactsModalBtn) {
      this.closeArtifactsModalBtn.addEventListener('click', () => (this.sessionArtifactsModal.style.display = 'none'));
    }
    if (this.cancelArtifactsModalBtn) {
      this.cancelArtifactsModalBtn.addEventListener('click', () => (this.sessionArtifactsModal.style.display = 'none'));
    }
    if (this.artifactCloseBtn) {
      this.artifactCloseBtn.addEventListener('click', () => this.closeArtifactViewer());
    }
    if (this.artifactCopyBtn) {
      this.artifactCopyBtn.addEventListener('click', () => this.copyCurrentArtifactContent());
    }
    if (this.artifactDownloadBtn) {
      this.artifactDownloadBtn.addEventListener('click', () => this.downloadCurrentArtifactFile());
    }
    if (this.artifactViewModeToggle) {
      this.artifactViewModeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.artifact-mode-btn');
        if (btn && btn.dataset.mode) {
          this.setArtifactViewerMode(btn.dataset.mode);
        }
      });
    }

    this.newChatBtn.addEventListener('click', () => this.openNewChatModal('cursor'));
    this.newAntigravityChatBtn.addEventListener('click', () => this.openNewChatModal('antigravity'));
    this.closeNewChatModalBtn.addEventListener('click', () => (this.newChatModal.style.display = 'none'));
    this.cancelNewChatBtn.addEventListener('click', () => (this.newChatModal.style.display = 'none'));
    this.submitNewChatBtn.addEventListener('click', () => this.submitNewChatModal());

    this.selectEngineCursor.addEventListener('click', () => this.setModalEngine('cursor'));
    this.selectEngineAntigravity.addEventListener('click', () => this.setModalEngine('antigravity'));

    this.sessionSearch.addEventListener('input', () => this.renderSessions());

    document.addEventListener('click', (e) => {
      // 1. Quick prompt chips
      const chip = e.target.closest('.chip-btn');
      if (chip && chip.dataset.prompt) {
        this.promptInput.value = chip.dataset.prompt;
        this.promptInput.focus();
        return;
      }

      // 2. Interactive Artifact Chips and Tool Artifact buttons
      const artifactBtn = e.target.closest('.chat-artifact-chip, .tool-artifact-view-btn');
      if (artifactBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (artifactBtn.dataset.toolCallId) {
          this.openArtifactFromToolCall(artifactBtn.dataset.toolCallId);
        } else if (artifactBtn.dataset.path) {
          this.openArtifact({ path: artifactBtn.dataset.path, title: artifactBtn.dataset.title || artifactBtn.innerText.trim() });
        }
        return;
      }

      // 3. File and Markdown links in messages
      const msgLink = e.target.closest('.message-bubble a, .markdown-body a');
      if (msgLink && msgLink.getAttribute('href')) {
        const href = msgLink.getAttribute('href');
        const isLocalFileLink = href.startsWith('file://') || href.startsWith('artifact://') || /\.(md|markdown|json|ts|js|py|html|css|txt|yaml|yml|sh|svg)($|#)/i.test(href);
        if (isLocalFileLink && !href.startsWith('http://') && !href.startsWith('https://')) {
          e.preventDefault();
          e.stopPropagation();
          const cleanTitle = msgLink.innerText.trim() || href.split(/[/\\]/).pop() || 'Артефакт';
          this.openArtifact({ path: href, title: cleanTitle });
        }
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
      this.syncAfterReconnect();
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

  async syncAfterReconnect() {
    this.markAgentActivity();
    try {
      await this.loadDevices();
    } catch (err) {
      console.warn('[App] Device refresh after reconnect failed:', err);
    }
    if (!this.activeSessionId) return;
    await this.loadActiveSessionDetails(this.activeSessionId, true);
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (session && (session.isStreaming || session.status === 'running')) {
      this.isStreaming = true;
      this.startAgentStallWatchdog();
    }
    setTimeout(() => {
      if (this.activeSessionId) this.loadActiveSessionDetails(this.activeSessionId, true);
    }, 1200);
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
            appendTextToMessageBlocks(lastMsg, {
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
            const existing = this.sessions[idx];
            this.sessions[idx] = {
              ...existing,
              ...updatedSession,
              messages: updatedSession.messages && updatedSession.messages.length > 0 ? updatedSession.messages : (existing.messages || []),
              _loaded: updatedSession.messages && updatedSession.messages.length > 0 ? true : Boolean(existing._loaded),
            };
          } else {
            this.sessions.unshift({
              ...updatedSession,
              _loaded: Boolean(updatedSession.messages && updatedSession.messages.length > 0),
            });
          }
          this.renderSessions();
          if (this.activeSessionId === updatedSession.id && !this.isStreaming) {
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
          const lastMsg = [...(s.messages || [])].reverse().find((m) => m.role === 'assistant');
          if (lastMsg) {
            if (!lastMsg.toolCalls) lastMsg.toolCalls = [];
            const existing = lastMsg.toolCalls.find((t) => t.id === toolCall.id);
            if (existing) {
              Object.assign(existing, toolCall);
              if (!lastMsg.blocks?.some((b) => b.type === 'tool' && b.toolCallId === toolCall.id)) {
                appendToolToMessageBlocks(lastMsg, toolCall);
              }
            } else {
              lastMsg.toolCalls.push(toolCall);
              appendToolToMessageBlocks(lastMsg, toolCall);
            }
          }
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
        const s = this.sessions.find((x) => x.id === sessionId);
        if (s) {
          for (const msg of s.messages || []) {
            const found = msg.toolCalls?.find((t) => t.id === toolCallId);
            if (found) {
              found.output = result;
              found.status = status;
              break;
            }
          }
        }
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
          if (success !== false && cursorChatId) s.cursorChatId = cursorChatId;
          if (success === false && isUsageLimitError(error)) s.cursorChatId = undefined;
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

      case 'hub:status': {
        this.renderHubStatus(msg.payload);
        break;
      }

      case 'devices:list': {
        this.devices = msg.payload || [];
        this.renderDevices();
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
        if (payload.reqId === this._pendingArtifactReqId) {
          this._pendingArtifactReqId = null;
          if (this.currentActiveArtifact) {
            this.currentActiveArtifact.content = payload.content;
          }
          this.displayArtifactContent(payload.content, payload.path);
        } else if (payload.reqId === this.pendingFileReqId || !this.pendingFileReqId) {
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
      case 'state:init': {
        if (msg.payload?.projects) {
          this.projects = msg.payload.projects;
          this.renderProjects();
          this.populateModalProjectSelect();
        }
        break;
      }

      case 'project:updated': {
        const proj = msg.payload;
        if (proj && proj.id) {
          const idx = this.projects.findIndex((p) => p.id === proj.id);
          if (idx >= 0) {
            this.projects[idx] = proj;
          } else {
            this.projects.push(proj);
          }
          this.renderProjects();
          this.renderSessions();
          this.populateModalProjectSelect();
          if (this.activeSessionId) {
            this.renderActiveChat();
          }
        }
        break;
      }

      case 'project:deleted': {
        const { projectId } = msg.payload || {};
        if (projectId) {
          this.projects = this.projects.filter((p) => p.id !== projectId);
          for (const s of this.sessions) {
            if (s.projectId === projectId) s.projectId = undefined;
          }
          if (this.activeProjectId === projectId) {
            this.selectProject('all');
          } else {
            this.renderProjects();
            this.renderSessions();
          }
          this.populateModalProjectSelect();
          if (this.activeSessionId) {
            this.renderActiveChat();
          }
        }
        break;
      }
    }
  }

  async loadInitialData() {
    await Promise.all([this.loadDevices(), this.loadProjects(), this.loadSessions()]);
  }

  async loadProjects() {
    try {
      const res = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        this.projects = data.projects || [];
        this.renderProjects();
        this.populateModalProjectSelect();
      }
    } catch (err) {
      console.error('[App] Failed to load projects:', err);
    }
  }

  renderProjects() {
    if (!this.projectList) return;
    this.projectList.innerHTML = '';

    // 1. "Усі чати" (All)
    const allItem = document.createElement('div');
    allItem.className = `project-item ${this.activeProjectId === 'all' ? 'active' : ''}`;
    allItem.innerHTML = `
      <div class="project-item-left">
        <span class="project-item-icon">🌟</span>
        <span class="project-item-name">Усі чати</span>
      </div>
      <div class="project-item-right">
        <span class="project-item-count">${this.sessions.length}</span>
      </div>
    `;
    allItem.addEventListener('click', () => this.selectProject('all'));
    this.projectList.appendChild(allItem);

    // 2. User projects
    this.projects.forEach((proj) => {
      const count = this.sessions.filter((s) => s.projectId === proj.id).length;
      const item = document.createElement('div');
      item.className = `project-item ${this.activeProjectId === proj.id ? 'active' : ''}`;
      const icon = proj.icon || '📁';
      const color = proj.color || '#38bdf8';
      item.innerHTML = `
        <div class="project-item-left">
          <span class="project-item-icon" style="color:${color};">${icon}</span>
          <span class="project-item-name">${this.escapeHtml(proj.name)}</span>
        </div>
        <div class="project-item-right">
          <span class="project-item-count">${count}</span>
          <button type="button" class="project-item-edit-btn" title="Налаштування проєкту">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.project-item-edit-btn')) {
          e.stopPropagation();
          this.openProjectModal(proj);
        } else {
          this.selectProject(proj.id);
        }
      });
      this.projectList.appendChild(item);
    });

    // 3. "Без проєкту" (Unassigned)
    if (this.projects.length > 0) {
      const unassignedCount = this.sessions.filter((s) => !s.projectId).length;
      const unassignedItem = document.createElement('div');
      unassignedItem.className = `project-item ${this.activeProjectId === 'unassigned' ? 'active' : ''}`;
      unassignedItem.innerHTML = `
        <div class="project-item-left">
          <span class="project-item-icon">📂</span>
          <span class="project-item-name">Без проєкту</span>
        </div>
        <div class="project-item-right">
          <span class="project-item-count">${unassignedCount}</span>
        </div>
      `;
      unassignedItem.addEventListener('click', () => this.selectProject('unassigned'));
      this.projectList.appendChild(unassignedItem);
    }
  }

  selectProject(projectId) {
    this.activeProjectId = projectId;
    localStorage.setItem('agentremote_active_project_id', projectId);
    this.renderProjects();
    this.renderSessions();

    if (this.sessionListHeaderTitle) {
      if (projectId === 'all') {
        this.sessionListHeaderTitle.innerText = 'ІСТОРІЯ СЕСІЙ';
      } else if (projectId === 'unassigned') {
        this.sessionListHeaderTitle.innerText = 'БЕЗ ПРОЄКТУ';
      } else {
        const proj = this.projects.find((p) => p.id === projectId);
        this.sessionListHeaderTitle.innerText = proj ? `${proj.icon || '📁'} ${proj.name}`.toUpperCase() : 'ПРОЄКТ';
      }
    }
  }

  openProjectModal(projectToEdit = null) {
    this.editingProjectId = projectToEdit ? projectToEdit.id : null;
    this.selectedProjectIcon = projectToEdit?.icon || '📁';
    this.selectedProjectColor = projectToEdit?.color || '#38bdf8';

    if (this.projectModalTitle) {
      this.projectModalTitle.innerText = projectToEdit ? 'Редагувати проєкт' : 'Новий проєкт';
    }
    if (this.projectModalIconBadge) {
      this.projectModalIconBadge.innerText = this.selectedProjectIcon;
    }
    if (this.projectIconBtn) {
      this.projectIconBtn.innerText = this.selectedProjectIcon;
    }
    if (this.projectNameInput) {
      this.projectNameInput.value = projectToEdit?.name || '';
    }
    if (this.projectDescInput) {
      this.projectDescInput.value = projectToEdit?.description || '';
    }
    if (this.projectWorkspaceInput) {
      this.projectWorkspaceInput.value = projectToEdit?.workspacePath || this.workspaceInput?.value || '';
    }
    if (this.projectEngineSelect) {
      this.projectEngineSelect.value = projectToEdit?.defaultEngine || '';
    }
    if (this.deleteProjectBtn) {
      this.deleteProjectBtn.style.display = projectToEdit ? 'inline-flex' : 'none';
    }
    if (this.projectIconPicker) {
      this.projectIconPicker.style.display = 'none';
    }

    if (this.projectColorPicker) {
      const dots = this.projectColorPicker.querySelectorAll('.color-dot');
      dots.forEach((dot) => {
        dot.classList.toggle('active', dot.dataset.color === this.selectedProjectColor);
      });
    }

    if (this.projectModal) {
      this.projectModal.style.display = 'flex';
      setTimeout(() => this.projectNameInput?.focus(), 50);
    }
  }

  closeProjectModal() {
    if (this.projectModal) this.projectModal.style.display = 'none';
    if (this.projectIconPicker) this.projectIconPicker.style.display = 'none';
    this.editingProjectId = null;
  }

  async saveProject() {
    const name = this.projectNameInput?.value.trim();
    if (!name) {
      this.showToast('Введіть назву проєкту');
      this.projectNameInput?.focus();
      return;
    }

    const payload = {
      name,
      description: this.projectDescInput?.value.trim() || '',
      icon: this.selectedProjectIcon,
      color: this.selectedProjectColor,
      workspacePath: this.projectWorkspaceInput?.value.trim() || '',
      defaultEngine: this.projectEngineSelect?.value || undefined,
    };

    try {
      if (this.editingProjectId) {
        const res = await fetch(`/api/projects/${this.editingProjectId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          const idx = this.projects.findIndex((p) => p.id === this.editingProjectId);
          if (idx >= 0) this.projects[idx] = data.project;
          this.showToast(`✨ Проєкт "${name}" оновлено`);
        }
      } else {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          this.projects.push(data.project);
          this.selectProject(data.project.id);
          this.showToast(`✨ Створено новий проєкт: ${name}`);
        }
      }

      this.renderProjects();
      this.populateModalProjectSelect();
      this.closeProjectModal();
    } catch (err) {
      console.error('[App] Failed to save project:', err);
      this.showToast('Помилка збереження проєкту');
    }
  }

  async deleteProject(projectId) {
    if (!projectId) return;
    const proj = this.projects.find((p) => p.id === projectId);
    if (!confirm(`Видалити проєкт "${proj?.name || 'цей проєкт'}"?\n(Чати всередині перейдуть у загальний список)`)) return;

    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });

      this.projects = this.projects.filter((p) => p.id !== projectId);
      for (const s of this.sessions) {
        if (s.projectId === projectId) s.projectId = undefined;
      }

      if (this.activeProjectId === projectId) {
        this.selectProject('all');
      } else {
        this.renderProjects();
        this.renderSessions();
      }

      this.populateModalProjectSelect();
      this.closeProjectModal();
      this.showToast('Проєкт видалено');
    } catch (err) {
      console.error('[App] Failed to delete project:', err);
      this.showToast('Помилка видалення проєкту');
    }
  }

  populateModalProjectSelect() {
    if (!this.modalProjectSelect) return;
    const currentVal = this.modalProjectSelect.value;
    this.modalProjectSelect.innerHTML = '<option value="">Без проєкту</option>';
    this.projects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.innerText = `${p.icon || '📁'} ${p.name}`;
      if (p.id === currentVal || (p.id === this.activeProjectId && this.activeProjectId !== 'all' && this.activeProjectId !== 'unassigned')) {
        opt.selected = true;
      }
      this.modalProjectSelect.appendChild(opt);
    });
  }

  async togglePinSession(sessionId) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const newPinned = !session.isPinned;
    session.isPinned = newPinned;
    this.renderSessions();
    this.renderPanes();
    this.showToast(newPinned ? '📌 Чат закріплено зверху' : 'Відкріплено');

    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'session:pin',
          payload: { sessionId, isPinned: newPinned }
        }));
      } else {
        await fetch(`/api/sessions/${sessionId}/pin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`
          },
          body: JSON.stringify({ isPinned: newPinned })
        });
      }
    } catch (err) {
      console.error('[App] Failed to toggle pin:', err);
    }
  }

  promptChangeSessionProject() {
    if (!this.activeSessionId) return;
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) return;

    const options = [
      'Без проєкту',
      ...this.projects.map((p) => `${p.icon || '📁'} ${p.name}`),
      '+ Створити новий проєкт...'
    ];

    const currentIdx = !session.projectId
      ? 0
      : this.projects.findIndex((p) => p.id === session.projectId) + 1;

    const choice = prompt(
      `Оберіть проєкт для цього чату:\n` +
        options.map((opt, idx) => `${idx + 1}. ${opt}${idx === currentIdx ? ' (поточний)' : ''}`).join('\n'),
      String(currentIdx + 1)
    );

    if (!choice) return;
    const num = parseInt(choice.trim(), 10);
    if (isNaN(num) || num < 1 || num > options.length) return;

    if (num === options.length) {
      this.openProjectModal();
      return;
    }

    const selectedProjectId = num === 1 ? undefined : this.projects[num - 2]?.id;
    this.setSessionProject(session.id, selectedProjectId);
  }

  async setSessionProject(sessionId, projectId) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    session.projectId = projectId || undefined;
    this.renderProjects();
    this.renderSessions();
    this.renderPanes();
    const proj = this.projects.find((p) => p.id === projectId);
    this.showToast(proj ? `📁 Переміщено в проєкт "${proj.name}"` : 'Чат переміщено в загальний список');

    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'session:move_project',
          payload: { sessionId, projectId: projectId || undefined }
        }));
      } else {
        await fetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`
          },
          body: JSON.stringify({ projectId: projectId || null })
        });
      }
    } catch (err) {
      console.error('[App] Failed to move session:', err);
    }
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
        const incoming = data.sessions || [];

        // Preserve already loaded messages and status from memory
        this.sessions = incoming.map((summary) => {
          const existing = this.sessions.find((s) => s.id === summary.id);
          return {
            ...summary,
            messages: existing && existing.messages && existing._loaded ? existing.messages : (existing && existing.messages ? existing.messages : []),
            _loaded: Boolean(existing && existing._loaded),
          };
        });

        // Restore active session from localStorage on reload
        const savedSessionId = localStorage.getItem('agentremote_active_session_id');
        if (savedSessionId && this.sessions.some((s) => s.id === savedSessionId)) {
          this.activeSessionId = savedSessionId;
        } else if (this.sessions.length > 0 && !this.activeSessionId) {
          this.activeSessionId = this.sessions[0].id;
        }

        this.renderProjects();
        this.renderSessions();
        if (this.activeSessionId) {
          await this.loadActiveSessionDetails(this.activeSessionId);
        } else {
          this.renderActiveChat();
        }
      }
    } catch (err) {
      console.error('[App] Failed to load sessions:', err);
    }
  }

  async loadActiveSessionDetails(sessionId, force = false) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) {
      this.renderActiveChat();
      return;
    }
    if (!force && session._loaded && session.messages && session.messages.length > 0) {
      this.renderActiveChat();
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          Object.assign(session, data.session, { _loaded: true });
        }
      }
    } catch (err) {
      console.error(`[App] Failed to load session details for ${sessionId}:`, err);
    }
    this.renderActiveChat();
  }

  renderHubStatus(status) {
    if (!status) return;
    this.latestHubStatus = status;
    const tag = document.querySelector('.hub-status-tag');
    if (tag) {
      tag.innerHTML = `● Live · RAM: ${status.ramMb}MB · Сесій: ${status.activeSessions}`;
      tag.style.color = '#38bdf8';
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
      const isRecentlySeen = activeDev && !isOnline && activeDev.lastSeen && (Date.now() - activeDev.lastSeen < 75000);

      let statusClass = 'offline';
      let statusLabel = 'OFFLINE';
      if (isOnline) {
        statusClass = 'online';
        statusLabel = 'ONLINE';
      } else if (isRecentlySeen) {
        statusClass = 'reconnecting';
        statusLabel = 'ПЕРЕПІДКЛЮЧЕННЯ';
      }

      this.deviceStatusDot.className = `device-status-indicator ${statusClass}`;

      const shortName = activeDev ? (activeDev.name || 'PC').slice(0, 14) : '—';
      const isNarrow = window.innerWidth <= 480;
      const isCursorLoggedIn = Boolean(activeDev && activeDev.cursorAuthStatus && activeDev.cursorAuthStatus.loggedIn);
      const reconnectSuffix = isRecentlySeen ? ' 🔄 Перепідключення...' : (isOnline ? '' : ' (Офлайн)');

      if (isNarrow) {
        this.activeDeviceIndicator.innerText = `${shortName}${isOnline ? '' : (isRecentlySeen ? ' 🔄' : ' ○')}`;
        this.activeDeviceIndicator.title = activeDev
          ? `${activeDev.name} (${statusLabel})`
          : 'Не обрано';
      } else if (isCursorLoggedIn) {
        this.loginCursorBtn.style.display = 'none';
        const emailLabel = activeDev.cursorAuthStatus.email ? ` • ${activeDev.cursorAuthStatus.email}` : ' • 🔑 Вхід виконано';
        this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev.name}${reconnectSuffix}${emailLabel}`;
      } else {
        this.loginCursorBtn.style.display = 'inline-flex';
        this.activeDeviceIndicator.innerText = `Пристрій: ${activeDev ? activeDev.name : 'Не обрано'}${reconnectSuffix}`;
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

  cleanTitleFromPrompt(prompt, maxLength = 34) {
    if (!prompt) return 'Новий чат';
    let text = prompt.replace(/<[^>]+>/g, ' ');
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(/`[^`]+`/g, ' ');
    text = text.replace(/https?:\/\/\S+/g, ' ');
    text = text.replace(/[#*_\->~[\]()]+/g, ' ');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let title = lines[0] || '';

    const prefixPatterns = [
      /^(?:хочу\s+(?:щоб|якщо)\s+(?:була\s+можливість\s+)?)/i,
      /^(?:треба\s+(?:щоб|зробити|додати)\s+(?:можливість\s+)?)/i,
      /^(?:зроби\s+(?:так\s+щоб|будь\s+ласка\s+)?)/i,
      /^(?:чи\s+(?:можна|працює|є|буде)\s+)/i,
      /^(?:допоможи\s+(?:мені\s+)?(?:з|у|в)?\s+)/i,
      /^(?:як\s+(?:зробити|налаштувати|додати)\s+)/i,
      /^(?:будь\s+ласка[,\s]+)/i,
      /^(?:can\s+you\s+(?:please\s+)?(?:help\s+me\s+with\s+)?)/i,
      /^(?:please\s+(?:help\s+me\s+with\s+)?)/i,
      /^(?:i\s+want\s+(?:to\s+)?)/i,
      /^(?:how\s+to\s+)/i,
      /^(?:could\s+you\s+)/i,
    ];
    for (const pat of prefixPatterns) {
      title = title.replace(pat, '');
    }
    title = title.replace(/[?!:;.,]+$/, '').replace(/\s+/g, ' ').trim();
    if (!title) return 'Новий чат';
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title.length > maxLength) {
      const cut = title.slice(0, maxLength);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace > maxLength * 0.55) {
        title = cut.slice(0, lastSpace).trim() + '…';
      } else {
        title = cut.trim() + '…';
      }
    }
    return title;
  }

  renderSessions() {
    const query = (this.sessionSearch?.value || '').toLowerCase().trim();
    let filtered = this.sessions.filter((s) => {
      // 1. Project filter
      if (this.activeProjectId === 'unassigned') {
        if (s.projectId) return false;
      } else if (this.activeProjectId !== 'all') {
        if (s.projectId !== this.activeProjectId) return false;
      }
      // 2. Search query
      if (query) {
        const titleMatch = s.title && s.title.toLowerCase().includes(query);
        const descMatch = s.description && s.description.toLowerCase().includes(query);
        const wsMatch = s.workspacePath && s.workspacePath.toLowerCase().includes(query);
        if (!titleMatch && !descMatch && !wsMatch) return false;
      }
      return true;
    });

    // 3. Sort: Pinned first, then by updatedAt descending
    filtered = [...filtered].sort((a, b) => {
      const aPinned = Boolean(a.isPinned);
      const bPinned = Boolean(b.isPinned);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    if (this.sessionCount) this.sessionCount.innerText = filtered.length;

    if (!this.sessionList) return;

    if (filtered.length === 0) {
      this.sessionList.innerHTML = '<p class="meta-text" style="padding:16px 6px; text-align:center;">Сесій не знайдено</p>';
      return;
    }

    this.sessionList.innerHTML = '';
    filtered.forEach((s) => {
      const item = document.createElement('div');
      const isCurrentActive = s.id === this.activeSessionId;
      const isOpenInPane = this.panes && this.panes.some((p) => p.sessionId === s.id);
      const isPinned = Boolean(s.isPinned);

      item.className = `session-item ${isCurrentActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}`;

      const formattedDate = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isAntigravity = s.engine === 'antigravity';
      const engineTag = isAntigravity
        ? '<span class="session-engine-tag antigravity">AGY</span>'
        : '<span class="session-engine-tag cursor">CURSOR</span>';

      const isRunning = Boolean(s.isStreaming || s.status === 'running');
      const runningTag = isRunning
        ? '<span class="session-running-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:9.5px; padding:1px 5px; border-radius:4px; background:rgba(56,189,248,0.15); color:var(--accent-primary); font-weight:700; border:1px solid rgba(56,189,248,0.3);"><span class="pulse-dot"></span> виконується</span>'
        : '';

      const pinBadge = isPinned ? '<span class="session-pin-indicator" title="Закріплений чат">📌</span>' : '';

      let projectTag = '';
      if (this.activeProjectId === 'all' && s.projectId) {
        const proj = this.projects.find((p) => p.id === s.projectId);
        if (proj) {
          projectTag = `<span class="session-project-tag" style="color:${proj.color || 'inherit'};">${proj.icon || '📁'} ${this.escapeHtml(proj.name)}</span>`;
        }
      }

      const descText = s.description || (s.workspacePath ? s.workspacePath.split(/[/\\]/).filter(Boolean).pop() : 'Робоча сесія');
      const messageCount = s.messageCount !== undefined ? s.messageCount : (s.messages ? s.messages.length : 0);
      const sessionTitle = s.title || (isAntigravity ? 'Чат Antigravity' : 'Чат Cursor');

      item.innerHTML = `
        <div class="session-info">
          <div class="session-header-line">
            <div class="session-tags-row">
              ${pinBadge}
              ${engineTag}
              ${runningTag}
              ${projectTag}
            </div>
            <span class="session-date-inline">${formattedDate}</span>
          </div>
          <div class="session-title" title="${this.escapeHtml(sessionTitle)}">${this.escapeHtml(sessionTitle)}</div>
          <div class="session-desc" title="${this.escapeHtml(descText)}">${this.escapeHtml(descText)}</div>
          <div class="session-date">${s.model === 'auto' ? 'Auto' : s.model || (isAntigravity ? 'Gemini' : 'Claude')} • ${messageCount} повід.</div>
        </div>
        <div class="session-actions-group">
          <button type="button" class="session-pin-btn ${isPinned ? 'active' : ''}" title="${isPinned ? 'Відкріпити чат' : 'Закріпити зверху'}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5M5 17h14l-1.5-6H6.5L5 17zM9 3h6l1 4H8l1-4z"/></svg>
          </button>
          <button type="button" class="session-split-btn" title="Відкрити поруч (Split Screen)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
          </button>
          <button type="button" class="session-delete-btn" title="Видалити сесію">✕</button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.session-pin-btn')) {
          e.stopPropagation();
          this.togglePinSession(s.id);
        } else if (e.target.closest('.session-split-btn')) {
          e.stopPropagation();
          this.addPane(s.id);
        } else if (e.target.closest('.session-delete-btn')) {
          e.stopPropagation();
          this.deleteSession(s.id);
        } else {
          this.selectSession(s.id);
        }
      });

      this.sessionList.appendChild(item);
    });
  }

  async selectSession(sessionId) {
    this.activeSessionId = sessionId;
    if (sessionId) {
      localStorage.setItem('agentremote_active_session_id', sessionId);
    } else {
      localStorage.removeItem('agentremote_active_session_id');
    }

    // Set sessionId on active pane
    const activePane = this.panes.find((p) => p.id === this.activePaneId) || this.panes[0];
    if (activePane) {
      activePane.sessionId = sessionId;
    }

    this.renderSessions();
    this.appSidebar?.classList.remove('open');
    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.classList.remove('show');
    }
    await this.loadActiveSessionDetails(sessionId);
    this.renderPanes();
  }

  async deleteSession(sessionId) {
    if (!confirm('Видалити цю сесію?')) return;
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);

    // If active session was deleted, reassign
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0] ? this.sessions[0].id : null;
      if (this.activeSessionId) {
        localStorage.setItem('agentremote_active_session_id', this.activeSessionId);
      } else {
        localStorage.removeItem('agentremote_active_session_id');
      }
    }

    // Reassign any pane that was showing this session
    this.panes.forEach((p) => {
      if (p.sessionId === sessionId) {
        p.sessionId = this.sessions[0]?.id || null;
      }
    });

    this.renderProjects();
    this.renderSessions();
    this.renderPanes();
  }

  // ================= MULTI-CHAT SPLIT SCREEN METHODS =================
  setSplitLayout(layoutCount) {
    const layout = Math.max(1, Math.min(4, layoutCount));
    this.splitLayout = layout;
    localStorage.setItem('agentremote_split_layout', String(layout));

    if (this.splitLayoutBtns) {
      this.splitLayoutBtns.forEach((btn) => {
        btn.classList.toggle('active', parseInt(btn.dataset.layout, 10) === layout);
      });
    }

    // Adjust panes list to match layout count
    while (this.panes.length < layout) {
      const paneId = `pane-${this.panes.length + 1}`;
      const openSessionIds = new Set(this.panes.map((p) => p.sessionId).filter(Boolean));
      const nextSession = this.sessions.find((s) => !openSessionIds.has(s.id)) || this.sessions[0];
      this.panes.push({ id: paneId, sessionId: nextSession ? nextSession.id : null });
    }
    if (this.panes.length > layout) {
      this.panes = this.panes.slice(0, layout);
    }

    if (!this.panes.some((p) => p.id === this.activePaneId)) {
      this.activePaneId = this.panes[0]?.id || 'pane-1';
    }

    this.renderPanes();
    this.renderSessions();
  }

  addPane(sessionId = null) {
    if (this.panes.length >= 4) {
      this.showToast('Досягнуто максимум 4 паралельних вікна');
      return;
    }
    const newCount = this.panes.length + 1;
    this.setSplitLayout(newCount);
    if (sessionId) {
      const lastPane = this.panes[this.panes.length - 1];
      if (lastPane) {
        lastPane.sessionId = sessionId;
        this.activePaneId = lastPane.id;
        this.activeSessionId = sessionId;
        this.renderPanes();
        this.renderSessions();
      }
    }
  }

  closePane(paneId) {
    if (this.panes.length <= 1) return;
    this.panes = this.panes.filter((p) => p.id !== paneId);
    this.setSplitLayout(this.panes.length);
  }

  focusPane(paneId) {
    this.activePaneId = paneId;
    const pane = this.panes.find((p) => p.id === paneId);
    if (pane && pane.sessionId) {
      this.activeSessionId = pane.sessionId;
    }
    const allPanes = document.querySelectorAll('.chat-pane');
    allPanes.forEach((p) => {
      p.classList.toggle('focused', p.dataset.paneId === paneId);
    });
    this.renderSessions();
  }

  renderPanes() {
    if (!this.chatPanesGrid) return;

    if (!this.panes || this.panes.length === 0) {
      this.panes = [{ id: 'pane-1', sessionId: this.activeSessionId }];
    }

    // Ensure pane count matches splitLayout
    while (this.panes.length < this.splitLayout) {
      const newId = `pane-${this.panes.length + 1}`;
      const openSessionIds = new Set(this.panes.map((p) => p.sessionId).filter(Boolean));
      const nextSession = this.sessions.find((s) => !openSessionIds.has(s.id)) || this.sessions[0];
      this.panes.push({ id: newId, sessionId: nextSession ? nextSession.id : null });
    }
    if (this.panes.length > this.splitLayout) {
      this.panes = this.panes.slice(0, this.splitLayout);
    }

    if (!this.panes.some((p) => p.id === this.activePaneId)) {
      this.activePaneId = this.panes[0]?.id || 'pane-1';
    }

    this.chatPanesGrid.dataset.layout = String(this.splitLayout);
    this.chatPanesGrid.innerHTML = '';

    if (this.splitLayoutBtns) {
      this.splitLayoutBtns.forEach((btn) => {
        btn.classList.toggle('active', parseInt(btn.dataset.layout, 10) === this.splitLayout);
      });
    }

    this.panes.forEach((pane, idx) => {
      const paneEl = this.createPaneElement(pane, idx);
      this.chatPanesGrid.appendChild(paneEl);
      this.renderPaneContent(pane, paneEl);
    });

    this.extractSessionArtifacts(this.activeSessionId);
  }

  createPaneElement(pane, index) {
    const paneEl = document.createElement('div');
    paneEl.className = `chat-pane ${pane.id === this.activePaneId ? 'focused' : ''}`;
    paneEl.dataset.paneId = pane.id;

    const session = this.sessions.find((s) => s.id === pane.sessionId);
    const isPinned = Boolean(session && session.isPinned);
    const isRunning = Boolean(session && (session.isStreaming || session.status === 'running'));
    const isAntigravity = session && session.engine === 'antigravity';
    const engineTag = session ? (isAntigravity ? 'AGY' : 'CURSOR') : 'CHAT';

    const sessionOptions = this.sessions
      .map((s) => {
        const isPin = s.isPinned ? '📌 ' : '';
        const title = this.escapeHtml(s.title || (s.engine === 'antigravity' ? 'Antigravity' : 'Cursor'));
        const isSel = s.id === pane.sessionId ? 'selected' : '';
        return `<option value="${s.id}" ${isSel}>${isPin}${title}</option>`;
      })
      .join('');

    const paneCount = this.panes.length;

    paneEl.innerHTML = `
      <div class="chat-pane-header">
        <div class="chat-pane-title-area">
          <button type="button" class="pane-pin-btn ${isPinned ? 'active' : ''}" title="${isPinned ? 'Відкріпити' : 'Закріпити'}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5M5 17h14l-1.5-6H6.5L5 17zM9 3h6l1 4H8l1-4z"/></svg>
          </button>
          <select class="pane-session-select" title="Оберіть сесію для цього вікна">
            ${sessionOptions || '<option value="">Немає сесій</option>'}
          </select>
          <span class="session-engine-tag ${isAntigravity ? 'antigravity' : 'cursor'}">${engineTag}</span>
          ${isRunning ? '<span class="session-running-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:9.5px; padding:1px 5px; border-radius:4px; background:rgba(56,189,248,0.15); color:var(--accent-primary); font-weight:700; border:1px solid rgba(56,189,248,0.3);"><span class="pulse-dot"></span> виконується</span>' : ''}
        </div>
        <div class="chat-pane-actions">
          <button type="button" class="pane-action-btn pane-new-chat-btn" title="Створити новий чат у цьому вікні">+</button>
          <button type="button" class="pane-action-btn pane-sync-btn" title="Синхронізувати з IDE">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          </button>
          ${paneCount > 1 ? '<button type="button" class="pane-action-btn pane-close-btn danger" title="Закрити це вікно">✕</button>' : ''}
        </div>
      </div>

      <div class="chat-pane-messages-wrapper" style="position:relative; flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden;">
        <div class="chat-pane-messages chat-messages">
          <!-- Messages will be rendered here -->
        </div>
        <button type="button" class="scroll-to-bottom-btn" title="Прокрутити вниз до нових повідомлень">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          <span>Вниз</span>
        </button>
      </div>

      <div class="chat-pane-input-area chat-input-area">
        <div class="input-controls">
          <div class="input-controls-left">
            <div class="inline-select-wrapper">
              <select class="pane-model-select custom-select-sm" title="Модель для цього чату">
                ${this.buildModelOptionsHtml(session?.engine || 'cursor', session?.model)}
              </select>
            </div>
            <div class="pane-effort-wrapper inline-select-wrapper" style="${this.modelSupportsEffort(session?.engine || 'cursor', session?.model) ? '' : 'display:none;'}">
              <select class="pane-effort-select custom-select-sm" title="Thinking Effort">
                <option value="high" ${session?.thinkingEffort === 'high' ? 'selected' : ''}>🚀 High</option>
                <option value="medium" ${session?.thinkingEffort === 'medium' || !session?.thinkingEffort ? 'selected' : ''}>🧠 Med</option>
                <option value="low" ${session?.thinkingEffort === 'low' ? 'selected' : ''}>⚡ Low</option>
                <option value="off" ${session?.thinkingEffort === 'off' ? 'selected' : ''}>🚫 Off</option>
              </select>
            </div>
          </div>
          <div class="input-right-controls">
            <button type="button" class="pane-stop-btn btn btn-danger btn-sm" style="${isRunning ? 'display:inline-flex;' : 'display:none;'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
              <span>Зупинити</span>
            </button>
          </div>
        </div>

        <div class="pane-queue-box" style="${session?.promptQueue && session.promptQueue.length > 0 ? '' : 'display:none;'}">
          <!-- Queue items -->
        </div>

        <div class="input-box-wrapper">
          <textarea class="pane-prompt-input" placeholder="Завдання для агента... (Enter — надіслати)" rows="2"></textarea>
          <div class="input-actions-bar">
            <span class="shortcut-hint">Enter</span>
            <button type="button" class="pane-send-btn send-btn" title="${isRunning ? 'Додати в чергу' : 'Надіслати'}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    // Attach scroll listener and scroll down button
    const messagesEl = paneEl.querySelector('.chat-pane-messages');
    const scrollDownBtn = paneEl.querySelector('.scroll-to-bottom-btn');
    if (messagesEl) {
      this.attachScrollListener(messagesEl);
      if (scrollDownBtn) {
        scrollDownBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.smartScrollToBottom(messagesEl, true);
        });
      }
    }

    // Pane focus
    paneEl.addEventListener('click', () => {
      this.focusPane(pane.id);
    });

    // Session dropdown
    const sessSelect = paneEl.querySelector('.pane-session-select');
    sessSelect.addEventListener('change', async (e) => {
      pane.sessionId = e.target.value;
      this.activeSessionId = pane.sessionId;
      await this.loadActiveSessionDetails(pane.sessionId);
      this.renderPanes();
      this.renderSessions();
    });

    // Pin toggle
    const pinBtn = paneEl.querySelector('.pane-pin-btn');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pane.sessionId) this.togglePinSession(pane.sessionId);
    });

    // Close pane
    const closeBtn = paneEl.querySelector('.pane-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePane(pane.id);
      });
    }

    // New chat
    const newChatBtn = paneEl.querySelector('.pane-new-chat-btn');
    if (newChatBtn) {
      newChatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openNewChatModal(session?.engine || 'cursor');
      });
    }

    // Sync IDE
    const syncBtn = paneEl.querySelector('.pane-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.syncCurrentChatWithIde();
      });
    }

    // Model select
    const modelSelect = paneEl.querySelector('.pane-model-select');
    modelSelect.addEventListener('change', (e) => {
      if (session) session.model = e.target.value;
      const effortWrap = paneEl.querySelector('.pane-effort-wrapper');
      if (effortWrap) {
        effortWrap.style.display = this.modelSupportsEffort(session?.engine || 'cursor', e.target.value) ? '' : 'none';
      }
    });

    // Effort select
    const effortSelect = paneEl.querySelector('.pane-effort-select');
    if (effortSelect) {
      effortSelect.addEventListener('change', (e) => {
        if (session) session.thinkingEffort = e.target.value;
      });
    }

    // Prompt textarea & Send button
    const textarea = paneEl.querySelector('.pane-prompt-input');
    const sendBtn = paneEl.querySelector('.pane-send-btn');
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendPrompt(pane.id);
      }
    });
    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sendPrompt(pane.id);
    });

    // Stop button
    const stopBtn = paneEl.querySelector('.pane-stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stopAgent(pane.sessionId);
      });
    }

    return paneEl;
  }

  renderPaneContent(pane, paneEl) {
    const messagesEl = paneEl.querySelector('.chat-pane-messages');
    if (!messagesEl) return;

    const session = this.sessions.find((s) => s.id === pane.sessionId);
    if (!session) {
      messagesEl.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-badge">Вікно чату</div>
          <h3>Оберіть або створіть сесію</h3>
          <p>Виберіть сесію зі списку вгорі або створіть новий чат кнопкою "+".</p>
        </div>
      `;
      return;
    }

    if (!session._loaded && (!session.messages || session.messages.length === 0)) {
      messagesEl.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-badge">Завантаження</div>
          <h3>${this.escapeHtml(session.title || 'Сесія')}</h3>
          <p><span class="pulse-dot"></span> Завантаження повідомлень чату...</p>
        </div>
      `;
      return;
    }

    if (!session.messages || session.messages.length === 0) {
      messagesEl.innerHTML = `
        <div class="welcome-box">
          <div class="welcome-badge">Готовий до роботи</div>
          <h3>${this.escapeHtml(session.title)}</h3>
          <p>Напишіть завдання для агента у полі внизу.</p>
        </div>
      `;
      return;
    }

    const prevScrollTop = messagesEl.scrollTop;
    const wasScrolledUp = Boolean(messagesEl._userScrolledUp);

    messagesEl.innerHTML = '';
    const isSessionStreaming = Boolean(session.isStreaming || session.status === 'running');
    session.messages.forEach((msg, idx) => {
      const isLast = idx === session.messages.length - 1;
      const isLastStreaming = isLast && isSessionStreaming && msg.role === 'assistant';
      this.renderChatMessageElement(msg.role, msg.content, msg.toolCalls, isLastStreaming, msg.thinkingContent, msg, messagesEl);
    });

    if (wasScrolledUp) {
      messagesEl.scrollTop = prevScrollTop;
      const btn = messagesEl.parentElement?.querySelector('.scroll-to-bottom-btn');
      if (btn) btn.classList.add('visible');
    } else {
      this.smartScrollToBottom(messagesEl, true);
    }
    this.renderQueue(pane.sessionId);
  }

  renderActiveChat() {
    this.renderPanes();
  }

  renderQueue(targetSessionId = null) {
    const activeSess = this.sessions.find((s) => s.id === (targetSessionId || this.activeSessionId));

    // 1. Render in main queue container (if present)
    if (this.chatQueueContainer && this.queueItemsList) {
      const queue = (activeSess && activeSess.promptQueue) || [];
      if (queue.length === 0) {
        this.chatQueueContainer.style.display = 'none';
      } else {
        this.chatQueueContainer.style.display = 'block';
        if (this.queueCount) this.queueCount.innerText = queue.length;
        this.queueItemsList.innerHTML = '';
        queue.forEach((promptText, idx) => {
          const itemEl = this.createQueueItemElement(promptText, idx, activeSess);
          this.queueItemsList.appendChild(itemEl);
        });
      }
    }

    // 2. Render in each pane's queue box
    if (this.panes && this.panes.length > 0) {
      this.panes.forEach((pane) => {
        const paneEl = document.querySelector(`[data-pane-id="${pane.id}"]`);
        if (!paneEl) return;
        const queueBox = paneEl.querySelector('.pane-queue-box');
        if (!queueBox) return;

        const session = this.sessions.find((s) => s.id === pane.sessionId);
        const queue = (session && session.promptQueue) || [];

        if (queue.length === 0) {
          queueBox.style.display = 'none';
          queueBox.innerHTML = '';
        } else {
          queueBox.style.display = 'block';
          queueBox.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; font-size:10.5px; color:var(--text-muted);">
              <span>📋 Черга завдань (${queue.length})</span>
              <button type="button" class="pane-clear-queue-btn btn-xs" style="background:none; border:none; color:var(--accent-error); cursor:pointer; font-size:10px;">очистити</button>
            </div>
            <div class="pane-queue-items-list" style="display:flex; flex-direction:column; gap:4px;"></div>
          `;

          const clearBtn = queueBox.querySelector('.pane-clear-queue-btn');
          if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.clearActiveSessionQueue(session.id);
            });
          }

          const listEl = queueBox.querySelector('.pane-queue-items-list');
          queue.forEach((promptText, idx) => {
            const itemEl = this.createQueueItemElement(promptText, idx, session);
            listEl.appendChild(itemEl);
          });
        }
      });
    }
  }

  createQueueItemElement(promptText, index, session) {
    const itemEl = document.createElement('div');
    itemEl.className = 'queue-item';

    const renderNormalView = () => {
      itemEl.innerHTML = `
        <div class="queue-item-info">
          <span class="queue-item-num">#${index + 1}</span>
          <span class="queue-item-text" title="${this.escapeHtml(promptText)}">${this.escapeHtml(promptText)}</span>
        </div>
        <div class="queue-item-actions">
          <button type="button" class="queue-item-edit-btn" title="Редагувати повідомлення">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button type="button" class="queue-item-del-btn" title="Видалити з черги">✕</button>
        </div>
      `;

      itemEl.querySelector('.queue-item-edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        renderEditView();
      });

      itemEl.querySelector('.queue-item-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeQueuedPrompt(session ? session.id : this.activeSessionId, index);
      });
    };

    const renderEditView = () => {
      itemEl.innerHTML = `
        <div class="queue-item-edit-form">
          <span class="queue-item-num">#${index + 1}</span>
          <input type="text" class="queue-item-edit-input" value="${this.escapeHtml(promptText)}" placeholder="Текст завдання..." />
          <button type="button" class="queue-item-save-btn" title="Зберегти (Enter)">✓</button>
          <button type="button" class="queue-item-cancel-btn" title="Скасувати (Esc)">✕</button>
        </div>
      `;

      const input = itemEl.querySelector('.queue-item-edit-input');
      const saveBtn = itemEl.querySelector('.queue-item-save-btn');
      const cancelBtn = itemEl.querySelector('.queue-item-cancel-btn');

      input.focus();
      input.select();

      const doSave = () => {
        const val = input.value.trim();
        if (!val) {
          this.showToast('Текст завдання не може бути порожнім');
          return;
        }
        promptText = val;
        this.editQueuedPrompt(session ? session.id : this.activeSessionId, index, val);
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          renderNormalView();
        }
      });

      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        doSave();
      });

      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderNormalView();
      });
    };

    renderNormalView();
    return itemEl;
  }

  editQueuedPrompt(sessionId, index, newPrompt) {
    const targetSessionId = sessionId || this.activeSessionId;
    const session = this.sessions.find((s) => s.id === targetSessionId);
    if (!session || !session.promptQueue || !session.promptQueue[index]) return;

    session.promptQueue[index] = newPrompt.trim();
    this.renderQueue(targetSessionId);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:update_queued_prompt',
          payload: { sessionId: targetSessionId, index, newPrompt: newPrompt.trim() },
        })
      );
    }
    this.showToast('✏️ Завдання в черзі оновлено');
  }

  removeQueuedPrompt(sessionId, index) {
    let targetSessionId = sessionId;
    let targetIndex = index;
    if (typeof sessionId === 'number' && index === undefined) {
      targetIndex = sessionId;
      targetSessionId = this.activeSessionId;
    }

    const session = this.sessions.find((s) => s.id === targetSessionId);
    if (!session || !session.promptQueue) return;
    session.promptQueue.splice(targetIndex, 1);
    this.renderQueue(targetSessionId);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:remove_queued_prompt',
          payload: { sessionId: targetSessionId, index: targetIndex },
        })
      );
    }
    this.showToast('🗑️ Завдання видалено з черги');
  }

  clearActiveSessionQueue(sessionId = null) {
    const targetSessionId = sessionId || this.activeSessionId;
    const session = this.sessions.find((s) => s.id === targetSessionId);
    if (!session || !session.promptQueue) return;
    session.promptQueue = [];
    this.renderQueue(targetSessionId);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:clear_queue',
          payload: { sessionId: targetSessionId },
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

  renderChatMessageElement(role, content, toolCalls, isStreaming = false, thinkingContent = '', msgOrBlocks = null) {
    const el = document.createElement('div');
    el.className = `message ${role} ${isStreaming ? 'streaming' : ''}`;

    const isUser = role === 'user';
    const isAssistant = role === 'assistant';

    const avatarHtml = isUser
      ? `<div class="message-avatar" style="background:var(--accent-primary); color:#fff; font-weight:700; font-size:11px;">ВИ</div>`
      : `<div class="message-avatar" style="background:var(--accent-primary); color:#fff; font-weight:700; font-size:10px;">AI</div>`;

    const thinkingHtml = thinkingContent
      ? `<div class="thinking-container">${this.formatThinkingHtml(thinkingContent, isStreaming)}</div>`
      : '';

    let bodyHtml = '';
    let hasRenderableContent = Boolean(thinkingContent);

    if (isAssistant && msgOrBlocks && typeof msgOrBlocks === 'object') {
      const blocks = getRenderableMessageBlocks(msgOrBlocks);
      const blockParts = [];
      let currentToolGroup = [];

      const flushToolGroup = () => {
        if (currentToolGroup.length === 0) return;
        if (currentToolGroup.length === 1) {
          blockParts.push(this.formatToolCallHtml(currentToolGroup[0]));
        } else {
          blockParts.push(this.formatToolGroupHtml(currentToolGroup, isStreaming));
        }
        currentToolGroup = [];
      };

      for (const block of blocks) {
        if (block.type === 'text' && block.content) {
          flushToolGroup();
          const parsedContent = window.marked
            ? this.renderMarkdownSafe(block.content)
            : this.escapeHtml(block.content).replace(/\n/g, '<br>');
          blockParts.push(`<div class="message-bubble">${parsedContent}</div>`);
          hasRenderableContent = true;
        } else if (block.type === 'tool') {
          const tc = (toolCalls || msgOrBlocks.toolCalls || []).find((t) => t.id === block.toolCallId);
          if (tc) {
            currentToolGroup.push(tc);
            hasRenderableContent = true;
          }
        }
      }
      flushToolGroup();

      bodyHtml = blockParts.join('');
    } else {
      let parsedContent = '';
      if (isAssistant && window.marked && content) {
        parsedContent = this.renderMarkdownSafe(content);
      } else if (content) {
        parsedContent = this.escapeHtml(content).replace(/\n/g, '<br>');
      }

      const blockParts = [];
      if (toolCalls && toolCalls.length > 0) {
        if (toolCalls.length === 1) {
          blockParts.push(this.formatToolCallHtml(toolCalls[0]));
        } else {
          blockParts.push(this.formatToolGroupHtml(toolCalls, isStreaming));
        }
        hasRenderableContent = true;
      }

      if (parsedContent) {
        blockParts.push(`<div class="message-bubble">${parsedContent}</div>`);
        hasRenderableContent = true;
      }
      bodyHtml = blockParts.join('');
    }

    if (isStreaming && isAssistant && !hasRenderableContent) {
      bodyHtml = `
        <div class="message-bubble">
          <div class="agent-thinking-wrapper" style="display:inline-flex; align-items:center; gap:8px; padding:2px 0; color:var(--text-secondary); font-size:12.5px;">
            <span class="thinking-spinner"></span>
            <span>Агент підключається та формує план дій...</span>
          </div>
        </div>
      `;
    }

    el.innerHTML = `
      ${avatarHtml}
      <div class="message-bubble-wrapper" style="flex:1; min-width:0;">
        ${thinkingHtml}
        ${bodyHtml}
      </div>
    `;

    el.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
    });

    el.querySelectorAll('.tool-call-card').forEach((card) => {
      const id = card.id?.replace('tool-call-', '');
      if (id) this.currentToolCallElements.set(id, card);
    });

    this.chatMessages.appendChild(el);
  }

  getStreamingAssistantWrapper() {
    let assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    if (!assistantMsgEl) {
      this.renderChatMessageElement('assistant', '', [], true, '', { blocks: [], toolCalls: [] });
      assistantMsgEl = this.chatMessages.querySelector('.message.assistant.streaming');
    }
    return assistantMsgEl?.querySelector('.message-bubble-wrapper') || null;
  }

  clearStreamingPlaceholder(wrapper) {
    const initialPlaceholder = wrapper.querySelector('.agent-thinking-wrapper');
    if (initialPlaceholder) {
      const bubble = initialPlaceholder.closest('.message-bubble');
      if (bubble && !bubble.rawMarkdown) bubble.remove();
    }
  }

  getOrCreateActiveTextBubble(wrapper) {
    const streamBlocks = [...wrapper.querySelectorAll('.message-bubble, .tool-call-card')];
    const lastBlock = streamBlocks[streamBlocks.length - 1];
    if (lastBlock && lastBlock.classList.contains('message-bubble')) {
      return lastBlock;
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    wrapper.appendChild(bubble);
    return bubble;
  }

  getToolMeta(toolName, input = {}) {
    const name = (toolName || '').toLowerCase();
    
    if (name.includes('command') || name.includes('terminal') || name.includes('bash') || name.includes('exec') || name.includes('shell')) {
      const cmd = input.CommandLine || input.command || input.cmd || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
        label: 'Термінал',
        badgeClass: 'badge-terminal',
        summary: cmd ? `$ ${cmd}` : (input.toolSummary || input.toolAction || 'Виконання команди'),
      };
    }
    if (name.includes('write') || name.includes('create')) {
      const file = input.TargetFile || input.file || input.path || input.target || '';
      const fileName = file ? file.split(/[/\\]/).pop() : '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`,
        label: 'Створення файлу',
        badgeClass: 'badge-edit',
        summary: fileName || input.toolSummary || file || 'Створення нового файлу',
      };
    }
    if (name.includes('replace') || name.includes('edit')) {
      const file = input.TargetFile || input.file || input.path || input.target || '';
      const fileName = file ? file.split(/[/\\]/).pop() : '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
        label: 'Редагування',
        badgeClass: 'badge-edit',
        summary: fileName || input.toolSummary || file || 'Модифікація файлу',
      };
    }
    if (name.includes('view') || name.includes('read_file') || (name.includes('read') && !name.includes('url'))) {
      const file = input.AbsolutePath || input.path || input.TargetFile || input.file || '';
      const fileName = file ? file.split(/[/\\]/).pop() : '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
        label: 'Перегляд',
        badgeClass: 'badge-view',
        summary: fileName || input.toolSummary || file || 'Читання файлу',
      };
    }
    if (name.includes('list_dir') || name.includes('dir') || name.includes('ls')) {
      const dir = input.DirectoryPath || input.path || input.dir || '';
      const dirName = dir ? dir.split(/[/\\]/).pop() || dir : '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
        label: 'Каталог',
        badgeClass: 'badge-generic',
        summary: dirName || input.toolSummary || 'Огляд структури папки',
      };
    }
    if (name.includes('grep') || name.includes('search') || name.includes('find')) {
      const query = input.Query || input.query || input.Pattern || input.pattern || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
        label: 'Пошук',
        badgeClass: 'badge-search',
        summary: query ? `"${query}"` : (input.toolSummary || 'Пошук у проєкті'),
      };
    }
    if (name.includes('subagent') || name.includes('agent')) {
      const role = input.Role || input.role || input.TypeName || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
        label: 'Субагент',
        badgeClass: 'badge-subagent',
        summary: role || input.toolSummary || 'Фоновий субагент',
      };
    }
    if (name.includes('url') || name.includes('web') || name.includes('browser')) {
      const url = input.Url || input.url || '';
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
        label: 'Веб',
        badgeClass: 'badge-web',
        summary: url || input.toolSummary || 'Веб-сторінка',
      };
    }
    if (name.includes('question') || name.includes('ask')) {
      return {
        icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
        label: 'Запитання',
        badgeClass: 'badge-web',
        summary: input.toolSummary || 'Уточнююче запитання',
      };
    }

    return {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
      label: toolName || 'Дія',
      badgeClass: 'badge-generic',
      summary: input.toolSummary || input.toolAction || '',
    };
  }

  formatToolGroupHtml(toolList, isStreaming = false) {
    if (!toolList || toolList.length === 0) return '';
    if (toolList.length === 1) return this.formatToolCallHtml(toolList[0]);

    const hasRunning = toolList.some((t) => t.status === 'running');
    const hasError = toolList.some((t) => t.status === 'failed' || t.status === 'error');

    const actionNames = toolList.map((t) => {
      let raw = t.input || t.arguments || t.args || t.parameters;
      if (typeof raw === 'string' && (raw.trim().startsWith('{') || raw.trim().startsWith('['))) {
        try { raw = JSON.parse(raw); } catch {}
      }
      const meta = this.getToolMeta(t.name || t.type, raw || {});
      return meta.label || t.name || 'дія';
    });
    const uniqueActionNames = [...new Set(actionNames)];
    const actionSummaryStr = uniqueActionNames.slice(0, 3).join(', ') + (uniqueActionNames.length > 3 ? '...' : '');

    const statusBadge = hasRunning
      ? '<span class="tool-group-status running"><span class="pulse-dot"></span> виконується...</span>'
      : hasError
      ? '<span class="tool-group-status error">✕ помилки</span>'
      : `<span class="tool-group-status completed">✓ ${toolList.length} дій завершено</span>`;

    const cardsHtml = toolList.map((t) => this.formatToolCallHtml(t)).join('');

    return `
      <div class="tool-calls-group ${hasRunning ? 'running' : 'collapsed'}">
        <div class="tool-calls-group-header" onclick="this.closest('.tool-calls-group').classList.toggle('collapsed')">
          <div class="tool-calls-group-left">
            <span class="tool-calls-group-icon">⚡</span>
            <span class="tool-calls-group-title">Виклики дій (${toolList.length}):</span>
            <span class="tool-calls-group-summary">${this.escapeHtml(actionSummaryStr)}</span>
          </div>
          <div class="tool-calls-group-right">
            ${statusBadge}
            <button type="button" class="tool-group-toggle-btn" title="Показати/Приховати всі дії">
              <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
          </div>
        </div>
        <div class="tool-calls-group-body">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  formatToolCallHtml(tc) {
    let rawInput = tc.input || tc.arguments || tc.args || tc.parameters;
    if (typeof rawInput === 'string' && (rawInput.trim().startsWith('{') || rawInput.trim().startsWith('['))) {
      try {
        rawInput = JSON.parse(rawInput);
      } catch {}
    }
    const meta = this.getToolMeta(tc.name || tc.type, rawInput || {});
    const actionText = tc.action || (rawInput && typeof rawInput === 'object' ? (rawInput.toolAction || rawInput.Instruction) : '') || '';
    const summaryText = tc.summary || (rawInput && typeof rawInput === 'object' ? (rawInput.toolSummary || rawInput.Description) : '') || meta.summary || '';
    const isRunning = tc.status === 'running';
    const isError = tc.status === 'failed' || tc.status === 'error';
    const statusLabel = isRunning ? '<span class="pulse-dot"></span> виконується...' : isError ? '✕ помилка' : '✓ завершено';
    const statusClass = isRunning ? 'running' : isError ? 'error' : 'completed';

    const inputJson = rawInput ? (typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput, null, 2)) : '';
    const outputText = tc.output || tc.result || '';

    let questionsHtml = '';
    if (rawInput && Array.isArray(rawInput.questions)) {
      questionsHtml = rawInput.questions
        .map((q) => {
          const qText = q.question || '';
          const options = Array.isArray(q.options) ? q.options : [];
          const optBtns = options
            .map(
              (opt) =>
                `<button type="button" class="question-option-chip" data-answer="${this.escapeHtml(opt)}" onclick="window.app.fillPromptInput(this.dataset.answer, true);" title="Обрати цей варіант">
                   <span>👉</span>
                   <span>${this.escapeHtml(opt)}</span>
                 </button>`
            )
            .join('');
          return `
            <div class="question-tool-box">
              <div class="question-item-title">❓ ${this.escapeHtml(qText)}</div>
              ${optBtns ? `<div class="question-options-list">${optBtns}</div>` : ''}
            </div>
          `;
        })
        .join('');
    }

    const isFileTool = Boolean(rawInput && typeof rawInput === 'object' && (rawInput.TargetFile || rawInput.file || rawInput.path || rawInput.AbsolutePath || rawInput.target));
    const artifactBtnHtml = isFileTool
      ? `<button type="button" class="tool-artifact-view-btn" data-tool-call-id="${this.escapeHtml(tc.id)}" title="Переглянути файл/артефакт поруч із чатом">
           <span>📄 Артефакт</span>
         </button>`
      : '';

    return `
      <div class="tool-call-card ${statusClass}" id="tool-call-${tc.id}">
        <div class="tool-call-header" onclick="this.closest('.tool-call-card').classList.toggle('expanded')">
          <div class="tool-call-header-left">
            <span class="tool-call-category-badge ${meta.badgeClass}">
              ${meta.icon}
              <span>${meta.label}</span>
            </span>
            <span class="tool-call-fn-name">${this.escapeHtml(tc.name || tc.type || 'tool')}</span>
            ${actionText ? `<span class="tool-call-summary" title="${this.escapeHtml(actionText)}">${this.escapeHtml(actionText)}</span>` : (summaryText ? `<span class="tool-call-summary" title="${this.escapeHtml(summaryText)}">${this.escapeHtml(summaryText)}</span>` : '')}
          </div>
          <div class="tool-call-header-right">
            ${artifactBtnHtml}
            <span class="tool-call-status ${statusClass}">
              ${statusLabel}
            </span>
            <button type="button" class="tool-call-toggle-btn" title="Розгорнути/Згорнути деталі">
              <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
          </div>
        </div>
        <div class="tool-call-body">
          ${questionsHtml}
          ${(actionText || summaryText) ? `
            <div class="tool-call-meta-box">
              ${actionText ? `<div class="tool-call-meta-row"><span class="tool-call-meta-key">🎯 Дія:</span> <span class="tool-call-meta-val">${this.escapeHtml(actionText)}</span></div>` : ''}
              ${summaryText && summaryText !== actionText ? `<div class="tool-call-meta-row"><span class="tool-call-meta-key">📋 Опис:</span> <span class="tool-call-meta-val">${this.escapeHtml(summaryText)}</span></div>` : ''}
            </div>
          ` : ''}
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
      </div>
    `;
  }

  getPaneMessagesContainers(sessionId) {
    if (!sessionId) return [this.chatMessages].filter(Boolean);
    const matched = this.panes ? this.panes.filter((p) => p.sessionId === sessionId) : [];
    if (matched.length === 0) return [this.chatMessages].filter(Boolean);
    return matched
      .map((p) => document.querySelector(`[data-pane-id="${p.id}"] .chat-pane-messages`))
      .filter(Boolean);
  }

  appendAssistantThinking(sessionId, payload) {
    const delta = typeof payload === 'string' ? payload : payload?.delta;
    const thinking = typeof payload === 'string' ? undefined : payload?.thinking;
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) {
      const lastMsg = [...(session.messages || [])].reverse().find((m) => m.role === 'assistant');
      if (lastMsg) {
        lastMsg.thinkingContent = applyStreamText(lastMsg.thinkingContent || '', { chunk: thinking, delta: typeof payload === 'string' ? payload : delta });
        lastMsg.isStreaming = true;
      }
    }

    const containers = this.getPaneMessagesContainers(sessionId);
    containers.forEach((messagesEl) => {
      let assistantMsgEl = messagesEl.querySelector('.message.assistant.streaming');
      if (!assistantMsgEl) {
        this.renderChatMessageElement('assistant', '', [], true, '', { blocks: [], toolCalls: [] }, messagesEl);
        assistantMsgEl = messagesEl.querySelector('.message.assistant.streaming');
      }
      if (!assistantMsgEl) return;

      const wrapper = assistantMsgEl.querySelector('.message-bubble-wrapper');
      if (!wrapper) return;
      this.clearStreamingPlaceholder(wrapper);

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

      const body = thinkingAccordion?.querySelector('.thinking-accordion-body');
      const textEl = thinkingAccordion?.querySelector('.thinking-text');
      if (textEl) {
        const next = applyStreamText(textEl.textContent || '', { chunk: thinking, delta: typeof payload === 'string' ? payload : delta });
        textEl.textContent = next;
        if (body) body.style.display = 'block';
      }
      this.smartScrollToBottom(messagesEl);
    });
  }

  appendAssistantChunk(sessionId, payload) {
    const streamPayload = typeof payload === 'string' ? { delta: payload } : payload;
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) {
      const lastMsg = [...(session.messages || [])].reverse().find((m) => m.role === 'assistant');
      if (lastMsg) {
        lastMsg.content = applyStreamText(lastMsg.content || '', streamPayload);
        lastMsg.isStreaming = true;
      }
    }

    const containers = this.getPaneMessagesContainers(sessionId);
    containers.forEach((messagesEl) => {
      let assistantMsgEl = messagesEl.querySelector('.message.assistant.streaming');
      if (!assistantMsgEl) {
        this.renderChatMessageElement('assistant', '', [], true, '', { blocks: [], toolCalls: [] }, messagesEl);
        assistantMsgEl = messagesEl.querySelector('.message.assistant.streaming');
      }
      if (!assistantMsgEl) return;

      const wrapper = assistantMsgEl.querySelector('.message-bubble-wrapper');
      if (wrapper) this.clearStreamingPlaceholder(wrapper);

      let bubble = wrapper ? this.getOrCreateActiveTextBubble(wrapper) : null;
      if (bubble) {
        if (!bubble.rawMarkdown) {
          bubble.rawMarkdown = '';
          bubble.innerHTML = '';
        }
        const next = applyStreamText(bubble.rawMarkdown || '', streamPayload);
        bubble.rawMarkdown = next;
        if (window.marked) {
          bubble.innerHTML = this.renderMarkdownSafe(next);
          bubble.querySelectorAll('pre code').forEach((b) => {
            if (window.hljs) hljs.highlightElement(b);
          });
        } else {
          bubble.innerText = next;
        }
      }
      this.smartScrollToBottom(messagesEl);
    });
  }

  flushStreamingMarkdown() {
    this._streamRenderQueued = false;
    const bubble = this._pendingStreamBubble;
    if (!bubble || !bubble.isConnected) return;
    const md = bubble.rawMarkdown || '';
    if (!md) return;
    if (window.marked) {
      bubble.innerHTML = this.renderMarkdownSafe(md);
      bubble.querySelectorAll('pre code').forEach((b) => {
        if (window.hljs) hljs.highlightElement(b);
      });
    } else {
      bubble.innerText = md;
    }
    this.smartScrollToBottom(this.chatMessages);
  }

  renderToolCall(sessionId, toolCall) {
    const rawInput = toolCall.input || toolCall.arguments;
    const meta = this.getToolMeta(toolCall.name || toolCall.type, rawInput);
    const containers = this.getPaneMessagesContainers(sessionId);

    containers.forEach((messagesEl) => {
      let assistantMsgEl = messagesEl.querySelector('.message.assistant.streaming');
      if (!assistantMsgEl) {
        this.renderChatMessageElement('assistant', '', [], true, '', { blocks: [], toolCalls: [] }, messagesEl);
        assistantMsgEl = messagesEl.querySelector('.message.assistant.streaming');
      }
      if (!assistantMsgEl) return;

      const wrapper = assistantMsgEl.querySelector('.message-bubble-wrapper');
      if (!wrapper) return;
      this.clearStreamingPlaceholder(wrapper);

      const existingTc = wrapper.querySelector(`#tool-call-${toolCall.id}`);
      if (existingTc) {
        const temp = document.createElement('div');
        temp.innerHTML = this.formatToolCallHtml(toolCall);
        if (temp.firstElementChild) {
          existingTc.replaceWith(temp.firstElementChild);
          this.currentToolCallElements.set(toolCall.id, wrapper.querySelector(`#tool-call-${toolCall.id}`));
        }
      } else {
        const temp = document.createElement('div');
        temp.innerHTML = this.formatToolCallHtml(toolCall);
        const card = temp.firstElementChild;
        if (card) {
          wrapper.appendChild(card);
          this.currentToolCallElements.set(toolCall.id, card);
        }
      }
      this.smartScrollToBottom(messagesEl);
    });
  }

  renderToolResult(sessionId, toolCallId, result, status) {
    const allCards = document.querySelectorAll(`#tool-call-${toolCallId}`);
    allCards.forEach((tcEl) => {
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
    });
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

      const wsOpen = this.ws && this.ws.readyState === WebSocket.OPEN;
      if (!wsOpen) {
        this.markAgentActivity();
        return;
      }

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
      if (cursorChatId && options.success !== false) session.cursorChatId = cursorChatId;
      if (options.success === false && isUsageLimitError(options.error)) session.cursorChatId = undefined;
    }

    if (!options.silent) {
      if (options.aborted) {
        this.showToast('🛑 Запит до агента зупинено');
      } else if (options.success === false) {
        this.showToast(`⚠️ ${options.error || 'Агент завершився з помилкою'}`, 6000);
      } else {
        this.showToast('✨ Агент завершив виконання завдання');
      }
    }

    // Update all panes displaying this session
    const containers = this.getPaneMessagesContainers(sessionId);
    containers.forEach((messagesEl) => {
      const streamingMsg = messagesEl.querySelector('.message.assistant.streaming');
      if (streamingMsg) {
        streamingMsg.classList.remove('streaming');
        const liveThinkingBadge = streamingMsg.querySelector('.thinking-live-badge');
        if (liveThinkingBadge) liveThinkingBadge.remove();

        const thinkingAccordion = streamingMsg.querySelector('.thinking-accordion');
        if (thinkingAccordion) {
          thinkingAccordion.classList.remove('streaming');
          const body = thinkingAccordion.querySelector('.thinking-accordion-body');
          if (body && body.textContent.trim() !== '') {
            thinkingAccordion.classList.remove('open');
          }
        }
      }
    });

    this.renderPanes();
    this.renderSessions();

    if (this.voiceMode?.enabled) {
      const lastBubble = this.chatMessages?.querySelector('.message.assistant:last-of-type .message-bubble');
      const spokenText = (lastBubble && (lastBubble.rawMarkdown || lastBubble.innerText)) || options.error || '';
      const hasToolCalls = Boolean(this.chatMessages?.querySelector('.message.assistant:last-of-type .tool-call-card'));
      this.voiceMode.onAgentComplete(session, { ...options, spokenText, hasToolCalls });
    }
  }

  handleAgentError(sessionId, error) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.isStreaming = false;
      session.status = 'idle';
    }
    this.showToast(`❌ Помилка: ${error}`, 5000);
    this.renderPanes();
    this.renderSessions();
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
          ? 'Сесія Google Antigravity'
          : 'Сесія Cursor AI Agent',
        engine,
        model: isAgy ? 'gemini-3.7-flash' : 'composer-2.5',
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
    data.session._loaded = true;
    this.sessions.unshift(data.session);
    this.renderProjects();
    this.renderSessions();
    this.selectSession(data.session.id);
    return data.session;
  }

  async sendPrompt(paneId = null) {
    const pane = (paneId && this.panes.find((p) => p.id === paneId)) || this.activePane || this.panes[0];
    if (!pane) return false;

    const paneEl = document.querySelector(`[data-pane-id="${pane.id}"]`);
    const promptInput = paneEl ? paneEl.querySelector('.pane-prompt-input') : this.promptInput;
    const text = promptInput ? promptInput.value.trim() : '';
    if (!text) return false;

    if (this.voiceMode?.enabled && this.voiceMode.consumeStopCommand(text)) {
      if (promptInput) {
        promptInput.value = '';
        promptInput.style.height = 'auto';
      }
      return false;
    }

    // No session in this pane -> create Antigravity session
    if (!pane.sessionId) {
      try {
        this.showToast('✨ Створюю чат Antigravity…');
        const newSess = await this.ensureActiveSession('antigravity');
        pane.sessionId = newSess.id;
        this.activeSessionId = newSess.id;
      } catch (err) {
        this.showToast(`❌ ${err.message || 'Помилка'}`, 4500);
        return false;
      }
    }

    const session = this.sessions.find((s) => s.id === pane.sessionId);
    if (!session) return false;

    if (promptInput) {
      promptInput.value = '';
      promptInput.style.height = 'auto';
    }

    const isRunning = Boolean(session.isStreaming || session.status === 'running');
    if (isRunning) {
      session.promptQueue = session.promptQueue || [];
      if (session.promptQueue.length > 0 && session.promptQueue[session.promptQueue.length - 1] === text) {
        return false;
      }
      session.promptQueue.push(text);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'agent:queue_prompt',
          payload: { sessionId: session.id, prompt: text }
        }));
      }
      this.showToast(`🕒 Додано в чергу (#${session.promptQueue.length})`);
      this.renderPanes();
      return true;
    }

    // Add user message to session
    const userMsg = {
      id: 'msg-' + Date.now(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };
    if (!session.messages) session.messages = [];
    session.messages.push(userMsg);

    // Add assistant streaming placeholder
    const assistantMsg = {
      id: 'msg-' + (Date.now() + 1),
      role: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: Date.now()
    };
    session.messages.push(assistantMsg);
    session.isStreaming = true;
    session.status = 'running';

    const modelSelect = paneEl ? paneEl.querySelector('.pane-model-select') : null;
    const effortSelect = paneEl ? paneEl.querySelector('.pane-effort-select') : null;
    const promptEngine = session.engine === 'antigravity' ? 'antigravity' : 'cursor';
    let effectiveModel = modelSelect?.value || session.model || this.defaultModelFor(promptEngine);
    let effectiveEffort = effortSelect?.value || session.thinkingEffort || (promptEngine === 'antigravity' ? 'high' : 'medium');

    session.model = effectiveModel;
    session.thinkingEffort = effectiveEffort;

    this.renderPanes();
    this.renderSessions();

    const lastAssistant = Array.isArray(session.messages)
      ? [...session.messages].reverse().find((m) => m.role === 'assistant' && m.content)
      : null;
    const resumeId = isUsageLimitError(lastAssistant && lastAssistant.content)
      ? undefined
      : session.cursorChatId;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'agent:prompt',
          payload: {
            sessionId: session.id,
            deviceId: (this.getActiveDevice() && this.getActiveDevice().id) || this.activeDeviceId,
            engine: promptEngine,
            prompt: text,
            model: effectiveModel,
            mode: session.mode || 'yolo',
            workspacePath: session.workspacePath || this.workspaceInput?.value || '',
            cursorChatId: resumeId,
            thinkingEffort: effectiveEffort,
          },
        })
      );
      return true;
    }

    this.showToast('Немає зʼєднання з сервером', 4000);
    session.isStreaming = false;
    session.status = 'idle';
    this.renderPanes();
    return false;
  }

  stopAgent(sessionId = null) {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) return;
    const session = this.sessions.find((s) => s.id === targetSessionId);
    if (session) {
      session.isStreaming = false;
      session.status = 'idle';
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent:abort', payload: { sessionId: targetSessionId } }));
    }
    this.handleAgentComplete(targetSessionId, undefined, { aborted: true });
  }

  fillPromptInput(text, autoSubmit = false) {
    const activePane = this.panes.find((p) => p.id === this.activePaneId) || this.panes[0];
    const paneEl = activePane ? document.querySelector(`[data-pane-id="${activePane.id}"]`) : null;
    const promptInput = paneEl ? paneEl.querySelector('.pane-prompt-input') : this.promptInput;
    if (promptInput) {
      promptInput.value = text;
      promptInput.focus();
      if (autoSubmit && activePane) {
        this.sendPrompt(activePane.id);
      }
    }
  }

  attachScrollListener(messagesEl) {
    if (!messagesEl || messagesEl._hasScrollListener) return;
    messagesEl._hasScrollListener = true;
    messagesEl.addEventListener('scroll', () => {
      const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
      const btn = messagesEl.parentElement?.querySelector('.scroll-to-bottom-btn');
      if (distance <= 60) {
        messagesEl._userScrolledUp = false;
        if (btn) btn.classList.remove('visible');
      } else if (distance > 100) {
        messagesEl._userScrolledUp = true;
        if (btn) btn.classList.add('visible');
      }
    }, { passive: true });
  }

  isUserAtBottom(messagesEl, threshold = 90) {
    if (!messagesEl) return true;
    const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    return distance <= threshold;
  }

  smartScrollToBottom(messagesEl, force = false, threshold = 90) {
    if (!messagesEl) return;
    this.attachScrollListener(messagesEl);

    if (force) {
      messagesEl._userScrolledUp = false;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      const btn = messagesEl.parentElement?.querySelector('.scroll-to-bottom-btn');
      if (btn) btn.classList.remove('visible');
      return;
    }

    if (!messagesEl._userScrolledUp && this.isUserAtBottom(messagesEl, threshold)) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      const btn = messagesEl.parentElement?.querySelector('.scroll-to-bottom-btn');
      if (btn) btn.classList.remove('visible');
    } else if (messagesEl._userScrolledUp) {
      const btn = messagesEl.parentElement?.querySelector('.scroll-to-bottom-btn');
      if (btn) btn.classList.add('visible');
    }
  }

  scrollToBottom(container = this.chatMessages, force = true) {
    if (container) {
      this.smartScrollToBottom(container, force);
    }
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

    const defaultWs = (dev && dev.defaultWorkspace) || this.workspaceInput?.value || '';
    if (this.modalWorkspaceInput) {
      this.modalWorkspaceInput.value = defaultWs;
    }

    if (this.modalSessionTitle) this.modalSessionTitle.value = '';
    if (this.modalSessionDesc) this.modalSessionDesc.value = '';

    this.populateModalProjectSelect();
    if (this.activeProjectId && this.activeProjectId !== 'all' && this.activeProjectId !== 'unassigned') {
      const activeProj = this.projects.find((p) => p.id === this.activeProjectId);
      if (activeProj) {
        if (this.modalProjectSelect) this.modalProjectSelect.value = activeProj.id;
        if (activeProj.workspacePath && this.modalWorkspaceInput) {
          this.modalWorkspaceInput.value = activeProj.workspacePath;
        }
        if (activeProj.defaultEngine) {
          this.setModalEngine(activeProj.defaultEngine);
        }
      }
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

    if (this.modalModelSelect) {
      const engine = isAgy ? 'antigravity' : 'cursor';
      this.modalModelSelect.innerHTML = this.buildModelOptionsHtml(engine, this.defaultModelFor(engine));
      this.refreshCustomSelect(this.modalModelSelect);
    }
  }

  getDeviceModels(engine) {
    const dev = this.getActiveDevice();
    const all = (dev && dev.availableModels) || [];
    if (engine === 'cursor') {
      return all.filter((m) => m.engine === 'cursor' && !isGeminiModelId(m.id));
    }
    return all.filter((m) => m.engine === engine);
  }

  defaultModelFor(engine) {
    const models = this.getDeviceModels(engine);
    if (engine === 'antigravity') {
      const preferred = models.find((m) => m.id === 'gemini-3.7-flash') || models[0];
      return preferred ? preferred.id : 'gemini-3.7-flash';
    }
    const composer = models.find((m) => m.id === 'composer-2.5');
    if (composer) return composer.id;
    return models.length ? models[0].id : 'composer-2.5';
  }

  modelSupportsEffort(engine, modelId) {
    if (engine !== 'antigravity') return false;
    const model = this.getDeviceModels(engine).find((m) => m.id === modelId);
    if (model && typeof model.supportsEffort === 'boolean') {
      return model.supportsEffort;
    }
    if (!modelId || modelId === 'auto' || modelId === 'default') return true;
    const clean = String(modelId).toLowerCase();
    if (/-(low|medium|high|xhigh|max|minimal)$/i.test(clean)) return false;
    if (/claude|thinking/i.test(clean)) return false;
    if (/^(gemini|gpt-oss)/i.test(clean)) return true;
    return false;
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
    const desc = (this.modalSessionDesc && this.modalSessionDesc.value.trim()) || (isAgy ? 'Сесія Google Antigravity' : 'Сесія Cursor AI Agent');
    const model = (this.modalModelSelect && this.modalModelSelect.value) || this.defaultModelFor(isAgy ? 'antigravity' : 'cursor');
    const mode = (this.modalModeSelect && this.modalModeSelect.value) || 'yolo';
    const thinkingEffort = isAgy ? (this.modelSupportsEffort('antigravity', model) ? 'high' : 'off') : 'medium';
    const projectId = (this.modalProjectSelect && this.modalProjectSelect.value) || (this.activeProjectId !== 'all' && this.activeProjectId !== 'unassigned' ? this.activeProjectId : undefined);

    const newSession = {
      deviceId: chosenDeviceId,
      title,
      description: desc,
      engine: this.currentSelectedEngine,
      model,
      mode,
      thinkingEffort,
      workspacePath: workspace,
      projectId: projectId || undefined,
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
        data.session._loaded = true;
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
        data.session._loaded = true;
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
    
    // Transform GitHub alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
    let preprocessed = markdown
      .replace(/^>\s*\[!NOTE\][ \t]*\n((?:^>.*\n?)*)/gim, (m, body) => {
        const cleanBody = body.replace(/^>\s?/gm, '').trim();
        return `<div class="markdown-alert markdown-alert-note"><strong>ℹ️ Примітка</strong>\n\n${cleanBody}</div>\n`;
      })
      .replace(/^>\s*\[!TIP\][ \t]*\n((?:^>.*\n?)*)/gim, (m, body) => {
        const cleanBody = body.replace(/^>\s?/gm, '').trim();
        return `<div class="markdown-alert markdown-alert-tip"><strong>💡 Підказка</strong>\n\n${cleanBody}</div>\n`;
      })
      .replace(/^>\s*\[!IMPORTANT\][ \t]*\n((?:^>.*\n?)*)/gim, (m, body) => {
        const cleanBody = body.replace(/^>\s?/gm, '').trim();
        return `<div class="markdown-alert markdown-alert-important"><strong>❗ Важливо</strong>\n\n${cleanBody}</div>\n`;
      })
      .replace(/^>\s*\[!WARNING\][ \t]*\n((?:^>.*\n?)*)/gim, (m, body) => {
        const cleanBody = body.replace(/^>\s?/gm, '').trim();
        return `<div class="markdown-alert markdown-alert-warning"><strong>⚠️ Попередження</strong>\n\n${cleanBody}</div>\n`;
      })
      .replace(/^>\s*\[!CAUTION\][ \t]*\n((?:^>.*\n?)*)/gim, (m, body) => {
        const cleanBody = body.replace(/^>\s?/gm, '').trim();
        return `<div class="markdown-alert markdown-alert-caution"><strong>🛑 Застереження</strong>\n\n${cleanBody}</div>\n`;
      });

    if (!window.marked) return this.escapeHtml(preprocessed).replace(/\n/g, '<br>');
    return this.sanitizeMarkdownHtml(marked.parse(preprocessed));
  }

  // ================= ARTIFACT VIEWER METHODS =================
  async openArtifact(artifact) {
    if (!artifact) return;
    if (!this.chatArtifactViewer) return;

    this.currentActiveArtifact = artifact;
    const filePath = artifact.path || artifact.filePath || artifact.title || 'artifact.md';
    const fileName = artifact.title || filePath.split(/[/\\]/).pop() || 'artifact.md';

    this.chatArtifactViewer.style.display = 'flex';
    if (this.artifactViewerTitle) this.artifactViewerTitle.innerText = fileName;
    if (this.artifactViewerPath) {
      this.artifactViewerPath.innerText = filePath;
      this.artifactViewerPath.title = filePath;
    }
    if (this.artifactViewerIcon) {
      this.artifactViewerIcon.innerHTML = this.getFileIcon(fileName);
    }

    // Set default mode
    const ext = fileName.split('.').pop().toLowerCase();
    const isMd = ['md', 'markdown', 'txt'].includes(ext);
    this.setArtifactViewerMode(isMd ? 'rendered' : 'raw');

    if (artifact.content !== undefined && artifact.content !== null) {
      this.displayArtifactContent(artifact.content, filePath);
      return;
    }

    // Show loading state
    if (this.artifactRenderedContent) {
      this.artifactRenderedContent.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; color:var(--text-muted); gap:12px;">
          <span class="thinking-spinner" style="width:24px; height:24px; border-width:2.5px;"></span>
          <span>Завантаження вмісту артефакту...</span>
        </div>
      `;
    }

    try {
      // 1. Try fetching from server content endpoint
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        artifact.content = data.content;
        this.displayArtifactContent(data.content, filePath);
        return;
      }
    } catch (err) {
      console.warn('[Artifact] HTTP fetch failed, fallback to WS:', err);
    }

    // 2. Fallback to WS fs:read_file
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._pendingArtifactReqId = Math.random().toString(36).substring(2, 8);
      this.ws.send(
        JSON.stringify({
          type: 'fs:read_file',
          payload: {
            reqId: this._pendingArtifactReqId,
            filePath,
            workspacePath: this.getWorkspaceRoot(),
            deviceId: this.activeDeviceId,
          },
        })
      );
    }
  }

  displayArtifactContent(content, filePath = '') {
    this.currentArtifactRawContent = content || '';
    const ext = filePath.split('.').pop().toLowerCase();
    const isMd = ['md', 'markdown', 'txt'].includes(ext) || (!filePath.includes('.') && content.startsWith('#'));

    // 1. Render Markdown View
    if (this.artifactRenderedContent) {
      if (isMd && window.marked) {
        this.artifactRenderedContent.innerHTML = this.renderMarkdownSafe(content);
        this.artifactRenderedContent.querySelectorAll('pre code').forEach((b) => {
          if (window.hljs) hljs.highlightElement(b);
        });
      } else {
        const escaped = this.escapeHtml(content);
        this.artifactRenderedContent.innerHTML = `<pre style="margin:0; font-family:var(--font-mono, monospace); font-size:12.5px;"><code>${escaped}</code></pre>`;
      }
    }

    // 2. Render Raw Code View
    if (this.artifactRawCode) {
      this.artifactRawCode.innerText = content || '';
      if (window.hljs) {
        hljs.highlightElement(this.artifactRawCode);
      }
    }
  }

  setArtifactViewerMode(mode) {
    this.currentArtifactMode = mode;
    if (this.artifactViewModeToggle) {
      this.artifactViewModeToggle.querySelectorAll('.artifact-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });
    }

    if (this.artifactRenderedContent && this.artifactRawContent) {
      if (mode === 'rendered') {
        this.artifactRenderedContent.style.display = 'block';
        this.artifactRawContent.style.display = 'none';
      } else {
        this.artifactRenderedContent.style.display = 'none';
        this.artifactRawContent.style.display = 'block';
      }
    }
  }

  closeArtifactViewer() {
    if (this.chatArtifactViewer) {
      this.chatArtifactViewer.style.display = 'none';
    }
    this.currentActiveArtifact = null;
  }

  copyCurrentArtifactContent() {
    if (!this.currentArtifactRawContent) {
      this.showToast('Вміст артефакту порожній');
      return;
    }
    navigator.clipboard.writeText(this.currentArtifactRawContent);
    this.showToast('📋 Вміст артефакту скопійовано!');
  }

  downloadCurrentArtifactFile() {
    if (!this.currentArtifactRawContent) return;
    const fileName = this.artifactViewerTitle?.innerText || 'artifact.txt';
    const blob = new Blob([this.currentArtifactRawContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`💾 Файл «${fileName}» завантажено`);
  }

  openArtifactFromToolCall(toolCallId) {
    if (!toolCallId) return;
    for (const s of this.sessions) {
      if (!s.messages) continue;
      for (const m of s.messages) {
        const tc = (m.toolCalls || []).find((t) => t.id === toolCallId);
        if (tc) {
          const raw = tc.input || tc.arguments || {};
          const filePath = raw.TargetFile || raw.AbsolutePath || raw.file || raw.path || raw.target || 'artifact.txt';
          const fileName = filePath.split(/[/\\]/).pop() || filePath;
          const code = raw.CodeContent || raw.ReplacementContent || tc.output || tc.result || '';
          this.openArtifact({
            title: fileName,
            path: filePath,
            content: code,
          });
          return;
        }
      }
    }
    this.showToast('Не вдалося знайти вміст артефакту');
  }

  extractSessionArtifacts(sessionId = null) {
    const targetSessionId = sessionId || this.activeSessionId;
    const session = this.sessions.find((s) => s.id === targetSessionId);
    if (!session || !session.messages) return [];

    const artifactsMap = new Map();

    session.messages.forEach((msg) => {
      // 1. Tool calls
      (msg.toolCalls || []).forEach((tc) => {
        const raw = tc.input || tc.arguments || {};
        const filePath = raw.TargetFile || raw.AbsolutePath || raw.file || raw.path;
        if (filePath && !artifactsMap.has(filePath)) {
          const fileName = filePath.split(/[/\\]/).pop() || filePath;
          const code = raw.CodeContent || raw.ReplacementContent || tc.output || '';
          artifactsMap.set(filePath, {
            id: tc.id,
            title: fileName,
            path: filePath,
            content: code || undefined,
            timestamp: msg.timestamp || Date.now(),
          });
        }
      });

      // 2. Markdown links in assistant messages
      if (msg.role === 'assistant' && msg.content) {
        const linkRegex = /\[([^\]]+)\]\(([^)]+\.(?:md|markdown|json|ts|js|py|html|css|txt|yaml|yml|sh|svg)(?:#[^)]*)?)\)/gi;
        let match;
        while ((match = linkRegex.exec(msg.content)) !== null) {
          const title = match[1];
          let href = match[2];
          if (href.startsWith('file://')) href = href.replace(/^file:\/\/\/?/, '');
          if (!artifactsMap.has(href) && !href.startsWith('http://') && !href.startsWith('https://')) {
            artifactsMap.set(href, {
              id: 'link-' + Math.random().toString(36).slice(2, 7),
              title: title || href.split(/[/\\]/).pop() || 'Артефакт',
              path: href,
              timestamp: msg.timestamp || Date.now(),
            });
          }
        }
      }
    });

    const list = Array.from(artifactsMap.values());
    if (this.sessionArtifactsCount) {
      if (list.length > 0) {
        this.sessionArtifactsCount.innerText = list.length;
        this.sessionArtifactsCount.style.display = 'inline-block';
      } else {
        this.sessionArtifactsCount.style.display = 'none';
      }
    }
    return list;
  }

  openSessionArtifactsModal() {
    const artifacts = this.extractSessionArtifacts(this.activeSessionId);
    if (!this.sessionArtifactsModal || !this.sessionArtifactsList) return;

    if (artifacts.length === 0) {
      this.sessionArtifactsList.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:var(--text-muted);">
          <div style="font-size:32px; margin-bottom:8px;">📄</div>
          <div style="font-size:13px; font-weight:600; color:var(--text-secondary);">Немає артефактів</div>
          <p style="font-size:11.5px; margin-top:4px;">У цій сесії ще не згенеровано файлів або планів.</p>
        </div>
      `;
    } else {
      this.sessionArtifactsList.innerHTML = '';
      artifacts.forEach((art) => {
        const item = document.createElement('div');
        item.className = 'session-artifact-item';
        item.innerHTML = `
          <div class="session-artifact-item-left">
            <span style="font-size:16px;">${this.getFileIcon(art.title)}</span>
            <div>
              <div class="session-artifact-item-title">${this.escapeHtml(art.title)}</div>
              <div class="session-artifact-item-path">${this.escapeHtml(art.path)}</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-xs" style="font-size:11px; padding:3px 8px; flex-shrink:0;">Відкрити</button>
        `;
        item.addEventListener('click', () => {
          this.sessionArtifactsModal.style.display = 'none';
          this.openArtifact(art);
        });
        this.sessionArtifactsList.appendChild(item);
      });
    }

    this.sessionArtifactsModal.style.display = 'flex';
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
