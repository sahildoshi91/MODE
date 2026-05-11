import React, { useState } from 'react';
import renderer, { act } from 'react-test-renderer';

import DraftReviewStructuredCard from '../DraftReviewStructuredCard';

function hasRenderedTestID(node, targetTestID) {
  if (!node) {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((child) => hasRenderedTestID(child, targetTestID));
  }
  if (node.props?.testID === targetTestID) {
    return true;
  }
  return hasRenderedTestID(node.children, targetTestID);
}

function hasRenderedText(node, targetText) {
  if (!node) {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((child) => hasRenderedText(child, targetText));
  }
  if (typeof node === 'string') {
    return node.includes(targetText);
  }
  return hasRenderedText(node.children, targetText);
}

function findNodeWithHandler(tree, testID, handlerName) {
  const matches = tree.root.findAllByProps({ testID });
  const node = matches.find((candidate) => typeof candidate.props?.[handlerName] === 'function');
  if (!node) {
    throw new Error(`No node with testID "${testID}" has handler "${handlerName}".`);
  }
  return node;
}

function pressByTestID(tree, testID) {
  findNodeWithHandler(tree, testID, 'onPress').props.onPress();
}

function changeTextByTestID(tree, testID, value) {
  findNodeWithHandler(tree, testID, 'onChangeText').props.onChangeText(value);
}

async function press(tree, testID) {
  await act(async () => {
    pressByTestID(tree, testID);
  });
}

async function changeText(tree, testID, value) {
  await act(async () => {
    changeTextByTestID(tree, testID, value);
  });
}

function buildNutritionModel(overrides = {}) {
  return {
    kind: 'nutrition_plan',
    title: 'Performance Plan',
    calories: 2200,
    protein: 170,
    status: 'open',
    sourceType: 'generated_checkin_plan',
    summary: 'Performance Plan gives you about 2,200 kcal and 170g protein for the day.',
    notes: 'Dial portions based on hunger cues.',
    meals: [
      {
        id: 'meal-1',
        name: 'Breakfast',
        timing: '8:00 AM',
        foods: [
          {
            id: 'food-1',
            name: 'Egg whites',
            amount: '1 cup',
            calories: 120,
            protein: 26,
          },
        ],
        totalCalories: 560,
        totalProtein: 44,
        notes: 'Add berries for fiber.',
        collapsed: false,
      },
      {
        id: 'meal-2',
        name: 'Lunch',
        timing: '1:00 PM',
        foods: [
          {
            id: 'food-2',
            name: 'Chicken',
            amount: '',
            calories: 280,
            protein: 52,
          },
        ],
        totalCalories: 720,
        totalProtein: 58,
        notes: '',
        collapsed: false,
      },
    ],
    ...overrides,
  };
}

function NutritionHarness({
  initialModel,
  testIDPrefix = 'draft-review-test',
}) {
  const [model, setModel] = useState(initialModel);

  return (
    <DraftReviewStructuredCard
      model={model}
      onModelChange={setModel}
      modelKey="draft-1"
      onRetryRender={jest.fn()}
      onRegeneratePlan={jest.fn()}
      testIDPrefix={testIDPrefix}
    />
  );
}

function buildTrainingModel(overrides = {}) {
  return {
    kind: 'training_plan',
    title: 'Strength Builder',
    durationMinutes: 45,
    difficulty: 'intermediate',
    type: 'strength',
    description: 'Lower-body focused day.',
    coachNote: 'Move with control.',
    status: 'open',
    sourceType: 'generated_checkin_plan',
    summary: 'Strength Builder · 2 exercises · 45 min',
    exercises: [
      {
        id: 'exercise-1',
        name: 'Goblet squat',
        sets: 3,
        reps: '8 / side',
        rest: '60 sec',
        muscleGroup: 'legs',
        description: 'Tempo down, drive up.',
        coachTip: 'Brace before each rep.',
      },
      {
        id: 'exercise-2',
        name: 'Single-arm row',
        sets: 3,
        reps: '10 / side',
        rest: '45 sec',
        muscleGroup: 'back',
        description: '',
        coachTip: '',
      },
    ],
    warmup: [
      { id: 'warmup-1', name: 'Bike', duration: '4 min', description: 'Easy pace.' },
    ],
    cooldown: [
      { id: 'cooldown-1', name: 'Breathing reset', duration: '2 min', description: 'Slow exhales.' },
    ],
    ...overrides,
  };
}

function TrainingHarness({
  initialModel,
  testIDPrefix = 'draft-review-training',
}) {
  const [model, setModel] = useState(initialModel);

  return (
    <DraftReviewStructuredCard
      model={model}
      onModelChange={setModel}
      modelKey="draft-training-1"
      onRetryRender={jest.fn()}
      onRegeneratePlan={jest.fn()}
      testIDPrefix={testIDPrefix}
    />
  );
}

function buildGenericModel(overrides = {}) {
  return {
    kind: 'generic_structured',
    title: 'Client Follow-up',
    summary: 'Draft a simple client follow-up.',
    status: 'open',
    sourceType: 'trainer_assistant',
    notes: 'Keep it direct.',
    sections: [
      {
        id: 'section-1',
        title: 'Opening',
        text: 'Nice work getting the check-in done.',
        items: [],
      },
      {
        id: 'section-2',
        title: 'Next steps',
        text: '',
        items: ['Hydrate today', 'Keep dinner protein-forward'],
      },
    ],
    meta: [
      { label: 'Action', value: 'message_client' },
    ],
    ...overrides,
  };
}

function GenericHarness({
  initialModel,
  testIDPrefix = 'draft-review-generic',
}) {
  const [model, setModel] = useState(initialModel);

  return (
    <DraftReviewStructuredCard
      model={model}
      onModelChange={setModel}
      modelKey="draft-generic-1"
      onRetryRender={jest.fn()}
      onRegeneratePlan={jest.fn()}
      testIDPrefix={testIDPrefix}
    />
  );
}

describe('DraftReviewStructuredCard meal edit behavior', () => {
  it('edits only the tapped meal card', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <NutritionHarness initialModel={buildNutritionModel()} />,
      );
    });

    await press(tree, 'draft-review-test-meal-card-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-1' })).toHaveLength(0);

    await press(tree, 'draft-review-test-meal-card-1');

    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-1' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows helper labels only for populated inputs', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <NutritionHarness initialModel={buildNutritionModel()} />,
      );
    });

    await press(tree, 'draft-review-test-meal-card-0');
    await press(tree, 'draft-review-test-food-row-0-0');

    const firstMealRender = tree.toJSON();
    expect(hasRenderedTestID(firstMealRender, 'draft-review-test-value-label-meal-name-0')).toBe(true);
    expect(hasRenderedTestID(firstMealRender, 'draft-review-test-value-label-meal-timing-0')).toBe(true);
    expect(hasRenderedTestID(firstMealRender, 'draft-review-test-value-label-food-amount-0-0')).toBe(true);
    expect(hasRenderedTestID(firstMealRender, 'draft-review-test-value-label-meal-notes-0')).toBe(true);

    await press(tree, 'draft-review-test-meal-card-1');
    await press(tree, 'draft-review-test-food-row-1-0');

    const secondMealRender = tree.toJSON();
    expect(hasRenderedText(secondMealRender, 'Updating')).toBe(false);
    expect(hasRenderedText(secondMealRender, 'Food amount')).toBe(false);
    const secondMealJSON = tree.toJSON();
    expect(hasRenderedTestID(secondMealJSON, 'draft-review-test-value-label-food-amount-1-0')).toBe(false);
    expect(hasRenderedTestID(secondMealJSON, 'draft-review-test-value-label-meal-notes-1')).toBe(false);

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses meal-local save to exit edit mode and keep meal changes', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <NutritionHarness initialModel={buildNutritionModel()} />,
      );
    });

    await press(tree, 'draft-review-test-meal-card-0');

    await changeText(tree, 'draft-review-test-meal-name-0', 'Updated Breakfast');

    await press(tree, 'draft-review-test-meal-save-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-1' })).toHaveLength(0);
    expect(hasRenderedText(tree.toJSON(), 'Updated Breakfast')).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

  it('removes the targeted food row via inline x control', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <NutritionHarness initialModel={buildNutritionModel()} />,
      );
    });

    await press(tree, 'draft-review-test-meal-card-0');
    await press(tree, 'draft-review-test-food-row-0-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-test-food-remove-0-0' }).length).toBeGreaterThan(0);

    await press(tree, 'draft-review-test-food-remove-0-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-test-food-remove-0-0' })).toHaveLength(0);
    expect(hasRenderedText(tree.toJSON(), 'Egg whites')).toBe(false);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps meal edit target while collapsing and expanding', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <NutritionHarness initialModel={buildNutritionModel()} />,
      );
    });

    await press(tree, 'draft-review-test-meal-card-0');
    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' }).length).toBeGreaterThan(0);

    await press(tree, 'draft-review-test-meal-collapse-0');
    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' })).toHaveLength(0);

    await press(tree, 'draft-review-test-meal-collapse-0');
    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('auto-expands a collapsed meal when the card is tapped', async () => {
    const collapsedModel = buildNutritionModel({
      meals: [
        {
          id: 'meal-1',
          name: 'Breakfast',
          timing: '8:00 AM',
          foods: [
            {
              id: 'food-1',
              name: 'Egg whites',
              amount: '1 cup',
              calories: 120,
              protein: 26,
            },
          ],
          totalCalories: 560,
          totalProtein: 44,
          notes: 'Add berries for fiber.',
          collapsed: true,
        },
      ],
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <NutritionHarness initialModel={collapsedModel} />,
      );
    });

    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' })).toHaveLength(0);

    await press(tree, 'draft-review-test-meal-card-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-test-meal-name-0' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('DraftReviewStructuredCard training compact editing', () => {
  it('renders one expanded exercise row at a time', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainingHarness initialModel={buildTrainingModel()} />,
      );
    });

    await press(tree, 'draft-review-training-exercise-row-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-training-exercise-name-0' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-training-exercise-name-1' })).toHaveLength(0);

    await press(tree, 'draft-review-training-exercise-row-1');

    expect(tree.root.findAllByProps({ testID: 'draft-review-training-exercise-name-0' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-training-exercise-name-1' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses exercise-local done to exit edit mode and keep exercise changes', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainingHarness initialModel={buildTrainingModel()} />,
      );
    });

    await press(tree, 'draft-review-training-exercise-row-0');
    await changeText(tree, 'draft-review-training-exercise-name-0', 'Tempo squat');
    await press(tree, 'draft-review-training-exercise-save-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-training-exercise-name-0' })).toHaveLength(0);
    expect(hasRenderedText(tree.toJSON(), 'Tempo squat')).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

  it('removes the expanded exercise row via inline x', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainingHarness initialModel={buildTrainingModel()} />,
      );
    });

    await press(tree, 'draft-review-training-exercise-row-0');
    await press(tree, 'draft-review-training-exercise-remove-0');

    expect(hasRenderedText(tree.toJSON(), 'Goblet squat')).toBe(false);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps draft metadata read-only while warmup/cooldown render', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainingHarness initialModel={buildTrainingModel()} />,
      );
    });

    expect(hasRenderedText(tree.toJSON(), 'Warm-up')).toBe(true);
    expect(hasRenderedText(tree.toJSON(), 'Cool-down')).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'draft-review-training-toggle-edit' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-training-training-title' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-training-training-duration' })).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('DraftReviewStructuredCard generic section editing', () => {
  it('edits only the tapped generic section card', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <GenericHarness initialModel={buildGenericModel()} />,
      );
    });

    await press(tree, 'draft-review-generic-generic-section-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-generic-generic-section-title-0' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-generic-generic-section-title-1' })).toHaveLength(0);

    await press(tree, 'draft-review-generic-generic-section-1');

    expect(tree.root.findAllByProps({ testID: 'draft-review-generic-generic-section-title-0' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'draft-review-generic-generic-section-title-1' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses section-local done to exit edit mode and keep section changes', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <GenericHarness initialModel={buildGenericModel()} />,
      );
    });

    await press(tree, 'draft-review-generic-generic-section-0');
    await changeText(tree, 'draft-review-generic-generic-section-text-0', 'Updated section copy.');
    await press(tree, 'draft-review-generic-generic-section-save-0');

    expect(tree.root.findAllByProps({ testID: 'draft-review-generic-generic-section-text-0' })).toHaveLength(0);
    expect(hasRenderedText(tree.toJSON(), 'Updated section copy.')).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

  it('does not render delivery-only controls by default', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <GenericHarness initialModel={buildGenericModel()} />,
      );
    });

    expect(hasRenderedText(tree.toJSON(), 'Send to Client')).toBe(false);
    expect(hasRenderedText(tree.toJSON(), 'Delivery rollout coming soon')).toBe(false);

    await act(async () => {
      tree.unmount();
    });
  });
});
