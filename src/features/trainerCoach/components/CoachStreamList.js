import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
const SCROLL_RETRY_DELAYS_MS = [45, 130, 260, 420];
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
  restoreScrollOffset = null,
  restoreScrollSignal = 0,
  listRef = null,
  autoScrollOnContentChange = true,
  contentBottomPadding = 0,
}) {
  const items = useMemo(
    () => (Array.isArray(streamItems) ? streamItems : []),
    [streamItems],
  );
  const normalizedContentBottomPadding = asNonNegativeNumber(contentBottomPadding, 0);
  const internalListRef = useRef(null);
  const didInitialAutoScrollRef = useRef(false);
  const suppressNextAutoScrollRef = useRef(false);
  const initialPositionSettledRef = useRef(items.length <= 0);
  const [isInitialPositionSettled, setIsInitialPositionSettled] = useState(items.length <= 0);
  const itemCountRef = useRef(items.length);
  const previousLengthRef = useRef(0);
  const previousForceSignalRef = useRef(forceScrollSignal);
  const previousRestoreSignalRef = useRef(null);
  const previousContentBottomPaddingRef = useRef(normalizedContentBottomPadding);
  const scrollTimeoutsRef = useRef([]);
  const initialRevealTimeoutsRef = useRef([]);
  const scrollMetricsRef = useRef({
    offset: 0,
    contentHeight: 0,
    layoutHeight: 0,
    nearBottom: true,
  });

  const markInitialPositionSettled = useCallback((settled) => {
    if (initialPositionSettledRef.current === settled) {
      return;
    }
    initialPositionSettledRef.current = settled;
    setIsInitialPositionSettled(settled);
  }, []);

  const scheduleInitialPositionReveal = useCallback(() => {
    if (process.env.NODE_ENV === 'test') {
      markInitialPositionSettled(true);
      return;
    }
    initialRevealTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    initialRevealTimeoutsRef.current = [];
    const firstTimeoutId = setTimeout(() => {
      initialRevealTimeoutsRef.current = initialRevealTimeoutsRef.current.filter((id) => id !== firstTimeoutId);
      const secondTimeoutId = setTimeout(() => {
        initialRevealTimeoutsRef.current = initialRevealTimeoutsRef.current.filter((id) => id !== secondTimeoutId);
        markInitialPositionSettled(true);
      }, 0);
      initialRevealTimeoutsRef.current.push(secondTimeoutId);
    }, 0);
    initialRevealTimeoutsRef.current.push(firstTimeoutId);
  }, [markInitialPositionSettled]);

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
          typeof currentHandle.scrollToIndex === 'function'
          || typeof currentHandle.scrollToEnd === 'function'
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
          typeof externalHandle.scrollToIndex === 'function'
          || typeof externalHandle.scrollToEnd === 'function'
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
  const keyExtractor = useCallback((item) => item.id, []);
  const renderItem = useCallback(
    ({ item }) => <CoachStreamItem item={item} />,
    [],
  );

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

  const scrollToOffset = useCallback((offset, animated = false) => {
    const handle = resolveListHandle();
    if (!handle) {
      return;
    }
    const safeOffset = asNonNegativeNumber(offset, 0);
    if (typeof handle.scrollToOffset === 'function') {
      handle.scrollToOffset({ offset: safeOffset, animated });
      updateScrollMetrics({ offset: safeOffset });
      return;
    }
    if (typeof handle.scrollToEnd === 'function') {
      handle.scrollToEnd({ animated });
      const metrics = scrollMetricsRef.current;
      const maxOffset = Math.max(metrics.contentHeight - metrics.layoutHeight, 0);
      updateScrollMetrics({ offset: maxOffset });
      return;
    }
    const targetIndex = Math.max(itemCountRef.current - 1, -1);
    if (targetIndex >= 0 && typeof handle.scrollToIndex === 'function') {
      try {
        handle.scrollToIndex({
          index: targetIndex,
          viewPosition: 1,
          animated,
        });
      } catch (_error) {
        // Best effort: index scroll may fail during early mount.
      }
    }
  }, [resolveListHandle, updateScrollMetrics]);

  const scrollToLatest = useCallback((animated = true) => {
    const handle = resolveListHandle();
    if (!handle) {
      return;
    }
    const metrics = scrollMetricsRef.current;
    const maxOffset = Math.max(metrics.contentHeight - metrics.layoutHeight, 0);
    if (typeof handle.scrollToEnd === 'function') {
      handle.scrollToEnd({ animated });
      if (typeof handle.scrollToOffset === 'function') {
        // Follow with an explicit offset snap so the last item clears the floating composer reliably.
        handle.scrollToOffset({ offset: maxOffset, animated: false });
      }
      updateScrollMetrics({ offset: maxOffset });
      return;
    }
    if (typeof handle.scrollToOffset === 'function') {
      handle.scrollToOffset({ offset: maxOffset, animated });
      updateScrollMetrics({ offset: maxOffset });
      return;
    }
    const latestIndex = Math.max(itemCountRef.current - 1, -1);
    if (latestIndex >= 0 && typeof handle.scrollToIndex === 'function') {
      try {
        handle.scrollToIndex({
          index: latestIndex,
          viewPosition: 1,
          animated,
        });
        updateScrollMetrics({ offset: maxOffset });
      } catch (_error) {
        // Best effort: index scrolling may fail during first layout.
      }
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

  const scrollToOffsetWithRetries = useCallback((offset, animated = false) => {
    scrollToOffset(offset, animated);
    if (!ENABLE_SCROLL_RETRIES) {
      return;
    }
    SCROLL_RETRY_DELAYS_MS.forEach((delayMs) => {
      const timeoutId = setTimeout(() => {
        scrollTimeoutsRef.current = scrollTimeoutsRef.current.filter((id) => id !== timeoutId);
        scrollToOffset(offset, animated);
      }, delayMs);
      scrollTimeoutsRef.current.push(timeoutId);
    });
  }, [scrollToOffset]);

  const maybeInitialBottomSnap = useCallback((metrics = scrollMetricsRef.current) => {
    if (didInitialAutoScrollRef.current) {
      return;
    }
    if (items.length <= 0) {
      return;
    }
    const normalizedLayoutHeight = asNonNegativeNumber(metrics?.layoutHeight, 0);
    const normalizedContentHeight = asNonNegativeNumber(metrics?.contentHeight, 0);
    if (normalizedLayoutHeight <= 0 || normalizedContentHeight <= 0) {
      return;
    }
    didInitialAutoScrollRef.current = true;
    scrollToLatest(false);
    scheduleInitialPositionReveal();
  }, [items.length, scheduleInitialPositionReveal, scrollToLatest]);

  useLayoutEffect(() => {
    if (items.length <= 0) {
      markInitialPositionSettled(true);
      return;
    }
    if (!didInitialAutoScrollRef.current) {
      markInitialPositionSettled(false);
    }
  }, [items.length, markInitialPositionSettled]);

  useEffect(() => {
    if (previousRestoreSignalRef.current === restoreScrollSignal) {
      return;
    }
    previousRestoreSignalRef.current = restoreScrollSignal;
    const hasRestoreOffset = restoreScrollOffset !== null && restoreScrollOffset !== undefined;
    const normalizedRestoreOffset = hasRestoreOffset && Number.isFinite(Number(restoreScrollOffset))
      ? Math.max(Number(restoreScrollOffset), 0)
      : null;
    if (normalizedRestoreOffset === null) {
      return;
    }
    didInitialAutoScrollRef.current = true;
    suppressNextAutoScrollRef.current = true;
    scrollToOffsetWithRetries(normalizedRestoreOffset, false);
  }, [restoreScrollOffset, restoreScrollSignal, scrollToOffsetWithRetries]);

  useEffect(() => {
    itemCountRef.current = items.length;
    const previousLength = previousLengthRef.current;
    const hasNewItems = items.length > previousLength;
    if (suppressNextAutoScrollRef.current && hasNewItems) {
      suppressNextAutoScrollRef.current = false;
    } else if (
      autoScrollOnContentChange
      && hasNewItems
      && didInitialAutoScrollRef.current
      && initialPositionSettledRef.current
      && scrollMetricsRef.current.nearBottom
    ) {
      scrollToLatestWithRetries(true);
    }
    previousLengthRef.current = items.length;
  }, [
    autoScrollOnContentChange,
    items,
    items.length,
    scrollToLatestWithRetries,
  ]);

  useEffect(() => {
    if (previousForceSignalRef.current === forceScrollSignal) {
      return;
    }
    previousForceSignalRef.current = forceScrollSignal;
    // Force-scroll actions (e.g. "Jump to latest") should land exactly at the bottom.
    scrollToLatestWithRetries(false);
  }, [forceScrollSignal, scrollToLatestWithRetries]);

  useEffect(() => {
    const previousPadding = previousContentBottomPaddingRef.current;
    previousContentBottomPaddingRef.current = normalizedContentBottomPadding;
    if (normalizedContentBottomPadding <= previousPadding) {
      return;
    }
    if (itemCountRef.current <= 0 || !scrollMetricsRef.current.nearBottom) {
      return;
    }
    scrollToLatestWithRetries(false);
  }, [normalizedContentBottomPadding, scrollToLatestWithRetries]);

  useEffect(() => () => {
    scrollTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    scrollTimeoutsRef.current = [];
    initialRevealTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    initialRevealTimeoutsRef.current = [];
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        ref={assignListRef}
        data={items}
        style={[
          styles.list,
          !isInitialPositionSettled && styles.listHidden,
        ]}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={48}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        onLayout={(event) => {
          const nextMetrics = updateScrollMetrics({ layoutHeight: event?.nativeEvent?.layout?.height });
          maybeInitialBottomSnap(nextMetrics);
        }}
        onContentSizeChange={(_width, height) => {
          const nextMetrics = updateScrollMetrics({ contentHeight: height });
          maybeInitialBottomSnap(nextMetrics);
        }}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: theme.spacing[2] + normalizedContentBottomPadding },
          items.length === 0 && styles.emptyContent,
        ]}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <ModeText variant="caption" tone="secondary">
              No coach activity yet. Start with a prompt or slash command.
            </ModeText>
          </View>
        )}
        keyboardShouldPersistTaps="handled"
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
  list: {
    flex: 1,
  },
  listHidden: {
    opacity: 0,
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
