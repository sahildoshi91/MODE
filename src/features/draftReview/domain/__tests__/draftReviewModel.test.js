import {
  buildRegenerationLaunchContext,
  rebuildJSON,
  transformPlan,
} from '../draftReviewModel';

describe('draftReviewModel', () => {
  it('parses nutrition plan from structured payload wrapper', () => {
    const model = transformPlan({
      source_type: 'generated_checkin_plan',
      review_status: 'open',
      output_json: {
        plan_type: 'nutrition',
        structured: {
          title: 'Lean Build',
          totalCalories: 2150,
          totalProtein: 170,
          meals: [
            {
              name: 'Breakfast',
              timing: '8:00 AM',
              foods: [
                { name: 'Egg whites', amount: '6 oz', calories: 170, protein: 32 },
              ],
              totalCalories: 170,
              totalProtein: 32,
              notes: 'Hydrate early.',
            },
          ],
        },
      },
    });

    expect(model.kind).toBe('nutrition_plan');
    expect(model.title).toBe('Lean Build');
    expect(model.calories).toBe(2150);
    expect(model.protein).toBe(170);
    expect(model.summary).toBe('Lean Build gives you about 2,150 kcal and 170g protein for the day.');
    expect(model.meals).toHaveLength(1);
  });

  it('parses nutrition plan from JSON output text', () => {
    const model = transformPlan({
      output_text: JSON.stringify({
        title: 'Cut Day',
        totalCalories: 1900,
        totalProtein: 160,
        meals: [
          {
            name: 'Lunch',
            timing: '12:00 PM',
            foods: [
              { name: 'Chicken', amount: '6 oz', calories: 280, protein: 48 },
              { name: 'Rice', amount: '1 cup', calories: 210, protein: 4 },
            ],
            totalCalories: 490,
            totalProtein: 52,
          },
        ],
      }),
    });

    expect(model.kind).toBe('nutrition_plan');
    expect(model.title).toBe('Cut Day');
    expect(model.meals[0].foods[0].name).toBe('Chicken');
  });

  it('normalizes missing and null nutrition values', () => {
    const model = transformPlan({
      output_json: {
        plan_type: 'nutrition',
        structured: {
          title: null,
          totalCalories: null,
          totalProtein: null,
          meals: [
            {
              name: null,
              timing: null,
              foods: [
                { name: null, amount: null, calories: null, protein: null },
              ],
              totalCalories: null,
              totalProtein: null,
              notes: null,
            },
          ],
        },
      },
    });

    expect(model.kind).toBe('nutrition_plan');
    expect(model.title).toBe('Nutrition Plan');
    expect(model.meals[0].name).toBe('Meal 1');
    expect(model.meals[0].foods[0].name).toBe('Food 1');
    expect(model.meals[0].foods[0].calories).toBe(0);
    expect(model.calories).toBe(0);
    expect(model.protein).toBe(0);
  });

  it('maps non-nutrition outputs to generic structured model', () => {
    const model = transformPlan({
      output_json: {
        headline: 'Plan updates',
        summary: 'We shifted intensity down 10%.',
        sections: [
          {
            title: 'What changed',
            text: 'Lowered weekly volume.',
            items: ['Swap squat for split squat'],
          },
        ],
      },
      source_type: 'chat',
      action_type: 'adjust_plan',
    });

    expect(model.kind).toBe('generic_structured');
    expect(model.title).toBe('Plan updates');
    expect(model.summary).toContain('shifted intensity');
    expect(model.sections[0].title).toBe('What changed');
  });

  it('parses training plan from structured payload wrapper', () => {
    const model = transformPlan({
      source_type: 'generated_checkin_plan',
      review_status: 'open',
      output_json: {
        plan_type: 'training',
        structured: {
          title: 'Friday Workout',
          durationMinutes: 40,
          difficulty: 'intermediate',
          exercises: [
            {
              name: 'Split squat',
              sets: 3,
              reps: '8 / side',
              rest: '45 sec',
              muscleGroup: 'legs',
            },
          ],
          warmup: [
            {
              name: 'Ramp prep',
              duration: '4 min',
            },
          ],
          cooldown: [
            {
              name: 'Breathing reset',
              duration: '2 min',
            },
          ],
          coachNote: 'Stay smooth.',
        },
      },
    });

    expect(model.kind).toBe('training_plan');
    expect(model.title).toBe('Friday Workout');
    expect(model.durationMinutes).toBe(40);
    expect(model.exercises).toHaveLength(1);
    expect(model.warmup).toHaveLength(1);
    expect(model.cooldown).toHaveLength(1);
  });

  it('parses training plan from JSON output text', () => {
    const model = transformPlan({
      output_text: JSON.stringify({
        title: 'Hotel Session',
        durationMinutes: 25,
        exercises: [
          {
            name: 'Push-up',
            sets: 3,
            reps: '10',
            rest: '45 sec',
            muscleGroup: 'chest',
          },
          {
            name: 'Reverse lunge',
            sets: 3,
            reps: '8 / side',
            rest: '45 sec',
            muscleGroup: 'legs',
          },
        ],
      }),
    });

    expect(model.kind).toBe('training_plan');
    expect(model.title).toBe('Hotel Session');
    expect(model.exercises).toHaveLength(2);
  });

  it('returns fallback model when JSON parsing fails', () => {
    const model = transformPlan({
      output_text: '{"title": "Broken JSON"',
      summary: null,
      headline: null,
    });

    expect(model.kind).toBe('fallback');
    expect(model.message).toBe("We couldn't fully render this plan");
  });

  it('rebuilds JSON from edited nutrition ui state while preserving wrapper shape', () => {
    const originalDraft = {
      output_json: {
        plan_type: 'nutrition',
        structured: {
          title: 'Original',
          totalCalories: 2000,
          totalProtein: 150,
          meals: [],
        },
      },
    };
    const model = transformPlan(originalDraft);
    const edited = {
      ...model,
      title: 'Updated Plan',
      calories: 2250,
      protein: 180,
      meals: [
        {
          id: '1',
          name: 'Meal 1',
          timing: 'AM',
          emoji: '',
          foods: [
            { id: 'f-1', name: 'Oats', amount: '60g', calories: 230, protein: 8 },
          ],
          totalCalories: 230,
          totalProtein: 8,
          notes: 'Pre-workout',
          collapsed: false,
        },
      ],
      notes: 'Keep hydration up.',
    };

    const rebuilt = rebuildJSON(edited, originalDraft);

    expect(rebuilt.editedOutputJson.structured.title).toBe('Updated Plan');
    expect(rebuilt.editedOutputJson.structured.totalCalories).toBe(2250);
    expect(rebuilt.editedOutputJson.structured.totalProtein).toBe(180);
    expect(rebuilt.editedOutputJson.structured.meals[0].foods[0].name).toBe('Oats');
    expect(rebuilt.editedOutputText).toContain('2,250 kcal');
  });

  it('normalizes missing and null training values', () => {
    const model = transformPlan({
      output_json: {
        plan_type: 'training',
        structured: {
          title: null,
          durationMinutes: null,
          difficulty: null,
          exercises: [
            {
              name: null,
              sets: null,
              reps: null,
              rest: null,
              muscleGroup: null,
              description: null,
              coachTip: null,
            },
          ],
        },
      },
    });

    expect(model.kind).toBe('training_plan');
    expect(model.title).toBe('Training Plan');
    expect(model.durationMinutes).toBe(0);
    expect(model.exercises[0].name).toBe('Exercise 1');
    expect(model.exercises[0].sets).toBe(0);
  });

  it('rebuilds JSON from edited training ui state while preserving wrapper shape', () => {
    const originalDraft = {
      output_json: {
        plan_type: 'training',
        structured: {
          title: 'Original Training',
          durationMinutes: 30,
          difficulty: 'intermediate',
          exercises: [],
          warmup: [],
          cooldown: [],
        },
      },
    };
    const model = transformPlan(originalDraft);
    const edited = {
      ...model,
      title: 'Updated Workout',
      durationMinutes: 42,
      difficulty: 'advanced',
      coachNote: 'Stay crisp.',
      exercises: [
        {
          id: 'exercise-1',
          name: 'Goblet squat',
          sets: 4,
          reps: '8',
          rest: '60 sec',
          muscleGroup: 'legs',
          description: 'Controlled lowering.',
          coachTip: 'Brace first.',
        },
      ],
      warmup: [
        {
          id: 'warmup-1',
          name: 'Prep flow',
          duration: '4 min',
          description: '',
        },
      ],
      cooldown: [
        {
          id: 'cooldown-1',
          name: 'Breathing',
          duration: '2 min',
          description: '',
        },
      ],
    };

    const rebuilt = rebuildJSON(edited, originalDraft);

    expect(rebuilt.editedOutputJson.structured.title).toBe('Updated Workout');
    expect(rebuilt.editedOutputJson.structured.durationMinutes).toBe(42);
    expect(rebuilt.editedOutputJson.structured.difficulty).toBe('advanced');
    expect(rebuilt.editedOutputJson.structured.exercises[0].name).toBe('Goblet squat');
    expect(rebuilt.editedOutputText).toContain('1 exercises');
  });

  it('builds regeneration launch context with assistant metadata', () => {
    const model = transformPlan({ output_json: { summary: 'Need rewrite' }, action_type: 'adjust_plan' });
    const context = buildRegenerationLaunchContext(
      {
        client_id: 'client-1',
        client_name: 'Taylor',
        action_type: 'adjust_plan',
      },
      model,
    );

    expect(context.entrypoint).toBe('trainer_assistant_regenerate');
    expect(context.client_id).toBe('client-1');
    expect(context.action_type).toBe('adjust_plan');
    expect(context.regenerate_prompt).toContain('Taylor');
  });
});
