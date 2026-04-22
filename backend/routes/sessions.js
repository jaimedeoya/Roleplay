import { Router } from 'express';
import crypto from 'node:crypto';
import {
  findSession,
  getSessionById,
  createSession,
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
  getDb,
} from '../db.js';
import { loadScenario, publicScenario } from '../scenarios.js';
import { chat } from '../providers/index.js';
import { evaluateProgress, finalEvaluation } from '../services/evaluator.js';
import { summarise } from '../services/summarizer.js';

const router = Router();

function buildChatMessages(history) {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

function buildSystemPrompt(scenario, session) {
  let sys = scenario.system_prompt;
  if (session.summary) {
    sys += `\n\n[Resumen de la conversación previa que debes recordar]\n${session.summary}`;
  }
  return sys;
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
    // Drop the older messages now captured by the summary so history stays short.
    getDb()
      .prepare('DELETE FROM messages WHERE session_id = ? AND id <= ?')
      .run(session.id, lastKeptBoundaryId);
  } catch (e) {
    console.warn('[summariser] failed:', e.message);
  }
}

/**
 * POST /api/sessions
 * body: { student_id, scenario_id }
 * Creates a new session or resumes the existing one for this student+scenario.
 */
router.post('/', async (req, res) => {
  try {
    const { student_id, scenario_id } = req.body || {};
    if (!student_id || !scenario_id) {
      return res.status(400).json({ error: 'student_id and scenario_id are required' });
    }

    const scenario = loadScenario(scenario_id);

    let session = findSession(student_id, scenario_id);
    let isNew = false;

    if (!session) {
      const id = crypto.randomUUID();
      session = createSession({ id, studentId: student_id, scenarioId: scenario_id });
      seedObjectives(id, scenario.learning_objectives.map((o) => o.id));
      if (scenario.first_message) {
        addMessage(id, 'assistant', scenario.first_message);
      }
      isNew = true;
    }

    const messages = listMessages(session.id);
    const objectives = listObjectives(session.id);
    const evaluation = getEvaluation(session.id);

    res.json({
      session: {
        id: session.id,
        student_id: session.student_id,
        scenario_id: session.scenario_id,
        status: session.status,
        created_at: session.created_at,
        updated_at: session.updated_at,
        is_new: isNew,
      },
      scenario: publicScenario(scenario),
      messages,
      objectives,
      evaluation,
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
    session,
    scenario: publicScenario(scenario),
    messages: listMessages(session.id),
    objectives: listObjectives(session.id),
    evaluation: getEvaluation(session.id),
  });
});

/**
 * POST /api/sessions/:id/messages
 * body: { content }
 * Sends the student's message and returns the agent's reply plus updated objectives.
 */
router.post('/:id/messages', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session is closed' });
    }

    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const scenario = loadScenario(session.scenario_id);

    addMessage(session.id, 'user', content.trim());

    const history = listMessages(session.id);

    const reply = await chat({
      provider: scenario.provider,
      model: scenario.model,
      system: buildSystemPrompt(scenario, session),
      messages: buildChatMessages(history),
      temperature: scenario.temperature ?? 0.8,
      maxTokens: scenario.max_tokens ?? 1024,
    });

    addMessage(session.id, 'assistant', reply.content);

    let objectives = listObjectives(session.id);
    try {
      const updated = await evaluateProgress({
        scenario,
        messages: listMessages(session.id),
        currentStatus: objectives,
      });
      for (const u of updated) {
        if (!u || !u.id) continue;
        const status = ['pending', 'in_progress', 'done'].includes(u.status) ? u.status : 'pending';
        upsertObjective(session.id, u.id, status, u.evidence || null);
      }
      objectives = listObjectives(session.id);
    } catch (e) {
      console.warn('[evaluator] failed:', e.message);
    }

    // Fire-and-forget summary if the history is long enough.
    maybeSummarise(scenario, getSessionById(session.id)).catch((e) =>
      console.warn('[summariser] async failed:', e.message)
    );

    res.json({
      reply: reply.content,
      messages: listMessages(session.id),
      objectives,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/regenerate
 * Drops the last assistant message and produces a new one from the same history.
 */
router.post('/:id/regenerate', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session is closed' });
    }

    const scenario = loadScenario(session.scenario_id);
    deleteLastAssistantMessage(session.id);

    const history = listMessages(session.id);
    if (history.length === 0) {
      return res.status(400).json({ error: 'Nothing to regenerate' });
    }

    const reply = await chat({
      provider: scenario.provider,
      model: scenario.model,
      system: buildSystemPrompt(scenario, session),
      messages: buildChatMessages(history),
      temperature: scenario.temperature ?? 0.8,
      maxTokens: scenario.max_tokens ?? 1024,
    });

    addMessage(session.id, 'assistant', reply.content);

    let objectives = listObjectives(session.id);
    try {
      const updated = await evaluateProgress({
        scenario,
        messages: listMessages(session.id),
        currentStatus: objectives,
      });
      for (const u of updated) {
        if (!u || !u.id) continue;
        const status = ['pending', 'in_progress', 'done'].includes(u.status) ? u.status : 'pending';
        upsertObjective(session.id, u.id, status, u.evidence || null);
      }
      objectives = listObjectives(session.id);
    } catch (e) {
      console.warn('[evaluator] failed:', e.message);
    }

    res.json({
      reply: reply.content,
      messages: listMessages(session.id),
      objectives,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/evaluate
 * Closes the session and produces the final evaluation report.
 */
router.post('/:id/evaluate', async (req, res) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const existing = getEvaluation(session.id);
    if (existing) {
      return res.json({ evaluation: existing, already: true });
    }

    const scenario = loadScenario(session.scenario_id);
    const messages = listMessages(session.id);
    if (messages.filter((m) => m.role === 'user').length === 0) {
      return res.status(400).json({ error: 'No student messages to evaluate yet' });
    }

    const report = await finalEvaluation({ scenario, messages });
    const score = Number.isFinite(report.score) ? Math.round(report.score) : 0;
    saveEvaluation(session.id, score, report);
    updateSessionStatus(session.id, 'completed');

    res.json({ evaluation: { score, feedback: report }, already: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/sessions/:id/reopen
 * Lets the student go back and continue practising after seeing the evaluation.
 */
router.post('/:id/reopen', (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  updateSessionStatus(session.id, 'active');
  res.json({ ok: true });
});

export default router;
