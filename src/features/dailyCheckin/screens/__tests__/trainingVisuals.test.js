jest.mock('lucide-react-native', () => {
  const createIcon = (name) => name;

  return {
    Activity: createIcon('Activity'),
    ArrowDownUp: createIcon('ArrowDownUp'),
    ArrowRightLeft: createIcon('ArrowRightLeft'),
    CircleDot: createIcon('CircleDot'),
    Dumbbell: createIcon('Dumbbell'),
    PersonStanding: createIcon('PersonStanding'),
    StretchHorizontal: createIcon('StretchHorizontal'),
    Wind: createIcon('Wind'),
  };
});

import {
  resolveTrainingItemVisual,
  TRAINING_ITEM_SECTIONS,
  TRAINING_VISUAL_KEYS,
} from '../trainingVisuals';

describe('resolveTrainingItemVisual', () => {
  it('prefers direct keyword matches', () => {
    const visual = resolveTrainingItemVisual({
      section: TRAINING_ITEM_SECTIONS.WARMUP,
      name: 'Standing reset breathing',
      description: 'Use long exhales to settle in.',
    });

    expect(visual.iconKey).toBe(TRAINING_VISUAL_KEYS.BREATHING);
  });

  it('falls back to muscle group for main workout exercises', () => {
    const visual = resolveTrainingItemVisual({
      section: TRAINING_ITEM_SECTIONS.MAIN,
      name: 'Mystery builder',
      description: 'Stay controlled and crisp.',
      muscleGroup: 'posterior chain',
    });

    expect(visual.iconKey).toBe(TRAINING_VISUAL_KEYS.HINGE);
  });

  it('uses the section default for warm-up items with no matches', () => {
    const visual = resolveTrainingItemVisual({
      section: TRAINING_ITEM_SECTIONS.WARMUP,
      name: 'Pattern primer',
      description: 'Move with intention.',
    });

    expect(visual.iconKey).toBe(TRAINING_VISUAL_KEYS.MOBILITY);
  });

  it('uses the generic strength fallback for unknown main workout items', () => {
    const visual = resolveTrainingItemVisual({
      section: TRAINING_ITEM_SECTIONS.MAIN,
      name: 'Custom builder',
      description: 'Stay smooth all the way through.',
    });

    expect(visual.iconKey).toBe(TRAINING_VISUAL_KEYS.STRENGTH);
  });
});
