import { config } from '../config';

const FULL_SPEAK_MAX_CHARS = 450;
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type VoiceSpeakMode = 'full' | 'brief';

export function isVoiceEnabled(): boolean {
  return Boolean(config.geminiApiKey && config.elevenLabsApiKey);
}

export function stripMarkdownForSpeech(text: string): string {
  if (!text) return '';
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/[*_~>]+/g, '');
  t = t.replace(/\n{2,}/g, '. ');
  t = t.replace(/\n/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

export function chooseSpeakMode(text: string, hasToolCalls: boolean, forceBrief?: boolean): VoiceSpeakMode {
  if (forceBrief || hasToolCalls) return 'brief';
  const plain = stripMarkdownForSpeech(text);
  if (plain.length > FULL_SPEAK_MAX_CHARS) return 'brief';
  return 'full';
}

async function geminiGenerate(parts: Array<Record<string, unknown>>): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': config.geminiApiKey,
    },
    body: JSON.stringify({
      contents: [{ parts }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    '';
  return String(text).trim();
}

export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString('base64');
  let safeMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
  // Gemini expects canonical mime types
  if (safeMime === 'audio/mp4' || safeMime === 'video/mp4') safeMime = 'audio/mp4';
  if (safeMime === 'audio/mpeg') safeMime = 'audio/mp3';
  if (!safeMime.startsWith('audio/')) safeMime = 'audio/webm';

  const text = await geminiGenerate([
    {
      inlineData: {
        mimeType: safeMime,
        data: base64,
      },
    },
    {
      text:
        'Transcribe the user speech to plain text. Language is primarily Ukrainian (may include English tech terms). ' +
        'Return ONLY the transcript, no quotes, no commentary. If silence or unintelligible, return an empty string.',
    },
  ]);
  return text.replace(/^["«»]|["«»]$/g, '').trim();
}

export async function makeVoiceBrief(fullText: string, meta?: { hasToolCalls?: boolean }): Promise<string> {
  const clipped = fullText.slice(0, 12000);
  const brief = await geminiGenerate([
    {
      text:
        'Ти voice-brief асистент. З відповіді агента-кодера зроби короткий усний підсумок українською для озвучки.\n' +
        'Правила: 1–3 короткі речення; без markdown, коду, списків і емодзі; без привітань; скажи що зроблено і що далі (якщо є).\n' +
        (meta?.hasToolCalls ? 'Агент використовував інструменти (редагував файли/запускав команди).\n' : '') +
        'Текст відповіді агента:\n\n' +
        clipped,
    },
  ]);
  return stripMarkdownForSpeech(brief).slice(0, 600);
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  if (!config.elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }
  const spoken = stripMarkdownForSpeech(text).slice(0, 2500);
  if (!spoken) {
    throw new Error('Nothing to speak');
  }
  const voiceId = config.elevenLabsVoiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': config.elevenLabsApiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spoken,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function prepareAndSpeak(opts: {
  text: string;
  hasToolCalls?: boolean;
  forceBrief?: boolean;
}): Promise<{ audio: Buffer; mode: VoiceSpeakMode; spokenText: string }> {
  const mode = chooseSpeakMode(opts.text || '', Boolean(opts.hasToolCalls), opts.forceBrief);
  let spokenText =
    mode === 'full'
      ? stripMarkdownForSpeech(opts.text || '')
      : await makeVoiceBrief(opts.text || '', { hasToolCalls: opts.hasToolCalls });

  if (!spokenText) {
    spokenText = mode === 'brief' ? 'Завдання виконано.' : '';
  }
  if (!spokenText) {
    throw new Error('Nothing to speak');
  }

  const audio = await synthesizeSpeech(spokenText);
  return { audio, mode, spokenText };
}
