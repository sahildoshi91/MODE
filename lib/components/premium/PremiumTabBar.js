import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '../../theme';
import { GlassSurface } from '../glass/GlassSurface';
import { ModeText } from '../ModeText';

export const PREMIUM_TAB_BAR_BOTTOM_OFFSET = 8;
export const PREMIUM_TAB_BAR_HEIGHT = 56;
const INDICATOR_EDGE_INSET = 5;

export function PremiumTabBar({
  tabs = [],
  activeTab,
  onTabChange,
  bottomInset = 0,
  testID,
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [iconCenters, setIconCenters] = useState({});
  const indicatorX = useRef(new Animated.Value(0)).current;

  const activeIndex = useMemo(() => {
    const found = tabs.findIndex((item) => item.key === activeTab);
    return found >= 0 ? found : 0;
  }, [activeTab, tabs]);

  const tabWidth = containerWidth > 0 && tabs.length > 0 ? containerWidth / tabs.length : 0;
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
      mass: 0.92,
      stiffness: 185,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, activeTab, containerWidth, iconCenters, indicatorWidth, indicatorX, tabWidth]);

  if (!Array.isArray(tabs) || tabs.length === 0) {
    return null;
  }

  return (
    <View
      testID={testID}
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(bottomInset, 0) + PREMIUM_TAB_BAR_BOTTOM_OFFSET }]}
    >
      <GlassSurface
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        state="elevated"
        radius="pill"
        blur="nav"
        padding={INDICATOR_EDGE_INSET}
        style={styles.pill}
        contentStyle={styles.pillContent}
        fillColor={theme.colors.surface.elevated}
        borderColor={theme.colors.glass.borderStrong}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[
            'rgba(255, 255, 255, 0.06)',
            'rgba(255, 255, 255, 0.015)',
            'rgba(0, 0, 0, 0.24)',
          ]}
          locations={[0, 0.52, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
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
              'rgba(143, 178, 255, 0.34)',
              'rgba(123, 162, 255, 0.18)',
              'rgba(47, 77, 134, 0.1)',
            ]}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.activePillTopLight} />
        </Animated.View>

        {tabs.map(({ key, label, Icon }) => {
          const selected = key === activeTab;
          return (
            <Pressable
              key={key}
              onPress={() => onTabChange?.(key)}
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
    minHeight: PREMIUM_TAB_BAR_HEIGHT,
    marginBottom: 0,
    shadowColor: '#01060D',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  pillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: INDICATOR_EDGE_INSET,
  },
  activePill: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: theme.radii.pill,
    overflow: 'hidden',
    backgroundColor: theme.colors.nav.activeBg,
    borderWidth: 1,
    borderColor: theme.colors.nav.activeBorder,
  },
  activePillTopLight: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 2,
    height: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
  tabButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: theme.radii.pill,
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
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: theme.colors.nav.inactiveLabel,
    fontWeight: '500',
  },
});

