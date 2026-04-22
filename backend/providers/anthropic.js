import { parseAnthropicSSE } from './_sse.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export async function chat({ system, messages, model, temperature = 0.8, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  // Anthropic requires the conversation to start with a user turn, so we drop
  // any leading assistant messages (e.g. a scripted opening line from the agent).
  const trimmed = [...messages];
  while (trimmed.length && trimmed[0].role === 'assistant') trimmed.shift();

  const body = {
    model,
    system: system || undefined,
    max_tokens: maxTokens,
    temperature,
    messages: trimmed.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  };

  if (body.messages.length === 0) {
    throw new Error('No user messages to send to Anthropic');
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { content };
}

export async function* chatStream({ system, messages, model, temperature = 0.8, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const trimmed = [...messages];
  while (trimmed.length && trimmed[0].role === 'assistant') trimmed.shift();

  const body = {
    model,
    system: system || undefined,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    messages: trimmed.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  };

  if (body.messages.length === 0) {
    throw new Error('No user messages to send to Anthropic');
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }

  yield* parseAnthropicSSE(res.body);
}
