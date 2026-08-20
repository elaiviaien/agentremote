import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'agentremote-jwt-secret-key-change-in-prod-2026',
  adminUsername: process.env.ADMIN_USERNAME || 'olivka',
  adminPassword: process.env.ADMIN_PASSWORD || 'olivka_ol1',
  masterWorkerKey: process.env.MASTER_WORKER_KEY || 'agentremote-worker-secret-key-2026',
  dataDir: path.resolve(process.cwd(), 'data'),
  isProduction: process.env.NODE_ENV === 'production',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  // Multilingual voice; override via ELEVENLABS_VOICE_ID
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL',
};
