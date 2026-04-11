import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  createTrainerKnowledgeDocument,
  listTrainerKnowledgeDocuments,
} from '../services/trainerKnowledgeApi';

function formatSavedDate(value) {
  if (!value) {
    return 'Date unavailable';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unavailable';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export default function TrainerHomeScreen({
  accessToken,
  bottomInset = 0,
  viewerDisplayName = null,
  trainerOnboardingCompleted = false,
  onOpenCoachTraining = null,
}) {
  const [documents, setDocuments] = useState([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');

  const profileLabel = useMemo(
    () => viewerDisplayName || 'Trainer',
    [viewerDisplayName],
  );

  const loadDocuments = async () => {
    if (!accessToken) {
      return;
    }
    setIsLoadingDocuments(true);
    setLoadError(null);
    try {
      const payload = await listTrainerKnowledgeDocuments({ accessToken });
      setDocuments(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setLoadError(error?.message || 'Unable to load trainer knowledge.');
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [accessToken]);

  const handleSaveDocument = async () => {
    if (!accessToken || isSaving) {
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedRawText = rawText.trim();
    if (!trimmedTitle || !trimmedRawText) {
      setSaveError('Add a title and paste coaching notes before saving.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      await createTrainerKnowledgeDocument({
        accessToken,
        title: trimmedTitle,
        rawText: trimmedRawText,
      });
      setTitle('');
      setRawText('');
      setSaveSuccess('Saved. Your agent can use this guidance.');
      await loadDocuments();
    } catch (error) {
      setSaveError(error?.message || 'Unable to save trainer knowledge.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="Trainer Home"
        subtitle={`Trainer profile: ${profileLabel}`}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <ModeCard variant="tinted">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Profile</ModeText>
          <ModeText variant="bodySm">
            {trainerOnboardingCompleted
              ? 'Trainer onboarding is complete and active for your assistant.'
              : 'Trainer onboarding is still in progress. Use Coach to finish training your assistant voice.'}
          </ModeText>
          <ModeButton
            title="Open Coach to train agent"
            variant="secondary"
            onPress={onOpenCoachTraining}
            style={styles.actionButton}
          />
        </ModeCard>

        <ModeCard variant="surface">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Train Your Agent</ModeText>
          <ModeText variant="bodySm" tone="secondary">
            Paste the rules and style you want your assistant to follow when building workouts and nutrition guidance.
          </ModeText>
          <ModeInput
            value={title}
            onChangeText={setTitle}
            placeholder="Document title (example: Program design rules)"
          />
          <ModeInput
            value={rawText}
            onChangeText={setRawText}
            placeholder="Paste your coaching framework here..."
            multiline
            style={styles.multilineInput}
          />
          {saveError ? (
            <ModeText variant="caption" tone="error">{saveError}</ModeText>
          ) : null}
          {saveSuccess ? (
            <ModeText variant="caption" tone="success">{saveSuccess}</ModeText>
          ) : null}
          <ModeButton
            title={isSaving ? 'Saving...' : 'Save training notes'}
            onPress={handleSaveDocument}
            disabled={isSaving}
            style={styles.actionButton}
          />
        </ModeCard>

        <ModeCard variant="surface">
          <View style={styles.listHeader}>
            <ModeText variant="label" tone="tertiary">Saved Knowledge</ModeText>
            <ModeButton
              title="Refresh"
              variant="ghost"
              size="md"
              onPress={loadDocuments}
              style={styles.refreshButton}
            />
          </View>
          {isLoadingDocuments ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
              <ModeText variant="bodySm" tone="secondary">Loading saved knowledge...</ModeText>
            </View>
          ) : null}
          {!isLoadingDocuments && loadError ? (
            <ModeText variant="bodySm" tone="error">{loadError}</ModeText>
          ) : null}
          {!isLoadingDocuments && !loadError && documents.length === 0 ? (
            <ModeText variant="bodySm" tone="secondary">
              No training notes yet. Save your first coaching document above.
            </ModeText>
          ) : null}
          {!isLoadingDocuments && !loadError && documents.length > 0 ? (
            <View style={styles.documentList}>
              {documents.slice(0, 12).map((doc) => (
                <View key={doc.id || `${doc.title}-${doc.created_at || ''}`} style={styles.documentRow}>
                  <ModeText variant="bodySm">{doc.title || 'Untitled document'}</ModeText>
                  <ModeText variant="caption" tone="tertiary">
                    {doc.document_type || 'text'} · {formatSavedDate(doc.created_at)}
                  </ModeText>
                </View>
              ))}
            </View>
          ) : null}
        </ModeCard>
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
  actionButton: {
    marginTop: theme.spacing[2],
  },
  multilineInput: {
    minHeight: 140,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[1],
  },
  refreshButton: {
    minHeight: 40,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  documentList: {
    gap: theme.spacing[2],
  },
  documentRow: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
});
