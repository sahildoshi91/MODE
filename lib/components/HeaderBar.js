import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../theme';

export const HeaderBar = ({ title, subtitle, style, testID }) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          paddingTop: insets.top + theme.spacing[2],
        },
        style,
      ]}
    >
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: theme.colors.bg.primary,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    paddingBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  title: {
    color: theme.colors.textHigh,
    ...theme.typography.h2,
    fontFamily: theme.typography.fontFamily,
  },
  subtitle: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    marginTop: theme.spacing[1],
  },
});
