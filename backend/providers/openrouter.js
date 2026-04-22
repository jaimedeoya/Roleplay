import { parseOpenAISSE } from './_sse.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function chat({ system, messages, model, temperature = 0.8, maxTokens = 1024 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages) {
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  const body = { model, messages: msgs, temperature, max_tokens: maxTokens };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://roleplay.local',
      'X-Title': process.env.OPENROUTER_TITLE || 'Roleplay e-learning',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = (data.choices?.[0]?.message?.content || '').trim();
  return { content };
}

export async function* chatStream({ system, messages, model, temperature = 0.8, maxTokens = 1024 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages) {
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  const body = { model, messages: msgs, temperature, max_tokens: maxTokens, stream: true };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://roleplay.local',
      'X-Title': process.env.OPENROUTER_TITLE || 'Roleplay e-learning',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  yield* parseOpenAISSE(res.body);
}
