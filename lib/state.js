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
      music: true,
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
    tripLabel: 'Return home',
    // Where "home" is: drives the clock, weather, and the scene's automatic time of day
    home: { name: 'Vancouver', lat: 49.25, lon: -123.05, tz: 'America/Vancouver' },
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
  music: {
    url: '', // the link the user pasted
    tall: false, // show the track list, not just the compact player
    collapsed: false,
    windowId: null, // set while the player is popped out into its own window
  },
};

export const OLD_TRIP_LABELS = ['Flight home to YVR'];

/** Current hour (0-24, fractional) in a time zone. */
export function hourIn(tz, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h + m / 60;
  } catch {
    return now.getHours() + now.getMinutes() / 60;
  }
}

/**
 * Parse what someone types into the big timer.
 * Accepts "25", "25:00", "1:30:00", "90m", "1h", "1h30", "1h 30m", "45s".
 * Returns milliseconds, or null if it can't be understood.
 */
export function parseDuration(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let sec = null;
  if (/^\d+(\.\d+)?$/.test(s)) sec = Number(s) * 60;
  else if (/^\d{1,3}:\d{1,2}$/.test(s)) {
    const [m, ss] = s.split(':').map(Number);
    if (ss < 60) sec = m * 60 + ss;
  } else if (/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(s)) {
    const [h, m, ss] = s.split(':').map(Number);
    if (m < 60 && ss < 60) sec = h * 3600 + m * 60 + ss;
  } else if (/^(\d+(\.\d+)?[hms]?)+$/.test(s)) {
    // Unit tokens like "1h30m", "10m30s", "1h30" (a trailing bare number after hours means minutes)
    const tokens = [...s.matchAll(/(\d+(?:\.\d+)?)([hms]?)/g)];
    const mult = { h: 3600, m: 60, s: 1 };
    let total = 0;
    let ok = true;
    tokens.forEach(([, num, unit], i) => {
      let u = unit;
      if (!u) u = i > 0 && tokens[i - 1][2] === 'h' ? 'm' : i > 0 && tokens[i - 1][2] === 'm' ? 's' : null;
      if (!u) ok = false;
      else total += Number(num) * mult[u];
    });
    if (ok) sec = total;
  }
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return null;
  return Math.round(sec) * 1000;
}

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
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
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
