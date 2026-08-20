export const CURSOR_DEFAULT_MODEL = 'composer-2.5';
export const ANTIGRAVITY_DEFAULT_MODEL = 'gemini-3.7-flash';

export function isGeminiModelId(model?: string): boolean {
  if (!model) return false;
  const id = model.replace(/\[effort=.*?\]/gi, '').trim();
  return /^gemini/i.test(id);
}

export function isUsageLimitError(text?: string): boolean {
  if (!text) return false;
  return /usage limit|spend limit|actionrequirederror|you've hit your usage limit/i.test(text);
}

export function resolveRunEngine(opts: {
  engine?: 'cursor' | 'antigravity';
  model?: string;
  hasAntigravityCli?: boolean;
}): 'cursor' | 'antigravity' {
  if (opts.engine === 'antigravity') return 'antigravity';
  if (isGeminiModelId(opts.model) && opts.hasAntigravityCli) return 'antigravity';
  return 'cursor';
}

export function resolveCursorModel(model?: string): string {
  if (!model || model === 'auto' || model === 'default' || isGeminiModelId(model)) {
    return CURSOR_DEFAULT_MODEL;
  }
  return model;
}

/**
 * Determines whether a model supported by Antigravity CLI accepts the `--effort` CLI argument.
 * Claude models (e.g. claude-opus-4-6-thinking, claude-sonnet-4-6), models with fixed thinking,
 * and models that already have an effort suffix (-high, -medium, -low) reject `--effort`.
 */
export function supportsAntigravityEffort(model?: string): boolean {
  if (!model || model === 'auto' || model === 'default') {
    return true; // Defaults to gemini-3.7-flash which supports effort
  }
  const clean = model.replace(/\[effort=.*?\]/gi, '').trim().toLowerCase();

  // Model IDs that already end with an explicit effort suffix
  if (/-(low|medium|high|xhigh|max|minimal)$/i.test(clean)) {
    return false;
  }

  // Claude models in Antigravity CLI have fixed reasoning and do not support --effort
  if (/claude/i.test(clean)) {
    return false;
  }

  // Any other model explicitly ending or marked with thinking/reasoning
  if (/thinking/i.test(clean)) {
    return false;
  }

  // Gemini models (gemini-3.7-flash, gemini-3.6-flash, gemini-3.1-pro, etc.) and GPT-OSS base models
  if (/^(gemini|gpt-oss)/i.test(clean)) {
    return true;
  }

  return false;
}

