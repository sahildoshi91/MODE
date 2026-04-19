import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '../../theme';

const SURFACE_STATE = {
  default: {
    fill: theme.colors.glass.base,
    border: theme.colors.glass.borderDefault,
    blur: 'surface',
  },
  elevated: {
    fill: theme.colors.glass.elevated,
    border: theme.colors.glass.borderStrong,
    blur: 'elevated',
  },
  active: {
    fill: theme.colors.glass.active,
    border: theme.colors.glass.borderActive,
    blur: 'hero',
  },
  hero: {
    fill: theme.colors.glass.hero,
    border: theme.colors.glass.borderHero,
    blur: 'hero',
  },
  muted: {
    fill: theme.colors.glass.base,
    border: theme.colors.glass.borderSoft,
    blur: 'surface',
  },
};

const SURFACE_MATERIAL = {
  default: {
    interiorColors: [
      theme.colors.glass.interiorTop,
      theme.colors.glass.interiorMid,
      theme.colors.glass.interiorBottom,
    ],
    edgeColor: theme.colors.glass.edgeHighlight,
    edgeOpacity: theme.glass.material.edgeLineOpacity,
    sideLiftColor: theme.colors.glass.innerLift,
    lowerDepthColor: theme.colors.glass.innerShade,
    energyColors: null,
  },
  elevated: {
    interiorColors: [
      theme.colors.glass.interiorTop,
      theme.colors.glass.interiorMid,
      theme.colors.glass.interiorBottom,
    ],
    edgeColor: theme.colors.glass.edgeHighlight,
    edgeOpacity: Math.min(theme.glass.material.edgeLineOpacity + 0.08, 1),
    sideLiftColor: theme.colors.glass.innerLift,
    lowerDepthColor: theme.colors.glass.innerShade,
    energyColors: null,
  },
  active: {
    interiorColors: [
      theme.colors.glass.interiorActiveTop,
      theme.colors.glass.interiorActiveMid,
      theme.colors.glass.interiorActiveBottom,
    ],
    edgeColor: theme.colors.glass.edgeHighlightActive,
    edgeOpacity: theme.glass.material.edgeLineOpacityActive,
    sideLiftColor: theme.colors.glass.edgeHighlightActive,
    lowerDepthColor: theme.colors.glass.interiorActiveBottom,
    energyColors: [
      theme.colors.glass.energyActiveStart,
      theme.colors.glass.energyActiveMid,
      theme.colors.glass.energyActiveEnd,
    ],
  },
  hero: {
    interiorColors: [
      theme.colors.glass.interiorHeroTop,
      theme.colors.glass.interiorHeroMid,
      theme.colors.glass.interiorHeroBottom,
    ],
    edgeColor: theme.colors.glass.edgeHighlightHero,
    edgeOpacity: theme.glass.material.edgeLineOpacityHero,
    sideLiftColor: theme.colors.glass.edgeHighlightHero,
    lowerDepthColor: theme.colors.glass.interiorHeroBottom,
    energyColors: [
      theme.colors.glass.energyHeroStart,
      theme.colors.glass.energyHeroMid,
      theme.colors.glass.energyHeroEnd,
    ],
  },
  muted: {
    interiorColors: [
      theme.colors.glass.interiorTop,
      theme.colors.glass.interiorMid,
      theme.colors.glass.interiorBottom,
    ],
    edgeColor: theme.colors.glass.edgeHighlight,
    edgeOpacity: Math.max(theme.glass.material.edgeLineOpacity - 0.12, 0),
    sideLiftColor: theme.colors.glass.innerLift,
    lowerDepthColor: theme.colors.glass.innerShade,
    energyColors: null,
  },
};

function resolveRadius(radius) {
  if (typeof radius === 'number') {
    return radius;
  }
  if (radius && theme.radii[radius]) {
    return theme.radii[radius];
  }
  return theme.radii.m;
}

function resolveBlur(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && theme.glass.blur[value]) {
    return theme.glass.blur[value];
  }
  return theme.glass.blur.surface;
}

function SurfaceBody({
  children,
  state,
  radius,
  blur,
  noBlur,
  padding = theme.spacing[3],
  fillColor,
  borderColor,
  highlight = true,
  cornerGlow = false,
  gradient = true,
  style,
  contentStyle,
  testID,
  viewProps,
}) {
  const visual = SURFACE_STATE[state] || SURFACE_STATE.default;
  const material = SURFACE_MATERIAL[state] || SURFACE_MATERIAL.default;
  const resolvedRadius = resolveRadius(radius);
  const blurIntensity = resolveBlur(blur || visual.blur);
  const resolvedEdgeTint = borderColor || visual.border;

  return (
    <View
      testID={testID}
      style={[
        styles.shell,
        {
          borderRadius: resolvedRadius,
          backgroundColor: fillColor || visual.fill,
          borderColor: resolvedEdgeTint,
        },
        style,
      ]}
      {...viewProps}
    >
      {!noBlur && Platform.OS === 'ios' ? (
        <BlurView
          intensity={blurIntensity}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {!noBlur && Platform.OS !== 'ios' ? (
        <View style={[StyleSheet.absoluteFill, styles.androidFallback]} />
      ) : null}
      {gradient ? (
        <LinearGradient
          pointerEvents="none"
          colors={material.interiorColors}
          locations={[0, 0.48, 1]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {gradient && material.energyColors ? (
        <LinearGradient
          pointerEvents="none"
          colors={material.energyColors}
          locations={[0, 0.58, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {gradient ? (
        <LinearGradient
          pointerEvents="none"
          colors={[material.sideLiftColor, 'rgba(255,255,255,0)', material.sideLiftColor]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[
            styles.sideLift,
            {
              opacity: theme.glass.material.sideLiftOpacity,
            },
          ]}
        />
      ) : null}
      {gradient ? (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)', material.lowerDepthColor]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[
            styles.lowerDepth,
            {
              opacity: theme.glass.material.lowerDepthOpacity,
            },
          ]}
        />
      ) : null}
      {highlight ? (
        <View
          pointerEvents="none"
          style={[
            styles.edgeHighlightClip,
            {
              opacity: material.edgeOpacity,
            },
            {
              borderTopLeftRadius: resolvedRadius,
              borderTopRightRadius: resolvedRadius,
            },
          ]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={[resolvedEdgeTint || material.edgeColor, 'rgba(255,255,255,0)']}
            locations={[0, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      {cornerGlow ? <View pointerEvents="none" style={styles.cornerGlow} /> : null}

      <View style={[styles.content, { padding }, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

export function GlassSurface({
  children,
  state = 'default',
  radius = 'm',
  blur = null,
  noBlur = false,
  padding,
  style,
  contentStyle,
  fillColor,
  borderColor,
  highlight = true,
  cornerGlow = false,
  gradient = true,
  onPress,
  disabled = false,
  testID,
  pressStyle,
  androidRippleColor = theme.colors.accent.soft,
  ...viewProps
}) {
  if (typeof onPress !== 'function') {
    return (
      <SurfaceBody
        state={state}
        radius={radius}
        blur={blur}
        noBlur={noBlur}
        padding={padding}
        style={style}
        contentStyle={contentStyle}
        fillColor={fillColor}
        borderColor={borderColor}
        highlight={highlight}
        cornerGlow={cornerGlow}
        gradient={gradient}
        testID={testID}
        viewProps={viewProps}
      >
        {children}
      </SurfaceBody>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      android_ripple={{ color: androidRippleColor }}
      {...viewProps}
      style={({ pressed }) => [
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        pressStyle,
      ]}
    >
      <SurfaceBody
        state={state}
        radius={radius}
        blur={blur}
        noBlur={noBlur}
        padding={padding}
        style={style}
        contentStyle={contentStyle}
        fillColor={fillColor}
        borderColor={borderColor}
        highlight={highlight}
        cornerGlow={cornerGlow}
        gradient={gradient}
      >
        {children}
      </SurfaceBody>
    </Pressable>
  );
}

export function GlassCard({
  children,
  style,
  contentStyle,
  state = 'default',
  padding = theme.spacing[3],
  radius = 'l',
  onPress,
  disabled,
  testID,
  fillColor,
  borderColor,
  blur,
}) {
  return (
    <GlassSurface
      testID={testID}
      state={state}
      padding={padding}
      radius={radius}
      style={[styles.card, style]}
      contentStyle={contentStyle}
      onPress={onPress}
      disabled={disabled}
      fillColor={fillColor}
      borderColor={borderColor}
      blur={blur}
    >
      {children}
    </GlassSurface>
  );
}

export function GlassRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
  state = 'default',
  style,
  contentStyle,
  testID,
}) {
  return (
    <GlassSurface
      testID={testID}
      state={state}
      radius="m"
      padding={theme.spacing[2]}
      onPress={onPress}
      style={style}
      contentStyle={[styles.rowContent, contentStyle]}
    >
      <View style={styles.rowLeading}>
        {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
        <View style={styles.rowCopy}>
          {title}
          {subtitle}
        </View>
      </View>
      {trailing ? <View style={styles.rowTrailing}>{trailing}</View> : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
  },
  androidFallback: {
    backgroundColor: 'rgba(14, 22, 36, 0.52)',
  },
  edgeHighlightClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: theme.glass.material.edgeLineHeight,
    overflow: 'hidden',
  },
  sideLift: {
    ...StyleSheet.absoluteFillObject,
  },
  lowerDepth: {
    ...StyleSheet.absoluteFillObject,
  },
  cornerGlow: {
    position: 'absolute',
    top: -18,
    left: -16,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.glass.cornerHighlight,
    opacity: theme.glass.material.cornerGlowOpacity,
  },
  content: {
    zIndex: 2,
  },
  card: {
    marginBottom: theme.spacing[2],
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  rowLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    flex: 1,
  },
  rowIcon: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTrailing: {
    marginLeft: theme.spacing[1],
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  disabled: {
    opacity: theme.interaction.disabledOpacity,
  },
});
