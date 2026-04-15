import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { BarChart3, Dumbbell, Home, User, Users } from 'lucide-react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const CLIENT_TABS = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'progress', label: 'Progress', Icon: BarChart3 },
  { key: 'profile', label: 'Settings', Icon: User },
];

const TRAINER_TABS = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'clients', label: 'Clients', Icon: Users },
  { key: 'profile', label: 'Settings', Icon: User },
];

const NAV_BOTTOM_OFFSET = 10;
const INDICATOR_EDGE_INSET = 6;

export default function LiquidBottomNav({
  activeTab,
  onTabChange,
  bottomInset = 0,
  role = 'client',
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [iconCenters, setIconCenters] = useState({});
  const indicatorX = useRef(new Animated.Value(0)).current;
  const tabs = role === 'trainer' ? TRAINER_TABS : CLIENT_TABS;

  const activeIndex = useMemo(() => {
    const found = tabs.findIndex((item) => item.key === activeTab);
    return found >= 0 ? found : 0;
  }, [activeTab, tabs]);

  const tabWidth = containerWidth > 0 ? containerWidth / tabs.length : 0;
  const indicatorWidth = Math.max(0, tabWidth - (INDICATOR_EDGE_INSET * 2));

  useEffect(() => {
    const fallbackX = tabWidth * activeIndex + INDICATOR_EDGE_INSET;
    const measuredCenter = iconCenters[activeTab];
    const measuredX = typeof measuredCenter === 'number'
      ? measuredCenter - (indicatorWidth / 2)
      : fallbackX;
    const maxX = Math.max(INDICATOR_EDGE_INSET, containerWidth - indicatorWidth - INDICATOR_EDGE_INSET);
    const targetX = Math.min(Math.max(measuredX, INDICATOR_EDGE_INSET), maxX);

    Animated.spring(indicatorX, {
      toValue: targetX,
      damping: 16,
      mass: 0.95,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, activeTab, containerWidth, iconCenters, indicatorWidth, indicatorX, tabWidth]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(bottomInset, 0) + NAV_BOTTOM_OFFSET }]}
    >
      <View
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        style={styles.pill}
      >
        <View pointerEvents="none" style={styles.backdrop} />
        {Platform.OS === 'ios' ? (
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[
            styles.activePill,
            {
              width: indicatorWidth,
              transform: [{ translateX: indicatorX }],
            },
          ]}
        />

        {tabs.map(({ key, label, Icon }) => {
          const selected = key === activeTab;
          return (
            <Pressable
              key={key}
              onPress={() => onTabChange(key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={8}
              android_ripple={{ color: theme.colors.accent.soft }}
              style={({ pressed }) => [
                styles.tabButton,
                pressed && styles.tabButtonPressed,
              ]}
              onLayout={(event) => {
                const centerX = event.nativeEvent.layout.x + (event.nativeEvent.layout.width / 2);
                setIconCenters((prev) => {
                  if (prev[key] === centerX) {
                    return prev;
                  }
                  return {
                    ...prev,
                    [key]: centerX,
                  };
                });
              }}
            >
              <Icon
                size={18}
                color={selected ? theme.colors.nav.activeIcon : theme.colors.nav.inactiveIcon}
                strokeWidth={2.2}
              />
              <ModeText
                variant="caption"
                tone="primary"
                style={selected ? styles.tabLabelActive : styles.tabLabelInactive}
              >
                {label}
              </ModeText>
            </Pressable>
          );
        })}
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
  pill: {
    width: '92%',
    maxWidth: 460,
    minWidth: 280,
    borderRadius: theme.radii.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    padding: INDICATOR_EDGE_INSET,
    backgroundColor: theme.colors.surface.glass,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    ...theme.shadows.medium,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface.base,
    opacity: 0.84,
  },
  activePill: {
    position: 'absolute',
    top: INDICATOR_EDGE_INSET,
    bottom: INDICATOR_EDGE_INSET,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.nav.activeBg,
    borderWidth: 1,
    borderColor: theme.colors.nav.activeBorder,
  },
  tabButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: theme.radii.pill,
  },
  tabButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  tabLabelActive: {
    color: theme.colors.nav.activeLabel,
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: theme.colors.nav.inactiveLabel,
    fontWeight: '600',
  },
});
