import { Router } from 'express';

const router = Router();

const NANOGPT_BASE = (process.env.NANOGPT_BASE_URL || 'https://nano-gpt.com/api').replace(/\/$/, '');
const TTS_URL = `${NANOGPT_BASE}/v1/audio/speech`;
const DEFAULT_MODEL = process.env.TTS_MODEL || 'tts-1';
const DEFAULT_VOICE = process.env.TTS_VOICE || 'alloy';
const DEFAULT_FORMAT = process.env.TTS_FORMAT || 'mp3';

/**
 * POST /api/tts
 * body: { text, voice?, model?, format? }
 *
 * Proxies OpenAI-compatible TTS at NanoGPT. Returns raw audio bytes with the
 * appropriate Content-Type, so the frontend can stream-play via Audio element.
 */
router.post('/', async (req, res) => {
  try {
    const apiKey = process.env.NANOGPT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'NANOGPT_API_KEY not set' });

    const { text, voice, model, format } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const body = {
      model: model || DEFAULT_MODEL,
      voice: voice || DEFAULT_VOICE,
      input: text.slice(0, 4000),
      response_format: format || DEFAULT_FORMAT,
    };

    const upstream = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: txt || `TTS ${upstream.status}` });
    }

    const ct = upstream.headers.get('content-type') || `audio/${body.response_format}`;
    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'no-store');

    // Pipe upstream bytes to client without buffering the whole blob.
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    console.error('[tts] failed:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

export default router;
