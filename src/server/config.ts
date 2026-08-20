import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const isProduction =
  process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

function getRequiredEnv(name: string, devFallback?: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();

  if (isProduction || !devFallback) {
    console.error(`\n❌ [Config Error] Missing required environment variable: ${name}`);
    console.error(`👉 Please set ${name} in your environment or .env file (see .env.example).\n`);
    throw new Error(`[Config] Missing required environment variable: ${name}`);
  }

  console.warn(`⚠️ [Config Warning] ${name} is unset — falling back to dev default. Do not use in production!`);
  return devFallback;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: getRequiredEnv('JWT_SECRET', isProduction ? undefined : 'dev-insecure-jwt-secret-key-32-chars-long'),
  adminUsername: getRequiredEnv('ADMIN_USERNAME', isProduction ? undefined : 'admin'),
  adminPassword: getRequiredEnv('ADMIN_PASSWORD', isProduction ? undefined : 'admin_dev_pass_123'),
  masterWorkerKey:
    process.env.MASTER_WORKER_KEY?.trim() ||
    process.env.WORKER_TOKEN?.trim() ||
    getRequiredEnv('MASTER_WORKER_KEY', isProduction ? undefined : 'dev-insecure-master-worker-key'),
  dataDir: path.resolve(process.cwd(), 'data'),
  isProduction,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  // Multilingual voice; override via ELEVENLABS_VOICE_ID
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL',
  elevenLabsTtsModel: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5',
};
