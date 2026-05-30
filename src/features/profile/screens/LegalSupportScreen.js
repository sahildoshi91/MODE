import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import {
  ModeText,
  SystemSectionCard,
  SystemSectionHeader,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { SettingsScreenShell } from './SettingsScreenShell';

const DOCUMENT_LINK_IDS = new Set(['privacy', 'terms']);

function LinkRow({ link, onPress }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={link.label}
      onPress={() => onPress(link)}
      testID={`profile-legal-link-${link.id}`}
      style={({ pressed }) => [
        styles.linkRow,
        pressed && styles.linkRowPressed,
      ]}
    >
      <View style={styles.linkCopy}>
        <ModeText variant="bodySm" tone="accent" style={styles.linkLabel}>
          {link.label}
        </ModeText>
      </View>
      <Feather name="external-link" size={16} color={theme.colors.accent.primary} />
    </Pressable>
  );
}

export default function LegalSupportScreen({
  legalLinks,
  legalLinksFallbackText,
  legalLinksError,
  onLegalLinkPress,
  bottomInset,
  onBack,
}) {
  const configuredLinks = legalLinks.filter((link) => link?.isConfigured && link?.url);
  const documentLinks = configuredLinks.filter((link) => DOCUMENT_LINK_IDS.has(link.id));
  const supportLinks = configuredLinks.filter((link) => !DOCUMENT_LINK_IDS.has(link.id));

  return (
    <SettingsScreenShell
      title="Legal & Support"
      subtitle="Documents and help"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <View testID="profile-legal-links" style={styles.sections}>
        <SystemSectionCard>
          <SystemSectionHeader title="Documents" />
          {documentLinks.map((link) => (
            <LinkRow key={link.id} link={link} onPress={onLegalLinkPress} />
          ))}
        </SystemSectionCard>

        <SystemSectionCard>
          <SystemSectionHeader title="Help" />
          {supportLinks.map((link) => (
            <LinkRow key={link.id} link={link} onPress={onLegalLinkPress} />
          ))}
        </SystemSectionCard>
      </View>

      {legalLinksFallbackText ? (
        <ModeText
          testID="profile-legal-links-fallback"
          variant="caption"
          tone="tertiary"
          style={styles.legalFallback}
        >
          {legalLinksFallbackText}
        </ModeText>
      ) : null}
      {legalLinksError ? (
        <ModeText variant="caption" tone="error" style={styles.legalFallback}>
          {legalLinksError}
        </ModeText>
      ) : null}
    </SettingsScreenShell>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: theme.spacing[3],
  },
  linkRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[1] + 4,
    paddingVertical: 10,
  },
  linkRowPressed: {
    backgroundColor: theme.colors.surface.elevated,
  },
  linkCopy: {
    flex: 1,
  },
  linkLabel: {
    fontWeight: '600',
  },
  legalFallback: {
    marginTop: -theme.spacing[1],
  },
});
