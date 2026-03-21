import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const IS_COMPACT = SCREEN_HEIGHT < 760;
const SIDE_PADDING = IS_COMPACT ? 18 : 20;
const MODE_GAP = IS_COMPACT ? 14 : 16;
const ITEM_HEIGHT = IS_COMPACT ? 50 : 54;
const SNAP_VELOCITY_FACTOR = 0.22;
const MAX_VISIBLE_OFFSET = 2;

const MODES = [
  {
    key: 'reset',
    label: 'RESET',
    description: 'Quiet the noise and return to a calm starting point.',
  },
  {
    key: 'base',
    label: 'BASE',
    description: 'Settle into the default state with steady, minimal effort.',
  },
  {
    key: 'build',
    label: 'BUILD',
    description: 'Layer momentum gradually and let progress compound.',
  },
  {
    key: 'beast',
    label: 'BEAST',
    description: 'Commit to intensity with sharp focus and full conviction.',
  },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return 'Good morning';
  }

  if (hour < 18) {
    return 'Good afternoon';
  }

  if (hour < 22) {
    return 'Good evening';
  }

  return 'Good night';
}

function useVerticalModePicker(items) {
  const animatedIndex = useRef(new Animated.Value(0)).current;
  const animatedIndexValueRef = useRef(0);
  const dragStartIndexRef = useRef(0);
  const activeIndexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const id = animatedIndex.addListener(({ value }) => {
      animatedIndexValueRef.current = value;
    });

    return () => {
      animatedIndex.removeListener(id);
    };
  }, [animatedIndex]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const snapToIndex = (nextIndex) => {
    const clampedIndex = clamp(nextIndex, 0, items.length - 1);
    const previousIndex = activeIndexRef.current;
    const didChange = clampedIndex !== previousIndex;

    if (didChange) {
      Haptics.selectionAsync();
    }

    Animated.spring(animatedIndex, {
      toValue: clampedIndex,
      useNativeDriver: true,
      damping: 20,
      stiffness: 220,
      mass: 0.9,
      overshootClamping: false,
    }).start(({ finished }) => {
      if (!finished) {
        return;
      }

      setActiveIndex(clampedIndex);
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 6,
        onPanResponderGrant: () => {
          dragStartIndexRef.current = animatedIndexValueRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextValue = clamp(
            dragStartIndexRef.current + gestureState.dy / ITEM_HEIGHT,
            0,
            items.length - 1
          );
          animatedIndex.setValue(nextValue);
        },
        onPanResponderRelease: (_, gestureState) => {
          const projectedIndex = clamp(
            animatedIndexValueRef.current + gestureState.vy * SNAP_VELOCITY_FACTOR,
            0,
            items.length - 1
          );
          snapToIndex(Math.round(projectedIndex));
        },
        onPanResponderTerminate: () => {
          snapToIndex(Math.round(animatedIndexValueRef.current));
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [activeIndex, animatedIndex, items.length]
  );

  return {
    activeIndex,
    animatedIndex,
    panHandlers: panResponder.panHandlers,
  };
}

function ModeAnchor() {
  return (
    <View pointerEvents="none" style={styles.modeAnchorWrap}>
      <Text style={styles.modeAnchorText}>MODE</Text>
    </View>
  );
}

function ModeWheel({ animatedIndex, modes }) {
  return (
    <View pointerEvents="none" style={styles.wheelViewport}>
      {modes.map((mode, index) => (
        <ModeWheelItem key={mode.key} mode={mode} index={index} animatedIndex={animatedIndex} />
      ))}
    </View>
  );
}

function ModeWheelItem({ animatedIndex, index, mode }) {
  const inputRange = [index - 2, index - 1, index, index + 1, index + 2];

  const translateY = animatedIndex.interpolate({
    inputRange,
    outputRange: [-ITEM_HEIGHT * 2, -ITEM_HEIGHT, 0, ITEM_HEIGHT, ITEM_HEIGHT * 2],
    extrapolate: 'clamp',
  });

  const opacity = animatedIndex.interpolate({
    inputRange,
    outputRange: [0.05, 0.22, 1, 0.22, 0.05],
    extrapolate: 'clamp',
  });

  const scale = animatedIndex.interpolate({
    inputRange,
    outputRange: [0.78, 0.88, 1, 0.88, 0.78],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.wheelItem,
        {
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <Text style={styles.wheelItemText}>{mode.label}</Text>
    </Animated.View>
  );
}

function ModePickerLayout() {
  const insets = useSafeAreaInsets();
  const { activeIndex, animatedIndex, panHandlers } = useVerticalModePicker(MODES);

  const activeMode = MODES[activeIndex];
  const greeting = useMemo(() => getGreeting(), []);

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      <View
        style={[
          styles.screen,
          {
            paddingTop: Math.max(insets.top, IS_COMPACT ? 8 : 10),
            paddingBottom: Math.max(insets.bottom, IS_COMPACT ? 14 : 18),
          },
        ]}
        {...panHandlers}
      >
        <View style={styles.topZone}>
          <Text style={styles.topLabel}>{greeting}</Text>
        </View>

        <View style={styles.centerStage}>
          <View style={styles.anchorRow}>
            <View style={styles.leftRail}>
              <ModeWheel animatedIndex={animatedIndex} modes={MODES} />
            </View>
            <View style={{ width: MODE_GAP }} />
            <ModeAnchor />
          </View>
        </View>

        <View style={styles.bottomZone}>
          <Text style={styles.captionText}>{activeMode.description}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.appShell}>
        <ModePickerLayout />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: '#000000',
  },
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: SIDE_PADDING,
  },
  topZone: {
    minHeight: IS_COMPACT ? 52 : 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topLabel: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0,
    textAlign: 'center',
  },
  centerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorRow: {
    width: '100%',
    maxWidth: IS_COMPACT ? 320 : 340,
    minHeight: ITEM_HEIGHT * (MAX_VISIBLE_OFFSET * 2 + 1),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftRail: {
    width: Math.min(SCREEN_WIDTH * 0.39, IS_COMPACT ? 132 : 142),
    height: ITEM_HEIGHT * (MAX_VISIBLE_OFFSET * 2 + 1),
    alignItems: 'flex-end',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wheelViewport: {
    width: '100%',
    height: ITEM_HEIGHT * (MAX_VISIBLE_OFFSET * 2 + 1),
    justifyContent: 'center',
  },
  wheelItem: {
    position: 'absolute',
    right: 0,
    width: '100%',
    height: ITEM_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  wheelItemText: {
    color: '#FFFFFF',
    fontSize: IS_COMPACT ? 26 : 28,
    lineHeight: IS_COMPACT ? 31 : 34,
    fontWeight: '600',
    textAlign: 'right',
    includeFontPadding: false,
  },
  modeAnchorWrap: {
    minWidth: IS_COMPACT ? 120 : 126,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeAnchorText: {
    color: '#FFFFFF',
    fontSize: IS_COMPACT ? 48 : 56,
    lineHeight: IS_COMPACT ? 50 : 58,
    fontWeight: '900',
    letterSpacing: 3.6,
    textAlign: 'center',
    includeFontPadding: false,
  },
  bottomZone: {
    minHeight: IS_COMPACT ? 82 : 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  captionText: {
    color: 'rgba(255,255,255,0.54)',
    fontSize: IS_COMPACT ? 16 : 17,
    lineHeight: IS_COMPACT ? 22 : 24,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 280,
  },
});
