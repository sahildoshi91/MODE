import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getTrainerHomeToday } from '../services/trainerHomeApi';

function formatSessionWindow(startAt, endAt) {
  if (!startAt && !endAt) {
    return 'Time not set';
  }
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const startLabel = start && !Number.isNaN(start.getTime())
    ? start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'Start TBD';
  const endLabel = end && !Number.isNaN(end.getTime())
    ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'End TBD';
  return `${startLabel} - ${endLabel}`;
}

function formatAvgScore(value) {
  if (typeof value !== 'number') {
    return 'N/A';
  }
  return `${value.toFixed(1)}/25`;
}

export default function TrainerClientsScreen({ accessToken, bottomInset = 0 }) {
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  const loadDashboard = async () => {
    if (!accessToken) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await getTrainerHomeToday({ accessToken });
      setPayload(response);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to load today\'s clients.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [accessToken]);

  const totals = payload?.totals || {
    scheduled_clients: 0,
    checkins_completed_today: 0,
    workouts_completed_7d: 0,
  };

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="Clients"
        subtitle="Today’s schedule, weekly context, and talking points"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <ModeCard variant="tinted">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Today</ModeText>
          <ModeText variant="bodySm">
            {totals.scheduled_clients} scheduled clients · {totals.checkins_completed_today} check-ins done today
          </ModeText>
          <ModeText variant="bodySm" tone="secondary">
            {totals.workouts_completed_7d} completed workouts logged in the last 7 days
          </ModeText>
        </ModeCard>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading client dashboard...</ModeText>
          </View>
        ) : null}

        {!isLoading && errorMessage ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="error">{errorMessage}</ModeText>
            <ModeButton
              title="Retry"
              variant="secondary"
              onPress={loadDashboard}
              style={styles.retryButton}
            />
          </ModeCard>
        ) : null}

        {!isLoading && !errorMessage && (!payload?.clients || payload.clients.length === 0) ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="secondary">
              No clients are scheduled for today yet. Seed today’s schedule and refresh this screen.
            </ModeText>
            <ModeButton
              title="Refresh"
              variant="secondary"
              onPress={loadDashboard}
              style={styles.retryButton}
            />
          </ModeCard>
        ) : null}

        {!isLoading && !errorMessage && Array.isArray(payload?.clients) && payload.clients.length > 0 ? (
          <View style={styles.clientList}>
            {payload.clients.map((client) => (
              <ModeCard key={client.schedule_id || client.client_id} variant="surface">
                <ModeText variant="h3">{client.client_name || 'Client'}</ModeText>
                <ModeText variant="caption" tone="secondary" style={styles.metaLine}>
                  {formatSessionWindow(client.session_start_at, client.session_end_at)} · {client.status || 'scheduled'}
                </ModeText>
                {client.session_type ? (
                  <ModeText variant="caption" tone="tertiary">Session type: {client.session_type}</ModeText>
                ) : null}
                <View style={styles.summaryBlock}>
                  <ModeText variant="label" tone="tertiary">Week Summary</ModeText>
                  <ModeText variant="bodySm">
                    {client.week_summary?.checkins_completed_7d || 0} check-ins · avg {formatAvgScore(client.week_summary?.avg_score_7d)} ({client.week_summary?.avg_mode_7d || 'N/A'})
                  </ModeText>
                  <ModeText variant="bodySm" tone="secondary">
                    {client.week_summary?.workouts_completed_7d || 0} workouts completed in 7 days
                  </ModeText>
                </View>
                <View style={styles.summaryBlock}>
                  <ModeText variant="label" tone="tertiary">Talking Points</ModeText>
                  {Array.isArray(client.talking_points) && client.talking_points.length > 0 ? (
                    <View style={styles.pointsList}>
                      {client.talking_points.map((point, index) => (
                        <ModeText key={`${client.client_id}-${index}`} variant="bodySm" tone="secondary">
                          • {point}
                        </ModeText>
                      ))}
                    </View>
                  ) : (
                    <ModeText variant="bodySm" tone="secondary">No talking points generated.</ModeText>
                  )}
                </View>
              </ModeCard>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing[1],
  },
  loadingContainer: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
  },
  retryButton: {
    marginTop: theme.spacing[2],
  },
  clientList: {
    gap: theme.spacing[1],
  },
  metaLine: {
    marginTop: theme.spacing[1] - 2,
  },
  summaryBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
  pointsList: {
    gap: theme.spacing[1] - 2,
  },
});
