import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../theme';

export const SafeScreen = ({
  children,
  style,
  includeTopInset = false,
  includeBottomInset = true,
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
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    flex: 1,
    backgroundColor: theme.colors.surface.canvas,
  },
});
