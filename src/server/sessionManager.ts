import { ChatSession, ChatMessage, ToolCallItem } from '../shared/types';
import { db } from './db';
import { randomUUID } from 'crypto';

export class SessionManager {
  private activeStreams = new Map<string, string>(); // sessionId -> accumulator

  public getSessions(deviceId?: string): ChatSession[] {
    return db.getSessions(deviceId);
  }

  public getSession(id: string): ChatSession | undefined {
    return db.getSession(id);
  }

  public createSession(params: {
    deviceId: string;
    title?: string;
    workspacePath?: string;
    model?: string;
    mode?: 'agent' | 'plan' | 'ask' | 'yolo' | 'auto' | 'auto-review';
    cursorChatId?: string;
  }): ChatSession {
    const id = randomUUID();
    const newSession: ChatSession = {
      id,
      deviceId: params.deviceId,
      title: params.title || 'New Agent Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cursorChatId: params.cursorChatId,
      workspacePath: params.workspacePath || '',
      model: params.model || 'claude-3-5-sonnet',
      mode: params.mode || 'agent',
      messages: [],
    };
    db.saveSession(newSession);
    return newSession;
  }

  public updateSession(
    id: string,
    params: {
      title?: string;
      workspacePath?: string;
      model?: string;
      mode?: 'agent' | 'plan' | 'ask' | 'yolo' | 'auto' | 'auto-review';
      cursorChatId?: string;
    }
  ): ChatSession | null {
    const session = db.getSession(id);
    if (!session) return null;

    if (params.title !== undefined) session.title = params.title;
    if (params.workspacePath !== undefined) session.workspacePath = params.workspacePath;
    if (params.model !== undefined) session.model = params.model;
    if (params.mode !== undefined) session.mode = params.mode;
    if (params.cursorChatId !== undefined) session.cursorChatId = params.cursorChatId;

    session.updatedAt = Date.now();
    db.saveSession(session);
    return session;
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

    // Auto-update session title from first user prompt if still default
    if (session.title === 'New Agent Chat' && message.role === 'user') {
      session.title = message.content.slice(0, 40) + (message.content.length > 40 ? '...' : '');
    }

    db.saveSession(session);
    return fullMsg;
  }

  public appendChunk(sessionId: string, chunk: string) {
    const prev = this.activeStreams.get(sessionId) || '';
    this.activeStreams.set(sessionId, prev + chunk);
  }

  public getStreamingContent(sessionId: string): string {
    return this.activeStreams.get(sessionId) || '';
  }

  public addToolCall(sessionId: string, toolCall: ToolCallItem) {
    const session = db.getSession(sessionId);
    if (!session) return;

    // Find the last assistant message
    const lastMsg = [...session.messages].reverse().find((m) => m.role === 'assistant');
    if (lastMsg) {
      if (!lastMsg.toolCalls) lastMsg.toolCalls = [];
      const existing = lastMsg.toolCalls.find((t) => t.id === toolCall.id);
      if (existing) {
        Object.assign(existing, toolCall);
      } else {
        lastMsg.toolCalls.push(toolCall);
      }
      db.saveSession(session);
    }
  }

  public updateToolResult(sessionId: string, toolCallId: string, result: string, status: 'completed' | 'failed') {
    const session = db.getSession(sessionId);
    if (!session) return;

    for (const msg of session.messages) {
      if (msg.toolCalls) {
        const found = msg.toolCalls.find((t) => t.id === toolCallId);
        if (found) {
          found.output = result;
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

    if (cursorChatId) {
      session.cursorChatId = cursorChatId;
    }

    const contentToSave = finalContent !== undefined ? finalContent : accumulated;

    const lastMsg = [...session.messages].reverse().find((m) => m.role === 'assistant' && m.isStreaming);
    if (lastMsg) {
      lastMsg.content = contentToSave;
      lastMsg.isStreaming = false;
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
