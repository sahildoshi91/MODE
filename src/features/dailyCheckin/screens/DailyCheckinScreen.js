import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

import { ModeButton, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getTodayCheckin, submitTodayCheckin } from '../services/checkinApi';

const QUESTIONS = [
  {
    id: 'sleep',
    key: 'sleep',
    icon: { family: 'material', name: 'weather-night' },
    question: 'How well did you sleep?',
    subtitle: 'Quality rest is the foundation of performance',
    color: '#8B5CF6',
    options: [
      { score: 1, label: 'Barely slept', sublabel: 'Under 4 hours' },
      { score: 2, label: 'Poor sleep', sublabel: 'Restless night' },
      { score: 3, label: 'OK sleep', sublabel: 'Some interruptions' },
      { score: 4, label: 'Good sleep', sublabel: 'Mostly rested' },
      { score: 5, label: 'Great sleep', sublabel: 'Fully recharged' },
    ],
  },
  {
    id: 'stress',
    key: 'stress',
    icon: { family: 'feather', name: 'wind' },
    question: 'How heavy is your stress today?',
    subtitle: 'Calm systems recover and perform better',
    color: '#14B8A6',
    options: [
      { score: 1, label: 'Maxed out', sublabel: 'I feel overloaded' },
      { score: 2, label: 'High stress', sublabel: 'Hard to settle' },
      { score: 3, label: 'Manageable', sublabel: 'I am holding it together' },
      { score: 4, label: 'Mostly calm', sublabel: 'A few stressors, still steady' },
      { score: 5, label: 'Very calm', sublabel: 'Clear head, low friction' },
    ],
  },
  {
    id: 'soreness',
    key: 'soreness',
    icon: { family: 'material', name: 'arm-flex' },
    question: 'How is your body feeling?',
    subtitle: 'Soreness changes how hard you should push',
    color: '#F97316',
    options: [
      { score: 1, label: 'Very sore', sublabel: 'Movement feels heavy' },
      { score: 2, label: 'Pretty sore', sublabel: 'A lot of stiffness today' },
      { score: 3, label: 'Some soreness', sublabel: 'Noticeable but manageable' },
      { score: 4, label: 'Minor soreness', sublabel: 'Just a little tight' },
      { score: 5, label: 'Fresh body', sublabel: 'Ready to move well' },
    ],
  },
  {
    id: 'nutrition',
    key: 'nutrition',
    icon: { family: 'material', name: 'food-apple-outline' },
    question: 'How well have you fueled yourself?',
    subtitle: 'Nutrition sets the ceiling for recovery and output',
    color: '#84CC16',
    options: [
      { score: 1, label: 'Way off', sublabel: 'Little structure today' },
      { score: 2, label: 'Below target', sublabel: 'Missed a lot of basics' },
      { score: 3, label: 'Decent enough', sublabel: 'Some good choices, some misses' },
      { score: 4, label: 'Solid nutrition', sublabel: 'Mostly on plan' },
      { score: 5, label: 'Locked in', sublabel: 'Fully fueled and intentional' },
    ],
  },
  {
    id: 'motivation',
    key: 'motivation',
    icon: { family: 'feather', name: 'zap' },
    question: 'How motivated do you feel?',
    subtitle: 'Honest effort starts with honest readiness',
    color: '#EC4899',
    options: [
      { score: 1, label: 'Running on empty', sublabel: 'I do not want to do this' },
      { score: 2, label: 'Low motivation', sublabel: 'Willpower feels thin' },
      { score: 3, label: 'I can show up', sublabel: 'Not fired up, still capable' },
      { score: 4, label: 'Ready to work', sublabel: 'Good focus and intent' },
      { score: 5, label: 'All in', sublabel: 'I want to attack the day' },
    ],
  },
];

const MODE_THEME = {
  BEAST: {
    accent: '#84CC16',
    badge: 'Peak readiness',
  },
  BUILD: {
    accent: '#14B8A6',
    badge: 'Strong and stable',
  },
  RECOVER: {
    accent: '#60A5FA',
    badge: 'Recovery leaning',
  },
  REST: {
    accent: '#FB7185',
    badge: 'Restorative need',
  },
};

const SCORE_KEYS = QUESTIONS.map((question) => question.key);
const GRID_COLUMNS = 18;
const GRID_ROWS = 10;

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
    sleep: 0,
    stress: 0,
    soreness: 0,
    nutrition: 0,
    motivation: 0,
  };
}

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

function renderQuestionIcon(icon, color, size = 22) {
  if (icon.family === 'material') {
    return <MaterialCommunityIcons name={icon.name} size={size} color={color} />;
  }

  return <Feather name={icon.name} size={size} color={color} />;
}

function createProgressWidth(index, questionIndex) {
  return index === questionIndex ? 28 : 8;
}

function BackgroundGrid() {
  const dots = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      dots.push(
        <View
          key={`${row}-${column}`}
          style={[
            styles.gridDot,
            {
              left: `${(column / (GRID_COLUMNS - 1)) * 100}%`,
              top: `${(row / (GRID_ROWS - 1)) * 100}%`,
            },
          ]}
        />,
      );
    }
  }

  return (
    <View pointerEvents="none" style={styles.gridOverlay}>
      {dots}
    </View>
  );
}

function ResultCard({ result }) {
  const modeTheme = MODE_THEME[result.mode] || MODE_THEME.RECOVER;

  return (
    <View style={[styles.resultCard, { borderColor: withAlpha(modeTheme.accent, 0.55) }]}>
      <View style={styles.resultHero}>
        <Text style={styles.resultEyebrow}>Today&apos;s mode</Text>
        <View style={[styles.resultModeBadge, { backgroundColor: withAlpha(modeTheme.accent, 0.18) }]}>
          <Text style={[styles.resultModeBadgeText, { color: modeTheme.accent }]}>{modeTheme.badge}</Text>
        </View>
      </View>

      <Text style={[styles.resultMode, { color: modeTheme.accent }]}>{result.mode}</Text>
      <Text style={styles.resultBody}>
        Score {result.score}/25. Your check-in is translated into a clear call for training, nutrition, and mindset.
      </Text>

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
    </View>
  );
}

function TopBar({ canGoBack, onGoBack, onSkip, disableSkip }) {
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityRole="button"
        disabled={!canGoBack}
        onPress={onGoBack}
        style={({ pressed }) => [
          styles.topBarAction,
          !canGoBack && styles.topBarActionDisabled,
          pressed && canGoBack && styles.topBarActionPressed,
        ]}
      >
        <Feather name="chevron-left" size={22} color={canGoBack ? theme.colors.textHigh : theme.colors.textDisabled} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={disableSkip}
        onPress={onSkip}
        style={({ pressed }) => [
          styles.skipButton,
          disableSkip && styles.topBarActionDisabled,
          pressed && !disableSkip && styles.topBarActionPressed,
        ]}
      >
        <Text style={[styles.skipLabel, disableSkip && styles.skipLabelDisabled]}>Skip</Text>
      </Pressable>
    </View>
  );
}

function QuestionScreen({
  question,
  questionIndex,
  justSelected,
  onGoBack,
  onSkip,
  onSelect,
  isBusy,
  topInset,
}) {
  return (
    <View style={[styles.phoneFrame, { paddingTop: Math.max(topInset, theme.spacing[3]) }]}>
      <TopBar
        canGoBack={questionIndex > 0 && !isBusy}
        onGoBack={onGoBack}
        onSkip={onSkip}
        disableSkip={isBusy}
      />

      <View style={styles.questionShell}>
        <View style={[styles.iconTile, { borderColor: withAlpha(question.color, 0.36), backgroundColor: withAlpha(question.color, 0.1) }]}>
          {renderQuestionIcon(question.icon, question.color, 26)}
        </View>

        <View style={styles.questionHeaderBlock}>
          <Text style={styles.questionHeading}>{question.question}</Text>
          <Text style={styles.questionSubtitle}>{question.subtitle}</Text>
        </View>

        <View style={styles.progressRow}>
          {QUESTIONS.map((item, index) => {
            const backgroundColor = index < questionIndex
              ? '#84CC16'
              : index === questionIndex
                ? question.color
                : '#232838';

            return (
              <View
                key={item.id}
                style={[
                  styles.progressDot,
                  {
                    width: createProgressWidth(index, questionIndex),
                    backgroundColor,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.optionsList}>
          {question.options.map((option) => {
            const isJustTapped = justSelected === option.score;

            return (
              <Pressable
                key={option.score}
                accessibilityRole="button"
                disabled={isBusy}
                onPress={() => onSelect(option.score)}
                style={({ pressed }) => [
                  styles.answerRow,
                  isJustTapped && {
                    backgroundColor: withAlpha(question.color, 0.1),
                    borderColor: withAlpha(question.color, 0.38),
                    transform: [{ scale: 1.02 }],
                  },
                  pressed && !isBusy && styles.answerRowPressed,
                ]}
              >
                <View style={styles.answerTextBlock}>
                  <Text style={styles.answerLabel}>{option.label}</Text>
                  <Text style={styles.answerSublabel}>{option.sublabel}</Text>
                </View>
                {isJustTapped ? (
                  <View style={[styles.answerCheck, { backgroundColor: question.color }]}>
                    <Feather name="check" size={14} color="#081018" />
                  </View>
                ) : (
                  <View style={styles.answerCheckPlaceholder} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function DailyCheckinScreen({ accessToken, onSignOut }) {
  const insets = useSafeAreaInsets();
  const sessionStartRef = useRef(Date.now());
  const today = useMemo(() => getLocalDateString(), []);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState('loading');
  const [scores, setScores] = useState(createEmptyAnswers);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [justSelected, setJustSelected] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const currentQuestion = QUESTIONS[questionIndex];
  const glowProgress = useRef(new Animated.Value(1)).current;
  const glowTargetRef = useRef(QUESTIONS[0].color);
  const [glowFromColor, setGlowFromColor] = useState(QUESTIONS[0].color);
  const [glowToColor, setGlowToColor] = useState(QUESTIONS[0].color);

  useEffect(() => {
    if (currentQuestion.color === glowTargetRef.current) {
      return;
    }

    setGlowFromColor(glowTargetRef.current);
    setGlowToColor(currentQuestion.color);
    glowTargetRef.current = currentQuestion.color;
    glowProgress.setValue(0);
    Animated.timing(glowProgress, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [currentQuestion.color, glowProgress]);

  const hasResult = Boolean(status?.completed && status?.checkin);
  const glowColor = glowProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [glowFromColor, glowToColor],
  });

  const loadToday = async () => {
    setIsLoading(true);
    setStep('loading');
    setErrorMessage(null);

    try {
      const nextStatus = await getTodayCheckin({ accessToken });
      setStatus(nextStatus);
      if (nextStatus.completed) {
        setStep('results');
      } else {
        setScores(createEmptyAnswers());
        setQuestionIndex(0);
        setJustSelected(null);
        setAnimating(false);
        sessionStartRef.current = Date.now();
        setStep('questionnaire');
      }
    } catch (error) {
      setErrorMessage(error.message || 'Unable to load today\'s check-in.');
      setStep('error-retry');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadToday();
  }, [accessToken]);

  const handleGoBack = () => {
    if (animating || isSubmitting || questionIndex === 0) {
      return;
    }

    setQuestionIndex((current) => current - 1);
  };

  const handleSubmit = async (updatedScores) => {
    if (isSubmitting) {
      return;
    }

    setStep('reviewing');
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await submitTodayCheckin({
        accessToken,
        date: today,
        inputs: updatedScores,
        timeToComplete: Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000)),
      });
      setStatus({
        date: today,
        completed: true,
        checkin: result,
      });
      setStep('results');
    } catch (error) {
      setErrorMessage(error.message || 'Unable to submit today\'s check-in.');
      setStep('error-retry');
    } finally {
      setIsSubmitting(false);
      setAnimating(false);
      setJustSelected(null);
    }
  };

  const handleOptionTap = (score) => {
    if (animating || isSubmitting) {
      return;
    }

    setAnimating(true);
    setJustSelected(score);
    const updatedScores = {
      ...scores,
      [currentQuestion.key]: score,
    };
    setScores(updatedScores);

    requestAnimationFrame(() => {
      setJustSelected(null);
      if (questionIndex < QUESTIONS.length - 1) {
        setQuestionIndex((current) => current + 1);
        setAnimating(false);
        return;
      }
      handleSubmit(updatedScores);
    });
  };

  const handleSkip = () => {
    handleOptionTap(3);
  };

  return (
    <SafeScreen style={styles.screen}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowOrb,
          {
            backgroundColor: glowColor,
          },
        ]}
      />
      <BackgroundGrid />

      {(isLoading || step === 'loading') ? (
        <View style={styles.loadingScreen}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={styles.loadingTitle}>Loading your check-in</Text>
          <Text style={styles.loadingBody}>Pulling today&apos;s status and preparing your flow.</Text>
        </View>
      ) : null}

      {step === 'questionnaire' ? (
        <View style={styles.centerStage}>
          <QuestionScreen
            question={currentQuestion}
            questionIndex={questionIndex}
            justSelected={justSelected}
            onGoBack={handleGoBack}
            onSkip={handleSkip}
            onSelect={handleOptionTap}
            isBusy={animating || isSubmitting}
            topInset={insets.top}
          />
          <ModeButton
            title="Sign Out"
            variant="secondary"
            onPress={onSignOut}
            disabled={isSubmitting}
            style={styles.footerButton}
          />
        </View>
      ) : null}

      {step === 'reviewing' ? (
        <View style={styles.loadingScreen}>
          <View style={styles.reviewCard}>
            <ActivityIndicator size="large" color={currentQuestion.color} />
            <Text style={styles.reviewTitle}>Coach is reviewing your details</Text>
            <Text style={styles.reviewBody}>
              Turning five honest answers into today&apos;s call.
            </Text>
          </View>
        </View>
      ) : null}

      {step === 'results' && hasResult ? (
        <ScrollView contentContainerStyle={[styles.resultsContent, { paddingTop: Math.max(insets.top, theme.spacing[3]) }]}>
          <View style={styles.phoneFrame}>
            <Text style={styles.resultsEyebrow}>{formatTodayLabel(today)}</Text>
            <Text style={styles.resultsTitle}>Today is handled.</Text>
            <Text style={styles.resultsSubtitle}>
              Your daily decision bundle is ready. Come back tomorrow for a fresh read.
            </Text>
            <ResultCard result={status.checkin} />
          </View>
          <ModeButton
            title="Sign Out"
            variant="secondary"
            onPress={onSignOut}
            style={styles.footerButton}
          />
        </ScrollView>
      ) : null}

      {step === 'error-retry' ? (
        <View style={styles.loadingScreen}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>We couldn&apos;t finish the check-in.</Text>
            <Text style={styles.errorText}>{errorMessage || 'Something went wrong while loading your check-in.'}</Text>
            <ModeButton
              title={hasResult ? 'Reload results' : 'Try again'}
              onPress={hasResult ? loadToday : (scores[SCORE_KEYS[SCORE_KEYS.length - 1]] > 0 ? () => handleSubmit(scores) : loadToday)}
              style={styles.errorButton}
            />
            <ModeButton
              title="Sign Out"
              variant="secondary"
              onPress={onSignOut}
              style={styles.footerButton}
            />
          </View>
        </View>
      ) : null}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
  },
  centerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.primary,
    paddingHorizontal: theme.spacing[3],
  },
  phoneFrame: {
    width: '100%',
    maxWidth: 384,
    alignSelf: 'center',
  },
  questionShell: {
    minHeight: 620,
    justifyContent: 'flex-start',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  topBarAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#FFFFFF', 0.04),
    borderWidth: 1,
    borderColor: withAlpha('#FFFFFF', 0.08),
  },
  topBarActionDisabled: {
    opacity: 0.45,
  },
  topBarActionPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.97 }],
  },
  skipButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[1],
  },
  skipLabel: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  skipLabelDisabled: {
    color: theme.colors.textDisabled,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 8,
    marginBottom: theme.spacing[4],
  },
  progressDot: {
    height: 8,
    borderRadius: 999,
  },
  iconTile: {
    width: 64,
    height: 64,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
    alignSelf: 'center',
  },
  questionHeaderBlock: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },
  questionHeading: {
    color: theme.colors.textHigh,
    ...theme.typography.h1,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[1],
    textAlign: 'center',
  },
  questionSubtitle: {
    color: theme.colors.textMedium,
    ...theme.typography.body1,
    textAlign: 'center',
    maxWidth: 320,
  },
  optionsList: {
    gap: 12,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    minHeight: 78,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: withAlpha('#FFFFFF', 0.08),
    backgroundColor: '#161B24',
  },
  answerRowPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  answerTextBlock: {
    flex: 1,
  },
  answerLabel: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    marginBottom: 2,
  },
  answerSublabel: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  answerCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerCheckPlaceholder: {
    width: 26,
    height: 26,
  },
  resultCard: {
    backgroundColor: '#101722',
    borderWidth: 1,
    borderRadius: 28,
    padding: theme.spacing[4],
    marginTop: theme.spacing[4],
  },
  resultHero: {
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
    fontFamily: theme.typography.fontFamily,
  },
  resultMode: {
    ...theme.typography.h1,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[1],
  },
  resultModeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  resultModeBadgeText: {
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  resultBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
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
    fontFamily: theme.typography.fontFamily,
    textTransform: 'uppercase',
    marginBottom: theme.spacing[1],
  },
  bundleValue: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[1],
  },
  bundleMeta: {
    color: theme.colors.accent,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
  },
  resultsContent: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    alignItems: 'center',
  },
  resultsEyebrow: {
    color: theme.colors.accent,
    ...theme.typography.label,
    fontFamily: theme.typography.fontFamily,
    textTransform: 'uppercase',
  },
  resultsTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h1,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[1],
  },
  resultsSubtitle: {
    color: theme.colors.textMedium,
    ...theme.typography.body1,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[1],
  },
  footerButton: {
    width: '100%',
    maxWidth: 384,
    marginTop: theme.spacing[3],
  },
  reviewCard: {
    width: '100%',
    maxWidth: 384,
    borderRadius: 28,
    backgroundColor: '#111721',
    borderWidth: 1,
    borderColor: withAlpha('#FFFFFF', 0.08),
    padding: theme.spacing[4],
    alignItems: 'center',
  },
  reviewTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  reviewBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  errorCard: {
    width: '100%',
    maxWidth: 384,
    borderRadius: 28,
    backgroundColor: '#111721',
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.error, 0.34),
    padding: theme.spacing[4],
  },
  errorTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[1],
    textAlign: 'center',
  },
  errorButton: {
    marginTop: theme.spacing[3],
  },
  loadingTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  loadingBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
    maxWidth: 320,
  },
  glowOrb: {
    position: 'absolute',
    top: -80,
    left: '50%',
    marginLeft: -220,
    width: 440,
    height: 300,
    borderRadius: 220,
    opacity: 0.24,
    transform: [{ scaleX: 1.2 }],
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.15,
  },
  gridDot: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#C9D2EA',
  },
});
