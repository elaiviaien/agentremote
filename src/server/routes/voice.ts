import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth';
import {
  isVoiceEnabled,
  prepareAndSpeak,
  transcribeAudio,
} from '../voice/voiceService';

export const voiceRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/voice/status', { preHandler: [requireAuth] }, async () => {
    return { enabled: isVoiceEnabled() };
  });

  fastify.post('/voice/transcribe', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isVoiceEnabled()) {
      return reply.status(503).send({ error: 'Voice mode is not configured (missing API keys)' });
    }

    const body = req.body as {
      audioBase64?: string;
      mimeType?: string;
    };

    if (!body?.audioBase64) {
      return reply.status(400).send({ error: 'audioBase64 is required' });
    }

    try {
      const buffer = Buffer.from(body.audioBase64, 'base64');
      if (buffer.length < 32) {
        return reply.status(400).send({ error: 'Audio too short' });
      }
      if (buffer.length > 8 * 1024 * 1024) {
        return reply.status(413).send({ error: 'Audio too large (max 8MB)' });
      }
      const text = await transcribeAudio(buffer, body.mimeType || 'audio/webm');
      return { text };
    } catch (err: any) {
      console.error('[Voice] Transcribe failed:', err?.message || err);
      return reply.status(502).send({ error: err?.message || 'Transcription failed' });
    }
  });

  fastify.post('/voice/speak', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isVoiceEnabled()) {
      return reply.status(503).send({ error: 'Voice mode is not configured (missing API keys)' });
    }

    const body = req.body as {
      text?: string;
      hasToolCalls?: boolean;
      forceBrief?: boolean;
    };

    const text = (body?.text || '').trim();
    if (!text) {
      return reply.status(400).send({ error: 'text is required' });
    }

    try {
      const { audio, mode, spokenText } = await prepareAndSpeak({
        text,
        hasToolCalls: Boolean(body.hasToolCalls),
        forceBrief: Boolean(body.forceBrief),
      });

      reply.header('Content-Type', 'audio/mpeg');
      reply.header('X-Voice-Mode', mode);
      reply.header('X-Voice-Text', encodeURIComponent(spokenText.slice(0, 500)));
      reply.header('Cache-Control', 'no-store');
      return reply.send(audio);
    } catch (err: any) {
      console.error('[Voice] Speak failed:', err?.message || err);
      return reply.status(502).send({ error: err?.message || 'TTS failed' });
    }
  });
};
