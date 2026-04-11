import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
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
  const indicatorWidth = Math.max(0, tabWidth - 10);

  useEffect(() => {
    const fallbackX = tabWidth * activeIndex + 5;
    const measuredCenter = iconCenters[activeTab];
    const measuredX = typeof measuredCenter === 'number' ? measuredCenter - indicatorWidth / 2 : fallbackX;
    const maxX = Math.max(5, containerWidth - indicatorWidth - 5);
    const targetX = Math.min(Math.max(measuredX, 5), maxX);

    Animated.spring(indicatorX, {
      toValue: targetX,
      damping: 16,
      mass: 0.9,
      stiffness: 170,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, activeTab, containerWidth, iconCenters, indicatorWidth, indicatorX, tabWidth]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(bottomInset, 0) + 12 }]}
    >
      <View
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        style={styles.pill}
      >
        <View pointerEvents="none" style={styles.lightFallback} />
        <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFill} />
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
              style={({ pressed }) => [
                styles.tabButton,
                pressed && styles.tabButtonPressed,
              ]}
              onLayout={(event) => {
                const centerX = event.nativeEvent.layout.x + event.nativeEvent.layout.width / 2;
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
                color={selected ? theme.colors.brand.progressDeep : theme.colors.text.tertiary}
                strokeWidth={2.2}
              />
              <ModeText
                variant="caption"
                tone={selected ? 'accent' : 'tertiary'}
                style={selected ? styles.tabLabelActive : null}
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
    padding: 5,
    backgroundColor: theme.colors.surface.overlay,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    ...theme.shadows.medium,
  },
  lightFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface.base,
    opacity: 0.94,
  },
  activePill: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    borderRadius: theme.radii.pill,
    backgroundColor: 'rgba(111, 143, 123, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(111, 143, 123, 0.42)',
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
    transform: [{ scale: 0.96 }],
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
