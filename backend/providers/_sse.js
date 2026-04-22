/**
 * Shared SSE parsing helpers for upstream LLM APIs.
 *
 * parseOpenAISSE: yields text deltas from OpenAI-compatible SSE streams
 *   (NanoGPT, OpenRouter, OpenAI). Emits `choices[0].delta.content` chunks.
 * parseAnthropicSSE: yields text deltas from Anthropic Messages SSE streams.
 *   Emits `content_block_delta` text deltas.
 */

async function* iterateSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      yield payload;
    }
  }
}

export async function* parseOpenAISSE(body) {
  for await (const payload of iterateSSE(body)) {
    if (!payload || payload === '[DONE]') {
      if (payload === '[DONE]') return;
      continue;
    }
    try {
      const obj = JSON.parse(payload);
      const delta = obj.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length) yield delta;
    } catch {
      /* ignore malformed chunks (keep-alive, partial) */
    }
  }
}

export async function* parseAnthropicSSE(body) {
  for await (const payload of iterateSSE(body)) {
    if (!payload) continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
        const text = obj.delta.text;
        if (typeof text === 'string' && text.length) yield text;
      }
      if (obj.type === 'message_stop') return;
    } catch {
      /* ignore */
    }
  }
}
