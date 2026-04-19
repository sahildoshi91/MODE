import React from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import CoachStreamItem from './CoachStreamItem';

export default function CoachStreamList({
  streamItems,
  onScrollDepthChange,
}) {
  const items = Array.isArray(streamItems) ? streamItems : [];

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CoachStreamItem item={item} />}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 && styles.emptyContent,
        ]}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <ModeText variant="caption" tone="secondary">
              No coach activity yet. Start with a prompt or slash command.
            </ModeText>
          </View>
        )}
        keyboardShouldPersistTaps="never"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScrollBeginDrag={() => Keyboard.dismiss()}
        onScroll={(event) => {
          const offsetY = event?.nativeEvent?.contentOffset?.y || 0;
          onScrollDepthChange?.(offsetY);
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 220,
  },
  listContent: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  emptyContent: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
  },
});
