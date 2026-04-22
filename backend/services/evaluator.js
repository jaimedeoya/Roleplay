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

Además, genera un micro-feedback del ÚLTIMO turno del alumno: una frase muy breve (≤ 110 caracteres) en 2ª persona que destaque algo concreto que haya hecho bien o mal en ese turno, con un nivel "good" (acierto), "warn" (alerta suave) o "neutral" (sin novedad relevante).

Devuelve EXCLUSIVAMENTE un JSON con este formato, sin texto adicional:
{
  "objectives": [
    {"id": "<objective_id>", "status": "pending|in_progress|done", "evidence": "<breve frase citando lo que lo demuestra o vacío>"}
  ],
  "turn_feedback": { "text": "<frase breve>", "level": "good|warn|neutral" }
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
  const tf = parsed.turn_feedback;
  const turnFeedback =
    tf && typeof tf.text === 'string' && tf.text.trim()
      ? {
          text: tf.text.trim().slice(0, 140),
          level: ['good', 'warn', 'neutral'].includes(tf.level) ? tf.level : 'neutral',
        }
      : null;
  return { objectives: parsed.objectives, turnFeedback };
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

/**
 * Generate a 3rd-person narrative recap of the session (2-4 sentences).
 * Run after finalEvaluation so the LLM has the score + feedback as context.
 */
export async function generateNarrative({ scenario, messages, evaluation }) {
  const provider = scenario.evaluator?.provider || process.env.EVALUATOR_PROVIDER;
  const model = scenario.evaluator?.model || process.env.EVALUATOR_MODEL;
  if (!provider || !model) return null;

  const charName = scenario.character?.name || 'el agente';
  const system = `Eres un narrador que resume, en 3ª persona y en 2-4 frases, cómo afrontó el ALUMNO un roleplay de formación. Tono cálido pero honesto, estilo cinemática final de videojuego. No uses comillas ni markdown. No empieces con "El alumno" ni "La alumna" — usa "Lidió con...", "Afrontó...", "Consiguió...". No inventes nombres propios del alumno.`;

  const user = `Escenario: ${scenario.name}
Contraparte: ${charName}
Puntuación final: ${evaluation.score}/100
Puntos fuertes: ${(evaluation.strengths || []).join(' · ')}
Áreas de mejora: ${(evaluation.improvements || []).join(' · ')}

Transcripción:
${transcript(messages)}

Devuelve SOLO el párrafo narrativo, sin encabezados ni comillas.`;

  try {
    const { content } = await chat({
      provider,
      model,
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0.5,
      maxTokens: 240,
    });
    return content.trim().replace(/^["']|["']$/g, '');
  } catch (e) {
    console.warn('[narrative] failed:', e.message);
    return null;
  }
}

/**
 * Produce a single-sentence hint that nudges the student towards the next
 * pending/in-progress objective WITHOUT giving the answer away.
 */
export async function generateHint({ scenario, messages, objectives }) {
  const provider = scenario.evaluator?.provider || process.env.EVALUATOR_PROVIDER;
  const model = scenario.evaluator?.model || process.env.EVALUATOR_MODEL;
  if (!provider || !model) throw new Error('Evaluator provider/model not configured');

  const pending = (objectives || [])
    .filter((o) => o.status !== 'done')
    .map((o) => {
      const def = scenario.learning_objectives.find((x) => x.id === o.objective_key);
      return def ? `- ${def.name}: ${def.description || ''} (éxito: ${def.success_criteria || ''})` : '';
    })
    .filter(Boolean)
    .join('\n');

  const system = `Eres un coach que da pistas a un alumno durante un roleplay, SIN darle la respuesta literal.
Da una única sugerencia en 1-2 frases, en 2ª persona, que le oriente hacia un objetivo aún por cumplir.
No le digas qué frase exacta debe decir. Sugiere el tipo de movimiento (escuchar, validar, preguntar, concretar, etc.).
No uses comillas ni markdown.`;

  const user = `Objetivos pendientes o en progreso:
${pending || '(todos completos)'}

Últimos turnos:
${transcript(messages.slice(-6))}

Devuelve SOLO la pista, sin prefijos.`;

  const { content } = await chat({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.4,
    maxTokens: 120,
  });
  return content.trim().replace(/^["']|["']$/g, '');
}

/**
 * Produce a "variant" twist for the scenario — a 1-2 sentence modifier that
 * is appended to the system prompt so each reset feels fresh. Keeps the
 * character and learning objectives intact.
 */
export async function generateVariant({ scenario }) {
  const provider = scenario.evaluator?.provider || process.env.EVALUATOR_PROVIDER;
  const model = scenario.evaluator?.model || process.env.EVALUATOR_MODEL;
  if (!provider || !model) return null;

  const system = `Eres un diseñador de escenarios. Generas una VARIANTE de un roleplay existente: un twist narrativo breve (1-2 frases) que se inyectará en el system prompt del personaje para que el alumno encuentre una situación distinta en su próximo intento. NO cambies la personalidad general del personaje ni los objetivos de aprendizaje. Cambia datos concretos: el detonante, un detalle de contexto, una restricción nueva, una emoción dominante. Devuelve SOLO la variante, sin prefijos ni comillas.`;

  const user = `Escenario: ${scenario.name}
Descripción: ${scenario.description || ''}
Personaje: ${scenario.character?.name || ''} — ${scenario.character?.role || ''}

Devuelve SOLO la variante (1-2 frases en 2ª persona dirigidas al personaje, ej: "Esta vez tu problema es... Además...").`;

  try {
    const { content } = await chat({
      provider,
      model,
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0.9,
      maxTokens: 160,
    });
    return content.trim().replace(/^["']|["']$/g, '');
  } catch (e) {
    console.warn('[variant] failed:', e.message);
    return null;
  }
}
