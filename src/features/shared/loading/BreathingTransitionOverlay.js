import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import { ModeText } from '../../../../lib/components';
import { AtmosphereBackground } from '../../../../lib/components/glass/AtmosphereBackground';
import { theme } from '../../../../lib/theme';
import { BREATHING_CONTEXT, getBreathingCopy } from './breathingCopy';
import { BREATHING_PHASE, useBreathingTransitionMachine } from './useBreathingTransitionMachine';
import { useReducedMotionPreference } from './useReducedMotionPreference';

function resolveAtmosphereContext(context) {
  if (context === BREATHING_CONTEXT.COACH_OPEN || context === BREATHING_CONTEXT.TRAINER_REVIEW_LOAD) {
    return 'chat';
  }
  if (context === BREATHING_CONTEXT.CHECKIN_LOAD
    || context === BREATHING_CONTEXT.CHECKIN_REVIEW
    || context === BREATHING_CONTEXT.PLAN_GENERATION) {
    return 'workout';
  }
  if (context === BREATHING_CONTEXT.INSIGHTS_LOAD) {
    return 'home';
  }
  if (context === BREATHING_CONTEXT.TRAINER_ASSISTANT_BOOTSTRAP
    || context === BREATHING_CONTEXT.TRAINER_ASSISTANT_EXECUTE) {
    return 'coach';
  }
  if (context === BREATHING_CONTEXT.CLIENT_CONTEXT_LOAD) {
    return 'clients';
  }
  return 'home';
}

function stopAnimation(animationRef) {
  if (animationRef.current && typeof animationRef.current.stop === 'function') {
    animationRef.current.stop();
  }
  animationRef.current = null;
}

export default function BreathingTransitionOverlay({
  active,
  context = BREATHING_CONTEXT.SHELL_BOOTSTRAP,
  variant = 'overlay',
  showAfterMs = 140,
  minVisibleMs = 280,
  inhaleMs = 4000,
  exhaleMs = 4000,
  progressLabel = null,
  onExitComplete,
  testID,
  reducedMotion = undefined,
}) {
  const reducedMotionPreference = useReducedMotionPreference();
  const shouldReduceMotion = typeof reducedMotion === 'boolean'
    ? reducedMotion
    : reducedMotionPreference;

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const orbScale = useRef(new Animated.Value(shouldReduceMotion ? 1 : 0.98)).current;
  const haloOpacity = useRef(new Animated.Value(0)).current;
  const primaryOpacity = useRef(new Animated.Value(0)).current;
  const secondaryOpacity = useRef(new Animated.Value(0)).current;
  const phaseAnimationRef = useRef(null);

  const {
    phase,
    durationMs,
    cycleCount,
    isMounted,
    shouldBlockPointerEvents,
  } = useBreathingTransitionMachine({
    active,
    showAfterMs,
    minVisibleMs,
    inhaleMs,
    exhaleMs,
    reducedMotion: shouldReduceMotion,
    onExitComplete,
  });

  const copy = useMemo(() => getBreathingCopy({
    context,
    phase,
    cycleCount,
    progressLabel,
  }), [context, cycleCount, phase, progressLabel]);

  useEffect(() => {
    stopAnimation(phaseAnimationRef);

    if (phase === BREATHING_PHASE.IDLE || phase === BREATHING_PHASE.PREPARING) {
      overlayOpacity.setValue(0);
      haloOpacity.setValue(0);
      primaryOpacity.setValue(0);
      secondaryOpacity.setValue(0);
      orbScale.setValue(shouldReduceMotion ? 1 : 0.98);
      return;
    }

    const inhaleCurve = Easing.bezier(0.22, 0.61, 0.36, 1);
    const exhaleCurve = Easing.bezier(0.4, 0.0, 0.2, 1);
    const motionDuration = Math.max(1, durationMs || 0);
    const inhaleMotionMs = Math.max(120, Math.min(inhaleMs, motionDuration));
    const exhaleMotionMs = Math.max(120, Math.min(exhaleMs, motionDuration));
    const inhalePauseMs = Math.max(0, motionDuration - inhaleMotionMs);
    const exhalePauseMs = Math.max(0, motionDuration - exhaleMotionMs);

    if (phase === BREATHING_PHASE.ENTERING) {
      orbScale.setValue(shouldReduceMotion ? 1 : 0.98);
      primaryOpacity.setValue(0);
      secondaryOpacity.setValue(0);
      phaseAnimationRef.current = Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(orbScale, {
          toValue: 1,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(haloOpacity, {
          toValue: 0.24,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(120, Math.round(motionDuration * 0.72)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: copy.secondary ? 1 : 0,
          duration: Math.max(120, Math.round(motionDuration * 0.72)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
      return;
    }

    if (phase === BREATHING_PHASE.INHALE) {
      const inhaleScaleTarget = shouldReduceMotion ? 1 : 1.12;
      const inhaleHaloTarget = shouldReduceMotion ? 0.25 : 0.34;
      phaseAnimationRef.current = Animated.parallel([
        Animated.sequence([
          Animated.timing(orbScale, {
            toValue: inhaleScaleTarget,
            duration: shouldReduceMotion ? motionDuration : inhaleMotionMs,
            easing: inhaleCurve,
            useNativeDriver: true,
          }),
          inhalePauseMs > 0
            ? Animated.timing(orbScale, {
              toValue: inhaleScaleTarget,
              duration: inhalePauseMs,
              easing: Easing.linear,
              useNativeDriver: true,
            })
            : Animated.delay(0),
        ]),
        Animated.sequence([
          Animated.timing(haloOpacity, {
            toValue: inhaleHaloTarget,
            duration: shouldReduceMotion ? motionDuration : inhaleMotionMs,
            easing: inhaleCurve,
            useNativeDriver: true,
          }),
          inhalePauseMs > 0
            ? Animated.timing(haloOpacity, {
              toValue: inhaleHaloTarget,
              duration: inhalePauseMs,
              easing: Easing.linear,
              useNativeDriver: true,
            })
            : Animated.delay(0),
        ]),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(100, Math.round(motionDuration * 0.5)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: copy.secondary ? 1 : 0,
          duration: Math.max(100, Math.round(motionDuration * 0.5)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
      return;
    }

    if (phase === BREATHING_PHASE.EXHALE) {
      const exhaleScaleTarget = shouldReduceMotion ? 1 : 0.94;
      const exhaleHaloTarget = shouldReduceMotion ? 0.22 : 0.19;
      phaseAnimationRef.current = Animated.parallel([
        Animated.sequence([
          Animated.timing(orbScale, {
            toValue: exhaleScaleTarget,
            duration: shouldReduceMotion ? motionDuration : exhaleMotionMs,
            easing: exhaleCurve,
            useNativeDriver: true,
          }),
          exhalePauseMs > 0
            ? Animated.timing(orbScale, {
              toValue: exhaleScaleTarget,
              duration: exhalePauseMs,
              easing: Easing.linear,
              useNativeDriver: true,
            })
            : Animated.delay(0),
        ]),
        Animated.sequence([
          Animated.timing(haloOpacity, {
            toValue: exhaleHaloTarget,
            duration: shouldReduceMotion ? motionDuration : exhaleMotionMs,
            easing: exhaleCurve,
            useNativeDriver: true,
          }),
          exhalePauseMs > 0
            ? Animated.timing(haloOpacity, {
              toValue: exhaleHaloTarget,
              duration: exhalePauseMs,
              easing: Easing.linear,
              useNativeDriver: true,
            })
            : Animated.delay(0),
        ]),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(100, Math.round(motionDuration * 0.5)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: copy.secondary ? 1 : 0,
          duration: Math.max(100, Math.round(motionDuration * 0.5)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
      return;
    }

    if (phase === BREATHING_PHASE.SETTLING) {
      phaseAnimationRef.current = Animated.parallel([
        Animated.timing(orbScale, {
          toValue: 1,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(haloOpacity, {
          toValue: 0.22,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(80, Math.round(motionDuration * 0.68)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: 0,
          duration: Math.max(100, Math.round(motionDuration * 0.55)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
      return;
    }

    if (phase === BREATHING_PHASE.EXITING) {
      phaseAnimationRef.current = Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(haloOpacity, {
          toValue: 0,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 0,
          duration: Math.max(100, Math.round(motionDuration * 0.65)),
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: 0,
          duration: Math.max(100, Math.round(motionDuration * 0.5)),
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(orbScale, {
          toValue: 1,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
    }
  }, [
    copy.secondary,
    durationMs,
    exhaleMs,
    haloOpacity,
    inhaleMs,
    orbScale,
    overlayOpacity,
    phase,
    primaryOpacity,
    secondaryOpacity,
    shouldReduceMotion,
  ]);

  useEffect(() => () => {
    stopAnimation(phaseAnimationRef);
  }, []);

  if (!isMounted) {
    return null;
  }

  const atmosphereContext = resolveAtmosphereContext(context);
  const pointerEvents = shouldBlockPointerEvents ? 'auto' : 'none';

  return (
    <Animated.View
      pointerEvents={pointerEvents}
      testID={testID}
      style={[
        variant === 'screen' ? styles.screenRoot : styles.overlayRoot,
        {
          opacity: overlayOpacity,
        },
      ]}
    >
      {variant === 'screen' ? (
        <AtmosphereBackground
          context={atmosphereContext}
          overlayStrength={1.04}
          dimmerOpacity={0.79}
        />
      ) : null}
      <View style={styles.scrimLayer} />
      <View style={styles.centerWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              opacity: haloOpacity,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.orbCore,
            {
              transform: [{ scale: orbScale }],
            },
          ]}
        >
          <View style={styles.orbRing} />
          <Animated.View style={[styles.primaryLabelWrap, { opacity: primaryOpacity }]}>
            <ModeText variant="h3" tone="primary" style={styles.primaryLabel}>
              {copy.primary}
            </ModeText>
          </Animated.View>
        </Animated.View>
        {copy.secondary ? (
          <Animated.View style={[styles.secondaryLabelWrap, { opacity: secondaryOpacity }]}>
            <ModeText variant="bodySm" tone="secondary" style={styles.secondaryLabel}>
              {copy.secondary}
            </ModeText>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scrimLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 11, 21, 0.78)',
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[4],
  },
  halo: {
    position: 'absolute',
    width: 212,
    height: 212,
    borderRadius: 106,
    backgroundColor: theme.colors.accent.glow,
  },
  orbCore: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(27, 43, 68, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(198, 222, 255, 0.24)',
    shadowColor: '#0A1425',
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  orbRing: {
    position: 'absolute',
    width: 122,
    height: 122,
    borderRadius: 61,
    borderWidth: 1,
    borderColor: 'rgba(230, 241, 255, 0.16)',
    backgroundColor: 'rgba(139, 177, 255, 0.08)',
  },
  primaryLabelWrap: {
    paddingHorizontal: 18,
  },
  primaryLabel: {
    textAlign: 'center',
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: 0.12,
  },
  secondaryLabelWrap: {
    marginTop: theme.spacing[3],
    minHeight: 24,
    justifyContent: 'center',
  },
  secondaryLabel: {
    textAlign: 'center',
    maxWidth: 300,
  },
});

