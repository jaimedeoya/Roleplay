import { chat } from '../providers/index.js';

function buildObjectivesBlock(scenario) {
  return scenario.learning_objectives
    .map((o) => {
      const crit = o.success_criteria ? `\n  success_criteria: ${o.success_criteria}` : '';
      const desc = o.description ? `\n  description: ${o.description}` : '';
      return `- id: ${o.id}\n  name: ${o.name}${desc}${crit}`;
    })
    .join('\n');
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fence ? fence[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in evaluator response');
  return JSON.parse(candidate.slice(start, end + 1));
}

function transcript(messages) {
  return messages
    .map((m) => `${m.role === 'assistant' ? 'AGENT' : 'STUDENT'}: ${m.content}`)
    .join('\n');
}

/**
 * Given the conversation so far, return per-objective status and evidence.
 * Runs after every student turn. Uses a cheap evaluator model.
 */
export async function evaluateProgress({ scenario, messages, currentStatus }) {
  const provider = scenario.evaluator?.provider || process.env.EVALUATOR_PROVIDER;
  const model = scenario.evaluator?.model || process.env.EVALUATOR_MODEL;
  if (!provider || !model) throw new Error('Evaluator provider/model not configured');

  const system = `Eres un evaluador pedagógico. Analizas una conversación de roleplay entre un ALUMNO y un AGENTE y decides qué objetivos de aprendizaje ha cumplido el alumno.

Para cada objetivo devuelve uno de estos estados:
- "pending": el alumno todavía no ha intentado abordar el objetivo.
- "in_progress": el alumno lo ha intentado pero aún no cumple el criterio de éxito.
- "done": el alumno ha cumplido claramente el criterio de éxito.

Una vez un objetivo está en "done" debería mantenerse así salvo que el alumno se contradiga o lo estropee claramente.

Devuelve EXCLUSIVAMENTE un JSON con este formato, sin texto adicional:
{
  "objectives": [
    {"id": "<objective_id>", "status": "pending|in_progress|done", "evidence": "<breve frase citando lo que lo demuestra o vacío>"}
  ]
}`;

  const currentBlock = currentStatus && currentStatus.length
    ? `Estado actual de los objetivos (previo a este turno):\n${currentStatus
        .map((o) => `- ${o.objective_key}: ${o.status}`)
        .join('\n')}\n\n`
    : '';

  const user = `${currentBlock}Objetivos de aprendizaje:
${buildObjectivesBlock(scenario)}

Transcripción de la conversación:
${transcript(messages)}

Devuelve el JSON ahora.`;

  const { content } = await chat({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0,
    maxTokens: 600,
  });

  const parsed = extractJson(content);
  if (!Array.isArray(parsed.objectives)) throw new Error('Evaluator JSON missing objectives array');
  return parsed.objectives;
}

/**
 * Final evaluation when the student closes the session.
 * Returns a score 0-100 plus per-objective feedback and a textual summary.
 */
export async function finalEvaluation({ scenario, messages }) {
  const provider = scenario.evaluator?.provider || process.env.EVALUATOR_PROVIDER;
  const model = scenario.evaluator?.model || process.env.EVALUATOR_MODEL;
  if (!provider || !model) throw new Error('Evaluator provider/model not configured');

  const rubric = scenario.evaluation_rubric
    ? `\nRúbrica adicional:\n${JSON.stringify(scenario.evaluation_rubric, null, 2)}\n`
    : '';

  const system = `Eres un evaluador pedagógico redactando el informe final de un ejercicio de roleplay.
Evalúa el desempeño del ALUMNO frente al AGENTE de roleplay teniendo en cuenta los objetivos de aprendizaje${rubric ? ' y la rúbrica' : ''}.
Devuelve EXCLUSIVAMENTE un JSON con este formato, sin texto adicional ni markdown:
{
  "score": <número entero 0-100>,
  "summary": "<resumen global del desempeño, 2-4 frases>",
  "strengths": ["<punto fuerte 1>", "..."],
  "improvements": ["<área de mejora 1>", "..."],
  "objectives": [
    {"id": "<objective_id>", "status": "pending|in_progress|done", "feedback": "<feedback específico 1-2 frases>"}
  ]
}`;

  const user = `Objetivos de aprendizaje:
${buildObjectivesBlock(scenario)}
${rubric}
Transcripción:
${transcript(messages)}

Devuelve el JSON ahora.`;

  const { content } = await chat({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0,
    maxTokens: 1200,
  });

  return extractJson(content);
}
