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
import Svg, {
  Circle,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { BREATHING_CONTEXT, getBreathingCopy } from './breathingCopy';
import { getBreathingLayout } from './breathingLayout';
import { BREATHING_PHASE, useBreathingTransitionMachine } from './useBreathingTransitionMachine';
import { useReducedMotionPreference } from './useReducedMotionPreference';

const DEFAULT_PRIMARY_COPY = 'Take a breath.';

const ACCENT_TONES = Object.freeze({
  default: Object.freeze({
    orbStart: 'rgba(83, 118, 174, 0.58)',
    orbMid: 'rgba(34, 56, 88, 0.78)',
    orbEnd: 'rgba(10, 19, 34, 0.94)',
    innerAtmosphere: 'rgba(174, 203, 255, 0.26)',
    auraCore: 'rgba(132, 166, 238, 0.28)',
    auraMid: 'rgba(82, 120, 198, 0.12)',
    auraEdge: 'rgba(20, 36, 62, 0)',
    diffusion: 'rgba(96, 132, 210, 0.16)',
    bloomPrimary: 'rgba(86, 122, 188, 0.14)',
    bloomSecondary: 'rgba(55, 85, 139, 0.1)',
  }),
  cool: Object.freeze({
    orbStart: 'rgba(74, 112, 178, 0.54)',
    orbMid: 'rgba(29, 54, 91, 0.78)',
    orbEnd: 'rgba(9, 19, 34, 0.94)',
    innerAtmosphere: 'rgba(166, 199, 255, 0.24)',
    auraCore: 'rgba(116, 158, 228, 0.24)',
    auraMid: 'rgba(74, 116, 196, 0.1)',
    auraEdge: 'rgba(17, 34, 58, 0)',
    diffusion: 'rgba(84, 124, 202, 0.14)',
    bloomPrimary: 'rgba(74, 115, 184, 0.14)',
    bloomSecondary: 'rgba(48, 80, 134, 0.09)',
  }),
  quiet: Object.freeze({
    orbStart: 'rgba(61, 92, 143, 0.48)',
    orbMid: 'rgba(27, 47, 78, 0.76)',
    orbEnd: 'rgba(10, 18, 31, 0.94)',
    innerAtmosphere: 'rgba(154, 186, 245, 0.2)',
    auraCore: 'rgba(104, 138, 199, 0.2)',
    auraMid: 'rgba(67, 96, 152, 0.08)',
    auraEdge: 'rgba(16, 29, 50, 0)',
    diffusion: 'rgba(74, 104, 160, 0.12)',
    bloomPrimary: 'rgba(63, 94, 148, 0.11)',
    bloomSecondary: 'rgba(42, 66, 108, 0.08)',
  }),
});

export const BREATHING_MOTION_TARGETS = Object.freeze({
  scale: Object.freeze({
    rest: 0.84,
    inhale: 1.15,
    hold: 1.15,
    exhale: 0.84,
    settling: 0.96,
  }),
  atmosphere: Object.freeze({
    base: Object.freeze({
      screen: 0.18,
      overlay: 0.12,
    }),
    inhale: Object.freeze({
      screen: 0.34,
      overlay: 0.24,
    }),
    hold: Object.freeze({
      screen: 0.28,
      overlay: 0.19,
    }),
    exhale: Object.freeze({
      screen: 0.1,
      overlay: 0.06,
    }),
  }),
  auraOpacity: Object.freeze({
    entering: 0.16,
    inhale: 0.42,
    hold: 0.34,
    exhale: 0.16,
    settling: 0.22,
  }),
  orbInnerOpacity: Object.freeze({
    entering: 0.16,
    inhale: 0.3,
    hold: 0.28,
    exhale: 0.12,
    settling: 0.17,
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

function resolvePrimaryCopy({ title, phase }) {
  const resolvedTitle = normalizeText(title);
  if (resolvedTitle && resolvedTitle !== DEFAULT_PRIMARY_COPY) {
    return resolvedTitle;
  }

  if (
    phase === BREATHING_PHASE.EXHALE
    || phase === BREATHING_PHASE.SETTLING
    || phase === BREATHING_PHASE.EXITING
  ) {
    return 'Exhale';
  }

  return 'Inhale';
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

function BreathingAura({ size, accent }) {
  const center = size / 2;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <RadialGradient id="breathingOuterAura" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={accent.auraCore} />
          <Stop offset="42%" stopColor={accent.auraMid} />
          <Stop offset="100%" stopColor={accent.auraEdge} />
        </RadialGradient>
        <RadialGradient id="breathingOuterAuraLift" cx="50%" cy="44%" r="42%">
          <Stop offset="0%" stopColor={accent.innerAtmosphere} stopOpacity="0.24" />
          <Stop offset="58%" stopColor={accent.auraMid} stopOpacity="0.08" />
          <Stop offset="100%" stopColor={accent.auraEdge} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={center} cy={center} r={center} fill="url(#breathingOuterAura)" />
      <Circle cx={center} cy={center * 0.9} r={center * 0.68} fill="url(#breathingOuterAuraLift)" />
    </Svg>
  );
}

function InnerBloom({ size, accent }) {
  const center = size / 2;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <RadialGradient id="breathingInnerBloom" cx="50%" cy="44%" r="55%">
          <Stop offset="0%" stopColor={accent.innerAtmosphere} stopOpacity="0.9" />
          <Stop offset="55%" stopColor={accent.innerAtmosphere} stopOpacity="0.28" />
          <Stop offset="100%" stopColor="rgba(0, 0, 0, 0)" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={center} cy={center} r={center} fill="url(#breathingInnerBloom)" />
    </Svg>
  );
}

export default function BreathingTransitionOverlay({
  active,
  context = BREATHING_CONTEXT.SHELL_BOOTSTRAP,
  variant = 'overlay',
  showAfterMs = 140,
  minVisibleMs = 280,
  inhaleMs = 4000,
  holdMs = 550,
  exhaleMs = 4000,
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
  const orbScale = useRef(new Animated.Value(
    shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.rest,
  )).current;
  const atmosphereOpacity = useRef(new Animated.Value(0)).current;
  const orbInnerOpacity = useRef(new Animated.Value(0)).current;
  const auraOpacity = useRef(new Animated.Value(0)).current;
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

  const resolvedPrimary = useMemo(() => resolvePrimaryCopy({
    title,
    phase,
  }), [phase, title]);
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
      auraOpacity.setValue(0);
      primaryOpacity.setValue(0);
      secondaryOpacity.setValue(0);
      orbScale.setValue(shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.rest);
      return;
    }

    const inhaleCurve = Easing.bezier(0.3, 0.0, 0.22, 1);
    const exhaleCurve = Easing.bezier(0.34, 0.0, 0.18, 1);
    const motionDuration = Math.max(1, durationMs || 0);
    const inhaleGlowDelay = Math.min(
      Math.round(motionDuration * 0.18),
      Math.max(0, motionDuration - 1),
    );

    const baseAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.base);
    const inhaleAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.inhale);
    const holdAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.hold);
    const exhaleAtmosphere = resolveVariantMotionValue(variant, BREATHING_MOTION_TARGETS.atmosphere.exhale);

    if (phase === BREATHING_PHASE.ENTERING) {
      orbScale.setValue(shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.rest);
      phaseAnimationRef.current = Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: motionDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(orbScale, {
          toValue: shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.rest,
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
        Animated.timing(auraOpacity, {
          toValue: BREATHING_MOTION_TARGETS.auraOpacity.entering,
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
        Animated.sequence([
          Animated.delay(inhaleGlowDelay),
          Animated.timing(atmosphereOpacity, {
            toValue: inhaleAtmosphere,
            duration: Math.max(1, motionDuration - inhaleGlowDelay),
            easing: inhaleCurve,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(orbInnerOpacity, {
          toValue: BREATHING_MOTION_TARGETS.orbInnerOpacity.inhale,
          duration: motionDuration,
          easing: inhaleCurve,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(inhaleGlowDelay),
          Animated.timing(auraOpacity, {
            toValue: BREATHING_MOTION_TARGETS.auraOpacity.inhale,
            duration: Math.max(1, motionDuration - inhaleGlowDelay),
            easing: inhaleCurve,
            useNativeDriver: true,
          }),
        ]),
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
        Animated.timing(auraOpacity, {
          toValue: BREATHING_MOTION_TARGETS.auraOpacity.hold,
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
        Animated.timing(auraOpacity, {
          toValue: BREATHING_MOTION_TARGETS.auraOpacity.exhale,
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
          toValue: shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.settling,
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
        Animated.timing(auraOpacity, {
          toValue: BREATHING_MOTION_TARGETS.auraOpacity.settling,
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
        Animated.timing(auraOpacity, {
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
          toValue: shouldReduceMotion ? 1 : BREATHING_MOTION_TARGETS.scale.settling,
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
    auraOpacity,
  ]);

  useEffect(() => () => {
    stopAnimation(phaseAnimationRef);
  }, []);

  if (!isMounted) {
    return null;
  }

  const pointerEvents = shouldBlockPointerEvents ? 'auto' : 'none';
  const screenScrimColor = variant === 'screen' ? 'rgba(5, 11, 21, 0.52)' : 'rgba(5, 11, 21, 0.64)';
  const auraSize = layout.orbDiameter * 2.26;
  const auraOffset = (auraSize - layout.orbDiameter) / 2;
  const innerBloomSize = layout.orbDiameter * 0.78;

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
            testID="breathing-orb-shell"
            style={[
              styles.orbShell,
              {
                width: layout.orbDiameter,
                height: layout.orbDiameter,
                transform: [{ scale: orbScale }],
              },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              testID="breathing-outer-aura"
              style={[
                styles.outerAura,
                {
                  top: -auraOffset,
                  left: -auraOffset,
                  width: auraSize,
                  height: auraSize,
                  opacity: auraOpacity,
                },
              ]}
            >
              <BreathingAura size={auraSize} accent={accent} />
            </Animated.View>

            <View
              testID="breathing-orb-core"
              style={[
                styles.orbCore,
                {
                  width: layout.orbDiameter,
                  height: layout.orbDiameter,
                  borderRadius: layout.orbRadius,
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
                    top: layout.orbDiameter * 0.1,
                    left: layout.orbDiameter * 0.11,
                    width: innerBloomSize,
                    height: innerBloomSize,
                    opacity: orbInnerOpacity,
                  },
                ]}
              >
                <InnerBloom size={innerBloomSize} accent={accent} />
              </Animated.View>

              <Animated.View style={[styles.primaryLabelWrap, { opacity: primaryOpacity }]}>
                <ModeText variant="h3" tone="primary" style={styles.primaryLabel}>
                  {resolvedPrimary}
                </ModeText>
              </Animated.View>
            </View>
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
  orbShell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerAura: {
    position: 'absolute',
  },
  orbCore: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 29, 48, 0.86)',
  },
  innerAtmosphere: {
    position: 'absolute',
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
