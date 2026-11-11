import {
  DEFAULTS,
  DEFAULT_BLOCKED_SITES,
  deepMerge,
  getState,
  setState,
  updateKey,
  dayKey,
  computeStreak,
  normalizeSite,
  formatClock,
  timerRemainingMs,
  sendMessage,
  uid,
} from './lib/state.js';
import { SCENES, SceneRenderer } from './lib/scenes.js';
import { mountScene, resolveSceneOptions } from './lib/sceneHost.js';
import { CHANNELS, SCENE_MIXES } from './lib/audio.js';
import { AFFIRMATIONS, JOURNAL_PROMPTS, dailyPick, pick } from './lib/content.js';
import { getWeather } from './lib/weather.js';

const $ = (id) => document.getElementById(id);

const FEATURE_LABELS = {
  clock: 'Vancouver clock',
  weather: 'Vancouver weather',
  timer: 'Focus timer',
  why: "\"Why I'm here\" note",
  affirmation: 'Daily encouragement',
  todos: "Today's goals",
  countdown: 'Countdown to home',
  stats: 'Focus stats and streak',
  journal: 'Journal',
};

let state = await getState();

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

await mountScene($('scene'));

function renderPlace() {
  const scene = SCENES.find((s) => s.id === state.settings.scene) ?? SCENES[0];
  $('placeName').textContent = scene.name;
  $('placeCredit').textContent = `${scene.name} · ${scene.area}`;
}

// ---------------------------------------------------------------------------
// Feature visibility
// ---------------------------------------------------------------------------

function renderFeatures() {
  const f = state.settings.features;
  document.querySelectorAll('[data-feature]').forEach((el) => {
    el.hidden = f[el.dataset.feature] === false;
  });
}

// ---------------------------------------------------------------------------
// Clock, weather, greeting
// ---------------------------------------------------------------------------

const homeFmt = new Intl.DateTimeFormat(undefined, {
  timeZone: 'America/Vancouver',
  hour: 'numeric',
  minute: '2-digit',
});
const hereFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const awayFromHome = localTz !== 'America/Vancouver' && localTz !== 'America/Los_Angeles';

function renderClock() {
  const now = new Date();
  $('homeTime').textContent = homeFmt.format(now);
  $('hereTime').hidden = !awayFromHome;
  if (awayFromHome) $('hereTime').textContent = `${hereFmt.format(now)} where you are`;
}

async function renderWeather() {
  const w = await getWeather();
  $('weather').textContent = w ? `${w.tempC}°C ${w.label.toLowerCase()}` : '';
}

function renderGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = state.settings.name?.trim();
  $('greeting').textContent = state.timer.phase === 'idle' ? `${part}${name ? `, ${name}` : ''}.` : '';
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderControls() {
  const { timer, settings } = state;
  const c = $('controls');
  c.replaceChildren();
  if (timer.phase === 'idle') {
    c.append(
      button('Start focus', 'primary', () => sendMessage({ type: 'timer:start', phase: 'focus' })),
      button('Take a break', '', () => sendMessage({ type: 'timer:start', phase: 'break', breakKind: 'short' })),
    );
  } else {
    if (timer.paused) c.append(button('Resume', 'primary', () => sendMessage({ type: 'timer:resume' })));
    else c.append(button('Pause', '', () => sendMessage({ type: 'timer:pause' })));
    if (timer.phase === 'break') c.append(button('Skip break', '', () => sendMessage({ type: 'timer:skip' })));
    c.append(
      button(timer.phase === 'focus' ? 'End early' : 'Stop', 'ghost', () => {
        if (timer.phase === 'focus') {
          const left = Math.ceil(timerRemainingMs(state.timer) / 60000);
          if (!confirm(`End this session early? You have ${left} minute${left === 1 ? '' : 's'} left.`)) return;
        }
        sendMessage({ type: 'timer:stop' });
      }),
    );
  }

  const n = settings.blockedSites.length;
  const note =
    settings.blockMode === 'off'
      ? 'Site blocking is off.'
      : settings.blockMode === 'always'
        ? `${n} distracting site${n === 1 ? ' is' : 's are'} always blocked.`
        : timer.phase === 'focus'
          ? `${n} distracting site${n === 1 ? ' is' : 's are'} blocked until this session ends.`
          : `${n} site${n === 1 ? '' : 's'} will be blocked while you focus.`;
  $('blockNote').textContent = note;
}

function renderTimerTick() {
  const { timer, settings } = state;
  const el = document.querySelector('.timer');
  const remaining = timer.phase === 'idle' ? settings.focusMin * 60000 : timerRemainingMs(timer);
  $('timeLeft').textContent = formatClock(remaining);
  el.classList.toggle('running', timer.phase !== 'idle' && !timer.paused);
  el.classList.toggle('paused', timer.paused);
  el.classList.toggle('break', timer.phase === 'break');
  const pct = timer.phase === 'idle' || !timer.totalMs ? 0 : (1 - remaining / timer.totalMs) * 100;
  $('progressBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const label =
    timer.phase === 'focus'
      ? timer.paused ? 'Paused' : 'Locked in'
      : timer.phase === 'break'
        ? timer.breakKind === 'long' ? 'Long break' : 'Break'
        : 'Ready to lock in';
  $('phaseLabel').textContent = label;
  document.title = timer.phase === 'idle' ? 'Homesick' : `${formatClock(remaining)} · ${label}`;
}

// ---------------------------------------------------------------------------
// Affirmation and "why"
// ---------------------------------------------------------------------------

$('affirmation').textContent = dailyPick(AFFIRMATIONS);

const whyEl = $('why');
function renderWhy() {
  if (document.activeElement !== whyEl) whyEl.value = state.why;
}
let whyTimer;
whyEl.addEventListener('input', () => {
  clearTimeout(whyTimer);
  whyTimer = setTimeout(() => setState({ why: whyEl.value }), 400);
});
whyEl.addEventListener('blur', () => setState({ why: whyEl.value }));

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

function renderTodos() {
  const list = $('todoList');
  list.replaceChildren();
  for (const t of state.todos) {
    const li = document.createElement('li');
    li.classList.toggle('done', t.done);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.setAttribute('aria-label', `Mark "${t.text}" done`);
    cb.addEventListener('change', () =>
      updateKey('todos', (todos) => todos.map((x) => (x.id === t.id ? { ...x, done: cb.checked } : x))),
    );
    const span = document.createElement('span');
    span.textContent = t.text;
    const del = document.createElement('button');
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete "${t.text}"`);
    del.addEventListener('click', () => updateKey('todos', (todos) => todos.filter((x) => x.id !== t.id)));
    li.append(cb, span, del);
    list.append(li);
  }
  $('clearDone').hidden = !state.todos.some((t) => t.done);
}

$('todoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('todoInput').value.trim();
  if (!text) return;
  $('todoInput').value = '';
  updateKey('todos', (todos) => [...todos, { id: uid(), text, done: false, created: Date.now() }]);
});

$('clearDone').addEventListener('click', () => updateKey('todos', (todos) => todos.filter((t) => !t.done)));

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function renderCountdown() {
  const { tripDate, tripLabel } = state.settings;
  $('tripLabel').textContent = tripLabel || 'Trip home';
  if (!tripDate) {
    $('tripDays').textContent = '—';
    $('tripSub').textContent = 'Set the date of your next trip home.';
    return;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = parseLocalDate(tripDate);
  const days = Math.round((target - today) / 86_400_000);
  const dateStr = target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (days > 1) {
    $('tripDays').textContent = `${days} days`;
    $('tripSub').textContent = `until ${dateStr}. You've got this.`;
  } else if (days === 1) {
    $('tripDays').textContent = 'Tomorrow';
    $('tripSub').textContent = `${dateStr}. Pack your rain jacket.`;
  } else if (days === 0) {
    $('tripDays').textContent = 'Today';
    $('tripSub').textContent = 'Safe travels home.';
  } else {
    $('tripDays').textContent = 'Welcome back';
    $('tripSub').textContent = 'Hope home was good. Set the next trip when you know it.';
  }
}

function toggleTripForm(show) {
  $('tripForm').hidden = !show;
  $('tripView').hidden = show;
  $('tripEdit').hidden = show;
  if (show) {
    $('tripLabelInput').value = state.settings.tripLabel;
    $('tripDateInput').value = state.settings.tripDate;
    $('tripDateInput').focus();
  }
}

$('tripEdit').addEventListener('click', () => toggleTripForm(true));
$('tripCancel').addEventListener('click', () => toggleTripForm(false));
$('tripForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({
    tripLabel: $('tripLabelInput').value.trim() || DEFAULTS.settings.tripLabel,
    tripDate: $('tripDateInput').value,
  });
  toggleTripForm(false);
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function renderStats() {
  const days = state.stats.days;
  const today = days[dayKey()] ?? { minutes: 0, sessions: 0 };
  const h = Math.floor(today.minutes / 60);
  const m = today.minutes % 60;
  $('statToday').textContent = h ? `${h}h ${m}m` : `${m}m`;
  $('statSessions').textContent = String(today.sessions);
  $('statStreak').textContent = String(computeStreak(state.stats));

  const bars = $('statBars');
  bars.replaceChildren();
  const series = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    series.push({ d, min: days[dayKey(d)]?.minutes ?? 0, today: i === 0 });
  }
  const max = Math.max(30, ...series.map((s) => s.min));
  for (const s of series) {
    const bar = document.createElement('div');
    bar.className = `bar${s.today ? ' today' : ''}`;
    bar.title = `${s.min} min`;
    const fill = document.createElement('i');
    fill.style.height = `${(s.min / max) * 40}px`;
    const label = document.createElement('small');
    label.textContent = s.d.toLocaleDateString(undefined, { weekday: 'narrow' });
    bar.append(fill, label);
    bars.append(bar);
  }
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

document.querySelectorAll('dialog').forEach((d) => {
  d.querySelector('[data-close]')?.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close(); // click on backdrop
  });
});

// ---- Place picker
let thumbs = [];
$('placeBtn').addEventListener('click', () => {
  const grid = $('placeGrid');
  if (!grid.childElementCount) {
    const opts = resolveSceneOptions(state.settings, state.weatherCache);
    for (const s of SCENES) {
      const btn = document.createElement('button');
      btn.className = 'place';
      btn.dataset.id = s.id;
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 150;
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = s.name;
      const area = document.createElement('em');
      area.textContent = s.area;
      const blurb = document.createElement('p');
      blurb.textContent = s.blurb;
      info.append(name, area, blurb);
      btn.append(canvas, info);
      btn.addEventListener('click', () => choosePlace(s.id));
      grid.append(btn);
      thumbs.push({ id: s.id, canvas });
    }
    $('placeDialog').showModal();
    // Draw after the dialog is laid out so canvases have a size
    requestAnimationFrame(() => {
      for (const t of thumbs) new SceneRenderer(t.canvas, { ...opts, scene: t.id, still: true });
    });
  } else {
    $('placeDialog').showModal();
  }
  grid.querySelectorAll('.place').forEach((b) => b.classList.toggle('selected', b.dataset.id === state.settings.scene));
});

async function choosePlace(id) {
  await saveSettings({ scene: id });
  await updateKey('audio', (a) => ({ ...a, volumes: { ...SCENE_MIXES[id] } }));
  $('placeDialog').close();
}

// ---- Sound
function renderSound() {
  const { audio } = state;
  $('soundBtn').classList.toggle('on', audio.playing);
  $('playToggle').textContent = audio.playing ? 'Pause' : 'Play';
  $('masterVol').value = audio.master;
  const list = $('channelList');
  if (!list.childElementCount) {
    for (const ch of CHANNELS) {
      const label = document.createElement('label');
      label.className = 'slider';
      const text = document.createElement('span');
      text.textContent = ch.label;
      const hint = document.createElement('small');
      hint.textContent = ch.hint;
      text.append(hint);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.dataset.channel = ch.id;
      input.addEventListener('input', () =>
        updateKey('audio', (a) => ({ ...a, volumes: { ...a.volumes, [ch.id]: Number(input.value) } })),
      );
      label.append(text, input);
      list.append(label);
    }
  }
  list.querySelectorAll('input').forEach((i) => {
    i.value = audio.volumes[i.dataset.channel] ?? 0;
  });
}

$('soundBtn').addEventListener('click', () => $('soundDialog').showModal());
$('playToggle').addEventListener('click', () => updateKey('audio', (a) => ({ ...a, playing: !a.playing })));
$('masterVol').addEventListener('input', (e) =>
  updateKey('audio', (a) => ({ ...a, master: Number(e.target.value) })),
);
$('sceneMix').addEventListener('click', () =>
  updateKey('audio', (a) => ({ ...a, volumes: { ...SCENE_MIXES[state.settings.scene] } })),
);

// ---- Journal
let currentPrompt = pick(JOURNAL_PROMPTS, Math.random() * 1000);
function renderJournal() {
  $('journalPrompt').textContent = currentPrompt;
  const list = $('journalEntries');
  list.replaceChildren();
  if (!state.journal.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Nothing yet.';
    list.append(li);
    return;
  }
  for (const entry of [...state.journal].reverse()) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const date = document.createElement('span');
    date.textContent = new Date(entry.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const del = document.createElement('button');
    del.className = 'link-btn';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      if (confirm('Delete this entry?')) updateKey('journal', (j) => j.filter((e) => e.id !== entry.id));
    });
    meta.append(date, del);
    const q = document.createElement('div');
    q.className = 'q';
    q.textContent = entry.prompt;
    const a = document.createElement('div');
    a.className = 'a';
    a.textContent = entry.text;
    li.append(meta, q, a);
    list.append(li);
  }
}

$('journalBtn').addEventListener('click', () => {
  renderJournal();
  $('journalDialog').showModal();
  $('journalText').focus();
});
$('newPrompt').addEventListener('click', () => {
  let next = currentPrompt;
  while (next === currentPrompt) next = pick(JOURNAL_PROMPTS, Math.random() * 1000);
  currentPrompt = next;
  $('journalPrompt').textContent = currentPrompt;
});
$('journalSave').addEventListener('click', async () => {
  const text = $('journalText').value.trim();
  if (!text) return;
  await updateKey('journal', (j) => [...j, { id: uid(), at: Date.now(), prompt: currentPrompt, text }]);
  $('journalText').value = '';
});

// ---- Settings
async function saveSettings(patch) {
  const next = { ...state.settings, ...patch };
  state.settings = next;
  await setState({ settings: next });
}

function renderSettings() {
  const s = state.settings;
  const toggles = $('featureToggles');
  if (!toggles.childElementCount) {
    for (const [key, label] of Object.entries(FEATURE_LABELS)) {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.key = key;
      cb.addEventListener('change', () =>
        saveSettings({ features: { ...state.settings.features, [key]: cb.checked } }),
      );
      l.append(cb, document.createTextNode(label));
      toggles.append(l);
    }
  }
  toggles.querySelectorAll('input').forEach((cb) => {
    cb.checked = s.features[cb.dataset.key] !== false;
  });

  document.querySelectorAll('input[name="blockMode"]').forEach((r) => (r.checked = r.value === s.blockMode));
  for (const id of ['focusMin', 'shortBreakMin', 'longBreakMin', 'longBreakEvery']) {
    if (document.activeElement !== $(id)) $(id).value = s[id];
  }
  $('autoStartBreak').checked = s.autoStartBreak;
  $('timeOfDay').value = s.timeOfDay;
  $('weatherFx').value = s.weatherFx;
  $('motion').value = s.motion;
  if (document.activeElement !== $('nameInput')) $('nameInput').value = s.name;

  const list = $('siteList');
  list.replaceChildren();
  for (const site of s.blockedSites) {
    const li = document.createElement('li');
    li.append(document.createTextNode(site));
    const x = document.createElement('button');
    x.textContent = '×';
    x.setAttribute('aria-label', `Unblock ${site}`);
    x.addEventListener('click', () =>
      saveSettings({ blockedSites: state.settings.blockedSites.filter((v) => v !== site) }),
    );
    li.append(x);
    list.append(li);
  }
}

$('settingsBtn').addEventListener('click', () => {
  renderSettings();
  $('settingsDialog').showModal();
});

document.querySelectorAll('input[name="blockMode"]').forEach((r) =>
  r.addEventListener('change', () => r.checked && saveSettings({ blockMode: r.value })),
);
for (const id of ['focusMin', 'shortBreakMin', 'longBreakMin', 'longBreakEvery']) {
  $(id).addEventListener('change', () => {
    const el = $(id);
    const v = Math.round(Number(el.value));
    const min = Number(el.min), max = Number(el.max);
    if (!Number.isFinite(v)) return;
    saveSettings({ [id]: Math.max(min, Math.min(max, v)) });
  });
}
$('autoStartBreak').addEventListener('change', (e) => saveSettings({ autoStartBreak: e.target.checked }));
for (const id of ['timeOfDay', 'weatherFx', 'motion']) {
  $(id).addEventListener('change', (e) => saveSettings({ [id]: e.target.value }));
}
$('nameInput').addEventListener('change', (e) => saveSettings({ name: e.target.value.trim() }));

$('siteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('siteError');
  const site = normalizeSite($('siteInput').value);
  if (!site) {
    err.textContent = "That doesn't look like a website. Try something like espn.com.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  $('siteInput').value = '';
  if (state.settings.blockedSites.includes(site)) return;
  saveSettings({ blockedSites: [...state.settings.blockedSites, site] });
});
$('resetSites').addEventListener('click', () => {
  const merged = [...new Set([...DEFAULT_BLOCKED_SITES, ...state.settings.blockedSites])];
  saveSettings({ blockedSites: merged });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function renderAll() {
  renderFeatures();
  renderPlace();
  renderClock();
  renderGreeting();
  renderControls();
  renderTimerTick();
  renderWhy();
  renderTodos();
  renderCountdown();
  renderStats();
  renderSound();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (k in DEFAULTS) state[k] = deepMerge(DEFAULTS[k], newValue);
  }
  if (changes.settings) {
    renderFeatures();
    renderPlace();
    renderControls();
    renderCountdown();
    renderGreeting();
    if ($('settingsDialog').open) renderSettings();
  }
  if (changes.timer) {
    renderControls();
    renderTimerTick();
    renderGreeting();
  }
  if (changes.why) renderWhy();
  if (changes.todos) renderTodos();
  if (changes.stats) renderStats();
  if (changes.audio) renderSound();
  if (changes.journal && $('journalDialog').open) renderJournal();
  if (changes.weatherCache) renderWeather();
});

renderAll();
renderWeather();
setInterval(renderTimerTick, 250);
setInterval(() => {
  renderClock();
  renderGreeting();
}, 15_000);
// Recompute midnight-dependent cards now and then
setInterval(() => {
  renderStats();
  renderCountdown();
}, 60_000);
