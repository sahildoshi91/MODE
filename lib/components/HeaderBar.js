import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../theme';

export const HeaderBar = ({ title, subtitle, style, testID, rightSlot = null }) => {
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
      <View style={styles.row}>
        <View style={styles.copyWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {rightSlot}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: theme.colors.surface.canvas,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    paddingBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  copyWrap: {
    flex: 1,
  },
  title: {
    color: theme.colors.text.primary,
    ...theme.typography.h2,
    fontFamily: theme.typography.fontFamily,
  },
  subtitle: {
    color: theme.colors.text.secondary,
    ...theme.typography.body2,
    marginTop: theme.spacing[1],
    fontFamily: theme.typography.fontFamily,
  },
});
