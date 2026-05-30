import React from 'react';

import { ModeCard } from '../../../../lib/components';
import {
  SettingToggle,
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function PersonalizationScreen({
  tonePreference,
  reminderPreference,
  onToggleTonePreference,
  onToggleReminderPreference,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Personalization"
      subtitle="Coaching tone and reminder style"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="tinted">
        <SettingsSectionLabel>Personalization</SettingsSectionLabel>
        <SettingToggle
          label="Supportive coaching tone"
          description="Keep language calm, clear, and emotionally intelligent."
          enabled={tonePreference}
          onToggle={onToggleTonePreference}
        />
        <SettingToggle
          label="Gentle progress reminders"
          description="Use low-pressure nudges focused on consistency."
          enabled={reminderPreference}
          onToggle={onToggleReminderPreference}
        />
      </ModeCard>
    </SettingsScreenShell>
  );
}
