import { chat } from '../providers/index.js';

function transcript(messages) {
  return messages
    .map((m) => `${m.role === 'assistant' ? 'AGENT' : 'STUDENT'}: ${m.content}`)
    .join('\n');
}

/**
 * Summarise an older slice of the conversation so the chat history stays short.
 * `previousSummary` is the previous rolling summary (or null).
 */
export async function summarise({ scenario, previousSummary, olderMessages }) {
  const provider = scenario.summarizer?.provider || process.env.SUMMARIZER_PROVIDER;
  const model = scenario.summarizer?.model || process.env.SUMMARIZER_MODEL;
  if (!provider || !model) return null;

  const system = `Eres un asistente que comprime conversaciones de roleplay manteniendo los hechos relevantes para que el AGENTE pueda seguir en personaje y recordar lo ocurrido. Mantén: nombres, cifras, acuerdos, objeciones, posturas, datos personales revelados, decisiones tomadas. Elimina chit-chat. Escribe en tercera persona, en español, máximo 12 frases.`;

  const prev = previousSummary ? `Resumen previo:\n${previousSummary}\n\n` : '';
  const user = `${prev}Nuevos mensajes a incorporar:
${transcript(olderMessages)}

Devuelve SOLO el resumen actualizado, sin preámbulo.`;

  const { content } = await chat({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.2,
    maxTokens: 700,
  });

  return content.trim();
}
