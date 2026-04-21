import React from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { theme } from '../theme';
import { ModeInput } from './ModeInput';

export function SystemSearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  testID,
}) {
  return (
    <View style={styles.wrap}>
      <View pointerEvents="none" style={styles.iconWrap}>
        <Feather name="search" size={15} color={theme.colors.text.tertiary} />
      </View>
      <ModeInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  iconWrap: {
    position: 'absolute',
    left: 14,
    top: 0,
    bottom: 0,
    zIndex: 2,
    justifyContent: 'center',
  },
  input: {
    marginVertical: 0,
    paddingLeft: 18,
  },
});
