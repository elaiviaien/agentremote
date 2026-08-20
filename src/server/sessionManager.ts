import { ChatSession, ChatSessionSummary, ChatMessage, ToolCallItem, Project } from '../shared/types';
import { applyStreamText } from '../shared/streamText';
import { appendTextToBlocks, appendToolToBlocks } from '../shared/messageBlocks';
import { truncateToolCallItem, truncateString, ChatSanitizer } from '../shared/chatSanitizer';
import { db } from './db';
import { randomUUID } from 'crypto';

export class SessionManager {
  private activeStreams = new Map<string, string>(); // sessionId -> accumulator

  public getSessions(deviceId?: string): ChatSession[] {
    return db.getSessions(deviceId);
  }

  public getSessionSummaries(deviceId?: string): ChatSessionSummary[] {
    const sessions = db.getSessions(deviceId);
    return sessions.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      title: s.title,
      description: s.description,
      projectId: s.projectId,
      isPinned: Boolean(s.isPinned),
      engine: s.engine,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      cursorChatId: s.cursorChatId,
      sourceSessionId: s.sourceSessionId,
      sourceFilePath: s.sourceFilePath,
      workspacePath: s.workspacePath,
      model: s.model,
      mode: s.mode,
      messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
      isStreaming: s.isStreaming,
      status: s.status,
      thinkingEffort: s.thinkingEffort,
      promptQueue: s.promptQueue,
    }));
  }

  public getSession(id: string): ChatSession | undefined {
    return db.getSession(id);
  }

  public createSession(params: {
    deviceId: string;
    title?: string;
    description?: string;
    projectId?: string;
    isPinned?: boolean;
    engine?: 'cursor' | 'antigravity';
    workspacePath?: string;
    model?: string;
    mode?: 'agent' | 'plan' | 'ask' | 'yolo' | 'auto' | 'auto-review';
    cursorChatId?: string;
    sourceSessionId?: string;
    sourceFilePath?: string;
    thinkingEffort?: 'low' | 'medium' | 'high' | 'off';
  }): ChatSession {
    const id = randomUUID();
    const engine = params.engine || 'cursor';
    const defaultTitle = engine === 'antigravity' ? 'Новий чат Antigravity' : 'Новий чат Cursor';
    const defaultDesc = engine === 'antigravity' ? 'Сесія Google Antigravity 2.0' : 'Сесія Cursor AI Agent';

    const newSession: ChatSession = {
      id,
      deviceId: params.deviceId,
      title: params.title || defaultTitle,
      description: params.description || defaultDesc,
      projectId: params.projectId || undefined,
      isPinned: Boolean(params.isPinned),
      engine,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cursorChatId: params.cursorChatId,
      sourceSessionId: params.sourceSessionId,
      sourceFilePath: params.sourceFilePath,
      workspacePath: params.workspacePath || '',
      model: params.model || (engine === 'antigravity' ? 'gemini-3.7-flash' : 'composer-2.5'),
      mode: params.mode || 'yolo',
      thinkingEffort: params.thinkingEffort || (engine === 'antigravity' ? 'high' : 'medium'),
      messages: [],
    };
    db.saveSession(newSession);
    return newSession;
  }

  public updateSession(
    id: string,
    params: {
      title?: string;
      description?: string;
      projectId?: string | null;
      isPinned?: boolean;
      engine?: 'cursor' | 'antigravity';
      workspacePath?: string;
      model?: string;
      mode?: 'agent' | 'plan' | 'ask' | 'yolo' | 'auto' | 'auto-review';
      cursorChatId?: string;
      sourceSessionId?: string;
      sourceFilePath?: string;
      thinkingEffort?: 'low' | 'medium' | 'high' | 'off';
      isStreaming?: boolean;
      status?: 'idle' | 'running' | 'completed' | 'error';
      promptQueue?: string[];
    }
  ): ChatSession | null {
    const session = db.getSession(id);
    if (!session) return null;

    if (params.title !== undefined) session.title = params.title;
    if (params.description !== undefined) session.description = params.description;
    if (params.projectId !== undefined) session.projectId = params.projectId === null || params.projectId === '' ? undefined : params.projectId;
    if (params.isPinned !== undefined) session.isPinned = Boolean(params.isPinned);
    if (params.engine !== undefined) session.engine = params.engine;
    if (params.workspacePath !== undefined) session.workspacePath = params.workspacePath;
    if (params.model !== undefined) session.model = params.model;
    if (params.mode !== undefined) session.mode = params.mode;
    if (params.cursorChatId !== undefined) session.cursorChatId = params.cursorChatId;
    if (params.sourceSessionId !== undefined) session.sourceSessionId = params.sourceSessionId;
    if (params.sourceFilePath !== undefined) session.sourceFilePath = params.sourceFilePath;
    if (params.thinkingEffort !== undefined) session.thinkingEffort = params.thinkingEffort;
    if (params.isStreaming !== undefined) session.isStreaming = params.isStreaming;
    if (params.status !== undefined) session.status = params.status;
    if (params.promptQueue !== undefined) session.promptQueue = params.promptQueue;

    session.updatedAt = Date.now();
    db.saveSession(session);
    return session;
  }

  public togglePin(id: string): ChatSession | null {
    const session = db.getSession(id);
    if (!session) return null;
    session.isPinned = !session.isPinned;
    session.updatedAt = Date.now();
    db.saveSession(session);
    return session;
  }

  public setSessionProject(id: string, projectId?: string): ChatSession | null {
    const session = db.getSession(id);
    if (!session) return null;
    session.projectId = projectId || undefined;
    session.updatedAt = Date.now();
    db.saveSession(session);
    return session;
  }

  // Projects API
  public getProjects(): Project[] {
    return db.getProjects();
  }

  public getProject(id: string): Project | undefined {
    return db.getProject(id);
  }

  public createProject(params: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    workspacePath?: string;
    defaultEngine?: 'cursor' | 'antigravity';
    defaultModel?: string;
    isPinned?: boolean;
  }): Project {
    const project: Project = {
      id: randomUUID(),
      name: params.name || 'Новий проект',
      description: params.description || '',
      icon: params.icon || '📁',
      color: params.color || '#38bdf8',
      workspacePath: params.workspacePath || '',
      defaultEngine: params.defaultEngine,
      defaultModel: params.defaultModel,
      isPinned: Boolean(params.isPinned),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.saveProject(project);
    return project;
  }

  public updateProject(id: string, updates: Partial<Project>): Project | null {
    const existing = db.getProject(id);
    if (!existing) return null;

    const updated: Project = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    db.saveProject(updated);
    return updated;
  }

  public deleteProject(id: string): boolean {
    const existing = db.getProject(id);
    if (!existing) return false;
    db.deleteProject(id);
    return true;
  }

  public syncExternalMessages(
    sessionIdOrSourceId: string,
    newMessages: ChatMessage[],
    newTitle?: string
  ): ChatSession | null {
    const all = db.getSessions();
    const session = all.find(
      (s) =>
        s.id === sessionIdOrSourceId ||
        s.sourceSessionId === sessionIdOrSourceId ||
        (s.sourceFilePath && s.sourceFilePath === sessionIdOrSourceId) ||
        (s.cursorChatId && s.cursorChatId === sessionIdOrSourceId)
    );
    if (!session) return null;

    if (newTitle && (session.title.includes('Новий чат') || session.title.includes('Antigravity') || session.title.includes('Imported'))) {
      session.title = newTitle;
    }

    if (newMessages && newMessages.length > 0) {
      session.messages = newMessages.map((m, idx) => ({
        id: m.id || `sync_${session.id}_${idx}_${Date.now()}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || Date.now(),
        model: m.model || session.model,
        thinkingContent: m.thinkingContent,
        toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls.map((tc) => truncateToolCallItem(tc)) : undefined,
      }));
    }

    session.updatedAt = Date.now();
    db.saveSession(session);
    return session;
  }

  public enqueuePrompt(sessionId: string, prompt: string): string[] {
    const session = db.getSession(sessionId);
    if (!session) return [];
    session.promptQueue = session.promptQueue || [];
    session.promptQueue.push(prompt);
    session.updatedAt = Date.now();
    db.saveSession(session);
    return session.promptQueue;
  }

  public dequeuePrompt(sessionId: string): string | null {
    const session = db.getSession(sessionId);
    if (!session || !session.promptQueue || session.promptQueue.length === 0) return null;
    const next = session.promptQueue.shift();
    session.updatedAt = Date.now();
    db.saveSession(session);
    return next || null;
  }

  public removeQueuedPrompt(sessionId: string, index: number): string[] {
    const session = db.getSession(sessionId);
    if (!session || !session.promptQueue) return [];
    if (index >= 0 && index < session.promptQueue.length) {
      session.promptQueue.splice(index, 1);
      session.updatedAt = Date.now();
      db.saveSession(session);
    }
    return session.promptQueue;
  }

  public updateQueuedPrompt(sessionId: string, index: number, newPrompt: string): string[] {
    const session = db.getSession(sessionId);
    if (!session || !session.promptQueue) return [];
    if (index >= 0 && index < session.promptQueue.length && newPrompt.trim()) {
      session.promptQueue[index] = newPrompt.trim();
      session.updatedAt = Date.now();
      db.saveSession(session);
    }
    return session.promptQueue;
  }

  public clearQueue(sessionId: string) {
    const session = db.getSession(sessionId);
    if (!session) return;
    session.promptQueue = [];
    session.updatedAt = Date.now();
    db.saveSession(session);
  }

  public addMessage(sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage | null {
    const session = db.getSession(sessionId);
    if (!session) return null;

    const msgId = Math.random().toString(36).substring(2, 12);
    const fullMsg: ChatMessage = {
      ...message,
      id: msgId,
      timestamp: Date.now(),
    };

    session.messages.push(fullMsg);
    session.updatedAt = Date.now();

    // Auto-update session title and description from first user prompt
    if (
      message.role === 'user' &&
      (session.title === 'New Agent Chat' ||
        session.title.includes('Новий чат') ||
        session.title === 'Untitled Chat')
    ) {
      session.title = ChatSanitizer.cleanTitleFromPrompt(message.content, 34);
      const wsName = session.workspacePath ? session.workspacePath.split(/[/\\]/).pop() : '';
      session.description = wsName ? `📂 ${wsName} • ${message.content.slice(0, 50)}...` : message.content.slice(0, 60);
    }

    db.saveSession(session);
    return fullMsg;
  }

  public appendChunk(sessionId: string, payload: { chunk?: string; delta?: string }) {
    const prev = this.activeStreams.get(sessionId) || '';
    const updated = applyStreamText(prev, payload);
    this.activeStreams.set(sessionId, updated);

    const session = db.getSession(sessionId);
    if (session) {
      session.isStreaming = true;
      session.status = 'running';
      const lastMsg = [...session.messages].reverse().find((m) => m.role === 'assistant');
      if (lastMsg) {
        appendTextToBlocks(lastMsg, payload);
        lastMsg.isStreaming = true;
      }
      db.saveSession(session);
    }
  }

  public appendThinking(sessionId: string, payload: { thinking?: string; delta?: string }) {
    const session = db.getSession(sessionId);
    if (session) {
      session.isStreaming = true;
      session.status = 'running';
      const lastMsg = [...session.messages].reverse().find((m) => m.role === 'assistant');
      if (lastMsg) {
        lastMsg.thinkingContent = applyStreamText(lastMsg.thinkingContent || '', {
          chunk: payload.thinking,
          delta: payload.delta,
        });
        lastMsg.isStreaming = true;
      }
      db.saveSession(session);
    }
  }

  public abortRun(sessionId: string) {
    this.finalizeAssistantMessage(sessionId);
    this.updateSession(sessionId, { isStreaming: false, status: 'idle' });
  }

  public getStreamingContent(sessionId: string): string {
    return this.activeStreams.get(sessionId) || '';
  }

  public addToolCall(sessionId: string, toolCall: ToolCallItem) {
    const session = db.getSession(sessionId);
    if (!session) return;

    session.isStreaming = true;
    session.status = 'running';

    const safeToolCall = truncateToolCallItem(toolCall);

    // Find the last assistant message
    const lastMsg = [...session.messages].reverse().find((m) => m.role === 'assistant');
    if (lastMsg) {
      if (!lastMsg.toolCalls) lastMsg.toolCalls = [];
      const existing = lastMsg.toolCalls.find((t) => t.id === safeToolCall.id);
      if (existing) {
        Object.assign(existing, safeToolCall);
        if (!lastMsg.blocks?.some((b) => b.type === 'tool' && b.toolCallId === safeToolCall.id)) {
          appendToolToBlocks(lastMsg, safeToolCall);
        }
      } else {
        lastMsg.toolCalls.push(safeToolCall);
        appendToolToBlocks(lastMsg, safeToolCall);
      }
      db.saveSession(session);
    }
  }

  public updateToolResult(sessionId: string, toolCallId: string, result: string, status: 'completed' | 'failed') {
    const session = db.getSession(sessionId);
    if (!session) return;

    const safeResult = truncateString(result, 3000);

    for (const msg of session.messages) {
      if (msg.toolCalls) {
        const found = msg.toolCalls.find((t) => t.id === toolCallId);
        if (found) {
          found.output = safeResult;
          found.status = status;
          db.saveSession(session);
          break;
        }
      }
    }
  }

  public finalizeAssistantMessage(sessionId: string, finalContent?: string, cursorChatId?: string) {
    const session = db.getSession(sessionId);
    const accumulated = this.activeStreams.get(sessionId) || '';
    this.activeStreams.delete(sessionId);

    if (!session) return;

    session.isStreaming = false;
    session.status = 'idle';

    if (cursorChatId) {
      session.cursorChatId = cursorChatId;
    }

    const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant');
    const contentToSave =
      (finalContent && finalContent.length > 0 ? finalContent : accumulated) || lastAssistant?.content || '';

    if (lastAssistant) {
      if (contentToSave) lastAssistant.content = contentToSave;
      lastAssistant.isStreaming = false;
    } else if (contentToSave) {
      session.messages.push({
        id: Math.random().toString(36).substring(2, 12),
        role: 'assistant',
        content: contentToSave,
        timestamp: Date.now(),
        model: session.model,
        isStreaming: false,
      });
    }

    session.updatedAt = Date.now();
    db.saveSession(session);
  }

  public deleteSession(id: string) {
    this.activeStreams.delete(id);
    db.deleteSession(id);
  }
}

export const sessionManager = new SessionManager();
