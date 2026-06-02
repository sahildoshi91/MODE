export const METRIC_CONFIG = {
  readiness: {
    key: 'readiness',
    label: 'Readiness',
    subtitle: 'all 5 signals combined',
    description: 'Overall daily readiness based on all 5 check-in inputs.',
    unit: '/25',
    order: 0,
    icon: 'activity',
    iconBg: 'rgba(64,104,245,0.12)',
    iconColor: '#4068F5',
  },
  sleep: {
    key: 'sleep',
    label: 'Sleep',
    subtitle: 'sleep readiness signal',
    description: 'How well-rested you felt when you woke up.',
    unit: '/5',
    order: 1,
    icon: 'moon',
    iconBg: 'rgba(72,103,184,0.12)',
    iconColor: '#4867B8',
  },
  recovery: {
    key: 'recovery',
    label: 'Recovery',
    subtitle: 'soreness · freshness',
    description: 'Physical soreness and muscle readiness.',
    unit: '/5',
    order: 2,
    icon: 'zap',
    iconBg: 'rgba(95,158,127,0.12)',
    iconColor: '#5F9E7F',
  },
  energy_mood: {
    key: 'energy_mood',
    label: 'Energy & Mood',
    subtitle: 'motivation signal',
    description: 'Motivation and mental energy going into the day.',
    unit: '/5',
    order: 3,
    icon: 'sun',
    iconBg: 'rgba(197,122,108,0.12)',
    iconColor: '#C57A6C',
  },
  stress: {
    key: 'stress',
    label: 'Calm',
    subtitle: 'stress signal · higher = calmer',
    description: 'How calm and low-stress you felt. Higher means calmer.',
    unit: '/5',
    order: 4,
    icon: 'wind',
    iconBg: 'rgba(95,158,127,0.10)',
    iconColor: '#5F9E7F',
  },
  nutrition: {
    key: 'nutrition',
    label: 'Nutrition',
    subtitle: 'consistency signal',
    description: 'How on-track your nutrition felt for the day.',
    unit: '/5',
    order: 5,
    icon: 'target',
    iconBg: 'rgba(185,140,96,0.12)',
    iconColor: '#B98C60',
  },
};

export const METRIC_ORDER = [
  'readiness',
  'sleep',
  'recovery',
  'energy_mood',
  'stress',
  'nutrition',
];

export const SIGNAL_LABELS = {
  1: 'Very Low',
  2: 'Low',
  3: 'Moderate',
  4: 'Good',
  5: 'Great',
};

export const STREAK_MILESTONES = [
  { weeks: 2, label: '2w' },
  { weeks: 3, label: '3w' },
  { weeks: 4, label: '4w' },
  { weeks: 8, label: '8w' },
];

export const INSIGHT_COPY = {
  low_sleep_3_days: 'Sleep has been low for 3 days in a row. Prioritizing rest drives almost every other metric.',
  low_recovery_3_days: 'Recovery has been low for 3 consecutive days. A lighter training day can help.',
  low_energy_3_days: 'Energy and mood have dipped for 3 days. Check in on sleep and nutrition quality.',
  low_calm_3_days: 'Stress has been elevated for 3 days. Recovery-focused sessions can help restore calm.',
  nutrition_below_target_7d: 'Nutrition has been below target this week. Fueling well supports every other metric.',
  readiness_sharp_drop: 'Readiness has dropped sharply from your recent baseline. Today is a good day to listen to your body.',
};
