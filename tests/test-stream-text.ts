import { applyStreamText } from '../src/shared/streamText';

function assertEqual(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(applyStreamText('', { delta: 'Hello' }), 'Hello', 'incremental from empty');
assertEqual(applyStreamText('Hello', { delta: ' world' }), 'Hello world', 'incremental append');
assertEqual(applyStreamText('Hello', { delta: '' }), 'Hello', 'empty delta without chunk keeps previous');
assertEqual(
  applyStreamText('Hello', { chunk: 'Hello world', delta: '' }),
  'Hello world',
  'empty delta + chunk is snapshot replace'
);
assertEqual(
  applyStreamText('Hello world', { chunk: 'Hello world', delta: '' }),
  'Hello world',
  'snapshot equal to previous does not duplicate'
);
assertEqual(applyStreamText('Hel', { chunk: 'Hello' }), 'Hello', 'legacy chunk-only prefix snapshot');
assertEqual(applyStreamText('Hello', { chunk: 'Hello Hello' }), 'Hello Hello', 'legacy non-prefix chunk appends');

const duplicatedIfBuggy = applyStreamText('Hello', { chunk: 'Hello', delta: '' });
assertEqual(duplicatedIfBuggy, 'Hello', 'empty delta must not append full chunk again');

console.log('streamText tests passed');
