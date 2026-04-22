const qs = new URLSearchParams(location.search);
const STUDENT_ID = qs.get('student_id') || qs.get('studentId');
const SCENARIO_ID = qs.get('scenario_id') || qs.get('scenarioId');
const API_BASE = (qs.get('api') || '').replace(/\/$/, '') || '';

const els = {
  scenarioName: document.getElementById('scenario-name'),
  scenarioDescription: document.getElementById('scenario-description'),
  messages: document.getElementById('messages'),
  composer: document.getElementById('composer'),
  input: document.getElementById('input'),
  btnSend: document.getElementById('btn-send'),
  btnRegenerate: document.getElementById('btn-regenerate'),
  btnEvaluate: document.getElementById('btn-evaluate'),
  modelSelect: document.getElementById('model-select'),
  objectives: document.getElementById('objectives'),
  banner: document.getElementById('banner'),
  evalModal: document.getElementById('eval-modal'),
  evalBody: document.getElementById('eval-body'),
  evalClose: document.getElementById('eval-close'),
  btnEvalOk: document.getElementById('btn-eval-ok'),
  btnReopen: document.getElementById('btn-reopen'),
};

const state = {
  session: null,
  scenario: null,
  objectives: [],
  messages: [],
  models: [],
  busy: false,
  evaluation: null,
};

function api(path, opts = {}) {
  return fetch(`${API_BASE}/api${path}`, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });
}

function showBanner(msg, level = 'error') {
  els.banner.textContent = msg;
  els.banner.classList.remove('hidden');
  els.banner.style.background = level === 'error' ? 'var(--danger)' : 'var(--accent)';
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => els.banner.classList.add('hidden'), 4000);
}

function labelFor(role) {
  if (role === 'user') return 'Tú';
  if (role === 'assistant') return state.scenario?.character?.name || 'Agente';
  return role;
}

function renderMessages() {
  els.messages.innerHTML = '';
  for (const m of state.messages) {
    const div = document.createElement('div');
    div.className = `msg ${m.role}`;
    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = labelFor(m.role);
    div.appendChild(role);
    div.appendChild(document.createTextNode(m.content));
    els.messages.appendChild(div);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
  updateControlAvailability();
}

function showTyping(on) {
  let tip = document.getElementById('typing');
  if (on) {
    if (tip) return;
    tip = document.createElement('div');
    tip.id = 'typing';
    tip.className = 'msg typing';
    tip.textContent = `${labelFor('assistant')} está escribiendo…`;
    els.messages.appendChild(tip);
    els.messages.scrollTop = els.messages.scrollHeight;
  } else if (tip) {
    tip.remove();
  }
}

function renderObjectives() {
  els.objectives.innerHTML = '';
  const defs = state.scenario?.learning_objectives || [];
  const statusBy = new Map(state.objectives.map((o) => [o.objective_key, o]));
  for (const def of defs) {
    const current = statusBy.get(def.id) || { status: 'pending' };
    const li = document.createElement('li');
    li.className = `objective ${current.status}`;
    const head = document.createElement('div');
    head.className = 'objective-head';
    const badge = document.createElement('span');
    badge.className = 'objective-status';
    badge.textContent = current.status === 'done' ? '✓' : current.status === 'in_progress' ? '·' : '';
    badge.title = current.status;
    head.appendChild(badge);
    const name = document.createElement('span');
    name.textContent = def.name;
    head.appendChild(name);
    li.appendChild(head);
    if (def.description) {
      const d = document.createElement('p');
      d.className = 'objective-desc';
      d.textContent = def.description;
      li.appendChild(d);
    }
    if (current.evidence) {
      const e = document.createElement('p');
      e.className = 'objective-evidence';
      e.textContent = `“${current.evidence}”`;
      li.appendChild(e);
    }
    els.objectives.appendChild(li);
  }
}

function updateControlAvailability() {
  const sessionClosed = state.session?.status === 'completed';
  const hasUserMsg = state.messages.some((m) => m.role === 'user');
  els.input.disabled = state.busy || sessionClosed;
  els.btnSend.disabled = state.busy || sessionClosed;
  els.btnRegenerate.disabled = state.busy || sessionClosed || !hasUserMsg;
  els.btnEvaluate.disabled = state.busy || !hasUserMsg;
  els.btnEvaluate.textContent = sessionClosed ? 'Ver evaluación' : 'Finalizar y evaluar';
  els.modelSelect.disabled =
    state.busy || sessionClosed || !state.session || state.models.length === 0;
}

function renderScenario() {
  const s = state.scenario;
  if (!s) return;
  els.scenarioName.textContent = s.name;
  els.scenarioDescription.textContent = s.description || '';
  document.title = `Roleplay — ${s.name}`;
}

function renderModelSelector() {
  els.modelSelect.innerHTML = '';
  const allowed = state.scenario?.allowed_models || null;
  const available = allowed && allowed.length
    ? state.models.filter((m) => allowed.includes(m.id))
    : state.models;

  const current =
    state.session?.model ||
    state.scenario?.default_model ||
    (available[0] && available[0].id) ||
    '';

  // Make sure the currently selected model is in the list even if /api/models
  // didn't return it (e.g. offline, or allow-list points to a deprecated id).
  const ids = new Set(available.map((m) => m.id));
  if (current && !ids.has(current)) {
    available.unshift({ id: current, label: current, owned_by: null, context_length: null });
  }

  if (available.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin modelos disponibles';
    els.modelSelect.appendChild(opt);
    els.modelSelect.disabled = true;
    return;
  }

  for (const m of available) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.owned_by ? `${m.label} · ${m.owned_by}` : m.label;
    els.modelSelect.appendChild(opt);
  }
  els.modelSelect.value = current;
  els.modelSelect.disabled = state.busy || state.session?.status === 'completed';
}

async function loadModels() {
  try {
    const data = await api('/models');
    state.models = data.models || [];
  } catch (e) {
    showBanner(`No se pudo cargar la lista de modelos: ${e.message}`);
    state.models = [];
  }
  renderModelSelector();
}

async function onModelChange(ev) {
  const newModel = ev.target.value;
  if (!state.session || !newModel || newModel === state.session.model) return;
  const prev = state.session.model;
  state.session.model = newModel;
  try {
    await api(`/sessions/${state.session.id}/model`, {
      method: 'PATCH',
      body: JSON.stringify({ model: newModel }),
    });
  } catch (e) {
    showBanner(`No se pudo cambiar el modelo: ${e.message}`);
    state.session.model = prev;
    els.modelSelect.value = prev || '';
  }
}

async function loadSession() {
  if (!STUDENT_ID || !SCENARIO_ID) {
    els.scenarioName.textContent = 'Faltan parámetros';
    els.scenarioDescription.textContent =
      'Añade ?student_id=<ID>&scenario_id=<ID> a la URL para iniciar la práctica.';
    return;
  }
  try {
    const data = await api('/sessions', {
      method: 'POST',
      body: JSON.stringify({ student_id: STUDENT_ID, scenario_id: SCENARIO_ID }),
    });
    state.session = data.session;
    state.scenario = data.scenario;
    state.messages = data.messages;
    state.objectives = data.objectives;
    state.evaluation = data.evaluation || null;
    renderScenario();
    renderMessages();
    renderObjectives();
    renderModelSelector();
    updateControlAvailability();
  } catch (e) {
    showBanner(`Error al iniciar la sesión: ${e.message}`);
  }
}

async function sendMessage(text) {
  if (!state.session || state.busy) return;
  state.busy = true;
  // Optimistic user message
  state.messages = [...state.messages, { role: 'user', content: text, id: Date.now() }];
  renderMessages();
  showTyping(true);
  try {
    const data = await api(`/sessions/${state.session.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: text }),
    });
    state.messages = data.messages;
    state.objectives = data.objectives;
    renderObjectives();
  } catch (e) {
    showBanner(`Error: ${e.message}`);
    // Roll back optimistic bubble on failure
    state.messages = state.messages.slice(0, -1);
  } finally {
    showTyping(false);
    state.busy = false;
    renderMessages();
  }
}

async function regenerate() {
  if (!state.session || state.busy) return;
  state.busy = true;
  // Drop the last assistant bubble optimistically
  const lastAssistantIdx = [...state.messages].reverse().findIndex((m) => m.role === 'assistant');
  if (lastAssistantIdx !== -1) {
    state.messages = state.messages.slice(0, state.messages.length - 1 - lastAssistantIdx);
    renderMessages();
  }
  showTyping(true);
  try {
    const data = await api(`/sessions/${state.session.id}/regenerate`, { method: 'POST' });
    state.messages = data.messages;
    state.objectives = data.objectives;
    renderObjectives();
  } catch (e) {
    showBanner(`Error: ${e.message}`);
  } finally {
    showTyping(false);
    state.busy = false;
    renderMessages();
  }
}

function renderEvaluation(evalData) {
  els.evalBody.innerHTML = '';
  const fb = evalData.feedback || {};
  const score = evalData.score ?? 0;

  const ring = document.createElement('div');
  ring.className = 'score-ring';
  const val = document.createElement('div');
  val.className = 'score';
  val.textContent = `${score}/100`;
  const label = document.createElement('div');
  label.className = 'score-label';
  label.textContent = fb.summary || '';
  ring.appendChild(val);
  ring.appendChild(label);
  els.evalBody.appendChild(ring);

  if (Array.isArray(fb.strengths) && fb.strengths.length) {
    const s = document.createElement('div');
    s.className = 'eval-section';
    s.innerHTML = '<h3>Puntos fuertes</h3>';
    const ul = document.createElement('ul');
    fb.strengths.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
    s.appendChild(ul);
    els.evalBody.appendChild(s);
  }
  if (Array.isArray(fb.improvements) && fb.improvements.length) {
    const s = document.createElement('div');
    s.className = 'eval-section';
    s.innerHTML = '<h3>Áreas de mejora</h3>';
    const ul = document.createElement('ul');
    fb.improvements.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
    s.appendChild(ul);
    els.evalBody.appendChild(s);
  }
  if (Array.isArray(fb.objectives) && fb.objectives.length) {
    const defs = new Map((state.scenario?.learning_objectives || []).map((o) => [o.id, o]));
    const s = document.createElement('div');
    s.className = 'eval-section';
    s.innerHTML = '<h3>Objetivos</h3>';
    fb.objectives.forEach((o) => {
      const def = defs.get(o.id) || { name: o.id };
      const row = document.createElement('div');
      row.className = 'eval-obj';
      const head = document.createElement('div');
      head.className = `eval-obj-head objective ${o.status || 'pending'}`;
      head.style.border = 'none';
      head.style.padding = '0';
      const badge = document.createElement('span');
      badge.className = 'objective-status';
      badge.textContent = o.status === 'done' ? '✓' : o.status === 'in_progress' ? '·' : '';
      head.appendChild(badge);
      const name = document.createElement('span');
      name.textContent = def.name;
      head.appendChild(name);
      row.appendChild(head);
      if (o.feedback) {
        const p = document.createElement('p');
        p.className = 'eval-obj-feedback';
        p.textContent = o.feedback;
        row.appendChild(p);
      }
      s.appendChild(row);
    });
    els.evalBody.appendChild(s);
  }
}

function openModal() { els.evalModal.classList.remove('hidden'); }
function closeModal() { els.evalModal.classList.add('hidden'); }

async function evaluateSession() {
  if (!state.session || state.busy) return;
  if (state.session.status === 'completed' && state.evaluation) {
    renderEvaluation(state.evaluation);
    openModal();
    return;
  }
  state.busy = true;
  updateControlAvailability();
  try {
    const data = await api(`/sessions/${state.session.id}/evaluate`, { method: 'POST' });
    state.evaluation = data.evaluation;
    state.session.status = 'completed';
    renderEvaluation(data.evaluation);
    openModal();
  } catch (e) {
    showBanner(`Error al evaluar: ${e.message}`);
  } finally {
    state.busy = false;
    updateControlAvailability();
  }
}

async function reopenSession() {
  if (!state.session) return;
  try {
    await api(`/sessions/${state.session.id}/reopen`, { method: 'POST' });
    state.session.status = 'active';
    closeModal();
    updateControlAvailability();
  } catch (e) {
    showBanner(`Error al reabrir: ${e.message}`);
  }
}

els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = '';
  sendMessage(text);
});

els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.btnRegenerate.addEventListener('click', regenerate);
els.btnEvaluate.addEventListener('click', evaluateSession);
els.evalClose.addEventListener('click', closeModal);
els.btnEvalOk.addEventListener('click', closeModal);
els.btnReopen.addEventListener('click', reopenSession);
els.modelSelect.addEventListener('change', onModelChange);

Promise.all([loadModels(), loadSession()]).then(() => {
  renderModelSelector();
  updateControlAvailability();
});
