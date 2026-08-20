import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { verifyPassword, createToken, requireAuth } from '../auth';
import { deviceManager } from '../deviceManager';
import { sessionManager } from '../sessionManager';
import { config } from '../config';
import { ChatSanitizer } from '../../shared/chatSanitizer';
import { ChatSession } from '../../shared/types';
import { voiceRoutes } from './voice';

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

export const apiRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  await fastify.register(voiceRoutes);
  // Public Login
  fastify.post('/auth/login', async (req, reply) => {
    const ip = req.ip || 'unknown';
    if (!checkLoginRateLimit(ip)) {
      return reply.status(429).send({ error: 'Too many login attempts. Try again later.' });
    }

    const { username, password } = req.body as any;

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }

    const user = db.getUser(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.status(401).send({ error: 'Invalid username or password' });
    }

    const token = createToken(username);

    // Set secure cookie
    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return { token, username: user.username };
  });

  // Logout
  fastify.post('/auth/logout', async (req, reply) => {
    reply.clearCookie('auth_token', { path: '/' });
    return { success: true };
  });

  // Check auth
  fastify.get('/auth/me', { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;
    return {
      username: user.username,
      masterWorkerKey: config.masterWorkerKey,
    };
  });

  // Devices
  fastify.get('/devices', { preHandler: [requireAuth] }, async () => {
    return {
      devices: deviceManager.getDevices(),
      activeDeviceId: deviceManager.getActiveDeviceId(),
    };
  });

  fastify.post('/devices/:id/activate', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dev = deviceManager.getDevice(id);
    if (!dev) {
      return reply.status(404).send({ error: 'Device not found' });
    }
    deviceManager.setActiveDeviceId(id);
    return { success: true, activeDeviceId: id };
  });

  fastify.delete('/devices/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = deviceManager.removeDevice(id);
    if (!removed) {
      return reply.status(404).send({ error: 'Device not found' });
    }
    return { success: true };
  });

  // Sessions (Lightweight summary: metadata & messageCount only)
  fastify.get('/sessions', { preHandler: [requireAuth] }, async (req) => {
    const { deviceId, projectId } = req.query as { deviceId?: string; projectId?: string };
    let summaries = sessionManager.getSessionSummaries(deviceId);
    if (projectId !== undefined) {
      if (projectId === 'unassigned' || projectId === 'none') {
        summaries = summaries.filter((s) => !s.projectId);
      } else {
        summaries = summaries.filter((s) => s.projectId === projectId);
      }
    }
    return { sessions: summaries };
  });

  fastify.post('/sessions', { preHandler: [requireAuth] }, async (req) => {
    const body = req.body as any;
    const session = sessionManager.createSession({
      deviceId: body.deviceId || deviceManager.getActiveDeviceId() || 'default',
      title: body.title,
      description: body.description,
      projectId: body.projectId,
      isPinned: body.isPinned,
      engine: body.engine,
      workspacePath: body.workspacePath,
      model: body.model,
      mode: body.mode,
      thinkingEffort: body.thinkingEffort,
      cursorChatId: body.cursorChatId,
    });
    return { session };
  });

  fastify.get('/sessions/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = sessionManager.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return { session };
  });

  fastify.patch('/sessions/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const session = sessionManager.updateSession(id, {
      title: body.title,
      description: body.description,
      projectId: body.projectId,
      isPinned: body.isPinned,
      engine: body.engine,
      workspacePath: body.workspacePath,
      model: body.model,
      mode: body.mode,
      cursorChatId: body.cursorChatId,
      thinkingEffort: body.thinkingEffort,
    });
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return { success: true, session };
  });

  fastify.post('/sessions/:id/pin', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    let session: ChatSession | null | undefined = sessionManager.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    if (body && typeof body.isPinned === 'boolean') {
      session = sessionManager.updateSession(id, { isPinned: body.isPinned });
    } else {
      session = sessionManager.togglePin(id);
    }
    return { success: true, isPinned: Boolean(session?.isPinned), session };
  });

  // Session Prompt Queue Management
  fastify.post('/sessions/:id/queue', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { prompt } = req.body as { prompt: string };
    if (!prompt || !prompt.trim()) {
      return reply.status(400).send({ error: 'Prompt is required' });
    }
    const queue = sessionManager.enqueuePrompt(id, prompt.trim());
    return { success: true, queue };
  });

  fastify.patch('/sessions/:id/queue/:index', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const { prompt } = req.body as { prompt: string };
    const idx = parseInt(index, 10);
    if (isNaN(idx) || !prompt || !prompt.trim()) {
      return reply.status(400).send({ error: 'Valid index and prompt are required' });
    }
    const queue = sessionManager.updateQueuedPrompt(id, idx, prompt.trim());
    return { success: true, queue };
  });

  fastify.delete('/sessions/:id/queue/:index', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const idx = parseInt(index, 10);
    if (isNaN(idx)) {
      return reply.status(400).send({ error: 'Valid index is required' });
    }
    const queue = sessionManager.removeQueuedPrompt(id, idx);
    return { success: true, queue };
  });

  fastify.delete('/sessions/:id/queue', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    sessionManager.clearQueue(id);
    return { success: true, queue: [] };
  });

  // Delete Session
  fastify.delete('/sessions/:id', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    sessionManager.deleteSession(id);
    return { success: true };
  });

  // Projects CRUD
  fastify.get('/projects', { preHandler: [requireAuth] }, async () => {
    return { projects: sessionManager.getProjects() };
  });

  fastify.post('/projects', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = req.body as any;
    if (!body || !body.name || !body.name.trim()) {
      return reply.status(400).send({ error: 'Project name is required' });
    }
    const project = sessionManager.createProject({
      name: body.name.trim(),
      description: body.description,
      icon: body.icon,
      color: body.color,
      workspacePath: body.workspacePath,
      defaultEngine: body.defaultEngine,
      defaultModel: body.defaultModel,
      isPinned: body.isPinned,
    });
    return { project };
  });

  fastify.get('/projects/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = sessionManager.getProject(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    const sessions = sessionManager.getSessionSummaries().filter((s) => s.projectId === id);
    return { project, sessions };
  });

  fastify.patch('/projects/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const project = sessionManager.updateProject(id, body);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return { success: true, project };
  });

  fastify.delete('/projects/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = sessionManager.deleteProject(id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return { success: true };
  });

  // Import Chat / Transcript or Connect to Existing Session
  fastify.post('/sessions/import', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = req.body as any;
    const { rawContent, title, deviceId, model, mode, workspacePath, sourceSessionId, filePath } = body;

    if (!rawContent) {
      return reply.status(400).send({ error: 'rawContent is required' });
    }

    const sanitized = ChatSanitizer.sanitizeAny(rawContent);
    const sessionTitle = title || sanitized.title || 'Сесія розробки';
    const effectiveEngine = (sanitized.sourceType === 'antigravity' ? 'antigravity' : body.engine) || 'cursor';

    // Extract potential source session ID (e.g. composer ID or transcript ID)
    let extractedChatId = sourceSessionId || (body.cursorChatId ? body.cursorChatId : undefined);
    if (!extractedChatId && filePath && filePath.startsWith('composer:')) {
      extractedChatId = filePath.replace('composer:', '');
    }

    // 1. Check if session already exists for this exact ID / file
    const allExisting = sessionManager.getSessions();
    const existing = allExisting.find((s) => {
      if (extractedChatId && (s.sourceSessionId === extractedChatId || s.cursorChatId === extractedChatId || s.id === extractedChatId)) return true;
      if (filePath && s.sourceFilePath === filePath) return true;
      if (s.title === sessionTitle && s.workspacePath === (workspacePath || '')) return true;
      return false;
    });

    if (existing) {
      // If found, update workspace, model, and source pointers if specified
      if (workspacePath && !existing.workspacePath) existing.workspacePath = workspacePath;
      if (model && existing.model !== model) existing.model = model;
      if (extractedChatId && !existing.cursorChatId && effectiveEngine === 'cursor') existing.cursorChatId = extractedChatId;
      if (extractedChatId && !existing.sourceSessionId) existing.sourceSessionId = extractedChatId;
      if (filePath && !existing.sourceFilePath) existing.sourceFilePath = filePath;
      sessionManager.updateSession(existing.id, {
        workspacePath: existing.workspacePath,
        model: existing.model,
        cursorChatId: existing.cursorChatId,
        sourceSessionId: existing.sourceSessionId,
        sourceFilePath: existing.sourceFilePath,
      });

      // Synchronize latest messages from transcript into existing session
      sessionManager.syncExternalMessages(
        existing.id,
        sanitized.messages.map((m) => ({
          id: Math.random().toString(36).substring(2, 12),
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || Date.now(),
        })),
        sessionTitle
      );

      const refreshed = sessionManager.getSession(existing.id)!;

      return {
        success: true,
        session: refreshed,
        reusedExisting: true,
        report: {
          title: refreshed.title,
          sourceType: sanitized.sourceType,
          messageCount: refreshed.messages.length,
          removedMetadataCount: 0,
          redactedSecretsCount: 0,
        },
      };
    }

    // 2. Otherwise create new 1:1 linked session
    const sourceLabel = sanitized.sourceType === 'claude_code' ? 'Claude Code' : sanitized.sourceType === 'cursor' ? 'Cursor' : sanitized.sourceType === 'antigravity' ? 'Antigravity' : 'Зовнішнього агента';
    const sessionDesc = body.description || `Підключено з ${sourceLabel} • ${sanitized.messages.length} повідомлень`;

    const session = sessionManager.createSession({
      deviceId: deviceId || deviceManager.getActiveDeviceId() || 'default',
      title: sessionTitle,
      description: sessionDesc,
      engine: effectiveEngine,
      workspacePath: workspacePath || '',
      model: model || (effectiveEngine === 'antigravity' ? 'gemini-3.7-flash' : 'composer-2.5'),
      mode: mode || 'yolo',
      cursorChatId: effectiveEngine === 'cursor' ? extractedChatId : undefined,
      sourceSessionId: extractedChatId || undefined,
      sourceFilePath: filePath || undefined,
    });

    // Populate sanitized messages
    sanitized.messages.forEach((msg) => {
      sessionManager.addMessage(session.id, {
        role: msg.role,
        content: msg.content,
      });
    });

    const updatedSession = sessionManager.getSession(session.id);

    return {
      success: true,
      session: updatedSession,
      reusedExisting: false,
      report: {
        title: sessionTitle,
        sourceType: sanitized.sourceType,
        messageCount: sanitized.messages.length,
        removedMetadataCount: sanitized.removedMetadataCount,
        redactedSecretsCount: sanitized.redactedSecretsCount,
        cleanSummaryContext: sanitized.cleanSummaryContext,
      },
    };
  });

  // Force sync external session endpoint
  fastify.post('/sessions/:id/sync', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = sessionManager.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const deviceId = session.deviceId || deviceManager.getActiveDeviceId();
    if (!deviceId) {
      return reply.status(400).send({ error: 'Target device offline' });
    }

    const reqId = randomUUID();
    deviceManager.sendToWorker(deviceId, {
      type: 'sessions:force_sync',
      payload: {
        reqId,
        sessionId: session.id,
        sourceSessionId: session.sourceSessionId,
        sourceFilePath: session.sourceFilePath,
        engine: session.engine,
      },
    });

    return { success: true, message: 'Sync request dispatched to worker' };
  });

  // Preview Sanitization endpoint
  fastify.post('/transcripts/sanitize-preview', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = req.body as any;
    const { rawContent } = body;
    if (!rawContent) {
      return reply.status(400).send({ error: 'rawContent is required' });
    }
    const sanitized = ChatSanitizer.sanitizeAny(rawContent);
    return { success: true, result: sanitized };
  });

  // Direct File/Artifact Content Reader
  fastify.get('/files/content', { preHandler: [requireAuth] }, async (req, reply) => {
    const { path: rawPath } = req.query as { path?: string };
    if (!rawPath) {
      return reply.status(400).send({ error: 'path query parameter is required' });
    }

    let filePath = rawPath.trim();
    if (filePath.startsWith('file:///')) {
      filePath = filePath.replace(/^file:\/\/\/?/, '');
      if (process.platform === 'win32' && filePath.match(/^[a-zA-Z]:/)) {
        filePath = filePath.replace(/\//g, '\\');
      }
    }

    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          return {
            success: true,
            filePath,
            fileName: path.basename(filePath),
            content,
            size: stats.size,
            mtime: stats.mtimeMs,
          };
        }
      }
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to read file: ${err.message}` });
    }

    return reply.status(404).send({ error: 'File not found on server' });
  });

  fastify.get('/health', async () => {
    const memory = process.memoryUsage();
    return {
      status: 'ok',
      uptime: process.uptime(),
      ramRssMb: Math.round(memory.rss / (1024 * 1024)),
      ramHeapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    };
  });
};
