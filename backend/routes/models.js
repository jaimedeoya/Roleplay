import { Router } from 'express';
import { listModels } from '../providers/nanogpt.js';

const router = Router();

let cache = null;
let cachedAt = 0;
const TTL_MS = 5 * 60 * 1000;

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (!cache || now - cachedAt > TTL_MS || req.query.refresh === '1') {
      cache = await listModels();
      cachedAt = now;
    }
    res.json({ models: cache });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
