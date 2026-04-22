import fs from 'node:fs';
import path from 'node:path';

let SCENARIOS_DIR = null;
const cache = new Map();

export function initScenarios(dir) {
  SCENARIOS_DIR = path.resolve(dir);
  if (!fs.existsSync(SCENARIOS_DIR)) {
    throw new Error(`Scenarios dir not found: ${SCENARIOS_DIR}`);
  }
}

function validate(s, file) {
  const required = ['id', 'name', 'provider', 'model', 'system_prompt', 'learning_objectives'];
  for (const k of required) {
    if (s[k] === undefined || s[k] === null) {
      throw new Error(`Scenario ${file} missing field: ${k}`);
    }
  }
  if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length === 0) {
    throw new Error(`Scenario ${file}: learning_objectives must be a non-empty array`);
  }
  const keys = new Set();
  for (const o of s.learning_objectives) {
    if (!o.id || !o.name) {
      throw new Error(`Scenario ${file}: every objective needs id and name`);
    }
    if (keys.has(o.id)) throw new Error(`Scenario ${file}: duplicate objective id ${o.id}`);
    keys.add(o.id);
  }
}

export function loadScenario(scenarioId) {
  if (cache.has(scenarioId)) return cache.get(scenarioId);

  if (!/^[a-z0-9-_]+$/i.test(scenarioId)) {
    throw new Error('Invalid scenario id');
  }

  const file = path.join(SCENARIOS_DIR, `${scenarioId}.json`);
  if (!fs.existsSync(file)) {
    const err = new Error(`Scenario not found: ${scenarioId}`);
    err.status = 404;
    throw err;
  }

  const raw = fs.readFileSync(file, 'utf8');
  const s = JSON.parse(raw);
  validate(s, file);

  cache.set(scenarioId, s);
  return s;
}

export function listScenarios() {
  if (!SCENARIOS_DIR) return [];
  return fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const s = loadScenario(f.replace(/\.json$/, ''));
        return { id: s.id, name: s.name, description: s.description || '' };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function publicScenario(s) {
  return {
    id: s.id,
    name: s.name,
    description: s.description || '',
    character: s.character || null,
    first_message: s.first_message || null,
    learning_objectives: s.learning_objectives.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description || '',
    })),
  };
}
