import React from 'react';

import { ModeCard } from '../../../../lib/components';
import {
  SettingsDetailRow,
  SettingsDivider,
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function DiagnosticsScreen({
  environment,
  appVersion,
  apiBase,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Diagnostics"
      subtitle="Environment and API details"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <SettingsSectionLabel>Diagnostics</SettingsSectionLabel>
        <SettingsDetailRow label="Environment" value={environment} />
        <SettingsDivider />
        <SettingsDetailRow label="Version" value={appVersion} />
        <SettingsDivider />
        <SettingsDetailRow label="API Base" value={apiBase} />
      </ModeCard>
    </SettingsScreenShell>
  );
}
