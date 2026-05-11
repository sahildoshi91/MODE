import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  ModeButton,
  ModeText,
} from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';
import ScheduleDayToggleRow from './ScheduleDayToggleRow';

function sectionTitleFromKey(section) {
  if (section === 'schedule_preferences') {
    return 'Schedule Preferences';
  }
  if (section === 'client_details') {
    return 'Client Details';
  }
  return 'Advanced AI Context';
}

function formatScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 'N/A';
  }
  return `${Math.round(parsed)}`;
}

function resolveProfileSnapshot(summary) {
  return summary?.detail?.profile_snapshot
    || summary?.aiContext?.profile_snapshot
    || {};
}

function resolveYourWhy(summary) {
  const profile = resolveProfileSnapshot(summary);
  return String(profile?.user_why || '').trim();
}

function renderAIContext(summary) {
  const aiContext = summary?.aiContext || {};
  const aiMemoryCount = Array.isArray(aiContext?.applied_ai_usable_memory)
    ? aiContext.applied_ai_usable_memory.length
    : 0;
  const internalCount = Number(aiContext?.internal_only_memory_count || 0);
  const preview = String(aiContext?.context_preview_text || '').trim() || 'No context preview available.';
  const yourWhy = resolveYourWhy(summary);

  return (
    <View style={styles.sectionBody}>
      {yourWhy ? (
        <ModeText variant="bodySm" tone="secondary">{`Your Why: ${yourWhy}`}</ModeText>
      ) : null}
      <ModeText variant="caption" tone="secondary">
        {`AI-usable memory: ${aiMemoryCount} | Internal-only memory: ${internalCount}`}
      </ModeText>
      <ModeText variant="bodySm" tone="secondary">{preview}</ModeText>
    </View>
  );
}

function renderClientDetails(summary) {
  const detail = summary?.detail || {};
  const activity = detail?.activity_summary || {};
  const schedule = detail?.schedule_preferences || {};
  const yourWhy = resolveYourWhy(summary);

  return (
    <View style={styles.sectionBody}>
      {yourWhy ? (
        <ModeText variant="bodySm" tone="secondary">{`Your Why: ${yourWhy}`}</ModeText>
      ) : null}
      <ModeText variant="caption" tone="secondary">
        {`Avg score (7d): ${formatScore(activity?.avg_score_7d)}`}
      </ModeText>
      <ModeText variant="caption" tone="secondary">
        {`Last check-in: ${activity?.latest_checkin_date || 'N/A'}`}
      </ModeText>
      <ModeText variant="caption" tone="secondary">
        {`Session status: ${activity?.session_status || 'unscheduled'}`}
      </ModeText>
      <ModeText variant="caption" tone="secondary">
        {`Preferred location: ${schedule?.preferred_meeting_location || 'Not set'}`}
      </ModeText>
    </View>
  );
}

function renderSchedulePreferences({
  summary,
  scheduleDaysDraft,
  onToggleDay,
  onSaveSchedule,
  isSavingSchedule,
  scheduleSaveStatus,
}) {
  const schedule = summary?.detail?.schedule_preferences || {};
  const saveMessage = scheduleSaveStatus === 'saved'
    ? 'Schedule preferences saved.'
    : (scheduleSaveStatus === 'error' ? 'Unable to save schedule preferences.' : null);

  return (
    <View style={styles.sectionBody}>
      <ScheduleDayToggleRow
        selectedDays={scheduleDaysDraft}
        onToggle={(weekday) => {
          const selected = Array.isArray(scheduleDaysDraft) ? scheduleDaysDraft : [];
          const next = selected.includes(weekday)
            ? selected.filter((value) => value !== weekday)
            : [...selected, weekday].sort((left, right) => left - right);
          onToggleDay?.(next);
        }}
      />
      <ModeText variant="caption" tone="secondary">
        {`Trainer fallback: ${schedule?.auto_use_trainer_default_location === false ? 'Off' : 'On'}`}
      </ModeText>
      {saveMessage ? (
        <ModeText
          variant="caption"
          tone={scheduleSaveStatus === 'error' ? 'error' : 'secondary'}
        >
          {saveMessage}
        </ModeText>
      ) : null}
      <ModeButton
        title={isSavingSchedule ? 'Saving...' : 'Save Schedule Preferences'}
        onPress={onSaveSchedule}
        disabled={isSavingSchedule}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          // This opens the same full sheet for now; deeper route can be layered in later.
          onSaveSchedule?.();
        }}
        style={({ pressed }) => [
          styles.inlineLinkRow,
          pressed && styles.inlineLinkRowPressed,
        ]}
      >
        <ModeText variant="caption" tone="secondary">Edit schedule preferences</ModeText>
      </Pressable>
    </View>
  );
}

export default function FullClientContextSheet({
  section = 'advanced_ai_context',
  summary,
  scheduleDaysDraft,
  onToggleDay,
  onSaveSchedule,
  onBack,
  isSavingSchedule = false,
  scheduleSaveStatus = 'idle',
}) {
  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to client context"
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <ModeText variant="caption" tone="secondary">Back</ModeText>
        </Pressable>
        <ModeText variant="bodySm" style={styles.sectionTitle}>
          {sectionTitleFromKey(section)}
        </ModeText>
      </View>

      {section === 'schedule_preferences'
        ? renderSchedulePreferences({
          summary,
          scheduleDaysDraft,
          onToggleDay,
          onSaveSchedule,
          isSavingSchedule,
          scheduleSaveStatus,
        })
        : null}
      {section === 'client_details' ? renderClientDetails(summary) : null}
      {section === 'advanced_ai_context' ? renderAIContext(summary) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing[2],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  backButton: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 6,
  },
  backButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  sectionTitle: {
    fontWeight: '700',
  },
  sectionBody: {
    gap: theme.spacing[1],
  },
  inlineLinkRow: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  inlineLinkRowPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
});
