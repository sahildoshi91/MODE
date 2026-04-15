export const QUICK_WIN_OPTIONS = [
  { key: 'energized', label: 'energized' },
  { key: 'okay', label: 'okay' },
  { key: 'tired', label: 'tired' },
  { key: 'stressed', label: 'stressed' },
  { key: 'off_track', label: 'off track' },
];

export const QUICK_WIN_RECOMMENDATIONS = {
  energized: {
    todayMove: 'Push Day: 40 minutes of focused strength work.',
    support: 'Keep intensity high but cap the session with one clean finisher, not extra volume.',
  },
  okay: {
    todayMove: 'Momentum Day: 30 minutes of steady training.',
    support: 'Start with your easiest first block to create a quick confidence win.',
  },
  tired: {
    todayMove: 'Recovery Build: 20 minutes of light movement and mobility.',
    support: 'Choose low friction: walk, stretch, and protect your energy for tomorrow.',
  },
  stressed: {
    todayMove: 'Reset Session: 15 minutes of breath-led movement and a short walk.',
    support: 'Anchor your day with one controllable action before adding anything harder.',
  },
  off_track: {
    todayMove: 'Restart Move: 10 minutes, no negotiation.',
    support: 'Minimum win counts today. Finishing a small session restores momentum fast.',
  },
};
