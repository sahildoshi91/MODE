import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import {
  ModeButton,
  ModeCard,
  ModeChip,
  ModeInput,
  ModeText,
  ProgressBar,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const ACCORDION_LAYOUT_ANIMATION = {
  duration: 220,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.spring,
    springDamping: 0.85,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

function runAccordionAnimation() {
  if (typeof LayoutAnimation?.configureNext !== 'function') {
    return;
  }
  LayoutAnimation.configureNext(ACCORDION_LAYOUT_ANIMATION);
}

if (Platform.OS === 'android' && typeof UIManager?.setLayoutAnimationEnabledExperimental === 'function') {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function toPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.round(parsed));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function labelCase(value) {
  const text = normalizeText(value);
  if (!text) {
    return 'Open';
  }
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function withUpdatedArrayItem(items, index, nextValue) {
  return (Array.isArray(items) ? items : []).map((item, itemIndex) => (
    itemIndex === index ? nextValue : item
  ));
}

function resolveMealEditKey(meal, mealIndex) {
  const mealId = normalizeText(meal?.id);
  return mealId || `meal-${mealIndex}`;
}

function resolveFoodEditKey(food, foodIndex) {
  const foodId = normalizeText(food?.id);
  return foodId || `food-${foodIndex}`;
}

function resolveExerciseEditKey(exercise, exerciseIndex) {
  const exerciseId = normalizeText(exercise?.id);
  return exerciseId || `exercise-${exerciseIndex}`;
}

function resolveSectionEditKey(section, sectionIndex) {
  const sectionId = normalizeText(section?.id);
  return sectionId || `section-${sectionIndex}`;
}

function InlineValueLabel({
  label,
  value,
  testID,
}) {
  if (!normalizeText(value)) {
    return null;
  }
  return (
    <ModeText testID={testID} variant="caption" tone="tertiary" style={styles.valueLabel}>
      {label}
    </ModeText>
  );
}

function NutritionMacrosRow({ calories, protein }) {
  return (
    <View style={styles.mealMacroRow}>
      <ModeText variant="caption" tone="secondary">Calories: {toPositiveInt(calories, 0)}</ModeText>
      <ModeText variant="caption" tone="secondary">Protein: {toPositiveInt(protein, 0)}g</ModeText>
    </View>
  );
}

function CompactNutritionFoodRow({
  food,
  foodIndex,
  isEditing,
  isExpanded,
  mealIndex,
  onToggle,
  onFoodChange,
  onRemove,
  testIDPrefix,
}) {
  return (
    <View style={styles.compactRowContainer}>
      <Pressable
        testID={`${testIDPrefix}-food-row-${mealIndex}-${foodIndex}`}
        onPress={isEditing ? onToggle : undefined}
        style={({ pressed }) => [
          styles.compactRowPressable,
          pressed && styles.compactRowPressed,
        ]}
        accessibilityRole={isEditing ? 'button' : undefined}
        accessibilityLabel={isEditing ? `Edit ${food.name || `food ${foodIndex + 1}`}` : undefined}
      >
        <View style={styles.compactRowTextWrap}>
          <ModeText variant="bodySm" style={styles.compactRowTitle}>
            {food.name || `Food ${foodIndex + 1}`}
          </ModeText>
          {food.amount ? (
            <ModeText variant="caption" tone="secondary" style={styles.compactRowSubtitle}>
              {food.amount}
            </ModeText>
          ) : null}
        </View>
        <View style={styles.compactRowRightWrap}>
          <ModeText variant="caption" tone="secondary" style={styles.compactRowMetric}>
            {`${toPositiveInt(food.calories, 0)} cal | ${toPositiveInt(food.protein, 0)}g P`}
          </ModeText>
          {isEditing ? (
            <Feather
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={theme.colors.text.secondary}
            />
          ) : null}
        </View>
      </Pressable>

      {isEditing && isExpanded ? (
        <View style={styles.compactRowExpanded}>
          <View style={styles.expandedRowAction}>
            <Pressable
              onPress={onRemove}
              testID={`${testIDPrefix}-food-remove-${mealIndex}-${foodIndex}`}
              style={({ pressed }) => [
                styles.foodRemoveIconButton,
                pressed && styles.foodRemoveIconButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${food.name || 'food'} row`}
            >
              <Feather name="x" size={13} color={theme.colors.text.secondary} />
            </Pressable>
          </View>
          <View style={styles.fieldWithLabelWrap}>
            <ModeInput
              value={food.name}
              onChangeText={(value) => onFoodChange({ ...food, name: value })}
              placeholder="Food name"
              style={styles.labeledInput}
              testID={`${testIDPrefix}-food-name-${mealIndex}-${foodIndex}`}
            />
            <InlineValueLabel
              label="Food name"
              value={food.name}
              testID={`${testIDPrefix}-value-label-food-name-${mealIndex}-${foodIndex}`}
            />
          </View>
          <View style={styles.fieldWithLabelWrap}>
            <ModeInput
              value={food.amount}
              onChangeText={(value) => onFoodChange({ ...food, amount: value })}
              placeholder="Amount"
              style={styles.labeledInput}
              testID={`${testIDPrefix}-food-amount-${mealIndex}-${foodIndex}`}
            />
            <InlineValueLabel
              label="Food amount"
              value={food.amount}
              testID={`${testIDPrefix}-value-label-food-amount-${mealIndex}-${foodIndex}`}
            />
          </View>
          <View style={styles.inlineMacroInputs}>
            <View style={styles.inlineFieldWithLabelWrap}>
              <ModeInput
                value={String(food.calories ?? '')}
                onChangeText={(value) => onFoodChange({ ...food, calories: toPositiveInt(value, 0) })}
                placeholder="Calories"
                keyboardType="numeric"
                style={[styles.inlineMacroInput, styles.labeledInput]}
                onBlur={() => onFoodChange({ ...food, calories: toPositiveInt(food.calories, 0) })}
                testID={`${testIDPrefix}-food-calories-${mealIndex}-${foodIndex}`}
              />
              <InlineValueLabel
                label="Food calories"
                value={String(food.calories ?? '')}
                testID={`${testIDPrefix}-value-label-food-calories-${mealIndex}-${foodIndex}`}
              />
            </View>
            <View style={styles.inlineFieldWithLabelWrap}>
              <ModeInput
                value={String(food.protein ?? '')}
                onChangeText={(value) => onFoodChange({ ...food, protein: toPositiveInt(value, 0) })}
                placeholder="Protein"
                keyboardType="numeric"
                style={[styles.inlineMacroInput, styles.labeledInput]}
                onBlur={() => onFoodChange({ ...food, protein: toPositiveInt(food.protein, 0) })}
                testID={`${testIDPrefix}-food-protein-${mealIndex}-${foodIndex}`}
              />
              <InlineValueLabel
                label="Food protein"
                value={String(food.protein ?? '')}
                testID={`${testIDPrefix}-value-label-food-protein-${mealIndex}-${foodIndex}`}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
const MemoizedCompactNutritionFoodRow = React.memo(CompactNutritionFoodRow);

function NutritionMealCard({
  meal,
  mealIndex,
  isMealEditing,
  onStartEditing,
  onToggleCollapse,
  onMealChange,
  onAddFood,
  onRemoveFood,
  onRemoveMeal,
  onSaveMeal,
  testIDPrefix,
}) {
  const [activeFoodEditKey, setActiveFoodEditKey] = useState(null);
  const [isAddFoodSheetOpen, setIsAddFoodSheetOpen] = useState(false);
  const [pendingFoodName, setPendingFoodName] = useState('');
  const [pendingFoodAmount, setPendingFoodAmount] = useState('');

  useEffect(() => {
    if (isMealEditing) {
      return;
    }
    setActiveFoodEditKey(null);
    setIsAddFoodSheetOpen(false);
    setPendingFoodName('');
    setPendingFoodAmount('');
  }, [isMealEditing]);

  const foods = Array.isArray(meal.foods) ? meal.foods : [];

  return (
    <ModeCard
      variant="surface"
      style={styles.mealCard}
      onPress={isMealEditing ? undefined : onStartEditing}
      testID={`${testIDPrefix}-meal-card-${mealIndex}`}
    >
      <View style={styles.mealHeaderRow}>
        <View style={styles.mealHeaderTextWrap}>
          <ModeText variant="body" style={styles.mealTitleText}>
            {`${meal.emoji ? `${meal.emoji} ` : ''}${meal.name || `Meal ${mealIndex + 1}`}`}
          </ModeText>
          <ModeText variant="caption" tone="secondary">{meal.timing || 'Timing TBD'}</ModeText>
        </View>
        <View style={styles.mealHeaderActionRow}>
          <Pressable
            testID={`${testIDPrefix}-meal-collapse-${mealIndex}`}
            onPress={(event) => {
              event?.stopPropagation?.();
              onToggleCollapse();
            }}
            style={({ pressed }) => [
              styles.mealHeaderIconButton,
              pressed && styles.mealHeaderIconButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={meal.collapsed ? 'Expand meal' : 'Collapse meal'}
          >
            <Feather
              name={meal.collapsed ? 'chevron-down' : 'chevron-up'}
              size={16}
              color={theme.colors.text.secondary}
            />
          </Pressable>
        </View>
      </View>

      {!meal.collapsed ? (
        <>
          {isMealEditing ? (
            <>
              <View style={styles.fieldWithLabelWrap}>
                <ModeInput
                  value={meal.name}
                  onChangeText={(value) => onMealChange({ ...meal, name: value })}
                  placeholder="Meal name"
                  style={styles.labeledInput}
                  testID={`${testIDPrefix}-meal-name-${mealIndex}`}
                />
                <InlineValueLabel
                  label="Meal name"
                  value={meal.name}
                  testID={`${testIDPrefix}-value-label-meal-name-${mealIndex}`}
                />
              </View>
              <View style={styles.fieldWithLabelWrap}>
                <ModeInput
                  value={meal.timing}
                  onChangeText={(value) => onMealChange({ ...meal, timing: value })}
                  placeholder="Timing"
                  style={styles.labeledInput}
                  testID={`${testIDPrefix}-meal-timing-${mealIndex}`}
                />
                <InlineValueLabel
                  label="Meal timing"
                  value={meal.timing}
                  testID={`${testIDPrefix}-value-label-meal-timing-${mealIndex}`}
                />
              </View>
              <View style={styles.inlineMacroInputs}>
                <View style={styles.inlineFieldWithLabelWrap}>
                  <ModeInput
                    value={String(meal.totalCalories ?? '')}
                    onChangeText={(value) => onMealChange({ ...meal, totalCalories: toPositiveInt(value, 0) })}
                    placeholder="Meal calories"
                    keyboardType="numeric"
                    style={[styles.inlineMacroInput, styles.labeledInput]}
                    testID={`${testIDPrefix}-meal-calories-${mealIndex}`}
                  />
                  <InlineValueLabel
                    label="Meal calories"
                    value={String(meal.totalCalories ?? '')}
                    testID={`${testIDPrefix}-value-label-meal-calories-${mealIndex}`}
                  />
                </View>
                <View style={styles.inlineFieldWithLabelWrap}>
                  <ModeInput
                    value={String(meal.totalProtein ?? '')}
                    onChangeText={(value) => onMealChange({ ...meal, totalProtein: toPositiveInt(value, 0) })}
                    placeholder="Meal protein"
                    keyboardType="numeric"
                    style={[styles.inlineMacroInput, styles.labeledInput]}
                    testID={`${testIDPrefix}-meal-protein-${mealIndex}`}
                  />
                  <InlineValueLabel
                    label="Meal protein"
                    value={String(meal.totalProtein ?? '')}
                    testID={`${testIDPrefix}-value-label-meal-protein-${mealIndex}`}
                  />
                </View>
              </View>
            </>
          ) : null}

          <View style={styles.compactList}>
            <View style={styles.compactStickyHeader}>
              <ModeText variant="caption" tone="secondary">
                {`${toPositiveInt(meal.totalCalories, 0)} cal | ${toPositiveInt(meal.totalProtein, 0)}g protein`}
              </ModeText>
            </View>
            {foods.map((food, foodIndex) => {
              const foodEditKey = resolveFoodEditKey(food, foodIndex);
              return (
                <React.Fragment key={foodEditKey}>
                  {foodIndex > 0 ? <View style={styles.compactRowSeparator} /> : null}
                  <MemoizedCompactNutritionFoodRow
                    food={food}
                    foodIndex={foodIndex}
                    isEditing={isMealEditing}
                    isExpanded={activeFoodEditKey === foodEditKey}
                    mealIndex={mealIndex}
                    onToggle={() => {
                      if (!isMealEditing) {
                        return;
                      }
                      runAccordionAnimation();
                      setActiveFoodEditKey((current) => (current === foodEditKey ? null : foodEditKey));
                    }}
                    onFoodChange={(nextFood) => {
                      const nextFoods = withUpdatedArrayItem(meal.foods, foodIndex, nextFood);
                      onMealChange({ ...meal, foods: nextFoods });
                    }}
                    onRemove={() => {
                      runAccordionAnimation();
                      const nextFoods = foods.filter((_, index) => index !== foodIndex);
                      onRemoveFood(nextFoods);
                      if (activeFoodEditKey === foodEditKey) {
                        setActiveFoodEditKey(null);
                      }
                    }}
                    testIDPrefix={testIDPrefix}
                  />
                </React.Fragment>
              );
            })}
          </View>

          {isMealEditing ? (
            <View style={styles.mealEditActionRow}>
              <ModeButton
                title="+ Add Food"
                variant="secondary"
                size="sm"
                onPress={() => setIsAddFoodSheetOpen(true)}
                testID={`${testIDPrefix}-food-add-open-${mealIndex}`}
              />
              <ModeButton
                title="Done"
                variant="secondary"
                size="sm"
                onPress={onSaveMeal}
                testID={`${testIDPrefix}-meal-save-${mealIndex}`}
              />
            </View>
          ) : null}

          <NutritionMacrosRow calories={meal.totalCalories} protein={meal.totalProtein} />

          {isMealEditing ? (
            <View style={styles.fieldWithLabelWrap}>
              <ModeInput
                value={meal.notes}
                onChangeText={(value) => onMealChange({ ...meal, notes: value })}
                placeholder="Meal notes"
                multiline
                style={[styles.notesInput, styles.labeledInput]}
                testID={`${testIDPrefix}-meal-notes-${mealIndex}`}
              />
              <InlineValueLabel
                label="Meal notes"
                value={meal.notes}
                testID={`${testIDPrefix}-value-label-meal-notes-${mealIndex}`}
              />
            </View>
          ) : (
            meal.notes ? <ModeText variant="caption" tone="tertiary" style={styles.mealNotes}>{meal.notes}</ModeText> : null
          )}

          {isMealEditing ? (
            <ModeButton
              title="Remove Meal"
              variant="destructive"
              size="sm"
              onPress={onRemoveMeal}
            />
          ) : null}
        </>
      ) : null}

      <Modal
        visible={isAddFoodSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsAddFoodSheetOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setIsAddFoodSheetOpen(false)} />
          <ModeCard variant="surface" style={styles.sheetCard}>
            <ModeText variant="h3">Add Food</ModeText>
            <ModeInput
              value={pendingFoodName}
              onChangeText={setPendingFoodName}
              placeholder="Food name"
              style={styles.labeledInput}
              testID={`${testIDPrefix}-food-add-name-${mealIndex}`}
            />
            <ModeInput
              value={pendingFoodAmount}
              onChangeText={setPendingFoodAmount}
              placeholder="Amount"
              style={styles.labeledInput}
              testID={`${testIDPrefix}-food-add-amount-${mealIndex}`}
            />
            <View style={styles.sheetActionRow}>
              <ModeButton
                title="Cancel"
                size="sm"
                variant="ghost"
                onPress={() => setIsAddFoodSheetOpen(false)}
              />
              <ModeButton
                title="Add Food"
                size="sm"
                disabled={!normalizeText(pendingFoodName)}
                onPress={() => {
                  const createdFoodId = onAddFood(
                    normalizeText(pendingFoodName),
                    normalizeText(pendingFoodAmount),
                  );
                  setPendingFoodName('');
                  setPendingFoodAmount('');
                  setIsAddFoodSheetOpen(false);
                  if (createdFoodId) {
                    setActiveFoodEditKey(createdFoodId);
                  }
                }}
                testID={`${testIDPrefix}-food-add-confirm-${mealIndex}`}
              />
            </View>
          </ModeCard>
        </View>
      </Modal>
    </ModeCard>
  );
}

function CompactTrainingExerciseRow({
  exercise,
  exerciseIndex,
  isEditing,
  isExpanded,
  onToggle,
  onExerciseChange,
  onRemove,
  onSave,
  testIDPrefix,
}) {
  return (
    <View style={styles.compactRowContainer}>
      <Pressable
        testID={`${testIDPrefix}-exercise-row-${exerciseIndex}`}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.compactRowPressable,
          pressed && styles.compactRowPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${exercise.name || `exercise ${exerciseIndex + 1}`}`}
      >
        <View style={styles.compactRowTextWrap}>
          <ModeText variant="bodySm" style={styles.compactRowTitle}>
            {exercise.name || `Exercise ${exerciseIndex + 1}`}
          </ModeText>
          {exercise.muscleGroup ? (
            <ModeText variant="caption" tone="secondary" style={styles.compactRowSubtitle}>
              {exercise.muscleGroup}
            </ModeText>
          ) : null}
        </View>
        <View style={styles.compactRowRightWrap}>
          <ModeText variant="caption" tone="secondary" style={styles.compactRowMetric}>
            {`${toPositiveInt(exercise.sets, 0)}x${exercise.reps || '-'} | ${exercise.rest || '-'}`}
          </ModeText>
          <Feather
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={15}
            color={theme.colors.text.secondary}
          />
        </View>
      </Pressable>

      {isEditing && isExpanded ? (
        <View style={styles.compactRowExpanded}>
          <View style={styles.expandedRowAction}>
            <Pressable
              onPress={onRemove}
              testID={`${testIDPrefix}-exercise-remove-${exerciseIndex}`}
              style={({ pressed }) => [
                styles.foodRemoveIconButton,
                pressed && styles.foodRemoveIconButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${exercise.name || 'exercise'} row`}
            >
              <Feather name="x" size={13} color={theme.colors.text.secondary} />
            </Pressable>
          </View>
          <View style={styles.fieldWithLabelWrap}>
            <ModeInput
              value={exercise.name}
              onChangeText={(value) => onExerciseChange({ ...exercise, name: value })}
              placeholder="Exercise name"
              style={styles.labeledInput}
              testID={`${testIDPrefix}-exercise-name-${exerciseIndex}`}
            />
          </View>
          <View style={styles.fieldWithLabelWrap}>
            <ModeInput
              value={exercise.muscleGroup}
              onChangeText={(value) => onExerciseChange({ ...exercise, muscleGroup: value })}
              placeholder="Muscle group"
              style={styles.labeledInput}
              testID={`${testIDPrefix}-exercise-muscle-group-${exerciseIndex}`}
            />
          </View>
          <View style={styles.inlineMacroInputs}>
            <View style={styles.inlineFieldWithLabelWrap}>
              <ModeInput
                value={String(exercise.sets ?? '')}
                onChangeText={(value) => onExerciseChange({ ...exercise, sets: toPositiveInt(value, 0) })}
                onBlur={() => onExerciseChange({ ...exercise, sets: toPositiveInt(exercise.sets, 0) })}
                placeholder="Sets"
                keyboardType="numeric"
                style={[styles.inlineMacroInput, styles.labeledInput]}
                testID={`${testIDPrefix}-exercise-sets-${exerciseIndex}`}
              />
            </View>
            <View style={styles.inlineFieldWithLabelWrap}>
              <ModeInput
                value={exercise.reps}
                onChangeText={(value) => onExerciseChange({ ...exercise, reps: value })}
                onBlur={() => onExerciseChange({ ...exercise, reps: normalizeText(exercise.reps) })}
                placeholder="Reps"
                style={[styles.inlineMacroInput, styles.labeledInput]}
                testID={`${testIDPrefix}-exercise-reps-${exerciseIndex}`}
              />
            </View>
            <View style={styles.inlineFieldWithLabelWrap}>
              <ModeInput
                value={exercise.rest}
                onChangeText={(value) => onExerciseChange({ ...exercise, rest: value })}
                onBlur={() => onExerciseChange({ ...exercise, rest: normalizeText(exercise.rest) })}
                placeholder="Rest"
                style={[styles.inlineMacroInput, styles.labeledInput]}
                testID={`${testIDPrefix}-exercise-rest-${exerciseIndex}`}
              />
            </View>
          </View>
          <View style={styles.fieldWithLabelWrap}>
            <ModeInput
              value={exercise.description}
              onChangeText={(value) => onExerciseChange({ ...exercise, description: value })}
              placeholder="Exercise description"
              multiline
              style={[styles.notesInput, styles.labeledInput]}
              testID={`${testIDPrefix}-exercise-description-${exerciseIndex}`}
            />
          </View>
          <View style={styles.fieldWithLabelWrap}>
            <ModeInput
              value={exercise.coachTip}
              onChangeText={(value) => onExerciseChange({ ...exercise, coachTip: value })}
              placeholder="Coach tip"
              multiline
              style={[styles.notesInput, styles.labeledInput]}
              testID={`${testIDPrefix}-exercise-tip-${exerciseIndex}`}
            />
          </View>
          <ModeButton
            title="Done"
            variant="secondary"
            size="sm"
            onPress={onSave}
            testID={`${testIDPrefix}-exercise-save-${exerciseIndex}`}
          />
        </View>
      ) : null}
    </View>
  );
}
const MemoizedCompactTrainingExerciseRow = React.memo(CompactTrainingExerciseRow);

function TrainingPlanEditor({
  model,
  onModelChange,
  testIDPrefix,
}) {
  const [activeExerciseEditKey, setActiveExerciseEditKey] = useState(null);

  const exercises = useMemo(
    () => (Array.isArray(model.exercises) ? model.exercises : []),
    [model.exercises],
  );
  const exerciseCount = exercises.length;
  const durationMinutes = toPositiveInt(model.durationMinutes, 0);
  const durationText = durationMinutes > 0 ? `${durationMinutes} min` : 'Duration TBD';
  const difficultyText = normalizeText(model.difficulty) || 'Difficulty TBD';

  useEffect(() => {
    if (!activeExerciseEditKey) {
      return;
    }
    const keys = exercises.map((exercise, index) => resolveExerciseEditKey(exercise, index));
    if (!keys.includes(activeExerciseEditKey)) {
      setActiveExerciseEditKey(null);
    }
  }, [activeExerciseEditKey, exercises]);

  return (
    <>
      <View style={styles.trainingSummaryRow}>
        <ModeChip label={`${exerciseCount} exercises`} selected={false} />
        <ModeChip label={durationText} selected={false} />
        <ModeChip label={difficultyText} selected={false} />
      </View>

      <View style={styles.compactList}>
        <View style={styles.compactStickyHeader}>
          <ModeText variant="caption" tone="secondary">
            {`${exerciseCount} exercises | ${durationText} | ${difficultyText}`}
          </ModeText>
        </View>
        {exercises.map((exercise, exerciseIndex) => {
          const exerciseEditKey = resolveExerciseEditKey(exercise, exerciseIndex);
          const isExerciseEditing = activeExerciseEditKey === exerciseEditKey;
          return (
            <React.Fragment key={exerciseEditKey}>
              {exerciseIndex > 0 ? <View style={styles.compactRowSeparator} /> : null}
              <MemoizedCompactTrainingExerciseRow
                exercise={exercise}
                exerciseIndex={exerciseIndex}
                isEditing={isExerciseEditing}
                isExpanded={isExerciseEditing}
                onToggle={() => {
                  runAccordionAnimation();
                  setActiveExerciseEditKey(exerciseEditKey);
                }}
                onExerciseChange={(nextExercise) => {
                  const nextExercises = withUpdatedArrayItem(exercises, exerciseIndex, nextExercise);
                  onModelChange({ ...model, exercises: nextExercises });
                }}
                onRemove={() => {
                  runAccordionAnimation();
                  const nextExercises = exercises.filter((_, index) => index !== exerciseIndex);
                  onModelChange({ ...model, exercises: nextExercises });
                  if (activeExerciseEditKey === exerciseEditKey) {
                    setActiveExerciseEditKey(null);
                  }
                }}
                onSave={() => {
                  if (activeExerciseEditKey === exerciseEditKey) {
                    setActiveExerciseEditKey(null);
                  }
                }}
                testIDPrefix={testIDPrefix}
              />
            </React.Fragment>
          );
        })}
      </View>

      <View style={styles.trainingBlockWrap}>
        <ModeText variant="caption" tone="secondary">Warm-up</ModeText>
        {(Array.isArray(model.warmup) ? model.warmup : []).map((item, index) => (
          <View key={`warmup-${index}`} style={styles.trainingReadOnlyRow}>
            <ModeText variant="bodySm">{item.name || `Warm-up ${index + 1}`}</ModeText>
            <ModeText variant="caption" tone="secondary">
              {[item.duration, item.description].filter(Boolean).join(' · ') || 'Details pending'}
            </ModeText>
          </View>
        ))}
      </View>

      <View style={styles.trainingBlockWrap}>
        <ModeText variant="caption" tone="secondary">Cool-down</ModeText>
        {(Array.isArray(model.cooldown) ? model.cooldown : []).map((item, index) => (
          <View key={`cooldown-${index}`} style={styles.trainingReadOnlyRow}>
            <ModeText variant="bodySm">{item.name || `Cool-down ${index + 1}`}</ModeText>
            <ModeText variant="caption" tone="secondary">
              {[item.duration, item.description].filter(Boolean).join(' · ') || 'Details pending'}
            </ModeText>
          </View>
        ))}
      </View>
    </>
  );
}

function GenericSectionCard({
  section,
  sectionIndex,
  isEditing,
  onStartEditing,
  onSectionChange,
  onRemoveSection,
  onSaveSection,
  testIDPrefix,
}) {
  if (!isEditing) {
    return (
      <ModeCard
        variant="surface"
        style={styles.genericSectionCard}
        onPress={onStartEditing}
        testID={`${testIDPrefix}-generic-section-${sectionIndex}`}
      >
        <ModeText variant="bodySm" style={styles.genericSectionTitle}>{section.title}</ModeText>
        {section.text ? (
          <ModeText variant="bodySm" tone="secondary">{section.text}</ModeText>
        ) : null}
        {Array.isArray(section.items) && section.items.length > 0 ? (
          <View style={styles.genericItemsList}>
            {section.items.map((item, itemIndex) => (
              <ModeText key={`${sectionIndex}-item-${itemIndex}`} variant="caption" tone="secondary">
                {`\u2022 ${item}`}
              </ModeText>
            ))}
          </View>
        ) : null}
      </ModeCard>
    );
  }

  return (
    <ModeCard
      variant="surface"
      style={styles.genericSectionCard}
      testID={`${testIDPrefix}-generic-section-editor-${sectionIndex}`}
    >
      <View style={styles.fieldWithLabelWrap}>
        <ModeInput
          value={section.title}
          onChangeText={(value) => onSectionChange({ ...section, title: value })}
          placeholder="Section title"
          style={styles.labeledInput}
          testID={`${testIDPrefix}-generic-section-title-${sectionIndex}`}
        />
        <InlineValueLabel
          label="Section title"
          value={section.title}
          testID={`${testIDPrefix}-generic-section-title-label-${sectionIndex}`}
        />
      </View>
      <View style={styles.fieldWithLabelWrap}>
        <ModeInput
          value={section.text}
          onChangeText={(value) => onSectionChange({ ...section, text: value })}
          placeholder="Section text"
          multiline
          style={[styles.notesInput, styles.labeledInput]}
          testID={`${testIDPrefix}-generic-section-text-${sectionIndex}`}
        />
        <InlineValueLabel
          label="Section text"
          value={section.text}
          testID={`${testIDPrefix}-generic-section-text-label-${sectionIndex}`}
        />
      </View>
      <View style={styles.fieldWithLabelWrap}>
        <ModeInput
          value={Array.isArray(section.items) ? section.items.join('\n') : ''}
          onChangeText={(value) => onSectionChange({
            ...section,
            items: value.split('\n').map((item) => item.trim()).filter(Boolean),
          })}
          placeholder="Section bullet items (one per line)"
          multiline
          style={[styles.notesInput, styles.labeledInput]}
          testID={`${testIDPrefix}-generic-section-items-${sectionIndex}`}
        />
        <InlineValueLabel
          label="Section items"
          value={Array.isArray(section.items) ? section.items.join('\n') : ''}
          testID={`${testIDPrefix}-generic-section-items-label-${sectionIndex}`}
        />
      </View>
      <ModeButton
        title="Done"
        variant="secondary"
        size="sm"
        onPress={onSaveSection}
        testID={`${testIDPrefix}-generic-section-save-${sectionIndex}`}
      />
      <ModeButton
        title="Remove Section"
        variant="destructive"
        size="sm"
        onPress={onRemoveSection}
      />
    </ModeCard>
  );
}

export default function DraftReviewStructuredCard({
  model,
  onModelChange,
  modelKey,
  onRetryRender,
  onRegeneratePlan,
  testIDPrefix = 'draft-review',
}) {
  const [activeMealEditKey, setActiveMealEditKey] = useState(null);
  const [activeGenericSectionEditKey, setActiveGenericSectionEditKey] = useState(null);

  useEffect(() => {
    setActiveMealEditKey(null);
    setActiveGenericSectionEditKey(null);
  }, [modelKey]);

  const safeModel = model && typeof model === 'object' ? model : null;

  const nutritionTotals = useMemo(() => {
    if (!safeModel || safeModel.kind !== 'nutrition_plan') {
      return { mealCalories: 0, mealProtein: 0, calorieProgress: 0, proteinProgress: 0 };
    }
    const mealCalories = (Array.isArray(safeModel.meals) ? safeModel.meals : [])
      .reduce((total, meal) => total + toPositiveInt(meal.totalCalories, 0), 0);
    const mealProtein = (Array.isArray(safeModel.meals) ? safeModel.meals : [])
      .reduce((total, meal) => total + toPositiveInt(meal.totalProtein, 0), 0);
    const calorieTarget = toPositiveInt(safeModel.calories, 0);
    const proteinTarget = toPositiveInt(safeModel.protein, 0);

    return {
      mealCalories,
      mealProtein,
      calorieProgress: calorieTarget > 0 ? Math.min(1, mealCalories / calorieTarget) : 0,
      proteinProgress: proteinTarget > 0 ? Math.min(1, mealProtein / proteinTarget) : 0,
    };
  }, [safeModel]);

  const updateModel = (nextModel) => {
    if (typeof onModelChange !== 'function' || !safeModel) {
      return;
    }
    onModelChange(nextModel);
  };

  useEffect(() => {
    if (!activeMealEditKey || safeModel?.kind !== 'nutrition_plan') {
      return;
    }
    const mealKeys = (Array.isArray(safeModel.meals) ? safeModel.meals : [])
      .map((meal, mealIndex) => resolveMealEditKey(meal, mealIndex));
    if (!mealKeys.includes(activeMealEditKey)) {
      setActiveMealEditKey(null);
    }
  }, [activeMealEditKey, safeModel]);

  useEffect(() => {
    if (!activeGenericSectionEditKey || safeModel?.kind !== 'generic_structured') {
      return;
    }
    const sectionKeys = (Array.isArray(safeModel.sections) ? safeModel.sections : [])
      .map((section, sectionIndex) => resolveSectionEditKey(section, sectionIndex));
    if (!sectionKeys.includes(activeGenericSectionEditKey)) {
      setActiveGenericSectionEditKey(null);
    }
  }, [activeGenericSectionEditKey, safeModel]);

  if (!safeModel) {
    return null;
  }

  if (safeModel.kind === 'fallback') {
    return (
      <ModeCard variant="hero" style={styles.panelCard}>
        <View style={styles.panelHeaderRow}>
          <ModeText variant="h3">{safeModel.title || 'Draft Preview'}</ModeText>
          <ModeChip label={labelCase(safeModel.status)} selected={safeModel.status === 'approved'} />
        </View>
        <ModeText variant="bodySm" tone="secondary">{safeModel.message}</ModeText>
        <ModeText variant="caption" tone="tertiary">{safeModel.summary}</ModeText>
        <View style={styles.fallbackButtonRow}>
          <ModeButton
            title="Retry Render"
            size="sm"
            variant="secondary"
            onPress={onRetryRender}
            testID={`${testIDPrefix}-retry-render`}
          />
          <ModeButton
            title="Regenerate Plan"
            size="sm"
            onPress={onRegeneratePlan}
            testID={`${testIDPrefix}-regenerate-plan`}
          />
        </View>
      </ModeCard>
    );
  }

  return (
    <ModeCard variant="hero" style={styles.panelCard}>
      <View style={styles.panelHeaderRow}>
        <ModeText variant="h3">{safeModel.title || 'Draft Review'}</ModeText>
        <View style={styles.panelHeaderActions}>
          <ModeChip label={labelCase(safeModel.status)} selected={safeModel.status === 'approved'} />
        </View>
      </View>

      {safeModel.kind === 'nutrition_plan' ? (
        <>
          <View style={styles.headerMacroRow}>
            <ModeText variant="h2" style={styles.primaryMacroText}>{toPositiveInt(safeModel.calories, 0)} kcal</ModeText>
            <ModeText variant="h2" style={styles.primaryMacroText}>{toPositiveInt(safeModel.protein, 0)}g</ModeText>
          </View>

          <View style={styles.progressWrap}>
            <ModeText variant="caption" tone="secondary">Calories Progress</ModeText>
            <ProgressBar progress={nutritionTotals.calorieProgress} />
            <ModeText variant="caption" tone="tertiary">
              {`${nutritionTotals.mealCalories} / ${toPositiveInt(safeModel.calories, 0)} kcal`}
            </ModeText>

            <ModeText variant="caption" tone="secondary">Protein Progress</ModeText>
            <ProgressBar progress={nutritionTotals.proteinProgress} />
            <ModeText variant="caption" tone="tertiary">
              {`${nutritionTotals.mealProtein} / ${toPositiveInt(safeModel.protein, 0)}g`}
            </ModeText>
          </View>

          <View style={styles.mealListWrap}>
            {(Array.isArray(safeModel.meals) ? safeModel.meals : []).map((meal, mealIndex) => {
              const mealEditKey = resolveMealEditKey(meal, mealIndex);
              return (
                <NutritionMealCard
                  key={mealEditKey}
                  meal={meal}
                  mealIndex={mealIndex}
                  isMealEditing={activeMealEditKey === mealEditKey}
                  onStartEditing={() => {
                    setActiveMealEditKey(mealEditKey);
                    if (!meal.collapsed) {
                      return;
                    }
                    const nextMeals = withUpdatedArrayItem(
                      safeModel.meals,
                      mealIndex,
                      { ...meal, collapsed: false },
                    );
                    updateModel({ ...safeModel, meals: nextMeals });
                  }}
                  onToggleCollapse={() => {
                    const nextMeals = withUpdatedArrayItem(
                      safeModel.meals,
                      mealIndex,
                      { ...meal, collapsed: !meal.collapsed },
                    );
                    updateModel({ ...safeModel, meals: nextMeals });
                  }}
                  onMealChange={(nextMeal) => {
                    const nextMeals = withUpdatedArrayItem(safeModel.meals, mealIndex, nextMeal);
                    updateModel({ ...safeModel, meals: nextMeals });
                  }}
                  onAddFood={(name, amount) => {
                    const newFoodId = `food-${Date.now()}`;
                    const nextFoods = [
                      ...(Array.isArray(meal.foods) ? meal.foods : []),
                      {
                        id: newFoodId,
                        name: normalizeText(name) || 'New food',
                        amount: normalizeText(amount),
                        calories: 0,
                        protein: 0,
                      },
                    ];
                    const nextMeals = withUpdatedArrayItem(safeModel.meals, mealIndex, { ...meal, foods: nextFoods });
                    updateModel({ ...safeModel, meals: nextMeals });
                    return newFoodId;
                  }}
                  onRemoveFood={(nextFoods) => {
                    const nextMeals = withUpdatedArrayItem(safeModel.meals, mealIndex, { ...meal, foods: nextFoods });
                    updateModel({ ...safeModel, meals: nextMeals });
                  }}
                  onRemoveMeal={() => {
                    const nextMeals = (Array.isArray(safeModel.meals) ? safeModel.meals : [])
                      .filter((_, index) => index !== mealIndex);
                    updateModel({ ...safeModel, meals: nextMeals });
                    if (activeMealEditKey === mealEditKey) {
                      setActiveMealEditKey(null);
                    }
                  }}
                  onSaveMeal={() => {
                    if (activeMealEditKey === mealEditKey) {
                      setActiveMealEditKey(null);
                    }
                  }}
                  testIDPrefix={testIDPrefix}
                />
              );
            })}
          </View>

          {safeModel.notes ? (
            <ModeText variant="caption" tone="tertiary" style={styles.coachNotesText}>{safeModel.notes}</ModeText>
          ) : null}
        </>
      ) : null}

      {safeModel.kind === 'training_plan' ? (
        <TrainingPlanEditor
          model={safeModel}
          onModelChange={updateModel}
          testIDPrefix={testIDPrefix}
        />
      ) : null}

      {safeModel.kind === 'generic_structured' ? (
        <>
          {safeModel.summary ? <ModeText variant="bodySm" tone="secondary">{safeModel.summary}</ModeText> : null}

          <View style={styles.genericSectionList}>
            {(Array.isArray(safeModel.sections) ? safeModel.sections : []).map((section, sectionIndex) => {
              const sectionEditKey = resolveSectionEditKey(section, sectionIndex);
              const isSectionEditing = activeGenericSectionEditKey === sectionEditKey;
              return (
                <GenericSectionCard
                  key={`${section.id || sectionIndex}`}
                  section={section}
                  sectionIndex={sectionIndex}
                  isEditing={isSectionEditing}
                  onStartEditing={() => {
                    runAccordionAnimation();
                    setActiveGenericSectionEditKey(sectionEditKey);
                  }}
                  onSectionChange={(nextSection) => {
                    const nextSections = withUpdatedArrayItem(safeModel.sections, sectionIndex, nextSection);
                    updateModel({ ...safeModel, sections: nextSections });
                  }}
                  onRemoveSection={() => {
                    const nextSections = (Array.isArray(safeModel.sections) ? safeModel.sections : [])
                      .filter((_, index) => index !== sectionIndex);
                    updateModel({ ...safeModel, sections: nextSections });
                    if (activeGenericSectionEditKey === sectionEditKey) {
                      setActiveGenericSectionEditKey(null);
                    }
                  }}
                  onSaveSection={() => {
                    if (activeGenericSectionEditKey === sectionEditKey) {
                      setActiveGenericSectionEditKey(null);
                    }
                  }}
                  testIDPrefix={testIDPrefix}
                />
              );
            })}
          </View>

          {safeModel.notes ? <ModeText variant="caption" tone="tertiary">{safeModel.notes}</ModeText> : null}

          {Array.isArray(safeModel.meta) && safeModel.meta.length > 0 ? (
            <View style={styles.metaRowWrap}>
              {safeModel.meta.map((row) => (
                <ModeChip
                  key={`${row.label}-${row.value}`}
                  label={`${row.label}: ${row.value}`}
                  selected={false}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

    </ModeCard>
  );
}

const styles = StyleSheet.create({
  panelCard: {
    gap: theme.spacing[2],
    borderRadius: theme.radii.l,
    paddingVertical: theme.spacing[1],
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  panelHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  headerMacroRow: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    justifyContent: 'space-between',
  },
  primaryMacroText: {
    fontWeight: '700',
  },
  progressWrap: {
    gap: theme.spacing[1],
  },
  mealListWrap: {
    gap: theme.spacing[2],
  },
  mealCard: {
    gap: theme.spacing[1],
    borderRadius: theme.radii.m,
  },
  mealHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  mealHeaderActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  mealHeaderIconButton: {
    width: 30,
    height: 30,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  mealHeaderIconButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  mealHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  mealTitleText: {
    fontWeight: '700',
  },
  compactList: {
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255,255,255,0.02)',
    overflow: 'hidden',
  },
  compactStickyHeader: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: 'rgba(16,24,40,0.88)',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.glass.borderSoft,
  },
  compactRowSeparator: {
    height: 1,
    backgroundColor: theme.colors.glass.borderSoft,
    opacity: 0.45,
  },
  compactRowContainer: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: theme.spacing[1],
  },
  compactRowPressable: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  compactRowPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  compactRowTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  compactRowTitle: {
    fontWeight: '600',
  },
  compactRowSubtitle: {
    lineHeight: 16,
  },
  compactRowRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '45%',
  },
  compactRowMetric: {
    textAlign: 'right',
  },
  compactRowExpanded: {
    gap: theme.spacing[1],
    paddingTop: 2,
  },
  expandedRowAction: {
    alignItems: 'flex-end',
  },
  foodRemoveIconButton: {
    width: 26,
    height: 26,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  foodRemoveIconButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  mealEditActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  trainingSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  trainingBlockWrap: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  trainingReadOnlyRow: {
    gap: 2,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.glass.borderSoft,
  },
  mealMacroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mealNotes: {
    marginTop: 2,
  },
  notesInput: {
    minHeight: 96,
  },
  inlineMacroInputs: {
    flexDirection: 'row',
    gap: theme.spacing[1],
    alignItems: 'flex-start',
  },
  fieldWithLabelWrap: {
    width: '100%',
    gap: 2,
    alignItems: 'stretch',
  },
  inlineFieldWithLabelWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    alignItems: 'stretch',
  },
  labeledInput: {
    marginVertical: 0,
  },
  inlineMacroInput: {
    flex: 1,
    minWidth: 0,
  },
  valueLabel: {
    marginTop: 0,
    paddingHorizontal: theme.spacing[2],
  },
  coachNotesText: {
    marginTop: 2,
  },
  genericSectionList: {
    gap: theme.spacing[2],
  },
  genericSectionCard: {
    gap: theme.spacing[1],
    borderRadius: theme.radii.m,
  },
  genericSectionTitle: {
    fontWeight: '700',
  },
  genericItemsList: {
    gap: 2,
  },
  metaRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 12, 22, 0.52)',
  },
  sheetCard: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
  sheetActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  fallbackButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
});
