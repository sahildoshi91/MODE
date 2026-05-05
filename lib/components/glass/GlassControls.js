import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '../../theme';
import { GlassSurface } from './GlassSurface';

function resolveButtonVisual(variant) {
  if (variant === 'secondary') {
    return {
      state: 'elevated',
      fillColor: theme.colors.cta.secondaryBg,
      borderColor: theme.colors.cta.secondaryBorder,
      textColor: theme.colors.cta.secondaryText,
    };
  }
  return {
    state: 'hero',
    fillColor: theme.colors.cta.primaryBg,
    borderColor: theme.colors.cta.primaryBorder,
    textColor: theme.colors.cta.primaryText,
  };
}

export function GlassPill({
  label,
  selected = false,
  disabled = false,
  onPress,
  style,
  textStyle,
  testID,
}) {
  const isInteractive = typeof onPress === 'function';
  return (
    <GlassSurface
      testID={testID}
      state={selected ? 'active' : 'default'}
      radius="pill"
      padding={0}
      disabled={disabled}
      onPress={isInteractive ? onPress : undefined}
      highlight={selected}
      style={[
        styles.pill,
        selected && styles.pillSelected,
        disabled && styles.pillDisabled,
        style,
      ]}
      contentStyle={styles.pillContent}
      fillColor={selected ? theme.colors.nav.activeBg : theme.colors.glass.elevated}
      borderColor={selected ? theme.colors.nav.activeBorder : theme.colors.glass.borderSoft}
    >
      <Text
        style={[
          styles.pillLabel,
          selected ? styles.pillLabelSelected : styles.pillLabelIdle,
          disabled && styles.pillLabelDisabled,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </GlassSurface>
  );
}

function GlassButton({
  title,
  onPress,
  disabled = false,
  style,
  textStyle,
  testID,
  variant,
}) {
  const visual = resolveButtonVisual(variant);
  return (
    <GlassSurface
      testID={testID}
      state={visual.state}
      radius="pill"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, style]}
      contentStyle={styles.buttonContent}
      fillColor={visual.fillColor}
      borderColor={visual.borderColor}
    >
      <Text
        style={[
          styles.buttonLabel,
          { color: visual.textColor },
          disabled && styles.buttonLabelDisabled,
          textStyle,
        ]}
      >
        {title}
      </Text>
    </GlassSurface>
  );
}

export function GlassButtonPrimary(props) {
  return <GlassButton {...props} variant="primary" />;
}

export function GlassButtonSecondary(props) {
  return <GlassButton {...props} variant="secondary" />;
}

export function GlassToggle({
  value,
  onValueChange,
  disabled = false,
  testID,
  style,
}) {
  const animated = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(animated, {
      toValue: value ? 1 : 0,
      damping: theme.motion.spring.damping,
      stiffness: theme.motion.spring.stiffness,
      mass: theme.motion.spring.mass,
      useNativeDriver: true,
    }).start();
  }, [animated, value]);

  const translateX = animated.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 20],
  });

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (!disabled && typeof onValueChange === 'function') {
          onValueChange(!value);
        }
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: Boolean(value), disabled }}
      style={({ pressed }) => [
        styles.toggleWrap,
        value && styles.toggleWrapOn,
        disabled && styles.toggleWrapDisabled,
        pressed && !disabled && styles.togglePressed,
        style,
      ]}
    >
      <GlassSurface
        state={value ? 'active' : 'default'}
        radius="pill"
        padding={0}
        highlight={false}
        style={styles.toggleTrack}
        contentStyle={styles.toggleTrackContent}
        fillColor={value ? theme.colors.glass.active : theme.colors.glass.base}
        borderColor={value ? theme.colors.glass.borderActive : theme.colors.glass.borderSoft}
      >
        <Animated.View
          style={[
            styles.toggleThumb,
            {
              transform: [{ translateX }],
            },
          ]}
        />
      </GlassSurface>
    </Pressable>
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function GlassSlider({
  value = 0,
  onChange,
  onComplete,
  min = 0,
  max = 1,
  disabled = false,
  style,
  testID,
}) {
  const [trackWidth, setTrackWidth] = useState(1);
  const [isPressed, setIsPressed] = useState(false);
  const startValueRef = useRef(value);
  const range = Math.max(max - min, 0.0001);
  const normalized = clamp((value - min) / range, 0, 1);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: () => {
      setIsPressed(true);
      startValueRef.current = value;
    },
    onPanResponderMove: (_event, gestureState) => {
      const next = clamp(startValueRef.current + ((gestureState.dx / trackWidth) * range), min, max);
      onChange?.(next);
    },
    onPanResponderRelease: (_event, gestureState) => {
      setIsPressed(false);
      const next = clamp(startValueRef.current + ((gestureState.dx / trackWidth) * range), min, max);
      onComplete?.(next);
    },
    onPanResponderTerminate: () => {
      setIsPressed(false);
    },
  }), [disabled, max, min, onChange, onComplete, range, trackWidth, value]);

  return (
    <View
      testID={testID}
      style={[styles.sliderWrap, style]}
      onLayout={(event) => {
        setTrackWidth(Math.max(event.nativeEvent.layout.width, 1));
      }}
      {...panResponder.panHandlers}
    >
      <GlassSurface
        state="default"
        radius="pill"
        padding={0}
        highlight={false}
        style={styles.sliderTrack}
        contentStyle={styles.sliderTrackContent}
      >
        <View style={[styles.sliderFill, { width: `${normalized * 100}%` }]} />
        <View
          style={[
            styles.sliderThumb,
            {
              left: `${normalized * 100}%`,
            },
            isPressed && styles.sliderThumbPressed,
            disabled && styles.sliderThumbDisabled,
          ]}
        />
      </GlassSurface>
    </View>
  );
}

export function GlassInputBar({
  value,
  onChangeText,
  onSend,
  onCancel,
  isSending = false,
  disabled = false,
  placeholder = 'Tell your coach what you need...',
  testID,
  style,
  onFocus,
  maxLength = 1200,
}) {
  const hasValue = typeof value === 'string' && value.trim().length > 0;
  const sendDisabled = isSending ? false : (disabled || !hasValue);
  const sendButtonGradientColors = sendDisabled
    ? [
      'rgba(247, 251, 255, 0.10)',
      'rgba(245, 250, 255, 0.03)',
      'rgba(10, 18, 32, 0.20)',
    ]
    : [
      'rgba(247, 251, 255, 0.22)',
      'rgba(177, 208, 255, 0.10)',
      'rgba(16, 31, 56, 0.28)',
    ];
  const sendButtonTopLight = sendDisabled
    ? 'rgba(246, 251, 255, 0.14)'
    : 'rgba(251, 254, 255, 0.26)';

  return (
    <GlassSurface
      testID={testID}
      state="hero"
      radius="xl"
      blur="input"
      style={[styles.inputBar, style]}
      contentStyle={styles.inputBarContent}
      fillColor={theme.colors.surface.input}
      borderColor={theme.colors.glass.borderActive}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        editable={!disabled}
        multiline
        placeholder={placeholder}
        placeholderTextColor="rgba(232, 243, 255, 0.76)"
        selectionColor={theme.colors.accent.primary}
        maxLength={maxLength}
        maxFontSizeMultiplier={1.1}
        autoCapitalize="sentences"
        autoCorrect
        blurOnSubmit={false}
        style={styles.inputField}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isSending ? 'Stop response' : (disabled ? 'Sending message' : 'Send message')}
        onPress={isSending ? onCancel : onSend}
        disabled={sendDisabled}
        hitSlop={10}
        style={({ pressed }) => [
          styles.inputSendButton,
          !sendDisabled && styles.inputSendButtonEnabled,
          sendDisabled && styles.inputSendButtonDisabled,
          pressed && !sendDisabled && styles.inputSendButtonPressed,
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={sendButtonGradientColors}
          locations={[0, 0.52, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            styles.inputSendButtonTopLight,
            {
              backgroundColor: sendButtonTopLight,
            },
          ]}
        />
        <Feather
          name={isSending ? 'square' : 'arrow-up'}
          size={16}
          color={sendDisabled ? theme.colors.text.disabled : theme.colors.text.inverse}
          style={styles.inputSendIconWrap}
        />
      </Pressable>
    </GlassSurface>
  );
}

export function FloatingQuickActionChip({
  label,
  onPress,
  disabled = false,
  testID,
  style,
}) {
  return (
    <GlassPill
      testID={testID}
      label={label}
      onPress={onPress}
      disabled={disabled}
      style={[styles.quickActionChip, style]}
      textStyle={styles.quickActionLabel}
    />
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 34,
    minWidth: 40,
  },
  pillContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '600',
    textAlign: 'center',
  },
  pillLabelIdle: {
    color: theme.colors.text.secondary,
  },
  pillLabelSelected: {
    color: theme.colors.text.primary,
    fontWeight: '700',
  },
  pillLabelDisabled: {
    color: theme.colors.text.disabled,
  },
  pillDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  pillSelected: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.12,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  button: {
    minHeight: 50,
  },
  buttonContent: {
    minHeight: 50,
    paddingHorizontal: theme.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.button.fontSize,
    lineHeight: theme.typography.button.lineHeight,
    fontWeight: theme.typography.button.fontWeight,
    letterSpacing: theme.typography.button.letterSpacing,
    textAlign: 'center',
  },
  buttonLabelDisabled: {
    color: theme.colors.text.disabled,
  },
  toggleWrap: {
    alignSelf: 'flex-start',
  },
  toggleWrapOn: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  toggleWrapDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  togglePressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  toggleTrack: {
    width: 44,
    height: 24,
  },
  toggleTrackContent: {
    padding: 0,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: 2,
    backgroundColor: '#F2F7FF',
    shadowColor: '#0A1427',
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  sliderWrap: {
    width: '100%',
  },
  sliderTrack: {
    width: '100%',
    height: 20,
  },
  sliderTrackContent: {
    padding: 0,
    justifyContent: 'center',
  },
  sliderFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.accent.primary,
    opacity: 0.78,
    marginLeft: 0,
    marginRight: 0,
    marginTop: 8,
  },
  sliderThumb: {
    position: 'absolute',
    top: 2,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EEF5FF',
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  sliderThumbPressed: {
    transform: [{ scale: 1.08 }],
  },
  sliderThumbDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  inputBar: {
    width: '100%',
  },
  inputBarContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  inputField: {
    flex: 1,
    minHeight: 42,
    maxHeight: 112,
    color: 'rgba(255, 255, 255, 0.96)',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  inputSendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    backgroundColor: theme.colors.glass.elevated,
    overflow: 'hidden',
  },
  inputSendButtonEnabled: {
    backgroundColor: theme.colors.cta.primaryBg,
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.18,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  inputSendButtonDisabled: {
    backgroundColor: theme.colors.glass.base,
  },
  inputSendButtonTopLight: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 2,
    height: 1,
    borderRadius: 1,
  },
  inputSendIconWrap: {
    zIndex: 2,
  },
  inputSendButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  quickActionChip: {
    minHeight: 32,
  },
  quickActionLabel: {
    fontWeight: '500',
  },
});
