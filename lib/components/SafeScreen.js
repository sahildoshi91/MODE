import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../theme';
import { AtmosphereBackground } from './glass/AtmosphereBackground';

export const SafeScreen = ({
  children,
  style,
  includeTopInset = true,
  includeBottomInset = true,
  atmosphere = null,
  atmosphereOverlayStrength = 1,
  testID,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID}
      style={[
        styles.base,
        includeTopInset && { paddingTop: insets.top },
        includeBottomInset && { paddingBottom: Math.max(insets.bottom, theme.spacing[3]) },
        style,
      ]}
    >
      {atmosphere ? (
        <AtmosphereBackground context={atmosphere} overlayStrength={atmosphereOverlayStrength} />
      ) : null}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
});
