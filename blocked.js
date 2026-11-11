import { getState, formatClock, timerRemainingMs, normalizeSite, deepMerge, DEFAULTS } from './lib/state.js';
import { mountScene } from './lib/sceneHost.js';


const $ = (id) => document.getElementById(id);
const site = normalizeSite(new URLSearchParams(location.search).get('site') ?? '') ?? '';

let { timer, settings, why } = await getState(['timer', 'settings', 'why']);
await mountScene($('scene'));

$('site').textContent = site || 'This site';
$('title').textContent = 'can wait.';
document.title = `${site || 'Blocked'} can wait · Homesick`;

function render() {
  const focusing = timer.phase === 'focus';
  const blockedNow =
    settings.blockMode === 'always' || (settings.blockMode === 'focus' && focusing);
  const listed = settings.blockedSites.includes(site);

  if (blockedNow && listed) {
    $('message').textContent =
      settings.blockMode === 'always' && !focusing
        ? 'You set this site to always be blocked. You can change that in Settings.'
        : "You're in a focus session. It'll still be here when the timer ends.";
    $('left').hidden = !focusing;
    $('goAnyway').hidden = true;
  } else {
    $('title').textContent = 'is open again.';
    $('message').textContent = focusing ? 'This site is no longer on your block list.' : 'Your focus session is over. Nice work.';
    $('left').hidden = true;
    if (site) {
      $('goAnyway').href = `https://${site}`;
      $('goAnyway').hidden = false;
    }
  }

  const note = why.trim();
  $('why').hidden = !note || settings.features.why === false;
  if (note) {
    $('why').replaceChildren();
    const label = document.createElement('small');
    label.textContent = "Why you're here";
    $('why').append(label, document.createTextNode(note));
  }
}

function tick() {
  if (timer.phase === 'focus') {
    $('left').textContent = formatClock(timerRemainingMs(timer));
  }
}

$('back').addEventListener('click', async () => {
  // Leave this tab for the focus page
  location.href = chrome.runtime.getURL('newtab.html');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.timer) timer = deepMerge(DEFAULTS.timer, changes.timer.newValue);
  if (changes.settings) settings = deepMerge(DEFAULTS.settings, changes.settings.newValue);
  if (changes.why) why = changes.why.newValue ?? '';
  render();
  tick();
});

render();
tick();
setInterval(tick, 500);
