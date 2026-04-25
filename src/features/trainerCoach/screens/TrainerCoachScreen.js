import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { BlurView } from 'expo-blur';

import {
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  DEFAULT_ASSISTANT_DISPLAY_NAME,
  resolveAssistantDisplayName,
} from '../../messaging';
import { getTrainerSettingsMe } from '../../profile/services/profileApi';
import { buildTrainerRouteDiagnosticsBundle } from '../../trainerPlatform/utils/trainerRouteDiagnostics';
import { ClientContextRail } from '../components/clientContextRail';
import CoachComposerWithCommands from '../components/CoachComposerWithCommands';
import CoachPanelHost from '../components/CoachPanelHost';
import CoachStreamList from '../components/CoachStreamList';
import { CLIENT_CONTEXT_RAIL_MODE, useClientContextState } from '../hooks/useClientContextState';
import { useTrainerCoachWorkspace } from '../hooks/useTrainerCoachWorkspace';

const COPY_FEEDBACK_TIMEOUT_MS = 2200;
const KEYBOARD_OPEN_COMPOSER_OFFSET = theme.spacing[1];
const LIST_BOTTOM_BREATHING_ROOM = theme.spacing[2];
const JUMP_TO_LATEST_BOTTOM_OFFSET = theme.spacing[1] + 2;
const COMPOSER_DOCK_BACKDROP_MIN_HEIGHT = 92;
const VISIBLE_CONVERSATION_KINDS = new Set(['trainer_input', 'internal_ai_private']);

function asNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function shouldDisplayStreamItem(item) {
  const kind = typeof item?.kind === 'string' ? item.kind : '';
  return VISIBLE_CONVERSATION_KINDS.has(kind);
}

export default function TrainerCoachScreen({
  accessToken,
  trainerId,
  bottomInset = 0,
  onOpenTrainerCoach = null,
}) {
  const [composerValue, setComposerValue] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [pendingNewMessagesBelowFold, setPendingNewMessagesBelowFold] = useState(false);
  const [composerDockHeight, setComposerDockHeight] = useState(0);
  const [streamForceScrollSignal, setStreamForceScrollSignal] = useState(0);
  const [anchorToLatestSignal, setAnchorToLatestSignal] = useState(1);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [assistantDisplayName, setAssistantDisplayName] = useState(DEFAULT_ASSISTANT_DISPLAY_NAME);
  const copyFeedbackTimerRef = useRef(null);
  const visibleStreamLengthRef = useRef(0);
  const previousTrainerIdRef = useRef(trainerId);
  const previousWorkspaceClientIdRef = useRef(null);
  const latestScrollMetricsRef = useRef({
    offset: 0,
    contentHeight: 0,
    layoutHeight: 0,
    nearBottom: true,
  });
  const {
    state,
    actions,
  } = useTrainerCoachWorkspace({
    accessToken,
    trainerId,
    assistantDisplayName,
  });
  const staleRouteError = state.errorDetails?.isStaleBackendRoute
    ? state.errorDetails
    : null;
  const workspaceNetworkError = (!staleRouteError && state.errorDetails?.stage === 'network')
    ? state.errorDetails
    : null;
  const visibleStream = useMemo(
    () => (Array.isArray(state.stream) ? state.stream.filter(shouldDisplayStreamItem) : []),
    [state.stream],
  );
  const showJumpToLatest = visibleStream.length > 0 && (!isNearBottom || pendingNewMessagesBelowFold);
  const dockAnchorInset = Math.max(bottomInset, 0);
  const activeComposerOffset = isKeyboardVisible
    ? KEYBOARD_OPEN_COMPOSER_OFFSET
    : dockAnchorInset;
  const trainerStreamContentBottomPadding =
    composerDockHeight + activeComposerOffset + LIST_BOTTOM_BREATHING_ROOM;
  const jumpToLatestBottom = trainerStreamContentBottomPadding + JUMP_TO_LATEST_BOTTOM_OFFSET;
  const composerDockBackdropHeight = Math.max(
    COMPOSER_DOCK_BACKDROP_MIN_HEIGHT,
    composerDockHeight + theme.spacing[1],
  );
  const clientContext = useClientContextState({
    accessToken,
    trainerId,
    initialSelectedClientId: state.activeClientId || state.panels.context?.clientId || null,
    onSelectedClientChange: actions.setActiveClientId,
  });
  const isClientRailOpen = (
    clientContext.state.railMode !== CLIENT_CONTEXT_RAIL_MODE.COLLAPSED
    && clientContext.state.isRailVisible
  );
  const nonClientPanel = state.panels.active !== 'client_context'
    ? state.panels.active
    : null;

  const helperLabel = useMemo(() => {
    if (isSendingMessage) {
      return `${assistantDisplayName} is reviewing...`;
    }
    if (state.sync.replaying) {
      return 'Replaying pending operations...';
    }
    if (state.hasPendingSync) {
      return 'Pending changes will sync automatically when online.';
    }
    if (state.loading) {
      return `${assistantDisplayName} is syncing your workspace...`;
    }
    if (state.error && !staleRouteError) {
      return state.error;
    }
    return null;
  }, [
    isSendingMessage,
    state.error,
    state.hasPendingSync,
    state.loading,
    state.sync.replaying,
    staleRouteError,
    assistantDisplayName,
  ]);
  const headerStatusLabel = useMemo(() => {
    if (isSendingMessage || state.loading || state.sync.replaying) {
      return 'Syncing';
    }
    if (state.hasPendingSync) {
      return 'Pending';
    }
    return 'Ready';
  }, [isSendingMessage, state.hasPendingSync, state.loading, state.sync.replaying]);

  useEffect(() => {
    let isActive = true;
    if (!accessToken) {
      setAssistantDisplayName(DEFAULT_ASSISTANT_DISPLAY_NAME);
      return () => {
        isActive = false;
      };
    }
    getTrainerSettingsMe({ accessToken })
      .then((payload) => {
        if (!isActive) {
          return;
        }
        setAssistantDisplayName(resolveAssistantDisplayName(payload?.assistant_display_name));
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setAssistantDisplayName(DEFAULT_ASSISTANT_DISPLAY_NAME);
      });

    return () => {
      isActive = false;
    };
  }, [accessToken]);

  const showCopyFeedback = useCallback((message) => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    setCopyFeedback(message);
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, COPY_FEEDBACK_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    visibleStreamLengthRef.current = visibleStream.length;
  }, [visibleStream.length]);

  useEffect(() => {
    if (previousTrainerIdRef.current === trainerId) {
      return;
    }
    previousTrainerIdRef.current = trainerId;
    setIsNearBottom(true);
    setPendingNewMessagesBelowFold(false);
    setAnchorToLatestSignal((value) => value + 1);
  }, [trainerId]);

  useEffect(() => {
    const normalizedWorkspaceClientId = String(state.activeClientId || '').trim() || null;
    if (previousWorkspaceClientIdRef.current === normalizedWorkspaceClientId) {
      return;
    }
    previousWorkspaceClientIdRef.current = normalizedWorkspaceClientId;
    clientContext.actions.hydrateSelectedClientId(normalizedWorkspaceClientId);
  }, [clientContext.actions, state.activeClientId]);

  useEffect(() => {
    if (state.panels.active !== 'client_context') {
      return;
    }
    const panelContext = state.panels.context || {};
    const initialClientId = panelContext?.clientId || state.activeClientId || null;
    if (initialClientId) {
      clientContext.actions.hydrateSelectedClientId(initialClientId);
    }
    if (panelContext?.initialSection === 'settings') {
      const fullSection = panelContext?.filter === 'risk_flags'
        ? 'advanced_ai_context'
        : 'schedule_preferences';
      clientContext.actions.openFullRail(fullSection);
    } else {
      clientContext.actions.expandRail({
        focusSearch: !initialClientId,
      });
    }
    actions.closePanel();
  }, [
    actions,
    clientContext.actions,
    state.activeClientId,
    state.panels.active,
    state.panels.context,
  ]);

  useEffect(() => {
    const openEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const closeEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const keyboardOpenSubscription = Keyboard.addListener(openEvent, () => {
      setIsKeyboardVisible(true);
      if (
        latestScrollMetricsRef.current.nearBottom
        && visibleStreamLengthRef.current > 0
      ) {
        setStreamForceScrollSignal((value) => value + 1);
        setAnchorToLatestSignal((value) => value + 1);
      }
    });
    const keyboardCloseSubscription = Keyboard.addListener(closeEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      keyboardOpenSubscription.remove();
      keyboardCloseSubscription.remove();
    };
  }, []);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  }, []);

  const handleSubmitComposer = async () => {
    const submitted = composerValue.trim();
    if (!submitted || state.loading || isSendingMessage) {
      return;
    }
    setIsSendingMessage(true);
    setStreamForceScrollSignal((value) => value + 1);
    setAnchorToLatestSignal((value) => value + 1);
    try {
      const didSend = await actions.sendIntentMessage(submitted);
      if (didSend) {
        setComposerValue('');
      }
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleCommandSelect = useCallback(async (command) => {
    if (!command || state.loading || isSendingMessage) {
      return;
    }
    setComposerValue(command);
    setIsSendingMessage(true);
    setStreamForceScrollSignal((value) => value + 1);
    setAnchorToLatestSignal((value) => value + 1);
    try {
      const didSend = await actions.sendIntentMessage(command);
      if (didSend) {
        setComposerValue('');
      }
    } finally {
      setIsSendingMessage(false);
    }
  }, [actions, isSendingMessage, state.loading]);

  const handleCopyRouteDetails = useCallback(async () => {
    const diagnosticsSource = staleRouteError || workspaceNetworkError;
    if (!diagnosticsSource) {
      return;
    }
    try {
      const diagnosticsBundle = buildTrainerRouteDiagnosticsBundle({
        surface: staleRouteError ? 'Trainer Coach Workspace (Stale Route)' : 'Trainer Coach Workspace (Connectivity)',
        errorDetails: diagnosticsSource,
      });
      await Clipboard.setStringAsync(diagnosticsBundle);
      showCopyFeedback('Copied diagnostics');
    } catch (_error) {
      showCopyFeedback('Unable to copy diagnostics');
    }
  }, [showCopyFeedback, staleRouteError, workspaceNetworkError]);

  const handleJumpToLatest = useCallback(() => {
    setPendingNewMessagesBelowFold(false);
    setStreamForceScrollSignal((value) => value + 1);
    setAnchorToLatestSignal((value) => value + 1);
  }, []);

  return (
    <SafeScreen
      includeBottomInset={false}
      includeTopInset
      style={styles.screen}
      atmosphere="coach"
      atmosphereOverlayStrength={0.96}
    >
      <View testID="trainer-coach-compact-header" style={styles.compactHeader}>
        <View style={styles.compactHeaderRow}>
          <ModeText variant="h3" style={styles.compactHeaderTitle}>Coach</ModeText>
          <View style={styles.compactStatusChip}>
            <ModeText variant="caption" tone="secondary" style={styles.compactStatusChipLabel}>
              {headerStatusLabel}
            </ModeText>
          </View>
        </View>
        <ModeText variant="caption" tone="secondary" style={styles.compactHeaderSubtitle}>
          {`Conversation with ${assistantDisplayName}`}
        </ModeText>
      </View>
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {staleRouteError ? (
          <View style={styles.content}>
            <ModeCard testID="trainer-coach-stale-route-card" variant="surface">
              <ModeText variant="h3">Unable to load Coach workspace</ModeText>
              <ModeText variant="bodySm" tone="error">
                {staleRouteError.message}
              </ModeText>
              <View style={styles.routeDiagnosticBlock}>
                <ModeText variant="bodySm" tone="secondary">
                  The backend appears stale and is missing trainer coach routes.
                </ModeText>
                {staleRouteError.requestPath ? (
                  <ModeText variant="caption" tone="tertiary">
                    Missing route: {staleRouteError.requestPath}
                  </ModeText>
                ) : null}
                {staleRouteError.apiBase ? (
                  <ModeText variant="caption" tone="tertiary">
                    API base: {staleRouteError.apiBase}
                  </ModeText>
                ) : null}
                <ModeText variant="caption" tone="tertiary">
                  Restart or redeploy backend from current repo code, then verify `/openapi.json`.
                </ModeText>
              </View>
              <ModeButton
                testID="trainer-coach-stale-route-retry"
                title={state.loading ? 'Retrying...' : 'Retry'}
                onPress={() => actions.refreshWorkspace({ silent: false })}
                disabled={state.loading}
                style={styles.actionButton}
              />
              <ModeButton
                testID="trainer-coach-stale-route-copy"
                title="Copy details"
                variant="ghost"
                onPress={handleCopyRouteDetails}
                disabled={state.loading}
                style={styles.actionButton}
              />
              {copyFeedback ? (
                <ModeText variant="caption" tone="secondary">{copyFeedback}</ModeText>
              ) : null}
            </ModeCard>
          </View>
        ) : (
          <View style={styles.content}>
            {workspaceNetworkError ? (
              <ModeCard testID="trainer-coach-network-card" variant="surface">
                <ModeText variant="h3">Coach workspace connectivity issue</ModeText>
                <ModeText variant="bodySm" tone="error">
                  {workspaceNetworkError.message}
                </ModeText>
                <View style={styles.routeDiagnosticBlock}>
                  {workspaceNetworkError.apiBase ? (
                    <ModeText variant="caption" tone="tertiary">
                      Resolved API base: {workspaceNetworkError.apiBase}
                    </ModeText>
                  ) : null}
                  {Array.isArray(workspaceNetworkError.attemptedBaseUrls) && workspaceNetworkError.attemptedBaseUrls.length > 0 ? (
                    <ModeText variant="caption" tone="tertiary">
                      Attempted hosts: {workspaceNetworkError.attemptedBaseUrls.join(', ')}
                    </ModeText>
                  ) : null}
                  {workspaceNetworkError.recommendedApiBase ? (
                    <ModeText variant="caption" tone="tertiary">
                      Recommended API base: {workspaceNetworkError.recommendedApiBase}
                    </ModeText>
                  ) : null}
                  <ModeText variant="caption" tone="tertiary">
                    Start backend with `cd backend && ./venv/bin/python main.py`.
                  </ModeText>
                  <ModeText variant="caption" tone="tertiary">
                    Verify `{`${workspaceNetworkError.recommendedApiBase || workspaceNetworkError.apiBase || 'http://<LAN-IP>:8000'}/healthz`}` from your phone browser.
                  </ModeText>
                  <ModeText variant="caption" tone="tertiary">
                    Confirm same Wi-Fi, disable VPN/proxy, allow Python inbound firewall, then restart Expo with cache clear.
                  </ModeText>
                </View>
                <ModeButton
                  testID="trainer-coach-network-retry"
                  title={state.loading ? 'Retrying...' : 'Retry'}
                  onPress={() => actions.refreshWorkspace({ silent: false })}
                  disabled={state.loading}
                  style={styles.actionButton}
                />
                <ModeButton
                  testID="trainer-coach-network-copy"
                  title="Copy details"
                  variant="ghost"
                  onPress={handleCopyRouteDetails}
                  disabled={state.loading}
                  style={styles.actionButton}
                />
                {copyFeedback ? (
                  <ModeText variant="caption" tone="secondary">{copyFeedback}</ModeText>
                ) : null}
              </ModeCard>
            ) : null}

            <View style={styles.streamViewport}>
              <CoachStreamList
                streamItems={visibleStream}
                assistantDisplayName={assistantDisplayName}
                forceScrollSignal={streamForceScrollSignal}
                anchorToLatestSignal={anchorToLatestSignal}
                threadKey={trainerId || 'trainer-coach-default-thread'}
                contentBottomPadding={trainerStreamContentBottomPadding}
                onNewItemsWhileAwayFromBottom={() => {
                  if (latestScrollMetricsRef.current.nearBottom) {
                    return;
                  }
                  setPendingNewMessagesBelowFold(true);
                }}
                onScrollMetricsChange={(metrics) => {
                  if (!metrics || typeof metrics !== 'object') {
                    return;
                  }
                  const nextOffset = asNonNegativeNumber(metrics.offset, 0);
                  const nextNearBottom = Boolean(metrics.nearBottom);
                  latestScrollMetricsRef.current = {
                    offset: nextOffset,
                    contentHeight: asNonNegativeNumber(metrics.contentHeight, 0),
                    layoutHeight: asNonNegativeNumber(metrics.layoutHeight, 0),
                    nearBottom: nextNearBottom,
                  };
                }}
                onNearBottomChange={(nearBottom) => {
                  const normalized = Boolean(nearBottom);
                  setIsNearBottom((current) => (current === normalized ? current : normalized));
                  if (normalized) {
                    setPendingNewMessagesBelowFold(false);
                  }
                  latestScrollMetricsRef.current = {
                    ...latestScrollMetricsRef.current,
                    nearBottom: normalized,
                  };
                }}
              />
              {showJumpToLatest ? (
                <Pressable
                  testID="trainer-coach-jump-latest"
                  onPress={handleJumpToLatest}
                  style={({ pressed }) => [
                    styles.jumpToLatestButton,
                    { bottom: jumpToLatestBottom },
                    pressed && styles.jumpToLatestButtonPressed,
                  ]}
                >
                  <ModeText variant="caption" tone="inverse" style={styles.jumpToLatestLabel}>
                    Jump to latest
                  </ModeText>
                </Pressable>
              ) : null}
              {isClientRailOpen ? (
                <Pressable
                  testID="trainer-coach-client-context-tap-outside"
                  onPress={() => clientContext.actions.collapseRail()}
                  style={[
                    styles.clientContextTapOutside,
                    { bottom: composerDockHeight + activeComposerOffset },
                  ]}
                />
              ) : null}

              <View
                pointerEvents="none"
                style={[
                  styles.composerDockBackdrop,
                  {
                    bottom: activeComposerOffset,
                    height: composerDockBackdropHeight,
                  },
                ]}
              >
                {Platform.OS === 'ios' ? (
                  <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
                ) : null}
                <View pointerEvents="none" style={styles.composerDockBackdropTint} />
                <View pointerEvents="none" style={styles.composerDockBackdropSeparator} />
              </View>

              <View
                pointerEvents="box-none"
                style={[
                  styles.composerDock,
                  { bottom: activeComposerOffset },
                ]}
              >
                <View
                  testID="trainer-coach-composer-dock-stack"
                  onLayout={(event) => {
                    const nextHeight = event?.nativeEvent?.layout?.height || 0;
                    setComposerDockHeight((current) => (current === nextHeight ? current : nextHeight));
                  }}
                  style={styles.composerDockStack}
                >
                  <ClientContextRail
                    testIDPrefix="trainer-coach-client-context-rail"
                    state={clientContext.state}
                    selectedClientSummary={clientContext.selectedClientSummary}
                    actions={clientContext.actions}
                    createdByTrainerId={trainerId}
                  />
                  <CoachComposerWithCommands
                    value={composerValue}
                    onChangeText={setComposerValue}
                    onSubmit={handleSubmitComposer}
                    onCommandSelect={handleCommandSelect}
                    assistantDisplayName={assistantDisplayName}
                    disabled={state.loading || isSendingMessage}
                    isSubmitting={isSendingMessage}
                  />
                  {helperLabel ? (
                    <View style={styles.helperRow}>
                      <ModeText variant="caption" tone={state.error && !isSendingMessage ? 'error' : 'secondary'}>
                        {helperLabel}
                      </ModeText>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {!staleRouteError ? (
        <CoachPanelHost
          accessToken={accessToken}
          activePanel={nonClientPanel}
          panelContext={state.panels.context}
          queue={state.queue}
          onOpenTrainerCoach={onOpenTrainerCoach}
          onClose={actions.closePanel}
          onApproveDraft={actions.approveDraft}
          onEditDraft={actions.editDraft}
          onRejectDraft={actions.rejectDraft}
          onSystemEvent={(event) => {
            actions.emitSystemEvent(event);
          }}
        />
      ) : null}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  compactHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
    gap: 4,
  },
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  compactHeaderTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  compactHeaderSubtitle: {
    color: theme.colors.text.secondary,
  },
  compactStatusChip: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(232, 243, 255, 0.16)',
    backgroundColor: 'rgba(12, 22, 38, 0.78)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
  },
  compactStatusChipLabel: {
    fontWeight: '600',
  },
  keyboardWrap: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    gap: theme.spacing[2],
  },
  routeDiagnosticBlock: {
    gap: theme.spacing[1],
  },
  actionButton: {
    marginTop: theme.spacing[1],
  },
  streamViewport: {
    flex: 1,
    position: 'relative',
  },
  jumpToLatestButton: {
    position: 'absolute',
    alignSelf: 'center',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(226, 240, 255, 0.24)',
    backgroundColor: 'rgba(17, 30, 49, 0.92)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 7,
    zIndex: 7,
  },
  jumpToLatestButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  jumpToLatestLabel: {
    fontWeight: '600',
  },
  composerDockBackdrop: {
    position: 'absolute',
    left: -theme.spacing[3],
    right: -theme.spacing[3],
    zIndex: 5,
    overflow: 'hidden',
  },
  composerDockBackdropTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 13, 24, 0.92)',
  },
  composerDockBackdropSeparator: {
    position: 'absolute',
    left: theme.spacing[3],
    right: theme.spacing[3],
    top: 0,
    height: 1,
    backgroundColor: 'rgba(232, 243, 255, 0.1)',
  },
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 6,
  },
  clientContextTapOutside: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  composerDockStack: {
    paddingTop: theme.spacing[1],
    gap: theme.spacing[1],
  },
  helperRow: {
    minHeight: 0,
  },
});
