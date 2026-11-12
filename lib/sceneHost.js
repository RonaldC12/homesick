// Mounts the animated wallpaper on a page and keeps it in sync with settings,
// the time of day at home, live weather, and any photos you've added.
import { SCENES, SceneRenderer, isCustomScene, todFromHour } from './scenes.js';
import { getState, hourIn } from './state.js';
import { getWeather } from './weather.js';

export function resolveSceneOptions(settings, weather) {
  const tz = settings.home?.tz ?? 'America/Vancouver';
  const tod = settings.timeOfDay === 'auto' ? todFromHour(hourIn(tz)) : settings.timeOfDay;
  // With no weather data yet, assume rain. It suits the mood.
  const fx = settings.weatherFx === 'auto' ? weather?.fx ?? 'rain' : settings.weatherFx;
  const reduced =
    settings.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { scene: settings.scene, tod, weather: fx, reduced, style: settings.style ?? 'smooth' };
}

const imageCache = new Map();

/** Decoded <img> for one of your photos, cached by id. */
export function loadPlaceImage(place) {
  if (!imageCache.has(place.id)) {
    const img = new Image();
    img.src = place.dataUrl;
    imageCache.set(place.id, img.decode().then(() => img));
  }
  return imageCache.get(place.id);
}

export async function imageForScene(sceneId, customPlaces) {
  if (!isCustomScene(sceneId)) return null;
  const place = customPlaces.find((p) => `custom:${p.id}` === sceneId);
  if (!place) return null;
  try {
    return await loadPlaceImage(place);
  } catch {
    return null;
  }
}

/** Display name and area line for any scene id, built-in or yours. */
export function describeScene(sceneId, customPlaces) {
  if (isCustomScene(sceneId)) {
    const place = customPlaces.find((p) => `custom:${p.id}` === sceneId);
    if (place) return { name: place.name, area: 'Your photo' };
  }
  const s = SCENES.find((x) => x.id === sceneId) ?? SCENES[0];
  return { name: s.name, area: s.area };
}

export async function mountScene(canvas) {
  let { settings, weatherCache, customPlaces } = await getState(['settings', 'weatherCache', 'customPlaces']);
  let weather = weatherCache;
  let image = await imageForScene(settings.scene, customPlaces);

  const options = () => {
    const o = resolveSceneOptions(settings, weather);
    // A photo that was deleted or failed to load falls back to the seawall
    if (isCustomScene(o.scene) && !image) o.scene = 'seawall';
    return { ...o, image };
  };
  const renderer = new SceneRenderer(canvas, options());
  const refresh = () => renderer.setOptions(options());

  getWeather().then((w) => {
    weather = w;
    refresh();
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.customPlaces) customPlaces = changes.customPlaces.newValue ?? [];
    if (changes.settings) settings = { ...settings, ...changes.settings.newValue };
    if (changes.weatherCache) weather = changes.weatherCache.newValue ?? null;
    if (changes.settings && changes.settings.oldValue?.home?.tz !== changes.settings.newValue?.home?.tz) {
      getWeather().then((w) => {
        weather = w;
        refresh();
      });
    }
    if (changes.settings || changes.customPlaces) image = await imageForScene(settings.scene, customPlaces);
    if (changes.settings || changes.customPlaces || changes.weatherCache) refresh();
  });

  // Re-check time of day and weather every few minutes
  setInterval(async () => {
    weather = await getWeather();
    refresh();
  }, 5 * 60 * 1000);

  return renderer;
}
