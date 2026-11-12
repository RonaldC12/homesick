import {
  DEFAULTS,
  OLD_TRIP_LABELS,
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
  parseDuration,
  sendMessage,
  uid,
} from './lib/state.js';
import { SCENES, SceneRenderer } from './lib/scenes.js';
import { mountScene, resolveSceneOptions, loadPlaceImage, describeScene } from './lib/sceneHost.js';
import { AmbientEngine, CHANNELS, mixFor } from './lib/audio.js';
import { NUDGES, JOURNAL_PROMPTS, dailyPick, pick } from './lib/content.js';
import { getWeather, searchCities } from './lib/weather.js';
import { musicEmbed, musicFrame } from './lib/music.js';

const $ = (id) => document.getElementById(id);

const FEATURE_LABELS = {
  clock: 'Clock for home',
  weather: 'Weather at home',
  timer: 'Focus timer',
  why: "\"Why I'm here\" note",
  affirmation: 'Daily nudge',
  todos: "Today's goals",
  countdown: 'Countdown to home',
  stats: 'Focus stats and streak',
  journal: 'Journal',
  music: 'Music player',
};

let state = await getState();

// The trip card used to say "Flight home to YVR". Anyone who never renamed it gets "Return home".
if (OLD_TRIP_LABELS.includes(state.settings.tripLabel)) {
  state.settings = { ...state.settings, tripLabel: DEFAULTS.settings.tripLabel };
  await setState({ settings: state.settings });
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

await mountScene($('scene'));

function renderPlace() {
  const { name, area } = describeScene(state.settings.scene, state.customPlaces);
  $('placeName').textContent = name;
  $('placeCredit').textContent = `${name} · ${area}`;
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

const hereFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

function timeIn(tz, now) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(now);
  } catch {
    return hereFmt.format(now);
  }
}

function renderClock() {
  const now = new Date();
  const home = state.settings.home;
  $('homeTime').textContent = timeIn(home.tz, now);
  $('homeLabel').textContent = `Home in ${home.name}`;
  // Only show "where you are" when it's actually a different time there
  const away = timeIn(home.tz, now) !== hereFmt.format(now) && home.tz !== localTz;
  $('hereTime').hidden = !away;
  if (away) $('hereTime').textContent = `${hereFmt.format(now)} where you are`;
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
  $('timeLeft').title =
    timer.phase === 'idle' ? 'Click to set how long to focus' : 'Click to change the time left';
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

// ---- Click the big numbers to type a new time
function openTimeEditor() {
  const input = $('timeInput');
  input.value = $('timeLeft').textContent;
  $('timeLeft').hidden = true;
  input.hidden = false;
  $('timeHint').hidden = false;
  $('timeHint').classList.remove('error-text');
  input.focus();
  input.select();
}

function closeTimeEditor() {
  $('timeInput').hidden = true;
  $('timeHint').hidden = true;
  $('timeLeft').hidden = false;
}

async function commitTimeEditor() {
  const ms = parseDuration($('timeInput').value);
  if (ms === null) {
    $('timeHint').textContent = "Couldn't read that. Try 25, 45:00, or 1h30.";
    $('timeHint').classList.add('error-text');
    $('timeInput').select();
    return;
  }
  $('timeHint').textContent = 'Type minutes (45), mm:ss (12:30), or 1h30, then press Enter';
  closeTimeEditor();
  await sendMessage({ type: 'timer:set', ms });
}

$('timeLeft').addEventListener('click', openTimeEditor);
$('timeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitTimeEditor();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeTimeEditor();
  }
});
$('timeInput').addEventListener('blur', () => {
  if (!$('timeInput').hidden) closeTimeEditor();
});

// ---------------------------------------------------------------------------
// Affirmation and "why"
// ---------------------------------------------------------------------------

$('affirmation').textContent = dailyPick(NUDGES);

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

function parseLocalDate(s, time = '') {
  const [y, m, d] = s.split('-').map(Number);
  const [hh, mm] = time ? time.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

function renderCountdown() {
  const { tripDate, tripTime, tripLabel } = state.settings;
  $('tripLabel').textContent = tripLabel || 'Trip home';
  if (!tripDate) {
    $('tripDays').textContent = '—';
    $('tripSub').textContent = "Add the date you're going home.";
    return;
  }
  const now = new Date();
  const target = parseLocalDate(tripDate, tripTime);
  const dateStr = target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = tripTime ? target.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  const when = timeStr ? `${dateStr} at ${timeStr}` : dateStr;

  // Whole calendar days, for the far-off view
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const targetDay = new Date(target);
  targetDay.setHours(0, 0, 0, 0);
  const days = Math.round((targetDay - today) / 86_400_000);
  const msLeft = target - now;

  if (days >= 2) {
    $('tripDays').textContent = `${days} days`;
    $('tripSub').textContent = when;
  } else if (tripTime && msLeft > 0) {
    // Under two days with a known time: count down hours and minutes
    const totalMin = Math.ceil(msLeft / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    $('tripDays').textContent = [d ? `${d}d` : '', h || d ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
    $('tripSub').textContent = `${days === 0 ? 'Today' : 'Tomorrow'} at ${timeStr}`;
  } else if (!tripTime && days >= 0) {
    $('tripDays').textContent = days === 1 ? 'Tomorrow' : 'Today';
    $('tripSub').textContent = when;
  } else if (tripTime && msLeft > -12 * 3_600_000) {
    $('tripDays').textContent = 'Going home';
    $('tripSub').textContent = 'Safe travels.';
  } else {
    $('tripDays').textContent = 'Welcome back';
    $('tripSub').textContent = 'Add your next trip when you know it.';
  }
}

function toggleTripForm(show) {
  $('tripForm').hidden = !show;
  $('tripView').hidden = show;
  $('tripEdit').hidden = show;
  if (show) {
    $('tripLabelInput').value = state.settings.tripLabel;
    $('tripDateInput').value = state.settings.tripDate;
    $('tripTimeInput').value = state.settings.tripTime;
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
    tripTime: $('tripDateInput').value ? $('tripTimeInput').value : '',
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
const MAX_PHOTOS = 8;

function placeCard({ id, name, area, blurb, image }, opts, onRemove) {
  const card = document.createElement('div');
  card.className = 'place';
  card.dataset.id = id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Go to ${name}`);
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 150;
  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = name;
  const sub = document.createElement('em');
  sub.textContent = area;
  info.append(title, sub);
  if (blurb) {
    const p = document.createElement('p');
    p.textContent = blurb;
    info.append(p);
  }
  if (onRemove) {
    const rm = document.createElement('button');
    rm.className = 'link-btn remove';
    rm.textContent = 'Remove';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    info.append(rm);
  }
  card.append(canvas, info);
  card.addEventListener('click', () => choosePlace(id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choosePlace(id);
    }
  });
  card.classList.toggle('selected', id === state.settings.scene);
  // Draw after layout so the canvas has a size
  requestAnimationFrame(() => new SceneRenderer(canvas, { ...opts, scene: id, image, still: true }));
  return card;
}

async function renderPlaceDialog() {
  const opts = resolveSceneOptions(state.settings, state.weatherCache);
  document.querySelectorAll('.segmented [data-style]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.style === opts.style)),
  );
  document.querySelectorAll('.segmented [data-tod]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.tod === state.settings.timeOfDay)),
  );

  const grid = $('placeGrid');
  grid.replaceChildren(...SCENES.map((s) => placeCard({ ...s, image: null }, opts)));

  const custom = $('customGrid');
  const cards = [];
  for (const place of state.customPlaces) {
    const image = await loadPlaceImage(place).catch(() => null);
    if (!image) continue;
    cards.push(
      placeCard({ id: `custom:${place.id}`, name: place.name, area: 'Your photo', image }, opts, () =>
        removePhoto(place),
      ),
    );
  }
  if (state.customPlaces.length < MAX_PHOTOS) {
    const add = document.createElement('button');
    add.className = 'place add-photo';
    add.innerHTML =
      '<span class="plus" aria-hidden="true">+</span><strong>Add your own photo</strong>' +
      '<p>Any picture of home. It gets the same weather, time of day, and art style.</p>';
    add.addEventListener('click', () => $('photoInput').click());
    cards.push(add);
  }
  custom.replaceChildren(...cards);
}

$('placeBtn').addEventListener('click', () => {
  $('photoError').hidden = true;
  $('placeDialog').showModal();
  renderPlaceDialog();
});

document.querySelectorAll('.segmented [data-style]').forEach((b) =>
  b.addEventListener('click', () => saveSettings({ style: b.dataset.style })),
);

async function choosePlace(id) {
  await saveSettings({ scene: id });
  await updateKey('audio', (a) => ({ ...a, volumes: mixFor(id) }));
  $('placeDialog').close();
}

function photoError(msg) {
  $('photoError').textContent = msg;
  $('photoError').hidden = false;
}

/** Shrink the photo so it fits comfortably in storage, then save it as a place. */
async function addPhoto(file) {
  $('photoError').hidden = true;
  if (!file.type.startsWith('image/')) return photoError("That file isn't an image.");
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return photoError("Couldn't read that image. Try a JPG or PNG.");
  }
  const scale = Math.min(1, 1920 / bmp.width, 1200 / bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const dataUrl = c.toDataURL('image/jpeg', 0.86);

  const suggested = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Home';
  const name = (prompt('What should this place be called?', suggested) ?? '').trim().slice(0, 40);
  if (!name) return;
  const id = uid();
  await updateKey('customPlaces', (list) => [...list, { id, name, dataUrl, created: Date.now() }]);
  await choosePlace(`custom:${id}`);
}

$('photoInput').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) addPhoto(file);
});

async function removePhoto(place) {
  if (!confirm(`Remove "${place.name}"?`)) return;
  if (state.settings.scene === `custom:${place.id}`) await saveSettings({ scene: 'seawall' });
  await updateKey('customPlaces', (list) => list.filter((p) => p.id !== place.id));
}

// ---- Home location
function openHomeDialog() {
  const h = state.settings.home;
  $('homeCurrent').textContent = `${h.name} (${h.tz.replace(/_/g, ' ')})`;
  $('homeResults').replaceChildren();
  $('homeStatus').textContent = '';
  $('homeInput').value = '';
  $('homeDialog').showModal();
  $('homeInput').focus();
}

$('homeBtn').addEventListener('click', openHomeDialog);

$('homeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('homeInput').value.trim();
  if (q.length < 2) return;
  $('homeStatus').textContent = 'Searching…';
  $('homeResults').replaceChildren();
  let results;
  try {
    results = await searchCities(q);
  } catch {
    $('homeStatus').textContent = "Couldn't search right now. Check your connection and try again.";
    return;
  }
  $('homeStatus').textContent = results.length ? 'Pick one:' : 'No cities found. Try a different spelling.';
  $('homeResults').replaceChildren(
    ...results.map((r) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const name = document.createElement('strong');
      name.textContent = r.name;
      const detail = document.createElement('span');
      detail.textContent = `${r.detail ? `${r.detail} · ` : ''}${timeIn(r.tz, new Date())}`;
      b.append(name, detail);
      b.addEventListener('click', async () => {
        await saveSettings({ home: { name: r.name, lat: r.lat, lon: r.lon, tz: r.tz } });
        $('homeDialog').close();
      });
      li.append(b);
      return li;
    }),
  );
});

// ---- Music player
let musicSrcShown = null;

function musicAction(label, title, onClick) {
  const b = document.createElement('button');
  b.className = 'link-btn';
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

const setMusic = (patch) => updateKey('music', (m) => ({ ...m, ...patch }));

function musicSetupForm(prefill = '') {
  const form = document.createElement('form');
  form.className = 'music-form';
  form.autocomplete = 'off';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Paste a playlist link';
  input.setAttribute('aria-label', 'Music link');
  input.value = prefill;
  const err = document.createElement('p');
  err.className = 'error';
  err.hidden = true;
  const hint = document.createElement('p');
  hint.className = 'muted hint';
  hint.textContent = 'In the app, open a playlist and use Share, then Copy link. Spotify, SoundCloud, and Apple Music work.';
  const row = document.createElement('div');
  row.className = 'row';
  const save = document.createElement('button');
  save.className = 'btn small primary';
  save.type = 'submit';
  save.textContent = 'Add';
  row.append(input, save);
  form.append(row, err, hint);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const embed = musicEmbed(input.value);
    if (embed.error) {
      err.textContent = embed.error;
      err.hidden = false;
      return;
    }
    setMusic({ url: input.value.trim(), collapsed: false });
  });
  return form;
}

let editingMusic = false;

function renderMusic() {
  const { music } = state;
  const body = $('musicBody');
  const actions = $('musicActions');
  const embed = music.url ? musicEmbed(music.url, music.tall) : null;
  $('musicCard').classList.toggle('collapsed', music.collapsed);

  if (!embed || embed.error || editingMusic) {
    musicSrcShown = null;
    $('musicTitle').textContent = 'Music';
    actions.replaceChildren(
      ...(editingMusic ? [musicAction('Cancel', 'Keep the current link', () => ((editingMusic = false), renderMusic()))] : []),
    );
    body.replaceChildren(musicSetupForm(editingMusic ? music.url : ''));
    return;
  }

  $('musicTitle').textContent = embed.provider;
  const popped = music.windowId != null;
  actions.replaceChildren(
    ...(popped
      ? []
      : [
          musicAction(music.collapsed ? 'Show' : 'Hide', music.collapsed ? 'Show the player' : 'Shrink to this bar', () =>
            setMusic({ collapsed: !music.collapsed }),
          ),
          ...(music.collapsed
            ? []
            : [musicAction(music.tall ? 'Smaller' : 'Track list', music.tall ? 'Compact player' : 'Show the track list', () =>
                setMusic({ tall: !music.tall }),
              )]),
          musicAction('Pop out', 'Open in its own small window so it keeps playing in other tabs', () =>
            sendMessage({ type: 'music:popout' }),
          ),
        ]),
    musicAction('Change', 'Use a different link', () => {
      editingMusic = true;
      renderMusic();
    }),
  );

  if (popped) {
    musicSrcShown = null;
    const p = document.createElement('p');
    p.className = 'muted popped';
    p.textContent = 'Playing in its own window. ';
    p.append(
      musicAction('Show it', 'Bring the player window to the front', () => sendMessage({ type: 'music:popout' })),
      document.createTextNode(' · '),
      musicAction('Put it back here', 'Close the window and show the player here', () => sendMessage({ type: 'music:popin' })),
    );
    body.replaceChildren(p);
    return;
  }
  if (music.collapsed) {
    // Keep the iframe alive (so music keeps playing) but tuck it away
    body.querySelector('iframe')?.classList.add('tucked');
    if (!body.querySelector('iframe')) body.replaceChildren();
    return;
  }
  const existing = body.querySelector('iframe');
  if (existing && embed.src === musicSrcShown) {
    existing.classList.remove('tucked');
    existing.height = String(embed.height);
    return;
  }
  // The track-list toggle only changes height, so reuse the player when the base link is the same
  if (existing && embed.src.split('?')[0] === musicSrcShown?.split('?')[0]) {
    existing.classList.remove('tucked');
    existing.height = String(embed.height);
    musicSrcShown = embed.src;
    return;
  }
  musicSrcShown = embed.src;
  body.replaceChildren(musicFrame(embed));
}

// ---- Quick time-of-day switch in the place picker
document.querySelectorAll('.segmented [data-tod]').forEach((b) =>
  b.addEventListener('click', () => saveSettings({ timeOfDay: b.dataset.tod })),
);

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

// Sound normally plays from a hidden offscreen document so it survives tab switches.
// If Chrome doesn't let that document start audio, this tab plays it instead.
let localEngine = null;

async function checkAudio() {
  if (!state.audio.playing || localEngine) return;
  const res = await sendMessage({ type: 'audio:status' });
  if (res?.result?.state === 'running') {
    $('soundStatus').textContent = 'Playing. Sound keeps going when you switch tabs.';
    return;
  }
  localEngine = new AmbientEngine();
  localEngine.apply(state.audio);
  $('soundStatus').textContent = 'Playing from this tab. Keep this tab open for sound.';
}

function syncLocalAudio() {
  if (!localEngine) return;
  if (state.audio.playing) localEngine.apply(state.audio);
  else {
    localEngine.stop();
    localEngine = null;
  }
}

$('soundBtn').addEventListener('click', () => {
  $('soundDialog').showModal();
  checkAudio();
});
$('playToggle').addEventListener('click', async () => {
  const next = await updateKey('audio', (a) => ({ ...a, playing: !a.playing }));
  if (next.playing) {
    $('soundStatus').textContent = 'Starting…';
    setTimeout(checkAudio, 1200);
  } else {
    $('soundStatus').textContent = '';
  }
});
$('masterVol').addEventListener('input', (e) =>
  updateKey('audio', (a) => ({ ...a, master: Number(e.target.value) })),
);
$('sceneMix').addEventListener('click', () =>
  updateKey('audio', (a) => ({ ...a, volumes: mixFor(state.settings.scene) })),
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
    if (document.activeElement !== $(id)) $(id).value = Number(s[id].toFixed(2));
  }
  $('autoStartBreak').checked = s.autoStartBreak;
  $('timeOfDay').value = s.timeOfDay;
  $('weatherFx').value = s.weatherFx;
  $('motion').value = s.motion;
  $('style').value = s.style;
  if (document.activeElement !== $('nameInput')) $('nameInput').value = s.name;
  $('homeSetting').textContent = s.home.name;

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

$('homeChange').addEventListener('click', () => {
  $('settingsDialog').close();
  openHomeDialog();
});

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
    // Focus length can include seconds when typed into the big timer, so keep decimals there
    const v = id === 'focusMin' ? Math.round(Number(el.value) * 60) / 60 : Math.round(Number(el.value));
    const min = Number(el.min), max = Number(el.max);
    if (!Number.isFinite(v)) return;
    saveSettings({ [id]: Math.max(min, Math.min(max, v)) });
  });
}
$('autoStartBreak').addEventListener('change', (e) => saveSettings({ autoStartBreak: e.target.checked }));
for (const id of ['timeOfDay', 'weatherFx', 'motion', 'style']) {
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
  renderMusic();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (k in DEFAULTS) state[k] = deepMerge(DEFAULTS[k], newValue);
  }
  if (changes.settings) {
    const homeChanged = changes.settings.oldValue?.home?.tz !== changes.settings.newValue?.home?.tz ||
      changes.settings.oldValue?.home?.name !== changes.settings.newValue?.home?.name;
    if (homeChanged) {
      renderClock();
      renderWeather();
    }
    renderTimerTick();
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
  if (changes.audio) {
    renderSound();
    syncLocalAudio();
  }
  if (changes.journal && $('journalDialog').open) renderJournal();
  if (changes.customPlaces) renderPlace();
  if (changes.music) {
    editingMusic = false;
    renderMusic();
  }
  if ((changes.customPlaces || changes.settings) && $('placeDialog').open) renderPlaceDialog();
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
