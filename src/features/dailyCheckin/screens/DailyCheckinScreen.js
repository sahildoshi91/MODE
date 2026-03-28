import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { HeaderBar, ModeButton, ModeCard } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getTodayCheckin, submitTodayCheckin } from '../services/checkinApi';

const QUESTIONS = [
  { key: 'sleep', prompt: 'How well did you sleep?' },
  { key: 'stress', prompt: 'What is your stress level?' },
  { key: 'soreness', prompt: 'How sore is your body?' },
  { key: 'nutrition', prompt: 'How well have you been eating?' },
  { key: 'motivation', prompt: 'How motivated do you feel?' },
];

const SCALE = [1, 2, 3, 4, 5];

const MODE_THEME = {
  GREEN: {
    accent: '#22C55E',
    badge: 'Peak readiness',
  },
  YELLOW: {
    accent: '#EAB308',
    badge: 'Functional capacity',
  },
  BLUE: {
    accent: '#3B82F6',
    badge: 'Recovery leaning',
  },
  RED: {
    accent: '#EF4444',
    badge: 'Restorative need',
  },
};

function getLocalDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatTodayLabel(dateString) {
  const parsed = new Date(`${dateString}T12:00:00`);
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function createEmptyAnswers() {
  return {
    sleep: null,
    stress: null,
    soreness: null,
    nutrition: null,
    motivation: null,
  };
}

function QuestionRow({ prompt, value, onSelect }) {
  return (
    <ModeCard style={styles.questionCard}>
      <Text style={styles.questionPrompt}>{prompt}</Text>
      <View style={styles.scaleRow}>
        {SCALE.map((option) => {
          const isSelected = value === option;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(option)}
              style={({ pressed }) => [
                styles.scaleOption,
                isSelected && styles.scaleOptionSelected,
                pressed && styles.scaleOptionPressed,
              ]}
            >
              <Text style={[styles.scaleLabel, isSelected && styles.scaleLabelSelected]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ModeCard>
  );
}

function ResultCard({ result }) {
  const modeTheme = MODE_THEME[result.mode] || MODE_THEME.BLUE;

  return (
    <ModeCard style={[styles.resultCard, { borderColor: modeTheme.accent }]}>
      <View style={styles.resultHeader}>
        <View>
          <Text style={styles.resultEyebrow}>Today&apos;s mode</Text>
          <Text style={[styles.resultMode, { color: modeTheme.accent }]}>{result.mode}</Text>
        </View>
        <View style={[styles.modeBadge, { backgroundColor: `${modeTheme.accent}20` }]}>
          <Text style={[styles.modeBadgeText, { color: modeTheme.accent }]}>{modeTheme.badge}</Text>
        </View>
      </View>

      <Text style={styles.resultScore}>Score {result.score}/25</Text>

      <View style={styles.bundleBlock}>
        <Text style={styles.bundleLabel}>Training</Text>
        <Text style={styles.bundleValue}>{result.training.type}</Text>
        <Text style={styles.bundleMeta}>
          {result.training.duration} • {result.training.intensity}
        </Text>
      </View>

      <View style={styles.bundleBlock}>
        <Text style={styles.bundleLabel}>Nutrition</Text>
        <Text style={styles.bundleValue}>{result.nutrition.rule}</Text>
      </View>

      <View style={styles.bundleBlock}>
        <Text style={styles.bundleLabel}>Mindset</Text>
        <Text style={styles.bundleValue}>{result.mindset.cue}</Text>
      </View>
    </ModeCard>
  );
}

export default function DailyCheckinScreen({ accessToken, onSignOut }) {
  const sessionStartRef = useRef(Date.now());
  const today = useMemo(() => getLocalDateString(), []);
  const [answers, setAnswers] = useState(createEmptyAnswers);
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadToday = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const nextStatus = await getTodayCheckin({ accessToken });
        if (!isMounted) {
          return;
        }
        setStatus(nextStatus);
        if (!nextStatus.completed) {
          sessionStartRef.current = Date.now();
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setErrorMessage(error.message || 'Unable to load today\'s check-in.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadToday();

    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  const answeredCount = QUESTIONS.filter(({ key }) => answers[key] !== null).length;
  const isComplete = answeredCount === QUESTIONS.length;
  const hasResult = Boolean(status?.completed && status?.checkin);

  const handleSelect = (key, value) => {
    setAnswers((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSubmit = async () => {
    if (!isComplete || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await submitTodayCheckin({
        accessToken,
        date: today,
        inputs: answers,
        timeToComplete: Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000)),
      });
      setStatus({
        date: today,
        completed: true,
        checkin: result,
      });
    } catch (error) {
      setErrorMessage(error.message || 'Unable to submit today\'s check-in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <HeaderBar
        title="MODE Today"
        subtitle={hasResult ? 'Your daily decision bundle is ready.' : 'Check in fast and get today\'s call.'}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <ModeCard style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>{formatTodayLabel(today)}</Text>
          <Text style={styles.heroTitle}>
            {hasResult ? 'Today is handled.' : 'Get clear on what your body needs today.'}
          </Text>
          <Text style={styles.heroBody}>
            {hasResult
              ? 'Come back tomorrow for a fresh recommendation based on how you feel then.'
              : 'Five taps, one score, one clear decision. No overthinking.'}
          </Text>
        </ModeCard>

        {errorMessage ? (
          <ModeCard>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </ModeCard>
        ) : null}

        {hasResult ? (
          <ResultCard result={status.checkin} />
        ) : (
          <View style={styles.formSection}>
            {QUESTIONS.map((question) => (
              <QuestionRow
                key={question.key}
                prompt={question.prompt}
                value={answers[question.key]}
                onSelect={(value) => handleSelect(question.key, value)}
              />
            ))}

            <ModeCard style={styles.progressCard}>
              <Text style={styles.progressLabel}>Progress</Text>
              <Text style={styles.progressValue}>{answeredCount}/5 complete</Text>
              <Text style={styles.progressBody}>This should take under 15 seconds.</Text>
            </ModeCard>

            <ModeButton
              title={isSubmitting ? 'Calculating...' : 'Get Today\'s Decision'}
              onPress={handleSubmit}
              disabled={!isComplete || isSubmitting}
            />
          </View>
        )}

        <ModeButton
          title="Sign Out"
          variant="secondary"
          onPress={onSignOut}
          disabled={isSubmitting}
          style={styles.signOutButton}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.primary,
  },
  content: {
    padding: theme.spacing[3],
    paddingBottom: theme.spacing[5],
  },
  heroCard: {
    backgroundColor: theme.colors.surfaceSoft,
    borderColor: '#31415C',
  },
  heroEyebrow: {
    color: theme.colors.accent,
    ...theme.typography.label,
    textTransform: 'uppercase',
    marginBottom: theme.spacing[1],
  },
  heroTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h2,
    marginBottom: theme.spacing[1],
  },
  heroBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body1,
  },
  formSection: {
    gap: theme.spacing[2],
  },
  questionCard: {
    marginBottom: 0,
  },
  questionPrompt: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
    marginBottom: theme.spacing[2],
  },
  scaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  scaleOption: {
    flex: 1,
    minHeight: 48,
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#171C28',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleOptionSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  scaleOptionPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  scaleLabel: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
  },
  scaleLabelSelected: {
    color: theme.colors.onPrimary,
  },
  progressCard: {
    backgroundColor: '#161B24',
    marginBottom: theme.spacing[2],
  },
  progressLabel: {
    color: theme.colors.textMedium,
    ...theme.typography.label,
    textTransform: 'uppercase',
    marginBottom: theme.spacing[1],
  },
  progressValue: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[1],
  },
  progressBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
  resultCard: {
    backgroundColor: '#111721',
    borderWidth: 2,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  resultEyebrow: {
    color: theme.colors.textMedium,
    ...theme.typography.label,
    textTransform: 'uppercase',
    marginBottom: theme.spacing[1],
  },
  resultMode: {
    ...theme.typography.h1,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  modeBadgeText: {
    ...theme.typography.body3,
    fontWeight: '600',
  },
  resultScore: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[2],
  },
  bundleBlock: {
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: theme.spacing[2],
  },
  bundleLabel: {
    color: theme.colors.textMedium,
    ...theme.typography.label,
    textTransform: 'uppercase',
    marginBottom: theme.spacing[1],
  },
  bundleValue: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
    marginBottom: theme.spacing[1],
  },
  bundleMeta: {
    color: theme.colors.accent,
    ...theme.typography.body2,
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.body2,
  },
  signOutButton: {
    marginTop: theme.spacing[2],
  },
});
