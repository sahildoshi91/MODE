import React from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';
import { metadataLineForEntry, notePreview, noteTitle } from './knowledgeUtils';

function isDistinctTitle(title, preview) {
  const normalizedTitle = String(title || '').trim().toLowerCase();
  const normalizedPreview = String(preview || '').trim().toLowerCase();
  if (!normalizedTitle || !normalizedPreview) {
    return false;
  }
  return normalizedTitle !== normalizedPreview;
}

const SWIPE_ARCHIVE_TRIGGER = -68;
const SWIPE_CLAMP = -96;

export default function KnowledgeMemoryRow({
  entry,
  expanded = false,
  onToggleExpand,
  onEdit,
  onArchive,
  isPending = false,
}) {
  const previewText = notePreview(entry);
  const title = noteTitle(entry);
  const metadataLine = metadataLineForEntry(entry);
  const showTitle = isDistinctTitle(title, previewText);
  const canArchive = !isPending && entry?.status !== 'archived';
  const swipeTranslateX = React.useRef(new Animated.Value(0)).current;

  const resetSwipe = React.useCallback(() => {
    Animated.spring(swipeTranslateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 24,
    }).start();
  }, [swipeTranslateX]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) => (
      Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
      && Math.abs(gestureState.dx) > 8
    ),
    onPanResponderMove: (_event, gestureState) => {
      if (gestureState.dx >= 0) {
        swipeTranslateX.setValue(0);
        return;
      }
      swipeTranslateX.setValue(Math.max(gestureState.dx, SWIPE_CLAMP));
    },
    onPanResponderRelease: (_event, gestureState) => {
      if (gestureState.dx <= SWIPE_ARCHIVE_TRIGGER && canArchive) {
        resetSwipe();
        onArchive?.();
        return;
      }
      resetSwipe();
    },
    onPanResponderTerminate: () => {
      resetSwipe();
    },
  }), [canArchive, onArchive, resetSwipe, swipeTranslateX]);

  return (
    <Animated.View
      style={[
        styles.rowWrap,
        {
          transform: [{ translateX: swipeTranslateX }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        testID={`trainer-coach-knowledge-row-${entry?.id}`}
        onPress={onToggleExpand}
        style={({ pressed }) => [
          styles.row,
          expanded && styles.rowExpanded,
          pressed && styles.rowPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Expand knowledge note"
        accessibilityState={{ expanded }}
      >
        <View style={styles.copy}>
          {showTitle ? (
            <ModeText variant="bodySm" style={styles.title} numberOfLines={1}>{title}</ModeText>
          ) : null}
          <ModeText
            variant="bodySm"
            tone="secondary"
            style={styles.preview}
            numberOfLines={expanded ? undefined : 2}
          >
            {previewText}
          </ModeText>
          <ModeText variant="caption" tone="tertiary" numberOfLines={1}>
            {metadataLine}
          </ModeText>
        </View>
        <View style={styles.actions}>
          <Pressable
            testID={`trainer-coach-knowledge-edit-${entry?.id}`}
            onPress={(event) => {
              event?.stopPropagation?.();
              onEdit?.();
            }}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.iconButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Edit knowledge note"
            disabled={isPending}
            hitSlop={8}
          >
            <Feather name="edit-2" size={14} color={theme.colors.text.secondary} />
          </Pressable>
          <Pressable
            testID={`trainer-coach-knowledge-archive-${entry?.id}`}
            onPress={(event) => {
              event?.stopPropagation?.();
              onArchive?.();
            }}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.iconButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Archive knowledge note"
            disabled={!canArchive}
            hitSlop={8}
          >
            {isPending ? (
              <ActivityIndicator size="small" color={theme.colors.text.secondary} />
            ) : (
              <Feather name="trash-2" size={14} color={theme.colors.text.secondary} />
            )}
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    overflow: 'hidden',
    borderRadius: 14,
  },
  row: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(94, 126, 184, 0.22)',
    backgroundColor: 'rgba(11, 21, 38, 0.54)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowExpanded: {
    backgroundColor: 'rgba(11, 22, 40, 0.7)',
    borderColor: 'rgba(111, 145, 205, 0.34)',
  },
  rowPressed: {
    opacity: 0.88,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: '600',
  },
  preview: {
    lineHeight: 18,
  },
  actions: {
    alignItems: 'center',
    gap: 6,
    paddingTop: 1,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(103, 136, 194, 0.28)',
    backgroundColor: 'rgba(12, 20, 35, 0.64)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    opacity: 0.82,
  },
});
