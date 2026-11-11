import { getState, setState, updateKey, deepMerge, DEFAULTS, formatClock, timerRemainingMs, sendMessage } from './lib/state.js';
import { SCENES } from './lib/scenes.js';
import { mixFor } from './lib/audio.js';

const $ = (id) => document.getElementById(id);
let { timer, settings, audio, customPlaces } = await getState(['timer', 'settings', 'audio', 'customPlaces']);

const option = (value, label) => {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
};
for (const s of SCENES) $('place').append(option(s.id, `${s.name} · ${s.area}`));
for (const p of customPlaces) $('place').append(option(`custom:${p.id}`, `${p.name} · Your photo`));

$('place').addEventListener('change', async (e) => {
  const scene = e.target.value;
  await setState({ settings: { ...settings, scene } });
  await updateKey('audio', (a) => ({ ...a, volumes: mixFor(scene) }));
});
$('sound').addEventListener('click', () => updateKey('audio', (a) => ({ ...a, playing: !a.playing })));
$('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
  window.close();
});

function btn(label, cls, msg) {
  const b = document.createElement('button');
  b.className = `btn small ${cls}`;
  b.textContent = label;
  b.addEventListener('click', () => sendMessage(msg));
  return b;
}

function render() {
  $('place').value = settings.scene;
  $('sound').classList.toggle('on', audio.playing);
  const c = $('controls');
  c.replaceChildren();
  if (timer.phase === 'idle') {
    c.append(btn('Start focus', 'primary', { type: 'timer:start', phase: 'focus' }));
  } else {
    c.append(
      timer.paused
        ? btn('Resume', 'primary', { type: 'timer:resume' })
        : btn('Pause', '', { type: 'timer:pause' }),
    );
    if (timer.phase === 'break') c.append(btn('Skip break', '', { type: 'timer:skip' }));
    if (timer.phase === 'break') c.append(btn('Stop', 'ghost', { type: 'timer:stop' }));
  }
  const n = settings.blockedSites.length;
  $('note').textContent =
    settings.blockMode === 'off'
      ? 'Site blocking is off.'
      : settings.blockMode === 'always'
        ? `${n} sites always blocked.`
        : timer.phase === 'focus'
          ? `${n} sites blocked until the session ends.`
          : `${n} sites get blocked when you focus.`;
  tick();
}

function tick() {
  const remaining = timer.phase === 'idle' ? settings.focusMin * 60000 : timerRemainingMs(timer);
  $('time').textContent = formatClock(remaining);
  $('phase').textContent =
    timer.phase === 'focus' ? (timer.paused ? 'Paused' : 'Locked in') : timer.phase === 'break' ? 'Break' : 'Ready to lock in';
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.timer) timer = deepMerge(DEFAULTS.timer, changes.timer.newValue);
  if (changes.settings) settings = deepMerge(DEFAULTS.settings, changes.settings.newValue);
  if (changes.audio) audio = deepMerge(DEFAULTS.audio, changes.audio.newValue);
  render();
});

render();
setInterval(tick, 500);
