import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const isProduction =
  process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();
  if (isProduction) {
    throw new Error(
      `[Config] Missing required env ${name}. Set it on the host before starting the hub.`
    );
  }
  console.warn(`[Config] ${name} unset — using insecure dev fallback. Do not deploy like this.`);
  return devFallback;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: requireSecret('JWT_SECRET', 'dev-only-jwt-change-me'),
  adminUsername: requireSecret('ADMIN_USERNAME', 'admin'),
  adminPassword: requireSecret('ADMIN_PASSWORD', 'admin'),
  masterWorkerKey:
    process.env.MASTER_WORKER_KEY?.trim() ||
    process.env.WORKER_TOKEN?.trim() ||
    requireSecret('MASTER_WORKER_KEY', 'dev-only-worker-key'),
  dataDir: path.resolve(process.cwd(), 'data'),
  isProduction,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  // Multilingual voice; override via ELEVENLABS_VOICE_ID
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL',
};
