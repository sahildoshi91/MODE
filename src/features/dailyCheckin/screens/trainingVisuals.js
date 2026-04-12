import {
  Activity,
  ArrowDownUp,
  ArrowRightLeft,
  CircleDot,
  Dumbbell,
  PersonStanding,
  StretchHorizontal,
  Wind,
} from 'lucide-react-native';

import { theme } from '../../../../lib/theme';

export const TRAINING_ITEM_SECTIONS = {
  WARMUP: 'warmup',
  MAIN: 'main',
  GUIDED: 'guided',
  COOLDOWN: 'cooldown',
};

export const TRAINING_VISUAL_KEYS = {
  BREATHING: 'breathing',
  CARDIO: 'cardio',
  LOWER_BODY: 'lower-body',
  HINGE: 'hinge',
  PUSH: 'push',
  PULL: 'pull',
  CORE: 'core',
  MOBILITY: 'mobility',
  STRENGTH: 'strength',
};

function withAlpha(hexColor, alpha) {
  const normalized = hexColor.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((chunk) => chunk + chunk).join('')
    : normalized;

  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const VISUALS = {
  [TRAINING_VISUAL_KEYS.BREATHING]: {
    key: TRAINING_VISUAL_KEYS.BREATHING,
    Icon: Wind,
  },
  [TRAINING_VISUAL_KEYS.CARDIO]: {
    key: TRAINING_VISUAL_KEYS.CARDIO,
    Icon: Activity,
  },
  [TRAINING_VISUAL_KEYS.LOWER_BODY]: {
    key: TRAINING_VISUAL_KEYS.LOWER_BODY,
    Icon: PersonStanding,
  },
  [TRAINING_VISUAL_KEYS.HINGE]: {
    key: TRAINING_VISUAL_KEYS.HINGE,
    Icon: ArrowDownUp,
  },
  [TRAINING_VISUAL_KEYS.PUSH]: {
    key: TRAINING_VISUAL_KEYS.PUSH,
    Icon: Dumbbell,
  },
  [TRAINING_VISUAL_KEYS.PULL]: {
    key: TRAINING_VISUAL_KEYS.PULL,
    Icon: ArrowRightLeft,
  },
  [TRAINING_VISUAL_KEYS.CORE]: {
    key: TRAINING_VISUAL_KEYS.CORE,
    Icon: CircleDot,
  },
  [TRAINING_VISUAL_KEYS.MOBILITY]: {
    key: TRAINING_VISUAL_KEYS.MOBILITY,
    Icon: StretchHorizontal,
  },
  [TRAINING_VISUAL_KEYS.STRENGTH]: {
    key: TRAINING_VISUAL_KEYS.STRENGTH,
    Icon: Dumbbell,
  },
};

const KEYWORD_RULES = [
  {
    key: TRAINING_VISUAL_KEYS.BREATHING,
    keywords: ['breathing', 'inhale', 'exhale', 'reset'],
  },
  {
    key: TRAINING_VISUAL_KEYS.CARDIO,
    keywords: ['walk', 'jog', 'run', 'interval', 'conditioning'],
  },
  {
    key: TRAINING_VISUAL_KEYS.LOWER_BODY,
    keywords: ['split squat', 'step-up', 'leg press', 'squat', 'lunge'],
  },
  {
    key: TRAINING_VISUAL_KEYS.HINGE,
    keywords: ['hinge', 'deadlift', 'rdl', 'bridge', 'posterior'],
  },
  {
    key: TRAINING_VISUAL_KEYS.PUSH,
    keywords: ['push-up', 'floor press', 'press', 'bench', 'chest'],
  },
  {
    key: TRAINING_VISUAL_KEYS.PULL,
    keywords: ['pulldown', 'row', 'pull', 'back'],
  },
  {
    key: TRAINING_VISUAL_KEYS.CORE,
    keywords: ['dead bug', 'plank', 'carry', 'core', 'hold'],
  },
  {
    key: TRAINING_VISUAL_KEYS.MOBILITY,
    keywords: ['reach', 'flow', 'prep', 'stretch', 'mobility'],
  },
];

const MUSCLE_GROUP_FALLBACKS = [
  {
    key: TRAINING_VISUAL_KEYS.CARDIO,
    matches: ['conditioning', 'cardio'],
  },
  {
    key: TRAINING_VISUAL_KEYS.HINGE,
    matches: ['posterior chain', 'hamstrings', 'glutes'],
  },
  {
    key: TRAINING_VISUAL_KEYS.PUSH,
    matches: ['chest', 'shoulders', 'triceps'],
  },
  {
    key: TRAINING_VISUAL_KEYS.PULL,
    matches: ['back', 'lats', 'biceps'],
  },
  {
    key: TRAINING_VISUAL_KEYS.CORE,
    matches: ['core', 'abs', 'obliques'],
  },
  {
    key: TRAINING_VISUAL_KEYS.LOWER_BODY,
    matches: ['legs', 'quads'],
  },
];

const SECTION_DEFAULT_KEYS = {
  [TRAINING_ITEM_SECTIONS.WARMUP]: TRAINING_VISUAL_KEYS.MOBILITY,
  [TRAINING_ITEM_SECTIONS.MAIN]: TRAINING_VISUAL_KEYS.STRENGTH,
  [TRAINING_ITEM_SECTIONS.GUIDED]: TRAINING_VISUAL_KEYS.STRENGTH,
  [TRAINING_ITEM_SECTIONS.COOLDOWN]: TRAINING_VISUAL_KEYS.BREATHING,
};

const SECTION_BADGE_COLORS = {
  [TRAINING_ITEM_SECTIONS.WARMUP]: {
    color: theme.colors.emotional.warmGold,
    backgroundColor: withAlpha(theme.colors.emotional.warmGold, 0.14),
    borderColor: withAlpha(theme.colors.emotional.warmGold, 0.24),
  },
  [TRAINING_ITEM_SECTIONS.MAIN]: {
    color: theme.colors.brand.progressCore,
    backgroundColor: withAlpha(theme.colors.brand.progressCore, 0.14),
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.22),
  },
  [TRAINING_ITEM_SECTIONS.GUIDED]: {
    color: theme.colors.brand.progressCore,
    backgroundColor: withAlpha(theme.colors.brand.progressCore, 0.14),
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.22),
  },
  [TRAINING_ITEM_SECTIONS.COOLDOWN]: {
    color: theme.colors.brand.progressCore,
    backgroundColor: withAlpha(theme.colors.brand.progressSoft, 0.24),
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.2),
  },
};

function normalizeText(...parts) {
  return parts
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesKeyword(text, keyword) {
  const pattern = new RegExp(`(^|[^a-z])${escapeRegExp(keyword)}([^a-z]|$)`);
  return pattern.test(text);
}

function resolveKeywordVisual(text) {
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => matchesKeyword(text, keyword))) {
      return VISUALS[rule.key];
    }
  }

  return null;
}

function resolveMuscleGroupVisual(muscleGroup) {
  const normalized = normalizeText(muscleGroup);

  for (const fallback of MUSCLE_GROUP_FALLBACKS) {
    if (fallback.matches.some((match) => normalized.includes(match))) {
      return VISUALS[fallback.key];
    }
  }

  return null;
}

export function resolveTrainingItemVisual({
  section,
  name,
  description,
  muscleGroup,
}) {
  const normalizedSection = SECTION_BADGE_COLORS[section] ? section : TRAINING_ITEM_SECTIONS.MAIN;
  const text = normalizeText(name, description);
  const supportsMuscleGroupFallback = normalizedSection === TRAINING_ITEM_SECTIONS.MAIN
    || normalizedSection === TRAINING_ITEM_SECTIONS.GUIDED;

  const visual = resolveKeywordVisual(text)
    || (supportsMuscleGroupFallback ? resolveMuscleGroupVisual(muscleGroup) : null)
    || VISUALS[SECTION_DEFAULT_KEYS[normalizedSection]];

  return {
    icon: visual,
    iconKey: visual.key,
    badgeColors: SECTION_BADGE_COLORS[normalizedSection],
  };
}
