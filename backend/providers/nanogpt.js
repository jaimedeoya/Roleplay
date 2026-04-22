import { parseOpenAISSE } from './_sse.js';

const NANOGPT_BASE = (process.env.NANOGPT_BASE_URL || 'https://nano-gpt.com/api').replace(/\/$/, '');
const NANOGPT_URL = `${NANOGPT_BASE}/v1/chat/completions`;
const NANOGPT_MODELS_URL = `${NANOGPT_BASE}/v1/models`;

export async function chat({ system, messages, model, temperature = 0.8, maxTokens = 1024 }) {
  const apiKey = process.env.NANOGPT_API_KEY;
  if (!apiKey) throw new Error('NANOGPT_API_KEY not set');

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages) {
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  const body = { model, messages: msgs, temperature, max_tokens: maxTokens };

  const res = await fetch(NANOGPT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NanoGPT ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = (data.choices?.[0]?.message?.content || '').trim();
  return { content };
}

export async function* chatStream({ system, messages, model, temperature = 0.8, maxTokens = 1024 }) {
  const apiKey = process.env.NANOGPT_API_KEY;
  if (!apiKey) throw new Error('NANOGPT_API_KEY not set');

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages) {
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  const body = { model, messages: msgs, temperature, max_tokens: maxTokens, stream: true };

  const res = await fetch(NANOGPT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NanoGPT ${res.status}: ${text}`);
  }

  yield* parseOpenAISSE(res.body);
}

export async function listModels() {
  const apiKey = process.env.NANOGPT_API_KEY;
  const headers = { accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const res = await fetch(NANOGPT_MODELS_URL, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NanoGPT /models ${res.status}: ${text}`);
  }
  const data = await res.json();
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .map((m) => ({
      id: m.id,
      label: m.name || m.id,
      owned_by: m.owned_by || null,
      context_length: m.context_length || m.context_window || null,
    }))
    .filter((m) => m.id)
    .sort((a, b) => a.label.localeCompare(b.label));
}
