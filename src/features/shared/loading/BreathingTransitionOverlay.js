import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { BREATHING_CONTEXT, getBreathingCopy } from './breathingCopy';
import { getBreathingLayout } from './breathingLayout';
import { BREATHING_PHASE, useBreathingTransitionMachine } from './useBreathingTransitionMachine';
import { useReducedMotionPreference } from './useReducedMotionPreference';

const DEFAULT_PRIMARY_COPY = 'Take a breath.';

const ACCENT_TONES = Object.freeze({
  default: Object.freeze({
    orbStart: 'rgba(79, 115, 175, 0.76)',
    orbMid: 'rgba(39, 65, 102, 0.9)',
    orbEnd: 'rgba(15, 26, 44, 0.98)',
    innerAtmosphere: 'rgba(178, 205, 255, 0.32)',
    guideRing: 'rgba(228, 240, 255, 0.32)',
    diffusion: 'rgba(111, 146, 255, 0.26)',
    bloomPrimary: 'rgba(97, 134, 201, 0.2)',
    bloomSecondary: 'rgba(66, 97, 158, 0.16)',
  }),
  cool: Object.freeze({
    orbStart: 'rgba(68, 105, 172, 0.72)',
    orbMid: 'rgba(31, 57, 98, 0.9)',
    orbEnd: 'rgba(11, 22, 40, 0.98)',
    innerAtmosphere: 'rgba(170, 200, 255, 0.28)',
    guideRing: 'rgba(214, 233, 255, 0.3)',
    diffusion: 'rgba(96, 136, 210, 0.24)',
    bloomPrimary: 'rgba(81, 121, 193, 0.2)',
    bloomSecondary: 'rgba(54, 86, 145, 0.14)',
  }),
  quiet: Object.freeze({
    orbStart: 'rgba(59, 89, 140, 0.62)',
    orbMid: 'rgba(28, 47, 79, 0.9)',
    orbEnd: 'rgba(12, 20, 35, 0.98)',
    innerAtmosphere: 'rgba(154, 186, 245, 0.24)',
    guideRing: 'rgba(206, 226, 250, 0.28)',
    diffusion: 'rgba(84, 113, 164, 0.2)',
    bloomPrimary: 'rgba(69, 101, 156, 0.16)',
    bloomSecondary: 'rgba(45, 70, 118, 0.12)',
  }),
});

export const BREATHING_MOTION_TARGETS = Object.freeze({
  scale: Object.freeze({
    inhale: 1.065,
    hold: 1.065,
    exhale: 0.965,
  }),
  atmosphere: Object.freeze({
    base: Object.freeze({
      screen: 0.26,
      overlay: 0.18,
    }),
    inhale: Object.freeze({
      screen: 0.46,
      overlay: 0.33,
    }),
    hold: Object.freeze({
      screen: 0.38,
      overlay: 0.26,
    }),
    exhale: Object.freeze({
      screen: 0.14,
      overlay: 0.08,
    }),
  }),
  orbInnerOpacity: Object.freeze({
    entering: 0.2,
    inhale: 0.38,
    hold: 0.36,
    exhale: 0.1,
    settling: 0.2,
  }),
});

function resolveAccentTone(accentMode) {
  if (typeof accentMode !== 'string') {
    return ACCENT_TONES.default;
  }
  const normalized = accentMode.trim().toLowerCase();
  return ACCENT_TONES[normalized] || ACCENT_TONES.default;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveSecondaryCopy({ subtitle, progressLabel, fallbackSecondary }) {
  const resolvedSubtitle = normalizeText(subtitle);
  if (resolvedSubtitle) {
    return resolvedSubtitle;
  }

  const resolvedProgressLabel = normalizeText(progressLabel);
  if (resolvedProgressLabel) {
    return resolvedProgressLabel;
  }

  return normalizeText(fallbackSecondary);
}

function resolveVariantMotionValue(variant, valueMap) {
  return variant === 'screen' ? valueMap.screen : valueMap.overlay;
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
  inhaleMs = 3000,
  holdMs = 300,
  exhaleMs = 3000,
  title = DEFAULT_PRIMARY_COPY,
  subtitle,
  progressLabel = null,
  accentMode = 'default',
  onExitComplete,
  testID,
  reducedMotion = undefined,
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const reducedMotionPreference = useReducedMotionPreference();
  const shouldReduceMotion = typeof reducedMotion === 'boolean'
    ? reducedMotion
    : reducedMotionPreference;

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const orbScale = useRef(new Animated.Value(shouldReduceMotion ? 1 : 0.985)).current;
  const atmosphereOpacity = useRef(new Animated.Value(0)).current;
  const orbInnerOpacity = useRef(new Animated.Value(0)).current;
  const guideRingOpacity = useRef(new Animated.Value(0)).current;
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
    holdMs,
    exhaleMs,
    reducedMotion: shouldReduceMotion,
    onExitComplete,
  });

  const fallbackCopy = useMemo(() => getBreathingCopy({
    context,
    phase,
    cycleCount,
  }), [context, cycleCount, phase]);

  const resolvedPrimary = useMemo(() => normalizeText(title) || DEFAULT_PRIMARY_COPY, [title]);
  const resolvedSecondary = useMemo(() => resolveSecondaryCopy({
    subtitle,
    progressLabel,
    fallbackSecondary: fallbackCopy.secondary,
  }), [fallbackCopy.secondary, progressLabel, subtitle]);

  const hasSecondary = Boolean(resolvedSecondary);
  const accent = useMemo(() => resolveAccentTone(accentMode), [accentMode]);
  const layout = useMemo(() => getBreathingLayout({
    width,
    height,
    insets,
  }), [height, insets, width]);

  useEffect(() => {
    stopAnimation(phaseAnimationRef);

    if (phase === BREATHING_PHASE.IDLE || phase === BREATHING_PHASE.PREPARING) {
      overlayOpacity.setValue(0);
      atmosphereOpacity.setValue(0);
      orbInnerOpacity.setValue(0);
      guideRingOpacity.setValue(0);
      primaryOpacity.setValue(0);
      secondaryOpacity.setValue(0);
      orbScale.setValue(shouldReduceMotion ? 1 : 0.985);
      return;
    }

    const inhaleCurve = Easing.bezier(0.22, 0.61, 0.36, 1);
    const exhaleCurve = Easing.bezier(0.4, 0.0, 0.2, 1);
    const motionDuration = Math.max(1, durationMs || 0);

    const baseAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.base);
    const inhaleAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.inhale);
    const holdAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.hold);
    const exhaleAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.exhale);

    if (phase === BREATHING_PHASE.ENTERING) {
      orbScale.setValue(shouldReduceMotion ? 1 : 0.985);
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
        Animated.timing(atmosphereOpacity, {
          toValue: baseAtmosphere,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(orbInnerOpacity, {
          toValue: BREATHING_MOTION_TARGETS.orbInnerOpacity.entering,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(guideRingOpacity, {
          toValue: shouldReduceMotion ? 0.04 : 0.06,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(120, Math.round(motionDuration * 0.74)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: hasSecondary ? 1 : 0,
          duration: Math.max(120, Math.round(motionDuration * 0.74)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
      return;
    }

    if (phase === BREATHING_PHASE.INHALE) {
      phaseAnimationRef.current = Animated.parallel([
        Animated.timing(orbScale, {
          toValue: shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.inhale,
          duration: motionDuration,
          easing: inhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(atmosphereOpacity, {
          toValue: inhaleAtmosphere,
          duration: motionDuration,
          easing: inhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(orbInnerOpacity, {
          toValue: BREATHING_MOTION_TARGETS.orbInnerOpacity.inhale,
          duration: motionDuration,
          easing: inhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(guideRingOpacity, {
          toValue: shouldReduceMotion ? 0.05 : 0.08,
          duration: motionDuration,
          easing: inhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(120, Math.round(motionDuration * 0.52)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: hasSecondary ? 1 : 0,
          duration: Math.max(120, Math.round(motionDuration * 0.52)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
      return;
    }

    if (phase === BREATHING_PHASE.HOLD) {
      phaseAnimationRef.current = Animated.parallel([
        Animated.timing(orbScale, {
          toValue: shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.hold,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(atmosphereOpacity, {
          toValue: holdAtmosphere,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(orbInnerOpacity, {
          toValue: BREATHING_MOTION_TARGETS.orbInnerOpacity.hold,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(guideRingOpacity, {
          toValue: shouldReduceMotion ? 0.05 : 0.07,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      phaseAnimationRef.current.start();
      return;
    }

    if (phase === BREATHING_PHASE.EXHALE) {
      phaseAnimationRef.current = Animated.parallel([
        Animated.timing(orbScale, {
          toValue: shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.exhale,
          duration: motionDuration,
          easing: exhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(atmosphereOpacity, {
          toValue: exhaleAtmosphere,
          duration: motionDuration,
          easing: exhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(orbInnerOpacity, {
          toValue: BREATHING_MOTION_TARGETS.orbInnerOpacity.exhale,
          duration: motionDuration,
          easing: exhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(guideRingOpacity, {
          toValue: shouldReduceMotion ? 0.04 : 0.05,
          duration: motionDuration,
          easing: exhaleCurve,
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(120, Math.round(motionDuration * 0.5)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: hasSecondary ? 1 : 0,
          duration: Math.max(120, Math.round(motionDuration * 0.5)),
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
        Animated.timing(atmosphereOpacity, {
          toValue: baseAtmosphere,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(orbInnerOpacity, {
          toValue: BREATHING_MOTION_TARGETS.orbInnerOpacity.settling,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(guideRingOpacity, {
          toValue: shouldReduceMotion ? 0.04 : 0.06,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 1,
          duration: Math.max(100, Math.round(motionDuration * 0.66)),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: hasSecondary ? 1 : 0,
          duration: Math.max(100, Math.round(motionDuration * 0.58)),
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
        Animated.timing(atmosphereOpacity, {
          toValue: 0,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(orbInnerOpacity, {
          toValue: 0,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(guideRingOpacity, {
          toValue: 0,
          duration: motionDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryOpacity, {
          toValue: 0,
          duration: Math.max(100, Math.round(motionDuration * 0.62)),
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryOpacity, {
          toValue: 0,
          duration: Math.max(100, Math.round(motionDuration * 0.52)),
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
    atmosphereOpacity,
    durationMs,
    hasSecondary,
    orbInnerOpacity,
    orbScale,
    overlayOpacity,
    phase,
    primaryOpacity,
    secondaryOpacity,
    shouldReduceMotion,
    variant,
    guideRingOpacity,
  ]);

  useEffect(() => () => {
    stopAnimation(phaseAnimationRef);
  }, []);

  if (!isMounted) {
    return null;
  }

  const pointerEvents = shouldBlockPointerEvents ? 'auto' : 'none';
  const screenScrimColor = variant === 'screen' ? 'rgba(5, 11, 21, 0.52)' : 'rgba(5, 11, 21, 0.64)';

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
        <>
          <LinearGradient
            pointerEvents="none"
            colors={['#050D1A', '#091323', '#0C1526']}
            locations={[0, 0.56, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.screenDepthScrim} />
          <View
            pointerEvents="none"
            style={[
              styles.screenBloomPrimary,
              { backgroundColor: accent.bloomPrimary },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.screenBloomSecondary,
              { backgroundColor: accent.bloomSecondary },
            ]}
          />
        </>
      ) : null}

      <View style={[styles.scrimLayer, { backgroundColor: screenScrimColor }]} />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.centerAtmosphere,
          {
            top: layout.orbCenterY - (layout.orbDiameter * 0.8),
            width: layout.orbDiameter * 1.6,
            height: layout.orbDiameter * 1.6,
            borderRadius: (layout.orbDiameter * 1.6) / 2,
            backgroundColor: accent.diffusion,
            opacity: atmosphereOpacity,
          },
        ]}
      />

      <View
        style={[
          styles.contentWrap,
          {
            paddingTop: layout.orbTopOffset,
            paddingHorizontal: layout.horizontalPadding,
          },
        ]}
      >
        <View style={styles.contentInner}>
          <Animated.View
            testID="breathing-orb-core"
            style={[
              styles.orbCore,
              {
                width: layout.orbDiameter,
                height: layout.orbDiameter,
                borderRadius: layout.orbRadius,
                transform: [{ scale: orbScale }],
              },
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={[accent.orbStart, accent.orbMid, accent.orbEnd]}
              locations={[0.04, 0.5, 1]}
              start={{ x: 0.34, y: 0.2 }}
              end={{ x: 0.8, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

            <Animated.View
              pointerEvents="none"
              testID="breathing-inner-atmosphere"
              style={[
                styles.innerAtmosphere,
                {
                  top: layout.orbDiameter * 0.13,
                  left: layout.orbDiameter * 0.14,
                  width: layout.orbDiameter * 0.72,
                  height: layout.orbDiameter * 0.72,
                  borderRadius: (layout.orbDiameter * 0.72) / 2,
                  backgroundColor: accent.innerAtmosphere,
                  opacity: orbInnerOpacity,
                },
              ]}
            />

            <Animated.View
              pointerEvents="none"
              testID="breathing-guide-ring"
              style={[
                styles.guideRing,
                {
                  width: layout.orbDiameter * 1.1,
                  height: layout.orbDiameter * 1.1,
                  borderRadius: (layout.orbDiameter * 1.1) / 2,
                  borderColor: accent.guideRing,
                  opacity: guideRingOpacity,
                },
              ]}
            />

            <Animated.View style={[styles.primaryLabelWrap, { opacity: primaryOpacity }]}>
              <ModeText variant="h3" tone="primary" style={styles.primaryLabel}>
                {resolvedPrimary}
              </ModeText>
            </Animated.View>
          </Animated.View>

          {hasSecondary ? (
            <Animated.View
              style={[
                styles.secondaryLabelWrap,
                {
                  marginTop: layout.subtitleGap,
                  opacity: secondaryOpacity,
                  maxWidth: layout.subtitleMaxWidth,
                },
              ]}
            >
              <ModeText variant="bodySm" tone="secondary" style={styles.secondaryLabel}>
                {resolvedSecondary}
              </ModeText>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    overflow: 'hidden',
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 44,
    overflow: 'hidden',
  },
  screenDepthScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 13, 24, 0.26)',
  },
  screenBloomPrimary: {
    position: 'absolute',
    left: -140,
    top: -220,
    width: 420,
    height: 420,
    borderRadius: 210,
  },
  screenBloomSecondary: {
    position: 'absolute',
    right: -170,
    bottom: -260,
    width: 470,
    height: 470,
    borderRadius: 235,
  },
  scrimLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  centerAtmosphere: {
    position: 'absolute',
    alignSelf: 'center',
  },
  contentWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  contentInner: {
    alignItems: 'center',
  },
  orbCore: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(22, 38, 62, 0.92)',
  },
  innerAtmosphere: {
    position: 'absolute',
  },
  guideRing: {
    position: 'absolute',
    borderWidth: 1,
  },
  primaryLabelWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  primaryLabel: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: 0.1,
    color: theme.colors.text.primary,
  },
  secondaryLabelWrap: {
    minHeight: 24,
    alignSelf: 'center',
  },
  secondaryLabel: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.04,
    color: theme.colors.text.secondary,
  },
});
