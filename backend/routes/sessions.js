import { Router } from 'express';
import crypto from 'node:crypto';
import {
  findSession,
  getSessionById,
  createSession,
  setSessionModel,
  setSessionDifficulty,
  setSessionVariant,
  setSessionNotes,
  addMessage,
  listMessages,
  listObjectives,
  seedObjectives,
  upsertObjective,
  setSessionSummary,
  updateSessionStatus,
  deleteLastAssistantMessage,
  saveEvaluation,
  getEvaluation,
  listEvaluations,
  getPersonalBest,
  resetSession,
  listSessionsForStudent,
  setMessageFeedback,
  getLastUserMessage,
  getDb,
} from '../db.js';
import { loadScenario, publicScenario } from '../scenarios.js';
import { chat, chatStream } from '../providers/index.js';
import {
  evaluateProgress,
  finalEvaluation,
  generateNarrative,
  generateHint,
  generateVariant,
} from '../services/evaluator.js';
import { summarise } from '../services/summarizer.js';

const DIFFICULTY_MODIFIERS = {
  easy:
    'MODIFICADOR DE DIFICULTAD (FÁCIL): Sé indulgente. Si el alumno muestra intención mínimamente correcta, facilítale la conversación. Ofrece pistas implícitas si ves que está perdido. Baja el tono más rápido ante cualquier esfuerzo de empatía.',
  normal: '',
  hard:
    'MODIFICADOR DE DIFICULTAD (DIFÍCIL): Sé exigente. No te conformes con medias tintas: si el alumno propone una solución vaga, empújale con objeciones o preguntas incómodas. Cambia de tema si ves que te lleva por donde quiere. Mantén la presión hasta que el alumno ejecute los objetivos de forma realmente clara.',
};

const router = Router();

function buildChatMessages(history) {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

function buildSystemPrompt(scenario, session) {
  let sys = scenario.system_prompt;
  if (session.variant) {
    sys += `\n\n[Variante activa — detalles específicos de ESTE intento, integra de forma natural]\n${session.variant}`;
  }
  const mod = DIFFICULTY_MODIFIERS[session.difficulty || 'normal'];
  if (mod) sys += `\n\n${mod}`;
  if (session.summary) {
    sys += `\n\n[Resumen de la conversación previa que debes recordar]\n${session.summary}`;
  }
  return sys;
}

/**
 * Resolve which (provider, model) pair to use for a given session.
 * Priority: session override > scenario default > env DEFAULT_MODEL.
 */
function resolveModel(scenario, session) {
  const provider = session.provider || scenario.provider || 'nanogpt';
  const model = session.model || scenario.model || process.env.DEFAULT_MODEL;
  if (!model) {
    const err = new Error(
      'No model configured. Set it in the scenario JSON, via DEFAULT_MODEL, or let the user pick one.'
    );
    err.status = 400;
    throw err;
  }
  return { provider, model };
}

function sessionPayload(session, isNew = false) {
  return {
    id: session.id,
    student_id: session.student_id,
    scenario_id: session.scenario_id,
    status: session.status,
    provider: session.provider,
    model: session.model,
    difficulty: session.difficulty || 'normal',
    variant: session.variant || null,
    attempt: session.attempt || 1,
    notes: session.notes || '',
    created_at: session.created_at,
    updated_at: session.updated_at,
    is_new: isNew,
  };
}

function sessionViewPayload(session) {
  return {
    session: sessionPayload(session),
    messages: listMessages(session.id),
    objectives: listObjectives(session.id),
    evaluation: getEvaluation(session.id, session.attempt) || null,
    past_evaluations: listEvaluations(session.id),
    personal_best: getPersonalBest(session.id),
  };
}

async function maybeSummarise(scenario, session) {
  const threshold = Number(process.env.SUMMARY_THRESHOLD || 30);
  const keepRecent = Number(process.env.SUMMARY_KEEP_RECENT || 10);
  const all = listMessages(session.id);
  if (all.length <= threshold) return;

  const olderCount = all.length - keepRecent;
  const older = all.slice(0, olderCount);
  const lastKeptBoundaryId = older[older.length - 1].id;

  try {
    const newSummary = await summarise({
      scenario,
      previousSummary: session.summary || null,
      olderMessages: older,
    });
    if (!newSummary) return;

    setSessionSummary(session.id, newSummary);
    getDb()
      .prepare('DELETE FROM messages WHERE session_id = ? AND id <= ?')
      .run(session.id, lastKeptBoundaryId);
  } catch (e) {
    console.warn('[summariser] failed:', e.message);
  }
}

/**
 * POST /api/sessions
 * body: { student_id, scenario_id, model? }
 * Creates a new session or resumes the existing one for this student+scenario.
 * If `model` is supplied on a NEW session, it's stored as the session's model.
 */
router.post('/', async (req, res) => {
  try {
    const { student_id, scenario_id, model, difficulty } = req.body || {};
    if (!student_id || !scenario_id) {
      return res.status(400).json({ error: 'student_id and scenario_id are required' });
    }

    const scenario = loadScenario(scenario_id);
    const cleanDifficulty = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : null;

    let session = findSession(student_id, scenario_id);
    let isNew = false;

    if (!session) {
      const id = crypto.randomUUID();
      const initialProvider = scenario.provider || 'nanogpt';
      const initialModel = model || scenario.model || process.env.DEFAULT_MODEL || null;
      session = createSession({
        id,
        studentId: student_id,
        scenarioId: scenario_id,
        provider: initialProvider,
        model: initialModel,
        difficulty: cleanDifficulty || 'normal',
      });
      seedObjectives(id, scenario.learning_objectives.map((o) => o.id));
      if (scenario.first_message) {
        addMessage(id, 'assistant', scenario.first_message);
      }
      isNew = true;
    } else if (cleanDifficulty && cleanDifficulty !== session.difficulty) {
      setSessionDifficulty(session.id, cleanDifficulty);
      session = getSessionById(session.id);
    }

    res.json({
      ...sessionViewPayload(session),
      session: sessionPayload(session, isNew),
      scenario: publicScenario(scenario),
    });
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/sessions/:id
 * Full session state (for the frontend to poll/refresh).
 */
router.get('/:id', (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const scenario = loadScenario(session.scenario_id);
  res.json({
    ...sessionViewPayload(session),
    scenario: publicScenario(scenario),
  });
});

/**
 * PATCH /api/sessions/:id/model
 * body: { model, provider? }
 * Switch the model used for the rest of the session. Persists across reloads.
 */
router.patch('/:id/model', (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { model, provider } = req.body || {};
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'model is required' });
  }

  const scenario = loadScenario(session.scenario_id);
  if (Array.isArray(scenario.allowed_models) && scenario.allowed_models.length > 0) {
    if (!scenario.allowed_models.includes(model)) {
      return res.status(400).json({ error: 'Model not allowed by this scenario' });
    }
  }

  setSessionModel(session.id, provider || session.provider || scenario.provider || 'nanogpt', model);
  res.json({ session: sessionPayload(getSessionById(session.id)) });
});

async function generateAndTrack(session, scenario, res) {
  const { provider, model } = resolveModel(scenario, session);
  const history = listMessages(session.id);

  const reply = await chat({
    provider,
    model,
    system: buildSystemPrompt(scenario, session),
    messages: buildChatMessages(history),
    temperature: scenario.temperature ?? 0.8,
    maxTokens: scenario.max_tokens ?? 1024,
  });

  addMessage(session.id, 'assistant', reply.content);

  let objectives = listObjectives(session.id);
  try {
    const { objectives: updated, turnFeedback } = await evaluateProgress({
      scenario,
      messages: listMessages(session.id),
      currentStatus: objectives,
    });
    for (const u of updated) {
      if (!u || !u.id) continue;
      const status = ['pending', 'in_progress', 'done'].includes(u.status) ? u.status : 'pending';
      upsertObjective(session.id, u.id, status, u.evidence || null);
    }
    if (turnFeedback) {
      const lastUser = getLastUserMessage(session.id);
      if (lastUser) setMessageFeedback(lastUser.id, turnFeedback);
    }
    objectives = listObjectives(session.id);
  } catch (e) {
    console.warn('[evaluator] failed:', e.message);
  }

  maybeSummarise(scenario, getSessionById(session.id)).catch((e) =>
    console.warn('[summariser] async failed:', e.message)
  );

  res.json({
    reply: reply.content,
    messages: listMessages(session.id),
    objectives,
  });
}

async function generateAndTrackStream(session, scenario, res) {
  res.status(200);
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat every 15s so proxies don't drop the idle connection.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 15000);

  let full = '';
  let clientGone = false;
  res.on('close', () => { clientGone = true; });

  try {
    const { provider, model } = resolveModel(scenario, session);
    const history = listMessages(session.id);

    for await (const chunk of chatStream({
      provider,
      model,
      system: buildSystemPrompt(scenario, session),
      messages: buildChatMessages(history),
      temperature: scenario.temperature ?? 0.8,
      maxTokens: scenario.max_tokens ?? 1024,
    })) {
      if (clientGone) break;
      full += chunk;
      send('delta', { text: chunk });
    }
  } catch (e) {
    clearInterval(heartbeat);
    send('error', { error: e.message });
    res.end();
    return;
  }

  clearInterval(heartbeat);

  const trimmed = full.trim();
  if (!trimmed) {
    send('error', { error: 'Empty response from model' });
    res.end();
    return;
  }

  addMessage(session.id, 'assistant', trimmed);

  let objectives = listObjectives(session.id);
  try {
    const { objectives: updated, turnFeedback } = await evaluateProgress({
      scenario,
      messages: listMessages(session.id),
      currentStatus: objectives,
    });
    for (const u of updated) {
      if (!u || !u.id) continue;
      const status = ['pending', 'in_progress', 'done'].includes(u.status) ? u.status : 'pending';
      upsertObjective(session.id, u.id, status, u.evidence || null);
    }
    if (turnFeedback) {
      const lastUser = getLastUserMessage(session.id);
      if (lastUser) setMessageFeedback(lastUser.id, turnFeedback);
    }
    objectives = listObjectives(session.id);
  } catch (e) {
    console.warn('[evaluator] failed:', e.message);
  }

  maybeSummarise(scenario, getSessionById(session.id)).catch((e) =>
    console.warn('[summariser] async failed:', e.message)
  );

  send('done', {
    messages: listMessages(session.id),
    objectives,
  });
  res.end();
}

/**
 * POST /api/sessions/:id/messages/stream
 * body: { content }
 * Streams the assistant reply as SSE (event: delta / done / error).
 */
router.post('/:id/messages/stream', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session is closed' });

    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const scenario = loadScenario(session.scenario_id);
    addMessage(session.id, 'user', content.trim());
    await generateAndTrackStream(session, scenario, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/regenerate/stream
 * Streams a regenerated assistant reply as SSE.
 */
router.post('/:id/regenerate/stream', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session is closed' });

    const scenario = loadScenario(session.scenario_id);
    deleteLastAssistantMessage(session.id);

    const history = listMessages(session.id);
    if (history.length === 0) return res.status(400).json({ error: 'Nothing to regenerate' });

    await generateAndTrackStream(session, scenario, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/messages
 * body: { content }
 */
router.post('/:id/messages', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session is closed' });

    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const scenario = loadScenario(session.scenario_id);
    addMessage(session.id, 'user', content.trim());
    await generateAndTrack(session, scenario, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/regenerate
 */
router.post('/:id/regenerate', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session is closed' });

    const scenario = loadScenario(session.scenario_id);
    deleteLastAssistantMessage(session.id);

    const history = listMessages(session.id);
    if (history.length === 0) return res.status(400).json({ error: 'Nothing to regenerate' });

    await generateAndTrack(session, scenario, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/evaluate
 */
router.post('/:id/evaluate', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const existing = getEvaluation(session.id, session.attempt);
    if (existing) {
      return res.json({
        evaluation: existing,
        personal_best: getPersonalBest(session.id),
        past_evaluations: listEvaluations(session.id),
        already: true,
      });
    }

    const scenario = loadScenario(session.scenario_id);
    const messages = listMessages(session.id);
    if (messages.filter((m) => m.role === 'user').length === 0) {
      return res.status(400).json({ error: 'No student messages to evaluate yet' });
    }

    const report = await finalEvaluation({ scenario, messages });
    const score = Number.isFinite(report.score) ? Math.round(report.score) : 0;

    // Narrative is best-effort: if it fails, we still save the evaluation.
    const narrative = await generateNarrative({ scenario, messages, evaluation: { ...report, score } });

    saveEvaluation(session.id, session.attempt, score, report, narrative);
    updateSessionStatus(session.id, 'completed');

    res.json({
      evaluation: { attempt: session.attempt, score, feedback: report, narrative },
      personal_best: getPersonalBest(session.id),
      past_evaluations: listEvaluations(session.id),
      already: false,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/reopen
 */
router.post('/:id/reopen', (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  updateSessionStatus(session.id, 'active');
  res.json({ ok: true });
});

/**
 * POST /api/sessions/:id/reset
 * Wipes messages, objectives, summary and evaluation for this session, then
 * re-seeds the pending objectives and the scenario's first_message.
 * Returns the fresh session state (same shape as GET /api/sessions/:id).
 */
router.post('/:id/reset', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const scenario = loadScenario(session.scenario_id);
    const wantVariant = !!(req.body && req.body.variant);

    resetSession(session.id);
    seedObjectives(session.id, scenario.learning_objectives.map((o) => o.id));

    if (wantVariant) {
      const v = await generateVariant({ scenario });
      if (v) setSessionVariant(session.id, v);
    }

    if (scenario.first_message) {
      addMessage(session.id, 'assistant', scenario.first_message);
    }

    const fresh = getSessionById(session.id);
    res.json({
      ...sessionViewPayload(fresh),
      scenario: publicScenario(scenario),
    });
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * PATCH /api/sessions/:id/notes — student notes (saved per session).
 */
router.patch('/:id/notes', (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
  setSessionNotes(session.id, notes.slice(0, 10000));
  res.json({ ok: true });
});

/**
 * PATCH /api/sessions/:id/difficulty — change difficulty mid-session.
 */
router.patch('/:id/difficulty', (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const d = req.body?.difficulty;
  if (!['easy', 'normal', 'hard'].includes(d)) {
    return res.status(400).json({ error: 'difficulty must be easy|normal|hard' });
  }
  setSessionDifficulty(session.id, d);
  res.json({ session: sessionPayload(getSessionById(session.id)) });
});

/**
 * POST /api/sessions/:id/hint — returns a one-sentence coaching hint.
 */
router.post('/:id/hint', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const scenario = loadScenario(session.scenario_id);
    const hint = await generateHint({
      scenario,
      messages: listMessages(session.id),
      objectives: listObjectives(session.id),
    });
    res.json({ hint });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/sessions?student_id=X — student history across scenarios.
 */
router.get('/', (req, res) => {
  const studentId = req.query.student_id;
  if (!studentId) return res.status(400).json({ error: 'student_id is required' });
  const rows = listSessionsForStudent(String(studentId));
  res.json({
    sessions: rows.map((s) => ({
      id: s.id,
      scenario_id: s.scenario_id,
      status: s.status,
      difficulty: s.difficulty || 'normal',
      attempt: s.attempt || 1,
      best_score: s.best_score,
      last_score: s.last_score,
      attempts_completed: s.attempts_completed,
      updated_at: s.updated_at,
    })),
  });
});

export default router;
