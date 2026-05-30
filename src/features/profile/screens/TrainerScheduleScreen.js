import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeCard, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { formatIsoWeekdaySummary } from '../../trainerClients/utils/scheduleResolver';
import {
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

function valueOrFallback(value, fallback = 'Not available') {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function formatExceptionDate(value) {
  if (!value) {
    return 'Unknown date';
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function TrainerScheduleScreen({
  trainerSchedule,
  trainerScheduleError,
  isLoadingTrainerSchedule,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Trainer Schedule"
      subtitle="Weekly days, location, and exceptions"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <SettingsSectionLabel>Trainer Schedule</SettingsSectionLabel>
        {isLoadingTrainerSchedule ? (
          <ModeText variant="bodySm" tone="secondary">Loading trainer schedule...</ModeText>
        ) : null}
        {!isLoadingTrainerSchedule && trainerScheduleError ? (
          <ModeText variant="bodySm" tone="error">{trainerScheduleError}</ModeText>
        ) : null}
        {!isLoadingTrainerSchedule && !trainerScheduleError ? (
          <>
            <ModeText variant="bodySm" tone="secondary">
              Trainer: {valueOrFallback(trainerSchedule?.trainer_display_name, 'Not assigned')}
            </ModeText>
            <ModeText variant="bodySm">
              Weekly Days: {formatIsoWeekdaySummary(trainerSchedule?.recurring_weekdays)}
            </ModeText>
            <ModeText variant="bodySm" tone="secondary">
              Typical Location: {valueOrFallback(trainerSchedule?.resolved_default_meeting_location, 'Not set')}
            </ModeText>
            {Array.isArray(trainerSchedule?.upcoming_exceptions) && trainerSchedule.upcoming_exceptions.length > 0 ? (
              <View style={styles.trainerScheduleList}>
                {trainerSchedule.upcoming_exceptions.map((exception) => (
                  <ModeText
                    key={`${exception.client_id || trainerSchedule?.client_id}-${exception.session_date}`}
                    variant="caption"
                    tone="secondary"
                  >
                    - {formatExceptionDate(exception.session_date)}: {exception.exception_type}
                    {exception.meeting_location_override ? ` @ ${exception.meeting_location_override}` : ''}
                  </ModeText>
                ))}
              </View>
            ) : (
              <ModeText variant="caption" tone="secondary">No upcoming exceptions.</ModeText>
            )}
            <ModeText variant="caption" tone="tertiary">
              This section is view-only. Schedule edits are trainer-managed.
            </ModeText>
          </>
        ) : null}
      </ModeCard>
    </SettingsScreenShell>
  );
}

const styles = StyleSheet.create({
  trainerScheduleList: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
    gap: theme.spacing[1] - 4,
  },
});
