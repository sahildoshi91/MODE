import React from 'react';

import { ModeCard } from '../../../../lib/components';
import {
  SettingsDetailRow,
  SettingsDivider,
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function AccountSettingsScreen({
  email,
  trainerName,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Account"
      subtitle="Email and coach details"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <SettingsSectionLabel>Account</SettingsSectionLabel>
        <SettingsDetailRow label="Email" value={email} />
        <SettingsDivider />
        <SettingsDetailRow label="Coach" value={trainerName} />
      </ModeCard>
    </SettingsScreenShell>
  );
}
