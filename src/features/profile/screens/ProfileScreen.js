import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet } from 'react-native';
import Constants from 'expo-constants';

import {
  HeaderBar,
  ModeButton,
  SafeScreen,
  SystemNavRow,
  SystemSectionCard,
  SystemSectionHeader,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getApiDebugInfo } from '../../../services/apiBaseUrl';
import {
  getMyTrainerSchedule,
  getTrainerSettingsMe,
  patchTrainerSettingsMe,
} from '../services/profileApi';
import {
  prepareAssistantDisplayNameForSave,
  resolveAssistantDisplayName,
} from '../../messaging';
import {
  getLegalLinks,
  getLegalLinksFallbackText,
} from '../../../config/legalLinks';
import AccountSettingsScreen from './AccountSettingsScreen';
import AIGuidanceScreen from './AIGuidanceScreen';
import DiagnosticsScreen from './DiagnosticsScreen';
import LegalSupportScreen from './LegalSupportScreen';
import PersonalizationScreen from './PersonalizationScreen';
import TrainerDefaultsScreen from './TrainerDefaultsScreen';
import TrainerScheduleScreen from './TrainerScheduleScreen';

const PROFILE_SETTINGS_VIEW = {
  ROOT: 'root',
  ACCOUNT: 'account',
  PERSONALIZATION: 'personalization',
  TRAINER_SCHEDULE: 'trainer_schedule',
  TRAINER_DEFAULTS: 'trainer_defaults',
  AI_GUIDANCE: 'ai_guidance',
  LEGAL_SUPPORT: 'legal_support',
  DIAGNOSTICS: 'diagnostics',
};

const SHOW_ACCOUNT_DIAGNOSTICS = (
  (typeof __DEV__ === 'boolean' && __DEV__)
  || String(process.env.EXPO_PUBLIC_SHOW_ACCOUNT_DIAGNOSTICS || '').trim().toLowerCase() === 'true'
);

function valueOrFallback(value, fallback = 'Not available') {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

export default function ProfileScreen({
  session,
  assignmentStatus,
  accessToken,
  onSignOut,
  onDeleteAccount,
  bottomInset = 0,
}) {
  const debugInfo = useMemo(() => getApiDebugInfo(), []);
  const email = valueOrFallback(session?.user?.email, 'No email found');
  const trainerName = valueOrFallback(assignmentStatus?.assigned_trainer_display_name, 'No trainer assigned');
  const appVersion = valueOrFallback(Constants.expoConfig?.version, 'dev');
  const environment = __DEV__ ? 'Development' : 'Production';
  const showDiagnostics = SHOW_ACCOUNT_DIAGNOSTICS;
  const isTrainerViewer = assignmentStatus?.viewer_role === 'trainer';

  const [viewStack, setViewStack] = useState([{ key: PROFILE_SETTINGS_VIEW.ROOT, params: null }]);
  const [tonePreference, setTonePreference] = useState(true);
  const [reminderPreference, setReminderPreference] = useState(true);
  const [, setTrainerSettings] = useState(null);
  const [trainerSettingsDraft, setTrainerSettingsDraft] = useState({
    defaultMeetingLocation: '',
    autoFillMeetingLocation: true,
    assistantDisplayName: '',
  });
  const [trainerSettingsError, setTrainerSettingsError] = useState(null);
  const [trainerSettingsSuccess, setTrainerSettingsSuccess] = useState(null);
  const [isLoadingTrainerSettings, setIsLoadingTrainerSettings] = useState(false);
  const [isSavingTrainerSettings, setIsSavingTrainerSettings] = useState(false);

  const [trainerSchedule, setTrainerSchedule] = useState(null);
  const [trainerScheduleError, setTrainerScheduleError] = useState(null);
  const [isLoadingTrainerSchedule, setIsLoadingTrainerSchedule] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState(null);
  const [deleteAccountNotice, setDeleteAccountNotice] = useState(null);
  const [legalLinksError, setLegalLinksError] = useState(null);
  const legalLinks = useMemo(() => getLegalLinks(), []);
  const legalLinksFallbackText = useMemo(() => getLegalLinksFallbackText(legalLinks), [legalLinks]);
  const resolvedAssistantPreviewName = useMemo(
    () => resolveAssistantDisplayName(trainerSettingsDraft.assistantDisplayName),
    [trainerSettingsDraft.assistantDisplayName],
  );
  const assistantDisplayNameCharacterCount = String(
    trainerSettingsDraft.assistantDisplayName || '',
  ).trim().length;
  const currentView = viewStack[viewStack.length - 1] || { key: PROFILE_SETTINGS_VIEW.ROOT, params: null };

  const pushView = useCallback((key, params = null) => {
    setViewStack((current) => [...current, { key, params }]);
  }, []);

  const popView = useCallback(() => {
    setViewStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  const handleToggleTonePreference = useCallback(() => {
    setTonePreference((current) => !current);
  }, []);

  const handleToggleReminderPreference = useCallback(() => {
    setReminderPreference((current) => !current);
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!accessToken || !isTrainerViewer) {
      setTrainerSettings(null);
      setTrainerSettingsError(null);
      setTrainerSettingsSuccess(null);
      return () => {
        isMounted = false;
      };
    }

    setIsLoadingTrainerSettings(true);
    setTrainerSettingsError(null);
    getTrainerSettingsMe({ accessToken })
      .then((payload) => {
        if (!isMounted) {
          return;
        }
        setTrainerSettings(payload);
        setTrainerSettingsDraft({
          defaultMeetingLocation: String(payload?.default_meeting_location || ''),
          autoFillMeetingLocation: payload?.auto_fill_meeting_location !== false,
          assistantDisplayName: String(payload?.assistant_display_name || ''),
        });
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setTrainerSettingsError(error?.message || 'Unable to load trainer settings.');
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }
        setIsLoadingTrainerSettings(false);
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, isTrainerViewer]);

  useEffect(() => {
    let isMounted = true;
    if (!accessToken || isTrainerViewer) {
      setTrainerSchedule(null);
      setTrainerScheduleError(null);
      return () => {
        isMounted = false;
      };
    }
    setIsLoadingTrainerSchedule(true);
    setTrainerScheduleError(null);
    getMyTrainerSchedule({ accessToken })
      .then((payload) => {
        if (!isMounted) {
          return;
        }
        setTrainerSchedule(payload);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setTrainerScheduleError(error?.message || 'Unable to load trainer schedule.');
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }
        setIsLoadingTrainerSchedule(false);
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, isTrainerViewer]);

  const handleSaveTrainerSettings = async () => {
    if (!accessToken || isSavingTrainerSettings) {
      return;
    }
    setIsSavingTrainerSettings(true);
    setTrainerSettingsError(null);
    setTrainerSettingsSuccess(null);
    try {
      const trimmedLocation = String(trainerSettingsDraft.defaultMeetingLocation || '').trim();
      const normalizedAssistantName = prepareAssistantDisplayNameForSave(
        trainerSettingsDraft.assistantDisplayName,
      );
      const payload = await patchTrainerSettingsMe({
        accessToken,
        defaultMeetingLocation: trimmedLocation || null,
        autoFillMeetingLocation: Boolean(trainerSettingsDraft.autoFillMeetingLocation),
        assistantDisplayName: normalizedAssistantName,
      });
      setTrainerSettings(payload);
      setTrainerSettingsDraft({
        defaultMeetingLocation: String(payload?.default_meeting_location || ''),
        autoFillMeetingLocation: payload?.auto_fill_meeting_location !== false,
        assistantDisplayName: String(payload?.assistant_display_name || ''),
      });
      setTrainerSettingsSuccess('Trainer defaults saved.');
    } catch (error) {
      setTrainerSettingsError(error?.message || 'Unable to save trainer settings.');
    } finally {
      setIsSavingTrainerSettings(false);
    }
  };

  const handleDeleteAccountPress = async () => {
    if (!onDeleteAccount || isDeletingAccount) {
      return;
    }

    const normalized = String(deleteConfirmationText || '').trim().toUpperCase();
    if (normalized !== 'DELETE') {
      setDeleteAccountError('Type DELETE to submit your account deletion request.');
      return;
    }

    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    setDeleteAccountNotice(null);
    try {
      await onDeleteAccount({ confirmation: 'DELETE' });
      setDeleteAccountNotice('Account deletion request submitted. Processing may continue after sign-out.');
    } catch (error) {
      setDeleteAccountError(error?.message || 'Unable to submit deletion request right now.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleLegalLinkPress = async (link) => {
    if (!link?.url) {
      setLegalLinksError(`Set ${link?.envVar || 'the link URL'} to open ${link?.label || 'this link'}.`);
      return;
    }
    setLegalLinksError(null);
    try {
      await Linking.openURL(link.url);
    } catch (_error) {
      setLegalLinksError(`Unable to open ${link.label} right now.`);
    }
  };

  const commonChildProps = {
    bottomInset,
    onBack: popView,
  };

  if (currentView.key === PROFILE_SETTINGS_VIEW.ACCOUNT) {
    return (
      <AccountSettingsScreen
        {...commonChildProps}
        email={email}
        trainerName={trainerName}
        deleteConfirmationText={deleteConfirmationText}
        onDeleteConfirmationTextChange={setDeleteConfirmationText}
        deleteAccountError={deleteAccountError}
        deleteAccountNotice={deleteAccountNotice}
        isDeletingAccount={isDeletingAccount}
        onDeleteAccountPress={handleDeleteAccountPress}
      />
    );
  }

  if (currentView.key === PROFILE_SETTINGS_VIEW.PERSONALIZATION) {
    return (
      <PersonalizationScreen
        {...commonChildProps}
        tonePreference={tonePreference}
        reminderPreference={reminderPreference}
        onToggleTonePreference={handleToggleTonePreference}
        onToggleReminderPreference={handleToggleReminderPreference}
      />
    );
  }

  if (currentView.key === PROFILE_SETTINGS_VIEW.TRAINER_SCHEDULE && !isTrainerViewer) {
    return (
      <TrainerScheduleScreen
        {...commonChildProps}
        trainerSchedule={trainerSchedule}
        trainerScheduleError={trainerScheduleError}
        isLoadingTrainerSchedule={isLoadingTrainerSchedule}
      />
    );
  }

  if (currentView.key === PROFILE_SETTINGS_VIEW.TRAINER_DEFAULTS && isTrainerViewer) {
    return (
      <TrainerDefaultsScreen
        {...commonChildProps}
        trainerSettingsDraft={trainerSettingsDraft}
        onTrainerSettingsDraftChange={setTrainerSettingsDraft}
        resolvedAssistantPreviewName={resolvedAssistantPreviewName}
        assistantDisplayNameCharacterCount={assistantDisplayNameCharacterCount}
        isLoadingTrainerSettings={isLoadingTrainerSettings}
        isSavingTrainerSettings={isSavingTrainerSettings}
        trainerSettingsError={trainerSettingsError}
        trainerSettingsSuccess={trainerSettingsSuccess}
        onSaveTrainerSettings={handleSaveTrainerSettings}
      />
    );
  }

  if (currentView.key === PROFILE_SETTINGS_VIEW.AI_GUIDANCE) {
    return (
      <AIGuidanceScreen
        {...commonChildProps}
      />
    );
  }

  if (currentView.key === PROFILE_SETTINGS_VIEW.LEGAL_SUPPORT) {
    return (
      <LegalSupportScreen
        {...commonChildProps}
        legalLinks={legalLinks}
        legalLinksFallbackText={legalLinksFallbackText}
        legalLinksError={legalLinksError}
        onLegalLinkPress={handleLegalLinkPress}
      />
    );
  }

  if (currentView.key === PROFILE_SETTINGS_VIEW.DIAGNOSTICS && showDiagnostics) {
    return (
      <DiagnosticsScreen
        {...commonChildProps}
        environment={environment}
        appVersion={appVersion}
        apiBase={valueOrFallback(debugInfo.resolvedApiBaseUrl)}
      />
    );
  }

  return (
    <SafeScreen
      includeTopInset={false}
      style={styles.screen}
      atmosphere="system"
      atmosphereOverlayStrength={0.94}
    >
      <HeaderBar
        title="Settings"
        subtitle="Personalization and account details"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <SystemSectionCard>
          <SystemSectionHeader title="Profile" />
          <SystemNavRow
            icon="user"
            title="Account"
            subtitle="Email and coach details."
            onPress={() => pushView(PROFILE_SETTINGS_VIEW.ACCOUNT)}
            testID="profile-settings-nav-account"
          />
          <SystemNavRow
            icon="sliders"
            title="Personalization"
            subtitle="Coaching tone and reminder style."
            onPress={() => pushView(PROFILE_SETTINGS_VIEW.PERSONALIZATION)}
            testID="profile-settings-nav-personalization"
          />
        </SystemSectionCard>

        <SystemSectionCard>
          <SystemSectionHeader title="Training" />
          {isTrainerViewer ? (
            <SystemNavRow
              icon="settings"
              title="Trainer Defaults"
              subtitle="Session location and assistant identity."
              onPress={() => pushView(PROFILE_SETTINGS_VIEW.TRAINER_DEFAULTS)}
              testID="profile-settings-nav-trainer-defaults"
            />
          ) : (
            <SystemNavRow
              icon="calendar"
              title="Trainer Schedule"
              subtitle="Weekly days, location, and exceptions."
              onPress={() => pushView(PROFILE_SETTINGS_VIEW.TRAINER_SCHEDULE)}
              testID="profile-settings-nav-trainer-schedule"
            />
          )}
        </SystemSectionCard>

        <SystemSectionCard>
          <SystemSectionHeader title="App" />
          <SystemNavRow
            icon="alert-circle"
            title="AI Fitness Guidance"
            subtitle="Important safety context."
            onPress={() => pushView(PROFILE_SETTINGS_VIEW.AI_GUIDANCE)}
            testID="profile-settings-nav-ai-guidance"
          />
          <SystemNavRow
            icon="external-link"
            title="Legal & Support"
            subtitle="Documents and help."
            onPress={() => pushView(PROFILE_SETTINGS_VIEW.LEGAL_SUPPORT)}
            testID="profile-settings-nav-legal-support"
          />
          {showDiagnostics ? (
            <SystemNavRow
              icon="activity"
              title="Diagnostics"
              subtitle="Environment, version, and API base."
              onPress={() => pushView(PROFILE_SETTINGS_VIEW.DIAGNOSTICS)}
              testID="profile-settings-nav-diagnostics"
            />
          ) : null}
        </SystemSectionCard>

        <ModeButton
          title="Sign out"
          variant="ghost"
          onPress={onSignOut}
          size="lg"
        />
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background.app,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[3],
  },
});
