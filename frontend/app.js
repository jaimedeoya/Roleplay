const qs = new URLSearchParams(location.search);
const STUDENT_ID = qs.get('student_id') || qs.get('studentId');
const SCENARIO_ID = qs.get('scenario_id') || qs.get('scenarioId');
const API_BASE = (qs.get('api') || '').replace(/\/$/, '') || '';
const URL_DIFFICULTY = qs.get('difficulty');

const els = {
  app: document.getElementById('app'),
  picker: document.getElementById('picker'),
  pickerStudentId: document.getElementById('picker-student-id'),
  pickerList: document.getElementById('picker-list'),
  scenarioName: document.getElementById('scenario-name'),
  scenarioDescription: document.getElementById('scenario-description'),
  messages: document.getElementById('messages'),
  composer: document.getElementById('composer'),
  input: document.getElementById('input'),
  btnSend: document.getElementById('btn-send'),
  btnRegenerate: document.getElementById('btn-regenerate'),
  btnEvaluate: document.getElementById('btn-evaluate'),
  btnHelp: document.getElementById('btn-help'),
  btnReset: document.getElementById('btn-reset'),
  btnMic: document.getElementById('btn-mic'),
  btnHint: document.getElementById('btn-hint'),
  btnAudio: document.getElementById('btn-audio'),
  btnHistory: document.getElementById('btn-history'),
  attemptChip: document.getElementById('attempt-chip'),
  attemptNum: document.getElementById('attempt-num'),
  bestChip: document.getElementById('best-chip'),
  bestScore: document.getElementById('best-score'),
  difficultyChip: document.getElementById('difficulty-chip'),
  variantBanner: document.getElementById('variant-banner'),
  difficultyModal: document.getElementById('difficulty-modal'),
  difficultyClose: document.getElementById('difficulty-close'),
  historyModal: document.getElementById('history-modal'),
  historyClose: document.getElementById('history-close'),
  historyBody: document.getElementById('history-body'),
  historyOk: document.getElementById('history-ok'),
  hintModal: document.getElementById('hint-modal'),
  hintClose: document.getElementById('hint-close'),
  hintText: document.getElementById('hint-text'),
  hintOk: document.getElementById('hint-ok'),
  notes: document.getElementById('notes'),
  notesSaved: document.getElementById('notes-saved'),
  confirmExtra: document.getElementById('confirm-extra'),
  modelSelect: document.getElementById('model-select'),
  objectives: document.getElementById('objectives'),
  banner: document.getElementById('banner'),
  evalModal: document.getElementById('eval-modal'),
  evalBody: document.getElementById('eval-body'),
  evalClose: document.getElementById('eval-close'),
  btnEvalOk: document.getElementById('btn-eval-ok'),
  btnReopen: document.getElementById('btn-reopen'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmClose: document.getElementById('confirm-close'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmOk: document.getElementById('confirm-ok'),
  confirmOkLabel: document.getElementById('confirm-ok-label'),
  confirmKicker: document.getElementById('confirm-kicker'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  shortcutsModal: document.getElementById('shortcuts-modal'),
  shortcutsClose: document.getElementById('shortcuts-close'),
  shortcutsOk: document.getElementById('shortcuts-ok'),
  progress: document.getElementById('progress'),
  progressBar: document.getElementById('progress-bar'),
  progressCount: document.getElementById('progress-count'),
  draftSaved: document.getElementById('draft-saved'),
};

const state = {
  session: null,
  scenario: null,
  objectives: [],
  messages: [],
  models: [],
  busy: false,
  streaming: false,
  evaluation: null,
  personalBest: null,
  pastEvaluations: [],
  audioEnabled: localStorage.getItem('roleplay.audio') === '1',
  pickerDifficulty: 'normal',
  lastSpokenMsgId: null,
};

// ----- api -----------------------------------------------------------------

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

// ----- helpers -------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Tiny, safe-by-default markdown renderer.
 * Escapes first, then transforms a restricted set of inline marks + line breaks.
 * Supports: **bold**, *italic*, _italic_, `code`, newlines.
 */
function renderMarkdown(raw) {
  const esc = escapeHtml(raw);
  return esc
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}

function labelFor(role) {
  if (role === 'user') return 'Tú';
  if (role === 'assistant') return state.scenario?.character?.name || 'Agente';
  return role;
}

function showBanner(msg, level = 'error') {
  els.banner.textContent = msg;
  els.banner.classList.remove('hidden');
  els.banner.dataset.level = level;
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => els.banner.classList.add('hidden'), 3200);
}

// ----- renderers -----------------------------------------------------------

function renderMessages() {
  els.messages.innerHTML = '';

  // Character profile card: shown until the student sends their first message.
  const hasUserMsg = state.messages.some((m) => m.role === 'user');
  if (!hasUserMsg && state.scenario?.character) {
    els.messages.appendChild(buildCharacterCard());
  }

  for (const m of state.messages) {
    els.messages.appendChild(buildMessageEl(m));
  }
  els.messages.scrollTop = els.messages.scrollHeight;
  updateControlAvailability();
}

function buildCharacterCard() {
  const c = state.scenario.character;
  const card = document.createElement('div');
  card.className = 'character-card';
  card.innerHTML = `
    <span class="kicker">Dramatis personae</span>
    <h3>${escapeHtml(c.name || 'Agente')}</h3>
    ${c.role ? `<p class="character-role">${escapeHtml(c.role)}</p>` : ''}
    ${c.personality ? `<p class="character-personality">${escapeHtml(c.personality)}</p>` : ''}
    <div class="character-divider">
      <span>Inicio del guion</span>
    </div>
  `;
  return card;
}

function buildMessageEl(m) {
  const div = document.createElement('div');
  div.className = `msg ${m.role}`;
  if (m.id) div.dataset.msgId = m.id;
  if (m.streaming) div.classList.add('streaming');

  const role = document.createElement('span');
  role.className = 'role';
  role.textContent = labelFor(m.role);
  div.appendChild(role);

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = renderMarkdown(m.content || '');
  div.appendChild(body);

  // Assistant: play button (only if not streaming)
  if (m.role === 'assistant' && !m.streaming && m.content) {
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'msg-speak';
    playBtn.title = 'Escuchar';
    playBtn.setAttribute('aria-label', 'Escuchar esta réplica');
    playBtn.innerHTML = '<span aria-hidden="true">▶</span>';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speak(m.content, m.id);
    });
    div.appendChild(playBtn);
  }

  // User: micro-feedback pill rendered below the bubble.
  if (m.role === 'user' && m.feedback && m.feedback.text) {
    const fb = document.createElement('div');
    fb.className = `turn-feedback ${m.feedback.level || 'neutral'}`;
    const icon = m.feedback.level === 'good' ? '✓' : m.feedback.level === 'warn' ? '!' : '·';
    fb.innerHTML = `<span class="tf-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(m.feedback.text)}</span>`;
    div.appendChild(fb);
  }

  return div;
}

function showTyping(on) {
  let tip = document.getElementById('typing');
  if (on) {
    if (tip) return;
    tip = document.createElement('div');
    tip.id = 'typing';
    tip.className = 'msg typing';
    tip.textContent = `${labelFor('assistant')} redactando`;
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
    badge.textContent =
      current.status === 'done' ? '✓' : current.status === 'in_progress' ? '·' : '';
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
  renderProgress();
}

function renderProgress() {
  const defs = state.scenario?.learning_objectives || [];
  const total = defs.length;
  if (!total) {
    els.progress.classList.add('hidden');
    return;
  }
  const done = state.objectives.filter((o) => o.status === 'done').length;
  const pct = Math.round((done / total) * 100);
  els.progress.classList.remove('hidden');
  els.progressBar.style.setProperty('--progress', `${pct}%`);
  els.progressBar.dataset.full = pct === 100 ? '1' : '';
  els.progressCount.innerHTML = `<em>${done}</em> / ${total}`;
}

function updateControlAvailability() {
  const sessionClosed = state.session?.status === 'completed';
  const hasUserMsg = state.messages.some((m) => m.role === 'user');
  const busy = state.busy || state.streaming;
  els.input.disabled = busy || sessionClosed;
  els.btnSend.disabled = busy || sessionClosed;
  els.btnRegenerate.disabled = busy || sessionClosed || !hasUserMsg;
  els.btnEvaluate.disabled = busy || !hasUserMsg;
  // Reset is available as soon as we have a loaded session, even if empty —
  // it's useful after an evaluation (closed session) too.
  els.btnReset.disabled = busy || !state.session;
  els.btnHint.disabled = busy || sessionClosed || !state.session || state.messages.length === 0;
  els.btnEvaluate.innerHTML = sessionClosed
    ? '<span>Ver evaluación</span>'
    : '<span>Finalizar y evaluar</span><span class="btn-arrow" aria-hidden="true">→</span>';
  els.modelSelect.disabled = busy || sessionClosed || !state.session || state.models.length === 0;
  if (els.btnMic && !rec.active) {
    els.btnMic.disabled = busy || sessionClosed || rec.transcribing || !state.session;
  }
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
  const available =
    allowed && allowed.length
      ? state.models.filter((m) => allowed.includes(m.id))
      : state.models;

  const current =
    state.session?.model ||
    state.scenario?.default_model ||
    (available[0] && available[0].id) ||
    '';

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
  els.modelSelect.disabled =
    state.busy || state.streaming || state.session?.status === 'completed';
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
    const label = ev.target.options[ev.target.selectedIndex]?.textContent || newModel;
    showBanner(`Modelo cambiado a ${label}`, 'info');
  } catch (e) {
    showBanner(`No se pudo cambiar el modelo: ${e.message}`);
    state.session.model = prev;
    els.modelSelect.value = prev || '';
  }
}

// ----- picker --------------------------------------------------------------

async function showPicker() {
  els.app.classList.add('hidden');
  els.picker.classList.remove('hidden');

  const savedId = localStorage.getItem('roleplay.student_id') || 'demo';
  els.pickerStudentId.value = savedId;

  for (const pill of document.querySelectorAll('#picker-difficulty .difficulty-pill')) {
    pill.addEventListener('click', () => {
      state.pickerDifficulty = pill.dataset.level;
      for (const p of document.querySelectorAll('#picker-difficulty .difficulty-pill')) {
        p.classList.toggle('is-active', p === pill);
      }
    });
  }

  els.pickerList.innerHTML = '<li class="muted">Cargando escenarios…</li>';
  try {
    const data = await api('/scenarios');
    els.pickerList.innerHTML = '';
    if (!data.scenarios || data.scenarios.length === 0) {
      els.pickerList.innerHTML = '<li class="muted">No hay escenarios disponibles.</li>';
      return;
    }
    for (const sc of data.scenarios) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-item';
      const name = document.createElement('div');
      name.className = 'picker-item-name';
      name.textContent = sc.name;
      btn.appendChild(name);
      if (sc.description) {
        const desc = document.createElement('div');
        desc.className = 'picker-item-desc';
        desc.textContent = sc.description;
        btn.appendChild(desc);
      }
      btn.addEventListener('click', () => {
        const studentId = (els.pickerStudentId.value || 'demo').trim() || 'demo';
        localStorage.setItem('roleplay.student_id', studentId);
        const params = new URLSearchParams({
          student_id: studentId,
          scenario_id: sc.id,
          difficulty: state.pickerDifficulty,
        });
        const apiParam = qs.get('api');
        if (apiParam) params.set('api', apiParam);
        location.search = '?' + params.toString();
      });
      li.appendChild(btn);
      els.pickerList.appendChild(li);
    }
  } catch (e) {
    els.pickerList.innerHTML = `<li class="muted">Error al cargar escenarios: ${escapeHtml(e.message)}</li>`;
  }
}

// ----- session lifecycle ---------------------------------------------------

async function loadSession() {
  try {
    const body = { student_id: STUDENT_ID, scenario_id: SCENARIO_ID };
    if (URL_DIFFICULTY && ['easy', 'normal', 'hard'].includes(URL_DIFFICULTY)) {
      body.difficulty = URL_DIFFICULTY;
    }
    const data = await api('/sessions', { method: 'POST', body: JSON.stringify(body) });
    applySessionView(data);
    renderScenario();
    renderMessages();
    renderObjectives();
    renderModelSelector();
    renderHeaderChips();
    renderVariantBanner();
    renderNotes();
    updateControlAvailability();
    restoreDraft();
    // If this is a brand-new session and no difficulty was passed in the URL,
    // prompt the student once so they engage with it consciously.
    if (data.session?.is_new && !URL_DIFFICULTY) openDifficultyModal();
  } catch (e) {
    showBanner(`Error al iniciar la sesión: ${e.message}`);
  }
}

function applySessionView(data) {
  state.session = data.session;
  state.scenario = data.scenario;
  state.messages = data.messages;
  state.objectives = data.objectives;
  state.evaluation = data.evaluation || null;
  state.personalBest = data.personal_best ?? null;
  state.pastEvaluations = data.past_evaluations || [];
}

function renderHeaderChips() {
  const s = state.session;
  if (!s) {
    els.attemptChip.classList.add('hidden');
    els.bestChip.classList.add('hidden');
    return;
  }
  const attempt = s.attempt || 1;
  if (attempt > 1) {
    els.attemptChip.classList.remove('hidden');
    els.attemptNum.textContent = String(attempt);
  } else {
    els.attemptChip.classList.add('hidden');
  }
  if (typeof state.personalBest === 'number') {
    els.bestChip.classList.remove('hidden');
    els.bestScore.textContent = String(state.personalBest);
  } else {
    els.bestChip.classList.add('hidden');
  }
  const d = s.difficulty || 'normal';
  els.difficultyChip.textContent =
    d === 'easy' ? 'Fácil' : d === 'hard' ? 'Difícil' : 'Normal';
  els.difficultyChip.dataset.level = d;
}

function renderVariantBanner() {
  const v = state.session?.variant;
  if (v) {
    els.variantBanner.textContent = `Variante de este intento · ${v}`;
    els.variantBanner.classList.remove('hidden');
  } else {
    els.variantBanner.classList.add('hidden');
    els.variantBanner.textContent = '';
  }
}

function renderNotes() {
  const n = state.session?.notes || '';
  if (els.notes.value !== n) els.notes.value = n;
}

// ----- streaming -----------------------------------------------------------

/**
 * Async iterator over SSE events from a streamed response body.
 * Yields { event, data } objects. Parses the minimal subset we need:
 * `event:` and `data:` lines separated by a blank line.
 */
async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!raw.trim() || raw.startsWith(':')) continue;
      const lines = raw.split('\n');
      let event = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trimStart();
      }
      yield { event, data };
    }
  }
}

async function streamAssistantReply(path, body) {
  state.streaming = true;
  updateControlAvailability();

  // Placeholder assistant bubble (no id yet — the server will return canonical list).
  const placeholder = {
    role: 'assistant',
    content: '',
    id: `__stream__${Date.now()}`,
    streaming: true,
  };
  state.messages = [...state.messages, placeholder];
  renderMessages();

  const bubble = els.messages.querySelector(`[data-msg-id="${placeholder.id}"] .msg-body`);

  let resp;
  try {
    resp = await fetch(`${API_BASE}/api${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Network error before the stream even opened.
    state.messages = state.messages.filter((m) => m !== placeholder);
    state.streaming = false;
    renderMessages();
    throw e;
  }

  if (!resp.ok || !resp.body) {
    const data = await resp.json().catch(() => ({}));
    state.messages = state.messages.filter((m) => m !== placeholder);
    state.streaming = false;
    renderMessages();
    throw new Error(data.error || `HTTP ${resp.status}`);
  }

  let accumulated = '';
  let serverError = null;
  let finalPayload = null;

  try {
    for await (const { event, data } of sseEvents(resp)) {
      if (!data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }

      if (event === 'delta' && typeof payload.text === 'string') {
        accumulated += payload.text;
        placeholder.content = accumulated;
        if (bubble) {
          bubble.innerHTML = renderMarkdown(accumulated);
          els.messages.scrollTop = els.messages.scrollHeight;
        }
      } else if (event === 'done') {
        finalPayload = payload;
      } else if (event === 'error') {
        serverError = payload.error || 'Error del servidor';
      }
    }
  } catch (e) {
    serverError = e.message;
  }

  state.streaming = false;

  if (serverError) {
    state.messages = state.messages.filter((m) => m !== placeholder);
    renderMessages();
    throw new Error(serverError);
  }

  if (finalPayload) {
    state.messages = finalPayload.messages;
    state.objectives = finalPayload.objectives;
  } else {
    // Server closed without a `done` frame — keep what we streamed so the
    // student doesn't lose the reply visually.
    placeholder.streaming = false;
    placeholder.content = accumulated.trim();
  }

  renderMessages();
  renderObjectives();
  maybeAutoSpeak(state.messages);
}

// ----- send / regenerate ---------------------------------------------------

async function sendMessage(text) {
  if (!state.session || state.busy || state.streaming) return;
  state.busy = true;

  state.messages = [...state.messages, { role: 'user', content: text, id: `__local__${Date.now()}` }];
  renderMessages();

  try {
    await streamAssistantReply(`/sessions/${state.session.id}/messages/stream`, { content: text });
    clearDraft();
  } catch (e) {
    showBanner(`Error: ${e.message}`);
    // Roll back the optimistic user bubble on failure.
    state.messages = state.messages.filter((m) => !String(m.id || '').startsWith('__local__'));
    renderMessages();
  } finally {
    state.busy = false;
    updateControlAvailability();
  }
}

async function regenerate() {
  if (!state.session || state.busy || state.streaming) return;
  state.busy = true;

  // Drop the last assistant bubble optimistically.
  const lastAssistantIdx = [...state.messages].reverse().findIndex((m) => m.role === 'assistant');
  if (lastAssistantIdx !== -1) {
    state.messages = state.messages.slice(0, state.messages.length - 1 - lastAssistantIdx);
    renderMessages();
  }

  try {
    await streamAssistantReply(`/sessions/${state.session.id}/regenerate/stream`, null);
  } catch (e) {
    showBanner(`Error: ${e.message}`);
  } finally {
    state.busy = false;
    updateControlAvailability();
  }
}

// ----- evaluation ----------------------------------------------------------

function renderEvaluation(evalData) {
  els.evalBody.innerHTML = '';
  const fb = evalData.feedback || {};
  const score = evalData.score ?? 0;

  const ring = document.createElement('div');
  ring.className = 'score-ring';
  const val = document.createElement('div');
  val.className = 'score';
  const num = document.createElement('span');
  num.textContent = String(score);
  const suffix = document.createElement('small');
  suffix.textContent = '/100';
  val.appendChild(num);
  val.appendChild(suffix);
  const label = document.createElement('div');
  label.className = 'score-label';
  label.textContent = fb.summary || '';
  ring.appendChild(val);
  ring.appendChild(label);
  els.evalBody.appendChild(ring);

  // Personal best comparison
  if (typeof state.personalBest === 'number') {
    const prevBest = state.pastEvaluations
      .filter((e) => e.attempt !== evalData.attempt)
      .reduce((m, e) => (e.score > m ? e.score : m), -1);
    const delta = prevBest >= 0 ? score - prevBest : null;
    const pbLine = document.createElement('p');
    pbLine.className = 'personal-best';
    if (prevBest < 0) {
      pbLine.innerHTML = `<span class="kicker">Primer intento</span> Has establecido tu marca: <em>${score}</em>.`;
    } else if (delta > 0) {
      pbLine.innerHTML = `<span class="kicker">Nuevo récord</span> Mejoras tu marca anterior de <em>${prevBest}</em> por <em>+${delta}</em> puntos.`;
    } else if (delta === 0) {
      pbLine.innerHTML = `<span class="kicker">Estable</span> Igualas tu mejor marca de <em>${prevBest}</em>.`;
    } else {
      pbLine.innerHTML = `<span class="kicker">Mejor marca previa</span> <em>${prevBest}</em>. Este intento: <em>${score}</em>.`;
    }
    els.evalBody.appendChild(pbLine);
  }

  // Narrative recap (cinematic)
  if (evalData.narrative) {
    const narr = document.createElement('div');
    narr.className = 'eval-narrative';
    narr.innerHTML = `<span class="kicker">Crónica</span><p>${escapeHtml(evalData.narrative)}</p>`;
    els.evalBody.appendChild(narr);
  }

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
      const status = o.status || 'pending';
      const liveObj = state.objectives.find((x) => x.objective_key === o.id);
      const evidence = liveObj?.evidence;

      const row = document.createElement('div');
      row.className = `eval-obj ${status}` + (evidence ? ' has-evidence' : '');
      const head = document.createElement('div');
      head.className = 'eval-obj-head';
      const badge = document.createElement('span');
      badge.className = 'objective-status';
      badge.textContent = status === 'done' ? '✓' : status === 'in_progress' ? '·' : '';
      head.appendChild(badge);
      const name = document.createElement('span');
      name.textContent = def.name;
      head.appendChild(name);
      if (evidence) {
        const pin = document.createElement('span');
        pin.className = 'eval-obj-pin';
        pin.textContent = '↗ ver evidencia';
        pin.title = 'Ir al momento en la conversación';
        head.appendChild(pin);
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => scrollChatToEvidence(evidence));
      }
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

  // Attempt history table
  if (state.pastEvaluations.length > 1) {
    const h = document.createElement('div');
    h.className = 'eval-section';
    h.innerHTML = '<h3>Historial de intentos</h3>';
    const ul = document.createElement('ul');
    ul.className = 'history-attempts';
    for (const e of state.pastEvaluations) {
      const li = document.createElement('li');
      const isCurrent = e.attempt === evalData.attempt;
      li.className = isCurrent ? 'is-current' : '';
      li.innerHTML = `<span class="kicker">Intento ${e.attempt}</span><em>${e.score}</em>`;
      ul.appendChild(li);
    }
    h.appendChild(ul);
    els.evalBody.appendChild(h);
  }
}

/**
 * Given a quoted evidence fragment, find the chat message whose content
 * contains (overlaps with) it and scroll to it, flashing a highlight.
 */
function scrollChatToEvidence(evidence) {
  closeEvalModal();
  const fragment = evidence.trim().slice(0, 40).toLowerCase();
  const msgs = state.messages.filter((m) => m.role === 'user');
  let target = null;
  for (const m of msgs) {
    if ((m.content || '').toLowerCase().includes(fragment)) target = m;
  }
  if (!target) return;
  const el = els.messages.querySelector(`[data-msg-id="${target.id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}

function openEvalModal() { els.evalModal.classList.remove('hidden'); }
function closeEvalModal() { els.evalModal.classList.add('hidden'); }

async function doEvaluate() {
  if (!state.session || state.busy) return;
  state.busy = true;
  updateControlAvailability();
  try {
    const data = await api(`/sessions/${state.session.id}/evaluate`, { method: 'POST' });
    state.evaluation = data.evaluation;
    state.personalBest = data.personal_best ?? state.personalBest;
    state.pastEvaluations = data.past_evaluations || state.pastEvaluations;
    state.session.status = 'completed';
    renderHeaderChips();
    renderEvaluation(data.evaluation);
    openEvalModal();
  } catch (e) {
    showBanner(`Error al evaluar: ${e.message}`);
  } finally {
    state.busy = false;
    updateControlAvailability();
  }
}

function askEvaluate() {
  if (!state.session || state.busy || state.streaming) return;
  // If already completed, just show the existing report without confirming.
  if (state.session.status === 'completed' && state.evaluation) {
    renderEvaluation(state.evaluation);
    openEvalModal();
    return;
  }
  openConfirm({
    kicker: 'Confirmación',
    titleHtml: '<em>¿Finalizar</em> la sesión?',
    message:
      'Se generará el informe final y la sesión quedará cerrada. Podrás reabrirla después si quieres seguir practicando.',
    okLabel: 'Sí, evaluar ahora',
    onConfirm: doEvaluate,
  });
}

function askReset() {
  if (!state.session || state.busy || state.streaming) return;
  openConfirm({
    kicker: 'Nuevo intento',
    titleHtml: '<em>¿Reiniciar</em> el progreso?',
    message:
      'Se borrarán los mensajes actuales, los objetivos y las notas, y arrancará un nuevo intento. El historial y tu mejor marca se conservan.',
    okLabel: 'Sí, reiniciar',
    danger: true,
    extraHtml: `
      <label class="confirm-check">
        <input type="checkbox" id="confirm-variant" />
        <span>Generar una <em>variante</em> distinta del escenario para que no se repita igual.</span>
      </label>
    `,
    onConfirm: () => {
      const withVariant = !!document.getElementById('confirm-variant')?.checked;
      doReset(withVariant);
    },
  });
}

async function doReset(withVariant = false) {
  if (!state.session || state.busy) return;
  state.busy = true;
  updateControlAvailability();
  try {
    const data = await api(`/sessions/${state.session.id}/reset`, {
      method: 'POST',
      body: JSON.stringify({ variant: withVariant }),
    });
    applySessionView(data);
    state.scenario = data.scenario;
    clearDraft();
    els.input.value = '';
    stopAudio();
    closeEvalModal();
    renderScenario();
    renderMessages();
    renderObjectives();
    renderModelSelector();
    renderHeaderChips();
    renderVariantBanner();
    renderNotes();
    showBanner(withVariant ? 'Nuevo intento con variante' : 'Progreso reiniciado', 'info');
  } catch (e) {
    showBanner(`No se pudo reiniciar: ${e.message}`);
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
    closeEvalModal();
    updateControlAvailability();
  } catch (e) {
    showBanner(`Error al reabrir: ${e.message}`);
  }
}

// ----- modals: confirm + shortcuts -----------------------------------------

let _confirmAction = null;

/**
 * Show the generic confirm modal. Renders HTML in title so you can use <em>
 * to highlight the key word in the question. Message is plain text.
 */
function openConfirm({ kicker = 'Confirmación', titleHtml, message, okLabel = 'Confirmar', danger = false, extraHtml = '', onConfirm }) {
  els.confirmKicker.textContent = kicker;
  els.confirmTitle.innerHTML = titleHtml || 'Confirmar';
  els.confirmMessage.textContent = message || '';
  els.confirmOkLabel.textContent = okLabel;
  els.confirmOk.classList.toggle('btn-danger', !!danger);
  if (extraHtml) {
    els.confirmExtra.innerHTML = extraHtml;
    els.confirmExtra.classList.remove('hidden');
  } else {
    els.confirmExtra.innerHTML = '';
    els.confirmExtra.classList.add('hidden');
  }
  _confirmAction = typeof onConfirm === 'function' ? onConfirm : null;
  els.confirmModal.classList.remove('hidden');
  els.confirmOk.focus();
}
function closeConfirmModal() {
  els.confirmModal.classList.add('hidden');
  _confirmAction = null;
}
function openShortcutsModal() { els.shortcutsModal.classList.remove('hidden'); els.shortcutsOk.focus(); }
function closeShortcutsModal() { els.shortcutsModal.classList.add('hidden'); }

function anyOpenModal() {
  return [
    els.evalModal,
    els.confirmModal,
    els.shortcutsModal,
    els.difficultyModal,
    els.historyModal,
    els.hintModal,
  ].find((m) => !m.classList.contains('hidden'));
}
function closeAnyOpenModal() {
  const m = anyOpenModal();
  if (m) m.classList.add('hidden');
}

// ----- draft persistence ---------------------------------------------------

function draftKey() {
  return state.session ? `roleplay.draft.${state.session.id}` : null;
}

function saveDraft() {
  const k = draftKey();
  if (!k) return;
  const value = els.input.value;
  if (value) {
    localStorage.setItem(k, value);
    flashDraftSaved();
  } else {
    localStorage.removeItem(k);
  }
}

function clearDraft() {
  const k = draftKey();
  if (k) localStorage.removeItem(k);
}

function restoreDraft() {
  const k = draftKey();
  if (!k) return;
  const saved = localStorage.getItem(k);
  if (saved) {
    els.input.value = saved;
    flashDraftSaved('Borrador restaurado');
  }
}

function flashDraftSaved(msg = 'Borrador guardado') {
  els.draftSaved.textContent = msg;
  els.draftSaved.dataset.visible = '1';
  clearTimeout(flashDraftSaved._t);
  flashDraftSaved._t = setTimeout(() => {
    els.draftSaved.dataset.visible = '';
  }, 1400);
}

// ----- TTS (agent voice) ---------------------------------------------------

let _audioEl = null;
let _audioObjUrl = null;

function stopAudio() {
  if (_audioEl) {
    _audioEl.pause();
    _audioEl.removeAttribute('src');
    _audioEl.load();
  }
  if (_audioObjUrl) {
    URL.revokeObjectURL(_audioObjUrl);
    _audioObjUrl = null;
  }
  document.body.classList.remove('audio-playing');
  state.lastSpokenMsgId = null;
}

async function speak(text, msgId) {
  if (!text) return;
  stopAudio();
  try {
    const resp = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    _audioObjUrl = URL.createObjectURL(blob);
    if (!_audioEl) {
      _audioEl = new Audio();
      _audioEl.addEventListener('ended', stopAudio);
      _audioEl.addEventListener('error', stopAudio);
    }
    _audioEl.src = _audioObjUrl;
    state.lastSpokenMsgId = msgId || null;
    document.body.classList.add('audio-playing');
    await _audioEl.play();
  } catch (e) {
    stopAudio();
    showBanner(`No se pudo reproducir audio: ${e.message}`);
  }
}

function toggleAudio() {
  state.audioEnabled = !state.audioEnabled;
  localStorage.setItem('roleplay.audio', state.audioEnabled ? '1' : '0');
  els.btnAudio.setAttribute('aria-pressed', state.audioEnabled ? 'true' : 'false');
  els.btnAudio.classList.toggle('is-on', state.audioEnabled);
  els.btnAudio.innerHTML = state.audioEnabled ? '<span aria-hidden="true">🔊</span>' : '<span aria-hidden="true">🔈</span>';
  els.btnAudio.title = state.audioEnabled ? 'Silenciar voz del agente' : 'Activar voz del agente';
  if (!state.audioEnabled) stopAudio();
  showBanner(state.audioEnabled ? 'Voz del agente activada' : 'Voz del agente silenciada', 'info');
}

function maybeAutoSpeak(messages) {
  if (!state.audioEnabled) return;
  // Speak only the most recent assistant message, and only if we haven't
  // spoken it already (avoids re-speaking on re-render).
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!last || !last.id) return;
  if (state.lastSpokenMsgId === last.id) return;
  speak(last.content, last.id);
}

// ----- difficulty ----------------------------------------------------------

function openDifficultyModal() {
  const current = state.session?.difficulty || 'normal';
  for (const btn of els.difficultyModal.querySelectorAll('.difficulty-option')) {
    btn.classList.toggle('is-active', btn.dataset.level === current);
  }
  els.difficultyModal.classList.remove('hidden');
}
function closeDifficultyModal() {
  els.difficultyModal.classList.add('hidden');
}

async function setDifficulty(level) {
  if (!state.session || !['easy', 'normal', 'hard'].includes(level)) return;
  if (level === state.session.difficulty) {
    closeDifficultyModal();
    return;
  }
  try {
    await api(`/sessions/${state.session.id}/difficulty`, {
      method: 'PATCH',
      body: JSON.stringify({ difficulty: level }),
    });
    state.session.difficulty = level;
    renderHeaderChips();
    showBanner(`Dificultad: ${level === 'easy' ? 'Fácil' : level === 'hard' ? 'Difícil' : 'Normal'}`, 'info');
  } catch (e) {
    showBanner(`No se pudo cambiar la dificultad: ${e.message}`);
  } finally {
    closeDifficultyModal();
  }
}

// ----- hint ----------------------------------------------------------------

async function requestHint() {
  if (!state.session || state.busy || state.streaming) return;
  state.busy = true;
  updateControlAvailability();
  els.hintText.textContent = 'Pensando…';
  els.hintModal.classList.remove('hidden');
  try {
    const data = await api(`/sessions/${state.session.id}/hint`, { method: 'POST' });
    els.hintText.textContent = data.hint || 'No se ha podido generar una pista.';
  } catch (e) {
    els.hintText.textContent = `Error: ${e.message}`;
  } finally {
    state.busy = false;
    updateControlAvailability();
  }
}

// ----- notes ---------------------------------------------------------------

let _notesTimer = null;
function onNotesInput() {
  clearTimeout(_notesTimer);
  _notesTimer = setTimeout(async () => {
    if (!state.session) return;
    try {
      await api(`/sessions/${state.session.id}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: els.notes.value }),
      });
      state.session.notes = els.notes.value;
      flashNotesSaved();
    } catch (e) {
      els.notesSaved.textContent = 'Error al guardar';
    }
  }, 600);
}
function flashNotesSaved() {
  els.notesSaved.textContent = 'Guardado';
  els.notesSaved.dataset.visible = '1';
  clearTimeout(flashNotesSaved._t);
  flashNotesSaved._t = setTimeout(() => {
    els.notesSaved.dataset.visible = '';
  }, 1200);
}

// ----- history (student dashboard) -----------------------------------------

async function openHistory() {
  if (!STUDENT_ID) {
    showBanner('No hay student_id en la URL.');
    return;
  }
  els.historyBody.innerHTML = '<p class="muted">Cargando historial…</p>';
  els.historyModal.classList.remove('hidden');
  try {
    const data = await api(`/sessions?student_id=${encodeURIComponent(STUDENT_ID)}`);
    renderHistory(data.sessions || []);
  } catch (e) {
    els.historyBody.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
}
function closeHistory() { els.historyModal.classList.add('hidden'); }

function renderHistory(sessions) {
  if (sessions.length === 0) {
    els.historyBody.innerHTML = '<p class="muted">Aún no hay sesiones registradas.</p>';
    return;
  }
  const rows = sessions
    .map((s) => {
      const date = s.updated_at ? new Date(s.updated_at.replace(' ', 'T') + 'Z').toLocaleString() : '';
      const best = s.best_score != null ? s.best_score : '—';
      const last = s.last_score != null ? s.last_score : '—';
      const diff = s.difficulty === 'easy' ? 'Fácil' : s.difficulty === 'hard' ? 'Difícil' : 'Normal';
      const active = s.scenario_id === SCENARIO_ID ? ' is-current' : '';
      return `
        <li class="history-row${active}">
          <div class="history-top">
            <span class="history-scenario">${escapeHtml(s.scenario_id)}</span>
            <span class="history-diff">${diff}</span>
          </div>
          <div class="history-bottom">
            <span class="history-stat"><span class="kicker">Mejor</span><em>${best}</em></span>
            <span class="history-stat"><span class="kicker">Último</span><em>${last}</em></span>
            <span class="history-stat"><span class="kicker">Intentos</span><em>${s.attempts_completed || 0}</em></span>
            <span class="history-date">${escapeHtml(date)}</span>
          </div>
        </li>
      `;
    })
    .join('');
  els.historyBody.innerHTML = `<ul class="history-list">${rows}</ul>`;
}

// ----- voice dictation (Whisper Large V3 via /api/transcribe) --------------

const rec = {
  active: false,
  recorder: null,
  stream: null,
  chunks: [],
  startedAt: 0,
  timerId: null,
  transcribing: false,
  maxSeconds: 60,
};

function micSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

function fmtSeconds(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setMicState(mode) {
  // mode: 'idle' | 'recording' | 'transcribing'
  els.btnMic.dataset.state = mode;
  els.btnMic.setAttribute('aria-pressed', mode === 'recording' ? 'true' : 'false');
  const label = els.btnMic.querySelector('.mic-label');
  const timer = els.btnMic.querySelector('.mic-timer');
  if (mode === 'recording') {
    label.textContent = 'Detener';
    timer.textContent = '0:00';
  } else if (mode === 'transcribing') {
    label.textContent = 'Transcribiendo…';
    timer.textContent = '';
  } else {
    label.textContent = 'Dictar';
    timer.textContent = '';
  }
  els.btnMic.disabled = state.busy || state.streaming || rec.transcribing || !state.session;
}

async function startRecording() {
  if (!micSupported()) {
    showBanner('Tu navegador no soporta grabación de audio.');
    return;
  }
  if (state.busy || state.streaming || rec.active || rec.transcribing) return;

  // Duck the agent's voice if it was playing — realistic call etiquette.
  stopAudio();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      showBanner('Permiso de micrófono denegado. Si estás en un iframe, necesita allow="microphone".');
    } else if (e.name === 'NotFoundError') {
      showBanner('No se encontró ningún micrófono.');
    } else {
      showBanner(`No se pudo acceder al micrófono: ${e.message}`);
    }
    return;
  }

  const mimeCandidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  rec.recorder = recorder;
  rec.stream = stream;
  rec.chunks = [];
  rec.startedAt = Date.now();
  rec.active = true;

  recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) rec.chunks.push(e.data);
  });
  recorder.addEventListener('stop', onRecorderStop);

  recorder.start();
  setMicState('recording');

  const tick = () => {
    const elapsed = Math.floor((Date.now() - rec.startedAt) / 1000);
    const timer = els.btnMic.querySelector('.mic-timer');
    if (timer) timer.textContent = fmtSeconds(elapsed);
    if (elapsed >= rec.maxSeconds) stopRecording();
  };
  rec.timerId = setInterval(tick, 250);
}

function stopRecording() {
  if (!rec.active || !rec.recorder) return;
  try {
    rec.recorder.stop();
  } catch {}
  rec.active = false;
  clearInterval(rec.timerId);
  rec.timerId = null;
  // Release the mic LED.
  if (rec.stream) {
    for (const track of rec.stream.getTracks()) track.stop();
    rec.stream = null;
  }
}

async function onRecorderStop() {
  const blob = new Blob(rec.chunks, { type: rec.recorder?.mimeType || 'audio/webm' });
  rec.chunks = [];
  rec.recorder = null;

  if (blob.size < 800) {
    // Less than ~0.5s of audio, likely an accidental tap.
    setMicState('idle');
    return;
  }

  rec.transcribing = true;
  setMicState('transcribing');

  try {
    const resp = await fetch(`${API_BASE}/api/transcribe`, {
      method: 'POST',
      headers: {
        'content-type': blob.type || 'audio/webm',
        'x-audio-filename': `clip.${(blob.type.split('/')[1] || 'webm').split(';')[0]}`,
        'x-audio-language': 'es',
      },
      body: blob,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    const text = (data.text || '').trim();
    if (text) {
      const current = els.input.value;
      const join = current && !/\s$/.test(current) ? ' ' : '';
      els.input.value = current + join + text;
      saveDraft();
      els.input.focus();
      // Put caret at the end.
      els.input.selectionStart = els.input.selectionEnd = els.input.value.length;
    } else {
      showBanner('No se detectó voz en el audio.', 'info');
    }
  } catch (e) {
    showBanner(`Transcripción fallida: ${e.message}`);
  } finally {
    rec.transcribing = false;
    setMicState('idle');
  }
}

function toggleRecording() {
  if (rec.active) {
    stopRecording();
  } else {
    startRecording();
  }
}

// ----- events --------------------------------------------------------------

els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = '';
  clearDraft();
  sendMessage(text);
});

els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

// Debounced draft save while typing.
let _draftTimer = null;
els.input.addEventListener('input', () => {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveDraft, 350);
});

els.btnRegenerate.addEventListener('click', regenerate);
els.btnEvaluate.addEventListener('click', askEvaluate);
els.btnHelp.addEventListener('click', openShortcutsModal);

els.evalClose.addEventListener('click', closeEvalModal);
els.btnEvalOk.addEventListener('click', closeEvalModal);
els.btnReopen.addEventListener('click', reopenSession);

els.confirmClose.addEventListener('click', closeConfirmModal);
els.confirmCancel.addEventListener('click', closeConfirmModal);
els.confirmOk.addEventListener('click', () => {
  const action = _confirmAction;
  closeConfirmModal();
  if (action) action();
});

els.btnReset.addEventListener('click', askReset);
els.btnMic.addEventListener('click', toggleRecording);
els.btnHint.addEventListener('click', requestHint);
els.btnAudio.addEventListener('click', toggleAudio);
els.btnHistory.addEventListener('click', openHistory);
els.difficultyChip.addEventListener('click', openDifficultyModal);
els.difficultyClose.addEventListener('click', closeDifficultyModal);
for (const btn of els.difficultyModal.querySelectorAll('.difficulty-option')) {
  btn.addEventListener('click', () => setDifficulty(btn.dataset.level));
}
els.historyClose.addEventListener('click', closeHistory);
els.historyOk.addEventListener('click', closeHistory);
els.hintClose.addEventListener('click', () => els.hintModal.classList.add('hidden'));
els.hintOk.addEventListener('click', () => els.hintModal.classList.add('hidden'));
els.notes.addEventListener('input', onNotesInput);

// Click anywhere to stop TTS playback (fast escape hatch).
document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('audio-playing')) return;
  if (e.target.closest('.msg-speak, #btn-audio, .modal, .composer-frame')) return;
  stopAudio();
});

els.shortcutsClose.addEventListener('click', closeShortcutsModal);
els.shortcutsOk.addEventListener('click', closeShortcutsModal);

els.modelSelect.addEventListener('change', onModelChange);

// Backdrop-click to close any modal.
for (const m of [
  els.evalModal,
  els.confirmModal,
  els.shortcutsModal,
  els.difficultyModal,
  els.historyModal,
  els.hintModal,
]) {
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  });
}

// Global keyboard shortcuts.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (anyOpenModal()) {
      e.preventDefault();
      closeAnyOpenModal();
    }
    return;
  }
  const inInput =
    e.target instanceof HTMLElement &&
    (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
  if (e.key === '?' && !inInput) {
    e.preventDefault();
    openShortcutsModal();
    return;
  }
  if (e.key.toLowerCase() === 'r' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    // Ctrl/Cmd+R triggers regeneration instead of browser reload.
    if (!els.btnRegenerate.disabled) {
      e.preventDefault();
      regenerate();
    }
  }
});

// ----- boot ----------------------------------------------------------------

if (!micSupported()) {
  els.btnMic.classList.add('hidden');
} else {
  setMicState('idle');
}

// Sync the audio toggle with the persisted preference.
if (state.audioEnabled) {
  els.btnAudio.setAttribute('aria-pressed', 'true');
  els.btnAudio.classList.add('is-on');
  els.btnAudio.innerHTML = '<span aria-hidden="true">🔊</span>';
  els.btnAudio.title = 'Silenciar voz del agente';
}

if (!STUDENT_ID || !SCENARIO_ID) {
  showPicker();
} else {
  Promise.all([loadModels(), loadSession()]).then(() => {
    renderModelSelector();
    updateControlAvailability();
  });
}
