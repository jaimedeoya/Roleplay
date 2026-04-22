import { Router } from 'express';
import express from 'express';

const router = Router();

const NANOGPT_BASE = (process.env.NANOGPT_BASE_URL || 'https://nano-gpt.com/api').replace(/\/$/, '');
const TRANSCRIBE_URL = `${NANOGPT_BASE}/transcribe`;
const DEFAULT_MODEL = process.env.TRANSCRIBE_MODEL || 'Whisper-Large-V3';
const DEFAULT_LANGUAGE = process.env.TRANSCRIBE_LANGUAGE || 'es';
const MAX_SIZE = Number(process.env.TRANSCRIBE_MAX_BYTES || 25 * 1024 * 1024);

/**
 * POST /api/transcribe
 *
 * Client sends raw audio as the request body (NOT multipart) with:
 *   Content-Type: audio/webm (or whatever MediaRecorder produced)
 *   X-Audio-Filename: optional hint for Whisper
 *   X-Audio-Language: optional ISO-639-1 or "auto" (default: es)
 *
 * We repackage it as multipart and forward to NanoGPT's /transcribe endpoint.
 * No external multipart parser needed — Node 22 has native FormData/Blob.
 */
router.post(
  '/',
  express.raw({ type: ['audio/*', 'video/*', 'application/octet-stream'], limit: MAX_SIZE }),
  async (req, res) => {
    try {
      const apiKey = process.env.NANOGPT_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'NANOGPT_API_KEY not set' });

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Empty audio payload' });
      }

      const mime = req.get('content-type') || 'audio/webm';
      const filename = req.get('x-audio-filename') || `clip.${guessExt(mime)}`;
      const language = (req.get('x-audio-language') || DEFAULT_LANGUAGE).trim();

      const form = new FormData();
      form.append('audio', new Blob([req.body], { type: mime }), filename);
      form.append('model', DEFAULT_MODEL);
      form.append('language', language);

      const upstream = await fetch(TRANSCRIBE_URL, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: form,
      });

      const data = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        const msg = data.error || data.message || `NanoGPT ${upstream.status}`;
        return res.status(upstream.status).json({ error: msg });
      }

      const text = (data.transcription || data.text || '').trim();
      res.json({
        text,
        model: DEFAULT_MODEL,
        language: data.metadata?.language || language,
        duration: data.metadata?.duration || null,
      });
    } catch (e) {
      console.error('[transcribe] failed:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

function guessExt(mime) {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'bin';
}

export default router;
