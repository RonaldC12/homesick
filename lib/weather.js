// Live weather for Vancouver/Burnaby from Open-Meteo (free, no API key).
import { getState, setState } from './state.js';

const URL =
  'https://api.open-meteo.com/v1/forecast?latitude=49.25&longitude=-123.05' +
  '&current=temperature_2m,weather_code,is_day&timezone=America%2FVancouver';
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
export async function getWeather({ force = false } = {}) {
  const { weatherCache } = await getState(['weatherCache']);
  if (!force && weatherCache && Date.now() - weatherCache.fetchedAt < MAX_AGE_MS) return weatherCache;
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const code = data?.current?.weather_code;
    const [label, fx] = CODES[code] ?? ['', 'clear'];
    const result = {
      tempC: Math.round(data.current.temperature_2m),
      label,
      fx,
      fetchedAt: Date.now(),
    };
    await setState({ weatherCache: result });
    return result;
  } catch {
    return weatherCache ?? null;
  }
}
