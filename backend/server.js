import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initDb } from './db.js';
import { initScenarios } from './scenarios.js';
import scenariosRouter from './routes/scenarios.js';
import sessionsRouter from './routes/sessions.js';
import modelsRouter from './routes/models.js';
import transcribeRouter from './routes/transcribe.js';
import ttsRouter from './routes/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || '../data/roleplay.db');
const SCENARIOS_DIR = path.resolve(__dirname, process.env.SCENARIOS_DIR || '../scenarios');
const FRONTEND_DIR = path.resolve(__dirname, process.env.FRONTEND_DIR || '../frontend');

initDb(DB_PATH);
initScenarios(SCENARIOS_DIR);

const app = express();

const rawOrigins = (process.env.ALLOWED_ORIGINS || '*').trim();
const corsOptions =
  rawOrigins === '*'
    ? {}
    : {
        origin: rawOrigins.split(',').map((s) => s.trim()).filter(Boolean),
      };
app.use(cors(corsOptions));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/scenarios', scenariosRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/transcribe', transcribeRouter);
app.use('/api/tts', ttsRouter);

if (fs.existsSync(FRONTEND_DIR)) {
  app.use('/', express.static(FRONTEND_DIR));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`Roleplay backend listening on http://localhost:${PORT}`);
  console.log(`Scenarios dir: ${SCENARIOS_DIR}`);
  console.log(`DB: ${DB_PATH}`);
});
