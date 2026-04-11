import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { BarChart3, Dumbbell, Home, User } from 'lucide-react-native';

import { theme } from '../../../../lib/theme';

const TABS = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'coach', label: 'Coach', Icon: Dumbbell },
  { key: 'progress', label: 'Progress', Icon: BarChart3 },
  { key: 'profile', label: 'Profile', Icon: User },
];

export default function LiquidBottomNav({
  activeTab,
  onTabChange,
  bottomInset = 0,
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [iconCenters, setIconCenters] = useState({});
  const indicatorX = useRef(new Animated.Value(0)).current;

  const activeIndex = useMemo(() => {
    const found = TABS.findIndex((item) => item.key === activeTab);
    return found >= 0 ? found : 0;
  }, [activeTab]);

  const tabWidth = containerWidth > 0 ? containerWidth / TABS.length : 0;
  const indicatorWidth = Math.max(0, tabWidth - 10);

  useEffect(() => {
    const fallbackX = tabWidth * activeIndex + 5;
    const measuredCenter = iconCenters[activeTab];
    const measuredX = typeof measuredCenter === 'number' ? measuredCenter - indicatorWidth / 2 : fallbackX;
    const maxX = Math.max(5, containerWidth - indicatorWidth - 5);
    const targetX = Math.min(Math.max(measuredX, 5), maxX);

    Animated.spring(indicatorX, {
      toValue: targetX,
      damping: 17,
      mass: 0.8,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, activeTab, containerWidth, iconCenters, indicatorWidth, indicatorX, tabWidth]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(bottomInset, 0) + 24 }]}
    >
      <View
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        style={styles.pill}
      >
        <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
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

        {TABS.map(({ key, label, Icon }) => {
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
                color={selected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.56)'}
                strokeWidth={2.2}
              />
              <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{label}</Text>
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
    width: '88%',
    maxWidth: 440,
    minWidth: 280,
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
    backgroundColor: 'rgba(5, 5, 6, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
  },
  activePill: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.36)',
  },
  tabButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 999,
  },
  tabButtonPressed: {
    transform: [{ scale: 0.95 }],
  },
  tabLabel: {
    color: 'rgba(255, 255, 255, 0.56)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    fontFamily: theme.typography.fontFamily,
  },
  tabLabelActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
