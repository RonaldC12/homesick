// Mounts the animated wallpaper on a page and keeps it in sync with settings,
// Vancouver's time of day, and live weather.
import { SceneRenderer, todFromHour, vancouverHour } from './scenes.js';
import { getState } from './state.js';
import { getWeather } from './weather.js';

export function resolveSceneOptions(settings, weather) {
  const tod = settings.timeOfDay === 'auto' ? todFromHour(vancouverHour()) : settings.timeOfDay;
  // With no weather data yet, assume the obvious: it's raining in Vancouver.
  const fx = settings.weatherFx === 'auto' ? weather?.fx ?? 'rain' : settings.weatherFx;
  const reduced =
    settings.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { scene: settings.scene, tod, weather: fx, reduced };
}

export async function mountScene(canvas) {
  let { settings, weatherCache } = await getState(['settings', 'weatherCache']);
  let weather = weatherCache;
  const renderer = new SceneRenderer(canvas, resolveSceneOptions(settings, weather));
  const refresh = () => renderer.setOptions(resolveSceneOptions(settings, weather));

  getWeather().then((w) => {
    weather = w;
    refresh();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
      refresh();
    }
    if (changes.weatherCache?.newValue) {
      weather = changes.weatherCache.newValue;
      refresh();
    }
  });

  // Re-check time of day and weather every few minutes
  setInterval(async () => {
    weather = await getWeather();
    refresh();
  }, 5 * 60 * 1000);

  return renderer;
}
