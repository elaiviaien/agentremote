export interface StreamTextPayload {
  chunk?: string;
  delta?: string;
}

/**
 * Merge a stream event into previously shown text.
 * Empty `delta` with a `chunk` is a snapshot replace (not an append).
 * That prevents duplicating a full accumulated chunk when CLI emits a summary event.
 */
export function applyStreamText(previous: string, payload: StreamTextPayload): string {
  const prev = previous || '';
  if (typeof payload.delta === 'string') {
    if (payload.delta.length > 0) return prev + payload.delta;
    if (typeof payload.chunk === 'string' && payload.chunk.length > 0) return payload.chunk;
    return prev;
  }
  const chunk = payload.chunk || '';
  if (!chunk) return prev;
  if (chunk.startsWith(prev)) return chunk;
  return prev + chunk;
}
