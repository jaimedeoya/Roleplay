const NANOGPT_URL = process.env.NANOGPT_URL || 'https://nano-gpt.com/api/v1/chat/completions';

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
