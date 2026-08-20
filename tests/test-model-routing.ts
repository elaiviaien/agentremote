import {
  supportsAntigravityEffort,
  resolveRunEngine,
  resolveCursorModel,
  isGeminiModelId,
  ANTIGRAVITY_DEFAULT_MODEL,
  CURSOR_DEFAULT_MODEL,
} from '../src/shared/modelRouting';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${msg}`);
    process.exit(1);
  }
  console.log(`✔ ${msg}`);
}

console.log('--- Testing modelRouting & supportsAntigravityEffort ---');

// 1. Antigravity models that MUST NOT accept --effort
assert(!supportsAntigravityEffort('claude-opus-4-6-thinking'), 'claude-opus-4-6-thinking does not support effort');
assert(!supportsAntigravityEffort('claude-sonnet-4-6'), 'claude-sonnet-4-6 does not support effort');
assert(!supportsAntigravityEffort('claude-3.7-sonnet'), 'claude-3.7-sonnet does not support effort');
assert(!supportsAntigravityEffort('gemini-3.7-flash-high'), 'gemini-3.7-flash-high (already carries -high) rejects --effort flag');
assert(!supportsAntigravityEffort('gemini-3.7-flash-medium'), 'gemini-3.7-flash-medium rejects --effort flag');
assert(!supportsAntigravityEffort('gemini-3.7-flash-low'), 'gemini-3.7-flash-low rejects --effort flag');
assert(!supportsAntigravityEffort('gemini-3.1-pro-low'), 'gemini-3.1-pro-low rejects --effort flag');
assert(!supportsAntigravityEffort('gpt-oss-120b-medium'), 'gpt-oss-120b-medium rejects --effort flag');

// 2. Antigravity models that DO accept --effort
assert(supportsAntigravityEffort('gemini-3.7-flash'), 'gemini-3.7-flash base model supports effort');
assert(supportsAntigravityEffort('gemini-3.6-flash'), 'gemini-3.6-flash base model supports effort');
assert(supportsAntigravityEffort('gemini-3.5-flash'), 'gemini-3.5-flash base model supports effort');
assert(supportsAntigravityEffort('gemini-3.1-pro'), 'gemini-3.1-pro base model supports effort');
assert(supportsAntigravityEffort('gpt-oss-120b'), 'gpt-oss-120b base model supports effort');
assert(supportsAntigravityEffort('auto'), 'auto defaults to effort-supporting base model');
assert(supportsAntigravityEffort('default'), 'default supports effort');
assert(supportsAntigravityEffort(undefined), 'undefined supports effort');

// 3. Engine resolution tests
assert(
  resolveRunEngine({ engine: 'antigravity', model: 'claude-opus-4-6-thinking', hasAntigravityCli: true }) === 'antigravity',
  'Explicit antigravity engine routes to antigravity even with Claude model'
);
assert(
  resolveRunEngine({ engine: 'cursor', model: 'claude-4.6-opus-high', hasAntigravityCli: true }) === 'cursor',
  'Explicit cursor engine routes to cursor'
);
assert(
  resolveRunEngine({ model: 'gemini-3.7-flash', hasAntigravityCli: true }) === 'antigravity',
  'Gemini model auto-routes to antigravity when CLI present'
);
assert(
  resolveRunEngine({ model: 'composer-2.5', hasAntigravityCli: true }) === 'cursor',
  'Cursor model routes to cursor'
);

// 4. Cursor model resolution
assert(resolveCursorModel('auto') === CURSOR_DEFAULT_MODEL, 'Auto resolves to default cursor model');
assert(resolveCursorModel('gemini-3.7-flash') === CURSOR_DEFAULT_MODEL, 'Gemini model in cursor resolves to default cursor model');
assert(resolveCursorModel('claude-4.6-opus-high') === 'claude-4.6-opus-high', 'Cursor model preserved');

console.log('\n🎉 ALL MODEL ROUTING & EFFORT TESTS PASSED!');
