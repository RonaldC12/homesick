// Shared state helpers used by the service worker and every extension page.
// Everything lives in chrome.storage.local; nothing leaves the device
// except the weather request to Open-Meteo.

export const DEFAULT_BLOCKED_SITES = [
  'youtube.com',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'facebook.com',
  'netflix.com',
  'twitch.tv',
  'pinterest.com',
];

export const DEFAULTS = {
  settings: {
    scene: 'seawall',
    timeOfDay: 'auto', // auto | day | dusk | night
    weatherFx: 'auto', // auto (live weather) | rain | clear
    motion: 'on', // on | reduced
    features: {
      clock: true,
      weather: true,
      timer: true,
      why: true,
      affirmation: true,
      todos: true,
      countdown: true,
      stats: true,
      journal: true,
    },
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    longBreakEvery: 4,
    autoStartBreak: true,
    blockMode: 'focus', // focus | always | off
    blockedSites: DEFAULT_BLOCKED_SITES,
    tripDate: '',
    tripTime: '', // 'HH:MM' in the user's local time, optional
    tripLabel: 'Flight home to YVR',
    style: 'smooth', // smooth | pixel
    name: '',
  },
  timer: {
    phase: 'idle', // idle | focus | break
    endsAt: null,
    remainingMs: null,
    paused: false,
    totalMs: 0,
    cycle: 0,
    breakKind: null, // short | long
  },
  stats: { days: {} }, // { 'YYYY-MM-DD': { minutes, sessions } }
  todos: [],
  why: '',
  journal: [],
  audio: {
    playing: false,
    master: 0.7,
    volumes: { rain: 0.6, waves: 0, forest: 0, city: 0, chimes: 0, pad: 0.25 },
  },
  weatherCache: null,
  customPlaces: [], // [{ id, name, dataUrl, created }]
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? structuredClone(base) : override;
  }
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(base[k]) && isPlainObject(v) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Read keys from storage, filling in defaults for anything missing. */
export async function getState(keys = Object.keys(DEFAULTS)) {
  const list = Array.isArray(keys) ? keys : [keys];
  const raw = await chrome.storage.local.get(list);
  const out = {};
  for (const k of list) out[k] = deepMerge(DEFAULTS[k], raw[k]);
  return out;
}

export async function setState(patch) {
  await chrome.storage.local.set(patch);
}

/** Update a single top-level key with a mutator function. */
export async function updateKey(key, mutate) {
  const { [key]: current } = await getState([key]);
  const next = mutate(current) ?? current;
  await chrome.storage.local.set({ [key]: next });
  return next;
}

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Consecutive days (ending today, or yesterday if today has nothing yet) with a completed session. */
export function computeStreak(stats, now = new Date()) {
  const days = stats?.days ?? {};
  const has = (d) => (days[dayKey(d)]?.sessions ?? 0) > 0;
  const cursor = new Date(now);
  if (!has(cursor)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (has(cursor)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Turn user input like "https://www.YouTube.com/watch?v=1" into "youtube.com".
 * Returns null if it isn't a usable hostname.
 */
export function normalizeSite(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/\.$/, '');
  const valid = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s);
  return valid ? s : null;
}

export function hostMatchesSite(hostname, site) {
  const h = hostname.toLowerCase();
  return h === site || h.endsWith(`.${site}`);
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function timerRemainingMs(timer, now = Date.now()) {
  if (timer.phase === 'idle') return 0;
  if (timer.paused) return timer.remainingMs ?? 0;
  return Math.max(0, (timer.endsAt ?? now) - now);
}

export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => undefined);
}
