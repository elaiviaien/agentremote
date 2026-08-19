import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { db } from '../db';
import { verifyPassword, createToken, requireAuth } from '../auth';
import { deviceManager } from '../deviceManager';
import { sessionManager } from '../sessionManager';
import { config } from '../config';
import { ChatSanitizer } from '../../shared/chatSanitizer';

export const apiRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Public Login
  fastify.post('/auth/login', async (req, reply) => {
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
      maxAge: 30 * 24 * 60 * 60, // 30 days
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

  // Sessions
  fastify.get('/sessions', { preHandler: [requireAuth] }, async (req) => {
    const { deviceId } = req.query as { deviceId?: string };
    return { sessions: sessionManager.getSessions(deviceId) };
  });

  fastify.post('/sessions', { preHandler: [requireAuth] }, async (req) => {
    const body = req.body as any;
    const session = sessionManager.createSession({
      deviceId: body.deviceId || deviceManager.getActiveDeviceId() || 'default',
      title: body.title,
      description: body.description,
      engine: body.engine,
      workspacePath: body.workspacePath,
      model: body.model,
      mode: body.mode,
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
      engine: body.engine,
      workspacePath: body.workspacePath,
      model: body.model,
      mode: body.mode,
      cursorChatId: body.cursorChatId,
    });
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return { success: true, session };
  });

  // Delete Session
  fastify.delete('/sessions/:id', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    sessionManager.deleteSession(id);
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
      if (extractedChatId && (s.cursorChatId === extractedChatId || s.id === extractedChatId)) return true;
      if (s.title === sessionTitle && s.workspacePath === (workspacePath || '')) return true;
      return false;
    });

    if (existing) {
      // If found, update workspace or model if specified, and return existing session directly!
      if (workspacePath && !existing.workspacePath) existing.workspacePath = workspacePath;
      if (model && existing.model !== model) existing.model = model;
      if (extractedChatId && !existing.cursorChatId) existing.cursorChatId = extractedChatId;
      sessionManager.updateSession(existing.id, {
        workspacePath: existing.workspacePath,
        model: existing.model,
        cursorChatId: existing.cursorChatId,
      });

      return {
        success: true,
        session: existing,
        reusedExisting: true,
        report: {
          title: existing.title,
          sourceType: sanitized.sourceType,
          messageCount: existing.messages.length,
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
      model: model || (effectiveEngine === 'antigravity' ? 'gemini-3.7-flash' : 'claude-4.5-sonnet'),
      mode: mode || 'yolo',
      cursorChatId: effectiveEngine === 'cursor' ? extractedChatId : undefined,
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
};
