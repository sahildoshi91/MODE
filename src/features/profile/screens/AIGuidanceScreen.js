import React from 'react';
import { StyleSheet } from 'react-native';

import { ModeCard, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { AI_FITNESS_DISCLAIMER } from '../../../config/legalLinks';
import {
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function AIGuidanceScreen({
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="AI Fitness Guidance"
      subtitle="Important safety context"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <SettingsSectionLabel>AI Fitness Guidance</SettingsSectionLabel>
        <ModeText
          testID="profile-ai-fitness-disclaimer"
          variant="caption"
          tone="tertiary"
          style={styles.disclaimer}
        >
          {AI_FITNESS_DISCLAIMER}
        </ModeText>
      </ModeCard>
    </SettingsScreenShell>
  );
}

const styles = StyleSheet.create({
  disclaimer: {
    marginTop: theme.spacing[1],
  },
});
