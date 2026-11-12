// Words shown around the app. Written like a friend nudging you, not a poster.

export const NUDGES = [
  'Phone in the other room?',
  "Just the next 25 minutes. That's all you have to do right now.",
  'Pick the smallest thing on your list and start there.',
  'Open the doc. Write one bad sentence. Fix it later.',
  'Two sessions, then go get food.',
  'Drink some water first.',
  'Text someone from home after this session.',
  "Stuck? Write down exactly what's confusing you.",
  "You've had harder weeks than this one.",
  'Close the tab you keep thinking about.',
  'On your break, actually stand up and go outside for a minute.',
  'Missing home is normal. Call someone tonight.',
  "Nobody back home needs this to be perfect.",
  "Start the timer before you feel ready.",
  'Put the rain on and get one thing done.',
  "What would make today feel like a win? Do that first.",
];

export const JOURNAL_PROMPTS = [
  'What is one small thing from home you could recreate here this week?',
  'Describe your favourite spot back home in as much detail as you can.',
  'What did you get done today, even if it felt small?',
  'Who from home would you like to message today? What would you say?',
  'What is one thing about where you are now that you would miss if you left?',
  'What are three things you are grateful for right now?',
  'What is making today heavy? What would make it 10% lighter?',
  'What is the first thing you will do when you get home?',
  'Write about a rainy day back home that you remember fondly.',
  'What are you working toward, and why does it matter to you?',
  'What helped the last time you felt like this?',
  'What would you tell a friend who felt exactly how you feel today?',
  'Name one thing you did today that past you would be proud of.',
  'What is a food from home you are craving? Where would you get it?',
  'What does a good, ordinary day look like for you here?',
];

export function pick(list, seed = Date.now()) {
  return list[Math.abs(Math.floor(seed)) % list.length];
}

/** Changes once a day, so the line stays put instead of changing on every new tab. */
export function dailyPick(list, offset = 0) {
  const d = new Date();
  const day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86_400_000);
  return list[(day + offset) % list.length];
}
