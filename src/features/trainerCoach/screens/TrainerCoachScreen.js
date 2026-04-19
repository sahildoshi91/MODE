import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { buildTrainerRouteDiagnosticsBundle } from '../../trainerPlatform/utils/trainerRouteDiagnostics';
import CoachComposerWithCommands from '../components/CoachComposerWithCommands';
import CoachPanelHost from '../components/CoachPanelHost';
import CoachStreamList from '../components/CoachStreamList';
import DraftQueueDock from '../components/DraftQueueDock';
import TodaySummaryBar from '../components/TodaySummaryBar';
import { useTrainerCoachWorkspace } from '../hooks/useTrainerCoachWorkspace';

const SUMMARY_COLLAPSE_SCROLL_THRESHOLD = 72;
const QUEUE_MINIMIZE_SCROLL_THRESHOLD = 260;
const COPY_FEEDBACK_TIMEOUT_MS = 2200;

export default function TrainerCoachScreen({
  accessToken,
  trainerId,
  bottomInset = 0,
}) {
  const [composerValue, setComposerValue] = useState('');
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const copyFeedbackTimerRef = useRef(null);
  const {
    state,
    actions,
  } = useTrainerCoachWorkspace({
    accessToken,
    trainerId,
  });
  const staleRouteError = state.errorDetails?.isStaleBackendRoute
    ? state.errorDetails
    : null;
  const workspaceNetworkError = (!staleRouteError && state.errorDetails?.stage === 'network')
    ? state.errorDetails
    : null;

  const helperLabel = useMemo(() => {
    if (state.sync.replaying) {
      return 'Replaying pending operations...';
    }
    if (state.hasPendingSync) {
      return 'Pending changes will sync automatically when online.';
    }
    if (state.loading) {
      return 'Loading Coach workspace...';
    }
    if (state.error && !staleRouteError) {
      return state.error;
    }
    return null;
  }, [state.error, state.hasPendingSync, state.loading, state.sync.replaying, staleRouteError]);

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
    const openEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const closeEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const keyboardOpenSubscription = Keyboard.addListener(openEvent, () => {
      setIsKeyboardVisible(true);
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

  const handleSummaryAction = async (summaryAction) => {
    const target = summaryAction?.target;
    if (target === 'queue') {
      actions.openPanel('draft_review', null);
      return;
    }
    if (target === 'panel_rules') {
      actions.openPanel('rules', null);
      return;
    }
    if (target === 'sync') {
      await actions.retryPendingOps();
      return;
    }
    if (target === 'command' && summaryAction?.payload?.command) {
      await actions.sendIntentMessage(summaryAction.payload.command);
      return;
    }
    if (target === 'coach_training') {
      await actions.sendIntentMessage('Resume coach calibration');
      return;
    }
  };

  const handleSubmitComposer = async () => {
    const submitted = composerValue.trim();
    if (!submitted) {
      return;
    }
    const didSend = await actions.sendIntentMessage(submitted);
    if (didSend) {
      setComposerValue('');
    }
  };

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

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="Coach"
        subtitle="Orchestrate, review, and apply coaching work"
      />
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

            <TodaySummaryBar
              summary={state.summary}
              collapsed={state.ui.summaryCollapsed}
              onActionPress={handleSummaryAction}
              onToggleCollapsed={actions.setSummaryCollapsed}
            />

            <DraftQueueDock
              queue={state.queue}
              minimized={state.ui.queueMinimized}
              onToggleMinimized={actions.setQueueMinimized}
              onOpenQueue={() => actions.openPanel('draft_review', null)}
              onOpenDraft={(item) => actions.openPanel('draft_review', { outputId: item.output_id })}
            />

            <CoachStreamList
              streamItems={state.stream}
              onScrollDepthChange={(offsetY) => {
                const shouldCollapseSummary = offsetY > SUMMARY_COLLAPSE_SCROLL_THRESHOLD;
                const shouldMinimizeQueue = offsetY > QUEUE_MINIMIZE_SCROLL_THRESHOLD;
                if (shouldCollapseSummary !== state.ui.summaryCollapsed) {
                  actions.setSummaryCollapsed(shouldCollapseSummary);
                }
                if (shouldMinimizeQueue !== state.ui.queueMinimized) {
                  actions.setQueueMinimized(shouldMinimizeQueue);
                }
              }}
            />

            <View
              style={[
                styles.composerWrap,
                { paddingBottom: isKeyboardVisible ? theme.spacing[1] : Math.max(bottomInset, 0) },
              ]}
            >
              <CoachComposerWithCommands
                value={composerValue}
                onChangeText={setComposerValue}
                onSubmit={handleSubmitComposer}
                onCommandSelect={(command) => {
                  setComposerValue(command);
                  actions.sendIntentMessage(command);
                  setComposerValue('');
                }}
                disabled={state.loading}
              />
              {helperLabel ? (
                <View style={styles.helperRow}>
                  <ModeText variant="caption" tone={state.error ? 'error' : 'secondary'}>
                    {helperLabel}
                  </ModeText>
                </View>
              ) : null}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {!staleRouteError ? (
        <CoachPanelHost
          accessToken={accessToken}
          activePanel={state.panels.active}
          panelContext={state.panels.context}
          queue={state.queue}
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
  keyboardWrap: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  routeDiagnosticBlock: {
    gap: theme.spacing[1],
  },
  actionButton: {
    marginTop: theme.spacing[1],
  },
  composerWrap: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  helperRow: {
    minHeight: 0,
  },
});
