# Homesick

A Chrome extension that turns every new tab into a calm, rainy corner of Vancouver or Burnaby, and blocks distracting sites while you focus.

I'm genuinely so burnt out, surely this will help me motivate.

## What it does

- **Animated places you miss.** Pick from seven hand-drawn, animated scenes:
  - Stanley Park Seawall: the North Shore mountains, Lions Gate Bridge, and a sailboat drifting by
  - Burnaby Mountain (SFU): fog through the cedars, city lights below
  - Metrotown SkyTrain: Expo Line trains gliding past the towers
  - Deer Lake: still water, ducks, reeds, and Metrotown on the horizon
  - English Bay: freighters at anchor, driftwood, and the inukshuk at sundown
  - Gastown: cobblestones, warm windows, and a steam clock that shows the real Vancouver time
  - Grouse Mountain: the red gondola over snowy firs

  By default each scene follows Vancouver's current time of day (day, dusk, or night) and live weather (rain, fog, or snow). You can also set the time of day and weather yourself.
- **Two art styles.** Smooth, or pixel art (chunky pixels, a dithered palette, and heavier rain). Switch between them at the top of the place picker or in Settings.
- **Your own photos.** Upload up to 8 pictures of home. Each one gets graded for the time of day, has the weather drawn over it, and turns into pixel art when that style is on.
- **Real site blocking.** YouTube, Instagram, TikTok, Twitter/X, Reddit, Facebook, Netflix, Twitch, and Pinterest are blocked during focus sessions. You can add your own sites, remove any of them, or choose to block them all the time. Tabs already open on a blocked site get redirected as soon as a session starts.
- **Focus timer.** A Pomodoro-style timer (25/5 by default, with a long break every 4 sessions). It keeps running in the background and shows the minutes left on the toolbar icon.
- **Ambient sound.** Rain, ocean, forest, city and SkyTrain, Westminster chimes, and a soft pad, all generated live in your browser. Each place comes with its own mix, and you can adjust every channel. Sound keeps playing when you switch tabs. If Chrome won't let the background page play audio, the tab where you pressed Play plays it instead, and the sound panel tells you which one is playing.
- **Motivation and homesickness tools.** You can turn each of these on or off in Settings:
  - Vancouver clock and weather, plus your own local time if you're somewhere else
  - A "why I'm here" note, also shown on the blocked page
  - A short daily nudge
  - A list of today's goals
  - A countdown to your next flight home. Add the departure time and it counts down in hours and minutes for the last two days.
  - Focus stats: minutes today, sessions completed, your day streak, and a 7-day chart
  - A private journal with prompts for homesick days

Everything is stored on your device with `chrome.storage.local`. The only network request is the weather lookup from [Open-Meteo](https://open-meteo.com/), which needs no account or API key.

## Install it (about one minute)

1. Download this repo: **Code → Download ZIP** on GitHub, then unzip it. You can also run `git clone https://github.com/RonaldC12/homesick.git`.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `homesick` folder (the one that contains `manifest.json`).
5. Open a new tab. Chrome may ask whether to keep the new tab change. Choose **Keep it**.

To pin it, click the puzzle-piece icon in the toolbar, then the pin next to Homesick. The popup lets you start and pause sessions, switch places, and turn sound on or off.

This works in Chrome 116 or newer, and in other Chromium browsers (Edge, Brave, Arc) through their own extensions pages.

## Sharing it

Send friends the repo link and the install steps above. There's no build step, so the folder is the extension.

To publish on the Chrome Web Store, zip the folder contents (everything except `scripts/`), then upload the zip through the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Registering as a developer costs a one-time fee.

## How it works

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 config: new tab override, popup, permissions |
| `background.js` | Service worker. Runs the timer (`chrome.alarms`), blocking rules (`declarativeNetRequest`), badge, notifications, and the audio document |
| `newtab.html/js` | The main focus page |
| `blocked.html/js` | The page you land on when you open a blocked site |
| `popup.html/js` | The toolbar popup |
| `offscreen.html/js` | Hidden page that plays ambient audio so it keeps going across tabs |
| `lib/scenes.js` | Canvas renderer and all seven animated scenes |
| `lib/audio.js` | Web Audio synthesis for every soundscape |
| `lib/state.js` | Storage defaults and helpers |
| `lib/weather.js` | Open-Meteo lookup with a 20-minute cache |
| `scripts/make-icons.mjs` | Regenerates the PNG icons (`node scripts/make-icons.mjs`) |

### Why these permissions

- `declarativeNetRequest` and host access: to redirect blocked sites to the Homesick page
- `tabs`: to move tabs that are already on a blocked site when a session starts
- `alarms` and `notifications`: so the timer ends on time and tells you, even with no tab open
- `offscreen`: to play sound in the background
- `storage` and `unlimitedStorage`: to save your settings, goals, journal, and photos on this device

## Tips

- If blocking feels too easy to get around, set **Site blocking → Always** in Settings.
- To end a focus session early, use the new tab page. You'll be asked to confirm. The popup only lets you pause, which adds a little friction on purpose.
- To cut CPU use on an older laptop, set **Settings → Motion → Reduced**.
