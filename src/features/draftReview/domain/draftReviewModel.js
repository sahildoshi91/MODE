const FALLBACK_RENDER_MESSAGE = "We couldn't fully render this plan";

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return '';
}

function firstRenderableText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) {
      continue;
    }
    if (looksLikeJsonString(text)) {
      continue;
    }
    return text;
  }
  return '';
}

function toPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.round(parsed));
}

export function looksLikeJsonString(value) {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  return text.startsWith('{') || text.startsWith('[');
}

function safeParseJson(value) {
  const text = normalizeText(value);
  if (!looksLikeJsonString(text)) {
    return {
      attempted: false,
      parseFailed: false,
      payload: null,
    };
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return {
        attempted: true,
        parseFailed: false,
        payload: {
          sections: [
            {
              title: 'Items',
              items: parsed.map((item) => normalizeText(item)).filter(Boolean),
            },
          ],
        },
      };
    }
    return {
      attempted: true,
      parseFailed: !isObject(parsed),
      payload: isObject(parsed) ? parsed : null,
    };
  } catch (_error) {
    return {
      attempted: true,
      parseFailed: true,
      payload: null,
    };
  }
}

function resolvePayloadSource(draftLike) {
  if (isObject(draftLike?.reviewed_output_json)) {
    return {
      source: 'reviewed_output_json',
      payload: draftLike.reviewed_output_json,
      parseFailed: false,
    };
  }

  if (isObject(draftLike?.output_json)) {
    return {
      source: 'output_json',
      payload: draftLike.output_json,
      parseFailed: false,
    };
  }

  const reviewedParsed = safeParseJson(draftLike?.reviewed_output_text);
  if (reviewedParsed.attempted) {
    return {
      source: 'reviewed_output_text',
      payload: reviewedParsed.payload,
      parseFailed: reviewedParsed.parseFailed,
    };
  }

  const outputParsed = safeParseJson(draftLike?.output_text);
  if (outputParsed.attempted) {
    return {
      source: 'output_text',
      payload: outputParsed.payload,
      parseFailed: outputParsed.parseFailed,
    };
  }

  return {
    source: null,
    payload: null,
    parseFailed: false,
  };
}

function unwrapStructuredPayload(payload) {
  if (!isObject(payload)) {
    return {
      wrapperType: null,
      outerPayload: {},
      innerPayload: {},
    };
  }

  if (isObject(payload.structured)) {
    return {
      wrapperType: 'structured',
      outerPayload: payload,
      innerPayload: payload.structured,
    };
  }

  return {
    wrapperType: null,
    outerPayload: payload,
    innerPayload: payload,
  };
}

function resolvePlanType(innerPayload, outerPayload = {}) {
  return firstNonEmpty(
    outerPayload?.plan_type,
    innerPayload?.plan_type,
    innerPayload?.type,
  ).toLowerCase();
}

function isNutritionPayload(innerPayload, outerPayload = {}) {
  const normalizedPlanType = resolvePlanType(innerPayload, outerPayload);

  const meals = Array.isArray(innerPayload?.meals)
    ? innerPayload.meals.filter((item) => isObject(item))
    : [];

  if (normalizedPlanType === 'nutrition') {
    return true;
  }

  if (meals.length === 0) {
    return false;
  }

  const hasFoods = meals.some((meal) => Array.isArray(meal.foods) && meal.foods.length > 0);
  const hasMacros = Number.isFinite(Number(innerPayload?.totalCalories))
    || Number.isFinite(Number(innerPayload?.totalProtein))
    || meals.some((meal) => Number.isFinite(Number(meal.totalCalories)) || Number.isFinite(Number(meal.totalProtein)));

  return hasFoods || hasMacros;
}

function isTrainingPayload(innerPayload, outerPayload = {}) {
  const normalizedPlanType = resolvePlanType(innerPayload, outerPayload);
  if (normalizedPlanType === 'training') {
    return true;
  }

  const exercises = Array.isArray(innerPayload?.exercises)
    ? innerPayload.exercises.filter((item) => isObject(item))
    : [];
  if (exercises.length > 0) {
    return true;
  }

  const blocks = Array.isArray(innerPayload?.blocks)
    ? innerPayload.blocks.filter((item) => isObject(item))
    : [];
  if (blocks.length > 0) {
    return true;
  }

  return false;
}

function buildNutritionSummaryText(title, calories, protein) {
  const safeTitle = firstNonEmpty(title, 'Nutrition plan');
  return `${safeTitle} · ${toPositiveInt(calories)} kcal · ${toPositiveInt(protein)}g protein`;
}

function buildTrainingSummaryText(title, exercises, durationMinutes) {
  const safeTitle = firstNonEmpty(title, 'Training plan');
  const exerciseCount = Array.isArray(exercises) ? exercises.length : 0;
  const duration = toPositiveInt(durationMinutes, 0);
  const details = [];
  if (exerciseCount > 0) {
    details.push(`${exerciseCount} exercises`);
  }
  if (duration > 0) {
    details.push(`${duration} min`);
  }
  if (details.length === 0) {
    return `${safeTitle} · Workout ready for review`;
  }
  return `${safeTitle} · ${details.join(' · ')}`;
}

function normalizeFoods(foods) {
  const safeFoods = Array.isArray(foods) ? foods.filter((food) => isObject(food)) : [];
  return safeFoods.map((food, index) => {
    const calories = toPositiveInt(food.calories, 0);
    const protein = toPositiveInt(food.protein, 0);
    return {
      id: firstNonEmpty(food.id, `${index}`),
      name: firstNonEmpty(food.name, `Food ${index + 1}`),
      amount: firstNonEmpty(food.amount),
      calories,
      protein,
    };
  });
}

function normalizeMeals(meals) {
  const safeMeals = Array.isArray(meals) ? meals.filter((meal) => isObject(meal)) : [];
  return safeMeals.map((meal, index) => {
    const foods = normalizeFoods(meal.foods);
    const computedCalories = foods.reduce((total, food) => total + toPositiveInt(food.calories, 0), 0);
    const computedProtein = foods.reduce((total, food) => total + toPositiveInt(food.protein, 0), 0);
    return {
      id: firstNonEmpty(meal.id, `${index}`),
      name: firstNonEmpty(meal.name, `Meal ${index + 1}`),
      timing: firstNonEmpty(meal.timing),
      emoji: firstNonEmpty(meal.emoji),
      foods,
      totalCalories: toPositiveInt(meal.totalCalories, computedCalories),
      totalProtein: toPositiveInt(meal.totalProtein, computedProtein),
      notes: firstNonEmpty(meal.notes),
      collapsed: false,
    };
  });
}

function normalizeTrainingBlockItems(items, fallbackPrefix) {
  const safeItems = Array.isArray(items) ? items.filter((item) => isObject(item)) : [];
  return safeItems.map((item, index) => ({
    id: firstNonEmpty(item.id, `${index}`),
    name: firstNonEmpty(item.name, `${fallbackPrefix} ${index + 1}`),
    duration: firstNonEmpty(item.duration),
    description: firstNonEmpty(item.description),
  }));
}

function normalizeTrainingExercises(exercises) {
  const safeExercises = Array.isArray(exercises) ? exercises.filter((item) => isObject(item)) : [];
  return safeExercises.map((exercise, index) => ({
    id: firstNonEmpty(exercise.id, `${index}`),
    name: firstNonEmpty(exercise.name, `Exercise ${index + 1}`),
    sets: toPositiveInt(exercise.sets, 0),
    reps: firstNonEmpty(exercise.reps),
    rest: firstNonEmpty(exercise.rest),
    muscleGroup: firstNonEmpty(exercise.muscleGroup, exercise.muscle_group),
    description: firstNonEmpty(exercise.description),
    coachTip: firstNonEmpty(exercise.coachTip, exercise.coach_tip),
  }));
}

function safeSummaryFromDraft(draftLike) {
  const reviewed = normalizeText(draftLike?.reviewed_output_text);
  if (reviewed && !looksLikeJsonString(reviewed)) {
    return reviewed;
  }
  const output = normalizeText(draftLike?.output_text);
  if (output && !looksLikeJsonString(output)) {
    return output;
  }
  return '';
}

function buildMetaRows(draftLike, innerPayload) {
  const rows = [];

  const actionType = firstNonEmpty(innerPayload?.action_type, draftLike?.action_type);
  if (actionType) {
    rows.push({ label: 'Action', value: actionType });
  }

  const sourceType = firstNonEmpty(draftLike?.source_type);
  if (sourceType) {
    rows.push({ label: 'Source', value: sourceType });
  }

  const priority = firstNonEmpty(draftLike?.priority_tier);
  if (priority) {
    rows.push({ label: 'Priority', value: priority });
  }

  return rows;
}

function normalizeSections(sections) {
  const safeSections = Array.isArray(sections) ? sections.filter((section) => isObject(section)) : [];
  return safeSections.map((section, index) => {
    const items = Array.isArray(section.items)
      ? section.items.map((item) => normalizeText(item)).filter(Boolean)
      : [];

    return {
      id: firstNonEmpty(section.id, `${index}`),
      title: firstNonEmpty(section.title, `Section ${index + 1}`),
      text: firstNonEmpty(section.text),
      items,
    };
  });
}

function normalizeSectionsFromEditablePayload(editablePayload) {
  if (!isObject(editablePayload)) {
    return [];
  }

  return Object.entries(editablePayload)
    .map(([key, value], index) => {
      if (Array.isArray(value)) {
        const items = value.map((item) => normalizeText(item)).filter(Boolean);
        if (items.length === 0) {
          return null;
        }
        return {
          id: `editable-${index}`,
          title: key.replace(/_/g, ' '),
          text: '',
          items,
        };
      }
      const text = normalizeText(value);
      if (!text) {
        return null;
      }
      return {
        id: `editable-${index}`,
        title: key.replace(/_/g, ' '),
        text,
        items: [],
      };
    })
    .filter(Boolean);
}

function buildFallbackModel(draftLike, payloadSource, reason = 'parse_failed') {
  return {
    kind: 'fallback',
    title: firstRenderableText(draftLike?.headline, draftLike?.summary, 'Draft Preview'),
    summary: firstRenderableText(draftLike?.summary, safeSummaryFromDraft(draftLike), 'Draft unavailable'),
    message: FALLBACK_RENDER_MESSAGE,
    status: firstNonEmpty(draftLike?.review_status, 'open'),
    sourceType: firstNonEmpty(draftLike?.source_type),
    draftMeta: {
      parseSource: payloadSource,
      wrapperType: null,
      reason,
    },
  };
}

export function transformPlan(draftLike) {
  const safeDraft = isObject(draftLike) ? draftLike : {};
  const sourceResult = resolvePayloadSource(safeDraft);

  if (!isObject(sourceResult.payload)) {
    if (sourceResult.parseFailed) {
      return buildFallbackModel(safeDraft, sourceResult.source, 'parse_failed');
    }

    const summary = safeSummaryFromDraft(safeDraft);
    const fallbackTitle = firstRenderableText(safeDraft.headline, safeDraft.summary);
    if (!summary && !fallbackTitle) {
      return buildFallbackModel(safeDraft, sourceResult.source, 'no_renderable_content');
    }

    return {
      kind: 'generic_structured',
      title: firstRenderableText(safeDraft.headline, safeDraft.summary, 'Draft Review'),
      summary: firstRenderableText(safeDraft.summary, summary),
      sections: summary
        ? [{
          id: 'summary',
          title: 'Summary',
          text: summary,
          items: [],
        }]
        : [],
      notes: '',
      meta: buildMetaRows(safeDraft, {}),
      status: firstNonEmpty(safeDraft.review_status, 'open'),
      sourceType: firstNonEmpty(safeDraft.source_type),
      draftMeta: {
        parseSource: sourceResult.source,
        wrapperType: null,
        reason: 'text_only',
      },
    };
  }

  const { wrapperType, outerPayload, innerPayload } = unwrapStructuredPayload(sourceResult.payload);

  if (isNutritionPayload(innerPayload, outerPayload)) {
    const meals = normalizeMeals(innerPayload.meals);
    const computedCalories = meals.reduce((total, meal) => total + toPositiveInt(meal.totalCalories, 0), 0);
    const computedProtein = meals.reduce((total, meal) => total + toPositiveInt(meal.totalProtein, 0), 0);
    const title = firstRenderableText(
      innerPayload.title,
      innerPayload.headline,
      outerPayload.headline,
      safeDraft.headline,
      safeDraft.summary,
      'Nutrition Plan',
    );
    const calories = toPositiveInt(
      innerPayload.totalCalories ?? innerPayload.total_calories ?? innerPayload.calories,
      computedCalories,
    );
    const protein = toPositiveInt(
      innerPayload.totalProtein ?? innerPayload.total_protein ?? innerPayload.protein,
      computedProtein,
    );

    return {
      kind: 'nutrition_plan',
      title,
      calories,
      protein,
      meals,
      notes: firstNonEmpty(innerPayload.coachNote, innerPayload.coach_note, innerPayload.notes),
      summary: buildNutritionSummaryText(title, calories, protein),
      status: firstNonEmpty(safeDraft.review_status, 'open'),
      sourceType: firstNonEmpty(safeDraft.source_type),
      draftMeta: {
        parseSource: sourceResult.source,
        wrapperType,
        reason: 'structured_payload',
      },
    };
  }

  if (isTrainingPayload(innerPayload, outerPayload)) {
    const exercises = normalizeTrainingExercises(innerPayload.exercises);
    const warmup = normalizeTrainingBlockItems(innerPayload.warmup, 'Warm-up');
    const cooldown = normalizeTrainingBlockItems(innerPayload.cooldown, 'Cooldown');
    const title = firstRenderableText(
      innerPayload.title,
      innerPayload.headline,
      outerPayload.headline,
      safeDraft.headline,
      safeDraft.summary,
      'Training Plan',
    );
    const durationMinutes = toPositiveInt(
      innerPayload.durationMinutes ?? innerPayload.duration_minutes,
      0,
    );
    return {
      kind: 'training_plan',
      title,
      durationMinutes,
      difficulty: firstNonEmpty(innerPayload.difficulty),
      type: firstNonEmpty(innerPayload.type),
      description: firstNonEmpty(innerPayload.description),
      coachNote: firstNonEmpty(innerPayload.coachNote, innerPayload.coach_note, innerPayload.notes),
      exercises,
      warmup,
      cooldown,
      summary: buildTrainingSummaryText(title, exercises, durationMinutes),
      status: firstNonEmpty(safeDraft.review_status, 'open'),
      sourceType: firstNonEmpty(safeDraft.source_type),
      draftMeta: {
        parseSource: sourceResult.source,
        wrapperType,
        reason: 'structured_payload',
      },
    };
  }

  const summary = firstRenderableText(
    innerPayload.summary,
    innerPayload.description,
    safeDraft.summary,
    safeSummaryFromDraft(safeDraft),
  );

  let sections = normalizeSections(innerPayload.sections);
  if (sections.length === 0) {
    sections = normalizeSectionsFromEditablePayload(innerPayload.editable_payload);
  }

  return {
    kind: 'generic_structured',
    title: firstRenderableText(innerPayload.headline, innerPayload.title, safeDraft.headline, safeDraft.summary, 'Draft Review'),
    summary,
    sections,
    notes: firstNonEmpty(innerPayload.notes, innerPayload.coachNote, innerPayload.coach_note),
    meta: buildMetaRows(safeDraft, innerPayload),
    status: firstNonEmpty(safeDraft.review_status, 'open'),
    sourceType: firstNonEmpty(safeDraft.source_type),
    draftMeta: {
      parseSource: sourceResult.source,
      wrapperType,
      reason: 'structured_payload',
    },
  };
}

function sanitizeNutritionMeals(meals) {
  const normalizedMeals = normalizeMeals(meals);
  return normalizedMeals.map((meal) => ({
    name: firstNonEmpty(meal.name, 'Meal'),
    timing: firstNonEmpty(meal.timing),
    emoji: firstNonEmpty(meal.emoji),
    foods: normalizeFoods(meal.foods).map((food) => ({
      name: firstNonEmpty(food.name, 'Food item'),
      amount: firstNonEmpty(food.amount),
      calories: toPositiveInt(food.calories, 0),
      protein: toPositiveInt(food.protein, 0),
    })),
    totalCalories: toPositiveInt(meal.totalCalories, 0),
    totalProtein: toPositiveInt(meal.totalProtein, 0),
    notes: firstNonEmpty(meal.notes),
  }));
}

function sanitizeGenericSections(sections) {
  return normalizeSections(sections).map((section) => ({
    title: firstNonEmpty(section.title, 'Section'),
    text: firstNonEmpty(section.text),
    items: Array.isArray(section.items)
      ? section.items.map((item) => normalizeText(item)).filter(Boolean)
      : [],
  }));
}

function sanitizeTrainingExercises(exercises) {
  return normalizeTrainingExercises(exercises).map((exercise) => ({
    name: firstNonEmpty(exercise.name, 'Exercise'),
    sets: toPositiveInt(exercise.sets, 0),
    reps: firstNonEmpty(exercise.reps),
    rest: firstNonEmpty(exercise.rest),
    muscleGroup: firstNonEmpty(exercise.muscleGroup),
    description: firstNonEmpty(exercise.description),
    coachTip: firstNonEmpty(exercise.coachTip),
  }));
}

function sanitizeTrainingBlocks(blocks, fallbackPrefix) {
  return normalizeTrainingBlockItems(blocks, fallbackPrefix).map((block) => ({
    name: firstNonEmpty(block.name, fallbackPrefix),
    duration: firstNonEmpty(block.duration),
    description: firstNonEmpty(block.description),
  }));
}

function resolveBaseJson(draftLike) {
  const sourceResult = resolvePayloadSource(draftLike);
  const payload = isObject(sourceResult.payload) ? sourceResult.payload : {};
  const { wrapperType, outerPayload, innerPayload } = unwrapStructuredPayload(payload);

  return {
    source: sourceResult.source,
    wrapperType,
    outerPayload: isObject(outerPayload) ? { ...outerPayload } : {},
    innerPayload: isObject(innerPayload) ? { ...innerPayload } : {},
  };
}

export function rebuildJSON(uiState, originalDraft) {
  const safeUiState = isObject(uiState) ? uiState : {};
  const safeDraft = isObject(originalDraft) ? originalDraft : {};
  const base = resolveBaseJson(safeDraft);

  if (safeUiState.kind === 'nutrition_plan') {
    const meals = sanitizeNutritionMeals(safeUiState.meals);
    const computedCalories = meals.reduce((total, meal) => total + toPositiveInt(meal.totalCalories, 0), 0);
    const computedProtein = meals.reduce((total, meal) => total + toPositiveInt(meal.totalProtein, 0), 0);
    const title = firstNonEmpty(safeUiState.title, 'Nutrition Plan');
    const totalCalories = toPositiveInt(safeUiState.calories, computedCalories);
    const totalProtein = toPositiveInt(safeUiState.protein, computedProtein);
    const summary = buildNutritionSummaryText(title, totalCalories, totalProtein);

    const nextInnerPayload = {
      ...base.innerPayload,
      title,
      headline: title,
      summary,
      totalCalories,
      totalProtein,
      meals,
      coachNote: firstNonEmpty(safeUiState.notes),
    };

    const editedOutputJson = base.wrapperType === 'structured'
      ? {
        ...base.outerPayload,
        headline: title,
        summary,
        structured: nextInnerPayload,
      }
      : {
        ...base.outerPayload,
        ...nextInnerPayload,
      };

    return {
      editedOutputJson,
      editedOutputText: summary,
    };
  }

  if (safeUiState.kind === 'generic_structured') {
    const title = firstNonEmpty(safeUiState.title, safeDraft.headline, safeDraft.summary, 'Draft Review');
    const summary = firstNonEmpty(safeUiState.summary, safeDraft.summary, safeSummaryFromDraft(safeDraft), title);
    const sections = sanitizeGenericSections(safeUiState.sections);
    const notes = firstNonEmpty(safeUiState.notes);

    const nextInnerPayload = {
      ...base.innerPayload,
      title,
      headline: title,
      summary,
      sections,
      notes,
      coachNote: notes,
    };

    const editedOutputJson = base.wrapperType === 'structured'
      ? {
        ...base.outerPayload,
        headline: title,
        summary,
        structured: nextInnerPayload,
      }
      : {
        ...base.outerPayload,
        ...nextInnerPayload,
      };

    return {
      editedOutputJson,
      editedOutputText: summary,
    };
  }

  if (safeUiState.kind === 'training_plan') {
    const exercises = sanitizeTrainingExercises(safeUiState.exercises);
    const warmup = sanitizeTrainingBlocks(safeUiState.warmup, 'Warm-up');
    const cooldown = sanitizeTrainingBlocks(safeUiState.cooldown, 'Cooldown');
    const title = firstNonEmpty(safeUiState.title, base.innerPayload?.title, 'Training Plan');
    const durationMinutes = toPositiveInt(safeUiState.durationMinutes, toPositiveInt(base.innerPayload?.durationMinutes, 0));
    const summary = buildTrainingSummaryText(title, exercises, durationMinutes);

    const nextInnerPayload = {
      ...base.innerPayload,
      title,
      headline: title,
      summary,
      durationMinutes,
      difficulty: firstNonEmpty(safeUiState.difficulty),
      type: firstNonEmpty(safeUiState.type),
      description: firstNonEmpty(safeUiState.description),
      coachNote: firstNonEmpty(safeUiState.coachNote),
      exercises,
      warmup,
      cooldown,
    };

    const editedOutputJson = base.wrapperType === 'structured'
      ? {
        ...base.outerPayload,
        headline: title,
        summary,
        structured: nextInnerPayload,
      }
      : {
        ...base.outerPayload,
        ...nextInnerPayload,
      };

    return {
      editedOutputJson,
      editedOutputText: summary,
    };
  }

  const fallbackSummary = firstRenderableText(
    safeUiState.summary,
    safeDraft.summary,
    safeSummaryFromDraft(safeDraft),
    'Draft requires regeneration.',
  );

  return {
    editedOutputJson: base.wrapperType === 'structured'
      ? { ...base.outerPayload, structured: base.innerPayload }
      : base.outerPayload,
    editedOutputText: fallbackSummary,
  };
}

export function inferAssistantActionType(actionType, model = null) {
  const normalizedAction = normalizeText(actionType).toLowerCase();
  if (['build_program', 'adjust_plan', 'analyze_client', 'message_client'].includes(normalizedAction)) {
    return normalizedAction;
  }
  if (model?.kind === 'nutrition_plan' || model?.kind === 'training_plan') {
    return 'adjust_plan';
  }
  return 'analyze_client';
}

export function buildRegenerationPrompt(draftLike, model = null) {
  const clientName = firstNonEmpty(draftLike?.client_name, 'this client');
  if (model?.kind === 'nutrition_plan') {
    return `Regenerate a nutrition plan for ${clientName} using clean structured fields: title, totalCalories, totalProtein, meals (name, timing, foods with amount/calories/protein, totals, notes). Keep it practical and coach-ready.`;
  }
  if (model?.kind === 'training_plan') {
    return `Regenerate a training plan for ${clientName} using clean structured fields: title, durationMinutes, difficulty, type, exercises (name, sets, reps, rest, muscleGroup, description, coachTip), plus warmup/cooldown blocks and coachNote. Keep it practical and coach-ready.`;
  }
  return `Regenerate this draft for ${clientName} in a clean structured format with title, summary, and sections that are easy to review and edit.`;
}

export function buildRegenerationLaunchContext(draftLike, model = null) {
  return {
    entrypoint: 'trainer_assistant_regenerate',
    client_id: firstNonEmpty(draftLike?.client_id) || null,
    action_type: inferAssistantActionType(draftLike?.action_type, model),
    regenerate_prompt: buildRegenerationPrompt(draftLike, model),
  };
}

export { FALLBACK_RENDER_MESSAGE };
