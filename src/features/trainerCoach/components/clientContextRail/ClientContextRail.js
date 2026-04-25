import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';
import { CLIENT_CONTEXT_RAIL_MODE } from '../../hooks/useClientContextState';
import { summarizeClientDisplay } from '../../services/coachClientContextApi';
import ClientContextChip from './ClientContextChip';
import ContextSettingsShortcuts from './ContextSettingsShortcuts';
import FullClientContextSheet from './FullClientContextSheet';
import QuickNoteComposer from './QuickNoteComposer';
import SmartClientPicker from './SmartClientPicker';

export default function ClientContextRail({
  state,
  selectedClientSummary,
  actions,
  createdByTrainerId = null,
  style,
  testIDPrefix = 'client-context-rail',
}) {
  const { height: viewportHeight } = useWindowDimensions();
  const expandedHeight = Math.max(280, Math.min(460, Math.round(viewportHeight * 0.42)));
  const fullHeight = Math.max(420, Math.min(680, Math.round(viewportHeight * 0.72)));
  const targetHeight = state.railMode === CLIENT_CONTEXT_RAIL_MODE.FULL ? fullHeight : expandedHeight;

  const [shouldRenderPanel, setShouldRenderPanel] = useState(
    state.railMode !== CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
  );
  const panelOpacity = useRef(new Animated.Value(0)).current;
  const panelLift = useRef(new Animated.Value(18)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state.railMode === CLIENT_CONTEXT_RAIL_MODE.COLLAPSED) {
      Animated.parallel([
        Animated.timing(panelOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(panelLift, {
          toValue: 18,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setShouldRenderPanel(false);
          dragY.setValue(0);
        }
      });
      return;
    }

    setShouldRenderPanel(true);
    panelOpacity.setValue(0);
    panelLift.setValue(18);
    dragY.setValue(0);
    Animated.parallel([
      Animated.timing(panelOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(panelLift, {
        toValue: 0,
        stiffness: 240,
        damping: 22,
        mass: 0.92,
        useNativeDriver: true,
      }),
    ]).start();
  }, [dragY, panelLift, panelOpacity, state.railMode]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) => (
      Math.abs(gestureState.dy) > 6 && gestureState.dy > Math.abs(gestureState.dx)
    ),
    onPanResponderMove: (_event, gestureState) => {
      dragY.setValue(Math.max(0, gestureState.dy));
    },
    onPanResponderRelease: (_event, gestureState) => {
      if (gestureState.dy > 96) {
        actions?.collapseRail?.();
      } else {
        Animated.spring(dragY, {
          toValue: 0,
          stiffness: 260,
          damping: 24,
          mass: 0.9,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, {
        toValue: 0,
        stiffness: 260,
        damping: 24,
        mass: 0.9,
        useNativeDriver: true,
      }).start();
    },
  }), [actions, dragY]);

  const selectedClientLabel = selectedClientSummary
    ? summarizeClientDisplay(selectedClientSummary, { includeTodayPrefix: true })
    : null;

  return (
    <View style={[styles.root, style]}>
      <ClientContextChip
        testID={`${testIDPrefix}-chip`}
        selectedClient={selectedClientSummary}
        onPress={() => {
          actions?.expandRail?.({ focusSearch: !state?.selectedClientId });
        }}
      />

      {shouldRenderPanel ? (
        <Animated.View
          testID={`${testIDPrefix}-panel`}
          style={[
            styles.panel,
            {
              maxHeight: targetHeight,
              opacity: panelOpacity,
              transform: [
                { translateY: panelLift },
                { translateY: dragY },
              ],
            },
          ]}
        >
          <View style={styles.panelHeader} {...panResponder.panHandlers}>
            <View style={styles.dragHandle} />
            <View style={styles.headerCopyWrap}>
              <ModeText variant="bodySm" style={styles.headerTitle}>Client Context</ModeText>
              {selectedClientLabel ? (
                <ModeText variant="caption" tone="secondary" numberOfLines={1}>
                  {selectedClientLabel}
                </ModeText>
              ) : null}
            </View>
            <Pressable
              testID={`${testIDPrefix}-dismiss`}
              onPress={() => actions?.dismissRail?.()}
              accessibilityRole="button"
              accessibilityLabel="Dismiss client context"
              style={({ pressed }) => [
                styles.dismissButton,
                pressed && styles.dismissButtonPressed,
              ]}
            >
              <Feather name="x" size={16} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.panelBody}
            contentContainerStyle={styles.panelContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {state.railMode === CLIENT_CONTEXT_RAIL_MODE.FULL ? (
              <FullClientContextSheet
                section={state.fullSection}
                summary={state.contextSummary}
                scheduleDaysDraft={state.scheduleDaysDraft}
                onToggleDay={actions?.setScheduleDaysDraft}
                onSaveSchedule={actions?.saveScheduleDays}
                onBack={actions?.backToExpandedRail}
                isSavingSchedule={state.isSavingSchedule}
                scheduleSaveStatus={state.scheduleSaveStatus}
              />
            ) : (
              <>
                <SmartClientPicker
                  selectedClientId={state.selectedClientId}
                  todayClients={state.todayClients}
                  recentClients={state.recentClients}
                  allClients={state.allClients}
                  searchQuery={state.searchQuery}
                  onSearchQueryChange={actions?.setSearchQuery}
                  onSelectClient={(clientId) => actions?.setSelectedClient?.(clientId, { keepOpen: true })}
                  isSearching={state.isSearching}
                  autoFocusSearch={!state.selectedClientId}
                  testIDPrefix={`${testIDPrefix}-picker`}
                />
                <QuickNoteComposer
                  quickNoteText={state.quickNoteText}
                  allowAIUse={state.allowAIUse}
                  isSavingNote={state.isSavingNote}
                  saveStatus={state.saveStatus}
                  saveMessage={state.saveMessage}
                  hasSelectedClient={Boolean(state.selectedClientId)}
                  onQuickNoteTextChange={actions?.setQuickNoteText}
                  onAllowAIUseChange={actions?.setAllowAIUse}
                  onSave={() => actions?.saveQuickNote?.({ createdByTrainerId })}
                  testIDPrefix={`${testIDPrefix}-note`}
                />
                <ContextSettingsShortcuts
                  onOpen={actions?.openFullRail}
                  testIDPrefix={`${testIDPrefix}-settings`}
                />
              </>
            )}
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing[1],
  },
  panel: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(7, 13, 24, 0.92)',
    overflow: 'hidden',
    shadowColor: '#01070F',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 9 },
    elevation: 9,
  },
  panelHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  dragHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 99,
    backgroundColor: theme.colors.glass.borderStrong,
  },
  headerCopyWrap: {
    paddingRight: 40,
    gap: 2,
  },
  headerTitle: {
    fontWeight: '700',
  },
  dismissButton: {
    position: 'absolute',
    top: 10,
    right: theme.spacing[2],
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  dismissButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  panelBody: {
    flexGrow: 0,
  },
  panelContent: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
});
