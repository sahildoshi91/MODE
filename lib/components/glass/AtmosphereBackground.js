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
};

export function AtmosphereBackground({
  context = 'home',
  style,
  overlayStrength = 1,
  dimmerOpacity = 0.64,
}) {
  const source = BACKGROUND_SOURCES[context] || BACKGROUND_SOURCES.home;

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
      <View style={[styles.dimmer, { opacity: dimmerOpacity * overlayStrength }]} />
      <View style={[styles.coolAtmosphere, { opacity: 0.82 * overlayStrength }]} />
      <View style={[styles.warmAtmosphere, { opacity: 0.34 * overlayStrength }]} />
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
});

