// Offscreen document: the only place audio plays, so it keeps going while you switch tabs.
// Offscreen documents can only use chrome.runtime, so state arrives by message.
import { AmbientEngine } from './lib/audio.js';

const engine = new AmbientEngine();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'audio') engine.apply(msg.audio);
  return false;
});

chrome.runtime.sendMessage({ type: 'offscreen:ready' }).then((res) => {
  if (res?.ok && res.result?.playing) engine.apply(res.result);
});
