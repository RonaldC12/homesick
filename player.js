// The popped-out music window. Keeps playing while you work in other tabs.
import { getState, sendMessage } from './lib/state.js';
import { musicEmbed, musicFrame } from './lib/music.js';

const $ = (id) => document.getElementById(id);
let { music } = await getState(['music']);
let shownSrc = null;

function render() {
  const embed = music.url ? musicEmbed(music.url, music.tall) : null;
  if (!embed || embed.error) {
    shownSrc = null;
    const p = document.createElement('p');
    p.className = 'empty muted';
    p.textContent = 'No music link yet. Add one from the Music card on your new tab.';
    $('frame').replaceChildren(p);
    $('label').textContent = '';
    return;
  }
  $('label').textContent = embed.provider;
  // Only rebuild the iframe if the link changed, so playback isn't interrupted
  if (embed.src === shownSrc) return;
  shownSrc = embed.src;
  const f = musicFrame(embed);
  f.removeAttribute('height');
  $('frame').replaceChildren(f);
}

$('back').addEventListener('click', () => sendMessage({ type: 'music:popin' }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.music) return;
  music = { ...music, ...changes.music.newValue };
  render();
});

render();
