import React, { useCallback, useEffect, useRef } from 'react';
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

const NEAR_BOTTOM_THRESHOLD_PX = 120;
const SCROLL_RETRY_DELAYS_MS = [45, 130];
const ENABLE_SCROLL_RETRIES = process.env.NODE_ENV !== 'test';

function asNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export default function CoachStreamList({
  streamItems,
  onScrollDepthChange,
  onScrollMetricsChange,
  onNearBottomChange,
  forceScrollSignal = 0,
  listRef = null,
  autoScrollOnContentChange = true,
  contentBottomPadding = 0,
}) {
  const items = Array.isArray(streamItems) ? streamItems : [];
  const internalListRef = useRef(null);
  const didInitialAutoScrollRef = useRef(false);
  const itemCountRef = useRef(items.length);
  const previousLengthRef = useRef(0);
  const previousForceSignalRef = useRef(forceScrollSignal);
  const scrollTimeoutsRef = useRef([]);
  const scrollMetricsRef = useRef({
    offset: 0,
    contentHeight: 0,
    layoutHeight: 0,
    nearBottom: true,
  });

  const assignListRef = useCallback((node) => {
    internalListRef.current = node;
    if (typeof listRef === 'function') {
      listRef(node);
      return;
    }
    if (listRef && typeof listRef === 'object' && 'current' in listRef) {
      const currentHandle = listRef.current;
      const hasExternalHandle = Boolean(
        currentHandle
        && (
          typeof currentHandle.scrollToEnd === 'function'
          || typeof currentHandle.scrollToOffset === 'function'
        ),
      );
      if (!hasExternalHandle) {
        listRef.current = node;
      }
    }
  }, [listRef]);

  const resolveListHandle = useCallback(() => {
    if (listRef && typeof listRef === 'object') {
      const externalHandle = listRef.current;
      if (
        externalHandle
        && (
          typeof externalHandle.scrollToEnd === 'function'
          || typeof externalHandle.scrollToOffset === 'function'
        )
      ) {
        return externalHandle;
      }
    }
    return internalListRef.current;
  }, [listRef]);

  const emitScrollMetrics = useCallback((metrics) => {
    onScrollMetricsChange?.(metrics);
    onNearBottomChange?.(metrics.nearBottom);
  }, [onNearBottomChange, onScrollMetricsChange]);

  const updateScrollMetrics = useCallback((partial = {}) => {
    const current = scrollMetricsRef.current;
    const next = {
      offset: partial.offset === undefined
        ? current.offset
        : asNonNegativeNumber(partial.offset, current.offset),
      contentHeight: partial.contentHeight === undefined
        ? current.contentHeight
        : asNonNegativeNumber(partial.contentHeight, current.contentHeight),
      layoutHeight: partial.layoutHeight === undefined
        ? current.layoutHeight
        : asNonNegativeNumber(partial.layoutHeight, current.layoutHeight),
      nearBottom: current.nearBottom,
    };
    const distanceFromBottom = next.contentHeight - (next.offset + next.layoutHeight);
    next.nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    scrollMetricsRef.current = next;
    emitScrollMetrics(next);
    return next;
  }, [emitScrollMetrics]);

  const scrollToLatest = useCallback((animated = true) => {
    const handle = resolveListHandle();
    if (!handle) {
      return;
    }
    const latestIndex = Math.max(itemCountRef.current - 1, -1);
    if (latestIndex >= 0 && typeof handle.scrollToIndex === 'function') {
      try {
        handle.scrollToIndex({
          index: latestIndex,
          viewPosition: 0,
          animated,
        });
        return;
      } catch (_error) {
        // Fallback below to offset/end-based scrolling when index scrolling cannot run yet.
      }
    }
    const metrics = scrollMetricsRef.current;
    const maxOffset = Math.max(metrics.contentHeight - metrics.layoutHeight, 0);
    updateScrollMetrics({ offset: maxOffset });
    if (typeof handle.scrollToEnd === 'function') {
      handle.scrollToEnd({ animated });
      return;
    }
    if (typeof handle.scrollToOffset === 'function') {
      handle.scrollToOffset({ offset: maxOffset, animated });
    }
  }, [resolveListHandle, updateScrollMetrics]);

  const scrollToLatestWithRetries = useCallback((animated = true) => {
    scrollToLatest(animated);
    if (!ENABLE_SCROLL_RETRIES) {
      return;
    }
    SCROLL_RETRY_DELAYS_MS.forEach((delayMs) => {
      const timeoutId = setTimeout(() => {
        scrollTimeoutsRef.current = scrollTimeoutsRef.current.filter((id) => id !== timeoutId);
        scrollToLatest(animated);
      }, delayMs);
      scrollTimeoutsRef.current.push(timeoutId);
    });
  }, [scrollToLatest]);

  useEffect(() => {
    itemCountRef.current = items.length;
    const previousLength = previousLengthRef.current;
    const hasNewItems = items.length > previousLength;
    if (!didInitialAutoScrollRef.current && items.length > 0) {
      didInitialAutoScrollRef.current = true;
      scrollToLatestWithRetries(false);
    } else if (
      autoScrollOnContentChange
      && hasNewItems
      && scrollMetricsRef.current.nearBottom
    ) {
      scrollToLatestWithRetries(true);
    }
    previousLengthRef.current = items.length;
  }, [autoScrollOnContentChange, items.length, scrollToLatestWithRetries]);

  useEffect(() => {
    if (previousForceSignalRef.current === forceScrollSignal) {
      return;
    }
    previousForceSignalRef.current = forceScrollSignal;
    scrollToLatestWithRetries(true);
  }, [forceScrollSignal, scrollToLatestWithRetries]);

  useEffect(() => () => {
    scrollTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    scrollTimeoutsRef.current = [];
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        ref={assignListRef}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CoachStreamItem item={item} />}
        onLayout={(event) => {
          updateScrollMetrics({ layoutHeight: event?.nativeEvent?.layout?.height });
        }}
        onContentSizeChange={(_width, height) => {
          updateScrollMetrics({ contentHeight: height });
        }}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: theme.spacing[2] + Math.max(0, contentBottomPadding) },
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
          const nativeEvent = event?.nativeEvent || {};
          const offsetY = nativeEvent?.contentOffset?.y || 0;
          updateScrollMetrics({
            offset: nativeEvent?.contentOffset?.y,
            contentHeight: nativeEvent?.contentSize?.height,
            layoutHeight: nativeEvent?.layoutMeasurement?.height,
          });
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
  },
  emptyContent: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
  },
});
