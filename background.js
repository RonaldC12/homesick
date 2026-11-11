// Service worker: owns the focus timer, the site-blocking rules,
// the toolbar badge, and the offscreen document that plays ambient sound.
import {
  DEFAULTS,
  getState,
  setState,
  dayKey,
  hostMatchesSite,
  timerRemainingMs,
} from './lib/state.js';

const PHASE_ALARM = 'homesick-phase-end';
const BADGE_ALARM = 'homesick-badge';
const OFFSCREEN_URL = 'offscreen.html';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (existing[k] === undefined) missing[k] = v;
  }
  if (Object.keys(missing).length) await setState(missing);
  await resync();
});

chrome.runtime.onStartup.addListener(async () => {
  // Sound never auto-plays after a browser restart.
  const { audio } = await getState(['audio']);
  if (audio.playing) await setState({ audio: { ...audio, playing: false } });
  await resync();
});

/** Bring alarms, rules, and badge in line with stored state. */
async function resync() {
  const { timer } = await getState(['timer']);
  if (timer.phase !== 'idle' && !timer.paused && timer.endsAt && timer.endsAt <= Date.now()) {
    await finishPhase();
    return;
  }
  await scheduleAlarms(timer);
  await updateBlocking();
  await updateBadge();
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

async function scheduleAlarms(timer) {
  await chrome.alarms.clear(PHASE_ALARM);
  await chrome.alarms.clear(BADGE_ALARM);
  if (timer.phase !== 'idle' && !timer.paused && timer.endsAt) {
    await chrome.alarms.create(PHASE_ALARM, { when: timer.endsAt });
    await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 0.5 });
  }
}

async function startPhase(phase, breakKind = null) {
  const { settings, timer } = await getState(['settings', 'timer']);
  const minutes =
    phase === 'focus'
      ? settings.focusMin
      : breakKind === 'long'
        ? settings.longBreakMin
        : settings.shortBreakMin;
  const totalMs = Math.max(1, Number(minutes) || 1) * 60_000;
  const next = {
    ...timer,
    phase,
    breakKind: phase === 'break' ? breakKind ?? 'short' : null,
    endsAt: Date.now() + totalMs,
    remainingMs: null,
    paused: false,
    totalMs,
  };
  await setState({ timer: next });
  await scheduleAlarms(next);
  await updateBlocking();
  await updateBadge();
  return next;
}

async function pauseTimer() {
  const { timer } = await getState(['timer']);
  if (timer.phase === 'idle' || timer.paused) return timer;
  const next = { ...timer, paused: true, remainingMs: timerRemainingMs(timer), endsAt: null };
  await setState({ timer: next });
  await scheduleAlarms(next);
  await updateBadge();
  return next;
}

async function resumeTimer() {
  const { timer } = await getState(['timer']);
  if (timer.phase === 'idle' || !timer.paused) return timer;
  const next = { ...timer, paused: false, endsAt: Date.now() + (timer.remainingMs ?? 0), remainingMs: null };
  await setState({ timer: next });
  await scheduleAlarms(next);
  await updateBadge();
  return next;
}

/** Stop early. Focus time already spent still counts toward today's minutes. */
async function stopTimer() {
  const { timer } = await getState(['timer']);
  if (timer.phase === 'focus') {
    const elapsed = timer.totalMs - timerRemainingMs(timer);
    await recordFocus(elapsed, false);
  }
  const next = { ...DEFAULTS.timer, cycle: timer.cycle };
  await setState({ timer: next });
  await scheduleAlarms(next);
  await updateBlocking();
  await updateBadge();
  return next;
}

async function skipPhase() {
  const { timer } = await getState(['timer']);
  if (timer.phase === 'break') return startPhase('focus');
  if (timer.phase === 'focus') {
    await stopTimer();
    return startPhase('focus');
  }
  return timer;
}

async function recordFocus(ms, completed) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes <= 0 && !completed) return;
  const { stats } = await getState(['stats']);
  const key = dayKey();
  const day = stats.days[key] ?? { minutes: 0, sessions: 0 };
  day.minutes += minutes;
  if (completed) day.sessions += 1;
  stats.days[key] = day;
  await setState({ stats });
}

async function finishPhase() {
  const { timer, settings } = await getState(['timer', 'settings']);
  if (timer.phase === 'focus') {
    await recordFocus(timer.totalMs, true);
    const cycle = timer.cycle + 1;
    const breakKind = cycle % Math.max(1, settings.longBreakEvery) === 0 ? 'long' : 'short';
    await setState({ timer: { ...timer, cycle } });
    notify(
      'Session complete',
      breakKind === 'long'
        ? `That's ${cycle} in a row. Take a proper ${settings.longBreakMin}-minute break.`
        : `Nice work. Stretch, drink some water, look out a window.`,
    );
    if (settings.autoStartBreak) {
      await startPhase('break', breakKind);
      return;
    }
  } else if (timer.phase === 'break') {
    notify('Break is over', 'Ready to lock in again? Open a new tab to start.');
  }
  const { timer: latest } = await getState(['timer']);
  const next = { ...DEFAULTS.timer, cycle: latest.cycle };
  await setState({ timer: next });
  await scheduleAlarms(next);
  await updateBlocking();
  await updateBadge();
}

function notify(title, message) {
  chrome.notifications
    .create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 1,
    })
    .catch(() => {});
}

chrome.notifications.onClicked.addListener((id) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
  chrome.notifications.clear(id);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === PHASE_ALARM) {
    const { timer } = await getState(['timer']);
    if (timer.phase !== 'idle' && !timer.paused) await finishPhase();
  } else if (alarm.name === BADGE_ALARM) {
    await updateBadge();
  }
});

async function updateBadge() {
  const { timer } = await getState(['timer']);
  if (timer.phase === 'idle') {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const mins = Math.ceil(timerRemainingMs(timer) / 60_000);
  await chrome.action.setBadgeText({ text: timer.paused ? '||' : `${mins}m` });
  await chrome.action.setBadgeBackgroundColor({ color: timer.phase === 'focus' ? '#2f6f73' : '#7a8f5c' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

// ---------------------------------------------------------------------------
// Site blocking (declarativeNetRequest dynamic rules)
// ---------------------------------------------------------------------------

let blockingQueue = Promise.resolve();

function updateBlocking() {
  // Serialize: overlapping updateDynamicRules calls can collide on rule ids.
  blockingQueue = blockingQueue.then(applyBlocking, applyBlocking);
  return blockingQueue;
}

async function applyBlocking() {
  const { settings, timer } = await getState(['settings', 'timer']);
  const active =
    settings.blockMode === 'always' || (settings.blockMode === 'focus' && timer.phase === 'focus');
  const sites = active ? [...new Set(settings.blockedSites)] : [];

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = sites.map((site, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: `/blocked.html?site=${encodeURIComponent(site)}` },
    },
    condition: { requestDomains: [site], resourceTypes: ['main_frame'] },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules,
  });

  if (sites.length) await redirectOpenTabs(sites);
}

/** Rules only catch new navigations, so move tabs that are already on a blocked site. */
async function redirectOpenTabs(sites) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url || !/^https?:/.test(tab.url)) continue;
    let host;
    try {
      host = new URL(tab.url).hostname;
    } catch {
      continue;
    }
    const site = sites.find((s) => hostMatchesSite(host, s));
    if (site) {
      const url = chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(site)}`);
      chrome.tabs.update(tab.id, { url }).catch(() => {});
    }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    const a = changes.settings.oldValue ?? {};
    const b = changes.settings.newValue ?? {};
    if (a.blockMode !== b.blockMode || JSON.stringify(a.blockedSites) !== JSON.stringify(b.blockedSites)) {
      updateBlocking();
    }
  }
  if (changes.audio) syncAudio(changes.audio.newValue);
});

// ---------------------------------------------------------------------------
// Ambient audio via an offscreen document, so sound keeps playing across tabs
// ---------------------------------------------------------------------------

let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Plays the ambient rain, ocean, and city sounds you turn on.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function syncAudio(audio) {
  const state = audio ?? (await getState(['audio'])).audio;
  if (state.playing) {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'audio', audio: state }).catch(() => {});
  } else if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Messages from pages
// ---------------------------------------------------------------------------

const handlers = {
  'timer:start': (msg) => startPhase(msg.phase ?? 'focus', msg.breakKind),
  'timer:pause': pauseTimer,
  'timer:resume': resumeTimer,
  'timer:stop': stopTimer,
  'timer:skip': skipPhase,
  'offscreen:ready': async () => (await getState(['audio'])).audio,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler(msg))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true;
});
