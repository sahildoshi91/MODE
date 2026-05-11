import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SystemSearchBar } from '../../../../../lib/components';

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
});
