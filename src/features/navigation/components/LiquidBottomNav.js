import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { BarChart3, Dumbbell, Home, User, Users } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { GlassSurface, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const CLIENT_TABS = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
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

export const NAV_BOTTOM_OFFSET = 10;
export const NAV_PILL_HEIGHT = 64;
const INDICATOR_EDGE_INSET = 6;

export default function LiquidBottomNav({
  activeTab,
  onTabChange,
  bottomInset = 0,
  role = 'client',
  trainerNavMode = 'coach_os',
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [iconCenters, setIconCenters] = useState({});
  const indicatorX = useRef(new Animated.Value(0)).current;
  const tabs = role === 'trainer'
    ? (trainerNavMode === 'legacy' ? TRAINER_TABS_LEGACY : TRAINER_TABS_COACH_OS)
    : CLIENT_TABS;

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
      <GlassSurface
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        state="hero"
        radius="pill"
        blur="nav"
        padding={INDICATOR_EDGE_INSET}
        style={styles.pill}
        contentStyle={styles.pillContent}
        fillColor={theme.colors.surface.elevated}
        borderColor={theme.colors.glass.borderSoft}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[
            'rgba(248, 252, 255, 0.05)',
            'rgba(178, 206, 255, 0.02)',
            'rgba(5, 10, 20, 0.22)',
          ]}
          locations={[0, 0.48, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.slabDepth}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activePill,
            {
              width: indicatorWidth,
              transform: [{ translateX: indicatorX }],
            },
          ]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={[
              'rgba(162, 201, 255, 0.32)',
              'rgba(126, 176, 255, 0.15)',
              'rgba(79, 129, 209, 0.08)',
            ]}
            locations={[0, 0.48, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.activePillTopLight} />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(6, 13, 25, 0.22)']}
            locations={[0, 0.58, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.activePillLowerDepth}
          />
        </Animated.View>

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
                selected && styles.tabButtonActive,
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
      </GlassSurface>
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
    minHeight: NAV_PILL_HEIGHT,
    marginBottom: 0,
    ...theme.shadows.soft,
  },
  pillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: INDICATOR_EDGE_INSET,
  },
  slabDepth: {
    ...StyleSheet.absoluteFillObject,
  },
  activePill: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: theme.radii.pill,
    overflow: 'hidden',
    backgroundColor: theme.colors.nav.activeBg,
  },
  activePillTopLight: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 2,
    height: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(250, 253, 255, 0.28)',
  },
  activePillLowerDepth: {
    ...StyleSheet.absoluteFillObject,
  },
  tabButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: theme.radii.pill,
  },
  tabButtonActive: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.14,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
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
    fontWeight: '500',
  },
});
