import React from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';

import { theme } from '../../theme';

const BACKGROUND_SOURCES = {
  home: require('../../../assets/backgrounds/gym-home.jpg'),
  chat: require('../../../assets/backgrounds/gym-chat.jpg'),
  workout: require('../../../assets/backgrounds/gym-workout.jpg'),
  nutrition: require('../../../assets/backgrounds/gym-nutrition.jpg'),
  coach: require('../../../assets/backgrounds/gym-chat.jpg'),
  clients: require('../../../assets/backgrounds/gym-workout.jpg'),
  system: require('../../../assets/backgrounds/gym-home.jpg'),
};

const ATMOSPHERE_PROFILE = {
  home: {
    dimmer: 0.62,
    cool: 0.76,
    warm: 0.28,
    bloom: 0.2,
  },
  chat: {
    dimmer: 0.66,
    cool: 0.84,
    warm: 0.24,
    bloom: 0.18,
  },
  workout: {
    dimmer: 0.63,
    cool: 0.79,
    warm: 0.34,
    bloom: 0.22,
  },
  nutrition: {
    dimmer: 0.65,
    cool: 0.72,
    warm: 0.37,
    bloom: 0.2,
  },
  coach: {
    dimmer: 0.68,
    cool: 0.86,
    warm: 0.26,
    bloom: 0.21,
  },
  clients: {
    dimmer: 0.66,
    cool: 0.8,
    warm: 0.32,
    bloom: 0.2,
  },
  system: {
    dimmer: 0.69,
    cool: 0.77,
    warm: 0.24,
    bloom: 0.16,
  },
};

export function AtmosphereBackground({
  context = 'home',
  style,
  overlayStrength = 1,
  dimmerOpacity = null,
}) {
  const source = BACKGROUND_SOURCES[context] || BACKGROUND_SOURCES.home;
  const profile = ATMOSPHERE_PROFILE[context] || ATMOSPHERE_PROFILE.home;
  const resolvedDimmer = typeof dimmerOpacity === 'number' ? dimmerOpacity : profile.dimmer;

  return (
    <View pointerEvents="none" style={[styles.root, style]}>
      <Image
        source={source}
        resizeMode="cover"
        style={styles.image}
      />
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={theme.glass.blur.background}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[styles.dimmer, { opacity: resolvedDimmer * overlayStrength }]} />
      <View style={[styles.coolAtmosphere, { opacity: profile.cool * overlayStrength }]} />
      <View style={[styles.warmAtmosphere, { opacity: profile.warm * overlayStrength }]} />
      <View style={[styles.upperBloom, { opacity: profile.bloom * overlayStrength }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  dimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface.scrim,
  },
  coolAtmosphere: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.scene.depthFieldCool,
  },
  warmAtmosphere: {
    position: 'absolute',
    right: -80,
    bottom: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: theme.colors.scene.depthFieldWarm,
  },
  upperBloom: {
    position: 'absolute',
    left: -60,
    top: -90,
    width: 280,
    height: 240,
    borderRadius: 140,
    backgroundColor: 'rgba(178, 209, 255, 0.44)',
  },
});
