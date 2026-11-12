// Live weather for your home city from Open-Meteo (free, no API key).
import { getState, setState } from './state.js';

const MAX_AGE_MS = 20 * 60 * 1000;

const CODES = {
  0: ['Clear', 'clear'],
  1: ['Mostly clear', 'clear'],
  2: ['Partly cloudy', 'clear'],
  3: ['Overcast', 'clear'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'],
  53: ['Drizzle', 'rain'],
  55: ['Heavy drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'],
  57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'rain'],
  96: ['Thunderstorm', 'rain'],
  99: ['Thunderstorm', 'rain'],
};

/** Returns { tempC, label, fx, fetchedAt } or null if offline and nothing cached. */
function forecastUrl({ lat, lon }) {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code,is_day',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

const sameHome = (a, b) => a && b && a.lat === b.lat && a.lon === b.lon;

export async function getWeather({ force = false } = {}) {
  const { weatherCache, settings } = await getState(['weatherCache', 'settings']);
  const home = settings.home;
  const fresh = weatherCache && Date.now() - weatherCache.fetchedAt < MAX_AGE_MS && sameHome(weatherCache.home, home);
  if (!force && fresh) return weatherCache;
  try {
    const res = await fetch(forecastUrl(home));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const code = data?.current?.weather_code;
    const [label, fx] = CODES[code] ?? ['', 'clear'];
    const result = {
      tempC: Math.round(data.current.temperature_2m),
      label,
      fx,
      home: { lat: home.lat, lon: home.lon },
      fetchedAt: Date.now(),
    };
    await setState({ weatherCache: result });
    return result;
  } catch {
    // Don't show another city's weather after you change home
    return sameHome(weatherCache?.home, home) ? weatherCache : null;
  }
}

/** Look up cities by name. Returns [{ name, detail, lat, lon, tz }]. */
export async function searchCities(query) {
  const q = new URLSearchParams({ name: query.trim(), count: '6', language: 'en', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r) => r.timezone)
    .map((r) => ({
      name: r.name,
      detail: [r.admin1, r.country].filter(Boolean).join(', '),
      lat: Math.round(r.latitude * 100) / 100,
      lon: Math.round(r.longitude * 100) / 100,
      tz: r.timezone,
    }));
}
