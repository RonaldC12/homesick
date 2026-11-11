// Words shown around the app. Kept short and specific to home.

export const AFFIRMATIONS = [
  'The rain always lets up eventually. So will this feeling.',
  'Home is still there. You are building something worth bringing back.',
  'One focused block at a time. That is how the mountain gets climbed.',
  'You took the SkyTrain a thousand times without thinking. This is just the next stop.',
  'Feeling homesick means you have somewhere worth missing.',
  'Lock in now so the next trip home feels earned.',
  'Small, steady, wet-coast energy. Keep going.',
  'You do not have to feel motivated to start. Start, and it shows up.',
  'Grey skies, warm drink, one task. That is the whole plan.',
  'The people back home are proud of you for trying.',
  'Future you, walking the seawall, will thank you for this hour.',
  'It is okay to miss home and still do good work here.',
  'Breathe like the tide: in for four, out for six.',
  'Nobody climbs the Grouse Grind in one step.',
  'Do the next small thing. Then the one after that.',
  'Rest is part of the work. Take your breaks for real.',
];

export const JOURNAL_PROMPTS = [
  'What is one small thing from home you could recreate here this week?',
  'Describe your favourite spot in Vancouver or Burnaby in as much detail as you can.',
  'What did you get done today, even if it felt small?',
  'Who from home would you like to message today? What would you say?',
  'What is one thing about where you are now that you would miss if you left?',
  'What are three things you are grateful for right now?',
  'What is making today heavy? What would make it 10% lighter?',
  'What is the first thing you will do when you land at YVR?',
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

/** Changes once a day, so the line feels stable instead of random on every new tab. */
export function dailyPick(list, offset = 0) {
  const d = new Date();
  const day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86_400_000);
  return list[(day + offset) % list.length];
}
