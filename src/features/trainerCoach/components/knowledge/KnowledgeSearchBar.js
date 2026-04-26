import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SystemSearchBar } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

export default function KnowledgeSearchBar({
  value,
  onChangeText,
  testID = 'trainer-coach-knowledge-search',
}) {
  return (
    <View style={styles.wrap}>
      <SystemSearchBar
        value={value}
        onChangeText={onChangeText}
        placeholder="Search knowledge"
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 48,
    justifyContent: 'center',
  },
  input: {
    minHeight: 48,
    marginVertical: 0,
    paddingVertical: 10,
  },
});
