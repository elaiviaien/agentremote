import { ChatMessage, MessageBlock, ToolCallItem } from './types';
import { applyStreamText, StreamTextPayload } from './streamText';

export function ensureMessageBlocks(msg: ChatMessage): MessageBlock[] {
  if (!msg.blocks) {
    msg.blocks = [];
  }
  return msg.blocks;
}

export function appendTextToBlocks(msg: ChatMessage, payload: StreamTextPayload): void {
  const blocks = ensureMessageBlocks(msg);
  const last = blocks[blocks.length - 1];

  if (last && last.type === 'text') {
    last.content = applyStreamText(last.content, payload);
  } else {
    const initial = applyStreamText('', payload);
    if (initial) {
      blocks.push({ type: 'text', content: initial });
    }
  }

  msg.content = applyStreamText(msg.content || '', payload);
}

export function appendToolToBlocks(msg: ChatMessage, toolCall: ToolCallItem): void {
  const blocks = ensureMessageBlocks(msg);
  if (!blocks.some((b) => b.type === 'tool' && b.toolCallId === toolCall.id)) {
    blocks.push({ type: 'tool', toolCallId: toolCall.id });
  }
}

export function getRenderableBlocks(msg: ChatMessage): MessageBlock[] {
  if (msg.blocks && msg.blocks.length > 0) {
    return msg.blocks;
  }

  const legacy: MessageBlock[] = [];
  if (msg.content) {
    legacy.push({ type: 'text', content: msg.content });
  }
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      legacy.push({ type: 'tool', toolCallId: tc.id });
    }
  }
  return legacy;
}
