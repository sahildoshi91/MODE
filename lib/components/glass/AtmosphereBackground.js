import React from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

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
    dimmer: 0.72,
    cool: 0.08,
    warm: 0.04,
    bloom: 0.1,
  },
  chat: {
    dimmer: 0.74,
    cool: 0.1,
    warm: 0.05,
    bloom: 0.11,
  },
  workout: {
    dimmer: 0.73,
    cool: 0.1,
    warm: 0.05,
    bloom: 0.12,
  },
  nutrition: {
    dimmer: 0.73,
    cool: 0.08,
    warm: 0.05,
    bloom: 0.1,
  },
  coach: {
    dimmer: 0.76,
    cool: 0.12,
    warm: 0.05,
    bloom: 0.12,
  },
  clients: {
    dimmer: 0.78,
    cool: 0.12,
    warm: 0.04,
    bloom: 0.12,
  },
  system: {
    dimmer: 0.75,
    cool: 0.09,
    warm: 0.03,
    bloom: 0.08,
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
      <LinearGradient
        pointerEvents="none"
        colors={['#08111F', '#0B1220']}
        locations={[0, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.dimmer, { opacity: resolvedDimmer * overlayStrength }]} />
      <View style={[styles.coolAtmosphere, { opacity: profile.cool * overlayStrength }]} />
      <View style={[styles.warmAtmosphere, { opacity: profile.warm * overlayStrength }]} />
      <View style={[styles.upperBloom, { opacity: profile.bloom * overlayStrength }]} />
      <View style={styles.vignette} />
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
    right: -60,
    bottom: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: theme.colors.scene.depthFieldWarm,
  },
  upperBloom: {
    position: 'absolute',
    left: -100,
    top: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(143, 178, 255, 0.95)',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.22)',
    shadowColor: '#000000',
    shadowOpacity: 0.34,
    shadowRadius: 46,
    shadowOffset: { width: 0, height: 0 },
  },
});
