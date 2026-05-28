import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { BarChart3, Dumbbell, Home, User, Users } from 'lucide-react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const Reanimated = process.env.JEST_WORKER_ID
  ? {
    default: { View },
    useAnimatedStyle: (updater) => updater(),
    useSharedValue: (initialValue) => ({ value: initialValue }),
    withSpring: (targetValue) => targetValue,
  }
  : require('react-native-reanimated');
const Animated = Reanimated.default;
const { useAnimatedStyle, useSharedValue, withSpring } = Reanimated;

const CLIENT_TABS = [
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'progress', label: 'Progress', Icon: BarChart3 },
  { key: 'profile', label: 'Settings', Icon: User },
];

const TRAINER_TABS_COACH_OS = [
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'clients', label: 'Clients', Icon: Users },
  { key: 'system', label: 'System', Icon: User },
];

const TRAINER_TABS_LEGACY = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'clients', label: 'Clients', Icon: Users },
  { key: 'profile', label: 'Settings', Icon: User },
];

const SPRING_CONFIG = { damping: 18, stiffness: 200, mass: 0.8 };
const ACTIVE_OPACITY = 1;
const INACTIVE_OPACITY = 0.58;

export const NAV_BOTTOM_OFFSET = 8;
export const NAV_PILL_HEIGHT = 56;

function LiquidNavTab({
  tab,
  index,
  selected,
  activeIndex,
  onLayout,
  onPress,
}) {
  const { Icon, label } = tab;
  const iconStyle = useAnimatedStyle(() => ({
    opacity: withSpring(
      activeIndex.value === index ? ACTIVE_OPACITY : INACTIVE_OPACITY,
      SPRING_CONFIG,
    ),
  }));

  return (
    <Pressable
      onLayout={onLayout}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={8}
      android_ripple={{ color: 'rgba(255,255,255,0.08)', borderless: false }}
      style={({ pressed }) => [
        styles.tabButton,
        selected && styles.tabButtonActive,
        pressed && styles.tabButtonPressed,
      ]}
    >
      <Animated.View pointerEvents="none" style={iconStyle}>
        <Icon
          size={18}
          color={theme.colors.nav.activeIcon}
          strokeWidth={2.2}
        />
      </Animated.View>
      <ModeText
        variant="caption"
        tone="primary"
        numberOfLines={1}
        style={selected ? styles.tabLabelActive : styles.tabLabelInactive}
      >
        {label}
      </ModeText>
    </Pressable>
  );
}

export default function LiquidBottomNav({
  activeTab,
  onTabChange,
  bottomInset = 0,
  role = 'client',
  trainerNavMode = 'coach_os',
}) {
  const tabs = role === 'trainer'
    ? (trainerNavMode === 'legacy' ? TRAINER_TABS_LEGACY : TRAINER_TABS_COACH_OS)
    : CLIENT_TABS;
  const tabLayouts = useRef(Array.from({ length: tabs.length }, () => null));
  const hasPositionedPill = useRef(false);
  const previousTabs = useRef(tabs);

  const activeIndex = useSharedValue(0);
  const pillX = useSharedValue(0);
  const pillY = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillHeight = useSharedValue(0);
  const pillOpacity = useSharedValue(0);

  const selectedIndex = useMemo(() => {
    const foundIndex = tabs.findIndex((item) => item.key === activeTab);
    return foundIndex >= 0 ? foundIndex : 0;
  }, [activeTab, tabs]);

  if (previousTabs.current !== tabs) {
    previousTabs.current = tabs;
    tabLayouts.current = Array.from({ length: tabs.length }, () => null);
    hasPositionedPill.current = false;
  }

  const applyPillLayout = useCallback((layout, animated) => {
    if (!layout) {
      return;
    }

    pillX.value = animated ? withSpring(layout.x, SPRING_CONFIG) : layout.x;
    pillY.value = animated ? withSpring(layout.y, SPRING_CONFIG) : layout.y;
    pillWidth.value = animated ? withSpring(layout.width, SPRING_CONFIG) : layout.width;
    pillHeight.value = animated ? withSpring(layout.height, SPRING_CONFIG) : layout.height;
    pillOpacity.value = animated ? withSpring(ACTIVE_OPACITY, SPRING_CONFIG) : ACTIVE_OPACITY;
    hasPositionedPill.current = true;
  }, [pillHeight, pillOpacity, pillWidth, pillX, pillY]);

  const movePillToIndex = useCallback((index, animated = true) => {
    applyPillLayout(tabLayouts.current[index], animated);
  }, [applyPillLayout]);

  useEffect(() => {
    activeIndex.value = selectedIndex;
    movePillToIndex(selectedIndex, hasPositionedPill.current);
  }, [activeIndex, movePillToIndex, selectedIndex]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillOpacity.value,
    width: pillWidth.value,
    height: pillHeight.value,
    transform: [
      { translateX: pillX.value },
      { translateY: pillY.value },
    ],
  }));

  if (!Array.isArray(tabs) || tabs.length === 0) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(bottomInset, 0) + NAV_BOTTOM_OFFSET }]}
    >
      <View style={styles.navContainer}>
        <Animated.View
          pointerEvents="none"
          style={[styles.activePill, pillStyle]}
        >
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={styles.activePillTopHighlight} />
        </Animated.View>

        {tabs.map((tab, index) => (
          <LiquidNavTab
            key={tab.key}
            tab={tab}
            index={index}
            selected={tab.key === activeTab}
            activeIndex={activeIndex}
            onLayout={(event) => {
              const { x, y, width, height } = event.nativeEvent.layout;
              tabLayouts.current[index] = { x, y, width, height };
              if (index === activeIndex.value) {
                movePillToIndex(index, hasPositionedPill.current);
              }
            }}
            onPress={() => {
              activeIndex.value = index;
              movePillToIndex(index, true);
              onTabChange?.(tab.key);
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  navContainer: {
    width: '92%',
    maxWidth: 460,
    minWidth: 280,
    minHeight: NAV_PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    padding: 7,
    borderRadius: 26,
    backgroundColor: 'rgba(8,14,28,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#01060D',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  activePill: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 0,
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 0,
  },
  activePillTopHighlight: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 1,
    height: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  tabButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 20,
    zIndex: 1,
  },
  tabButtonActive: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  tabButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  tabLabelActive: {
    color: theme.colors.nav.activeLabel,
    fontWeight: '600',
    opacity: ACTIVE_OPACITY,
  },
  tabLabelInactive: {
    color: '#EEF3FF',
    fontWeight: '400',
    opacity: INACTIVE_OPACITY,
  },
});
