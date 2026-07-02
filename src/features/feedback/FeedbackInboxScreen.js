import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HeaderBar, ModeButton, ModeInput, ModeText } from '../../../lib/components';
import { theme } from '../../../lib/theme';
import { getAdminScreenshotUrl, listAdminReports, updateAdminReport } from './feedbackApi';

const STATUS_OPTIONS = ['open', 'in_review', 'resolved', 'dismissed'];
const STATUS_LABELS = {
  open: 'Open',
  in_review: 'In Review',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};
const TYPE_LABELS = {
  bug: 'Bug',
  feature_request: 'Feature',
  feedback: 'Feedback',
};

export default function FeedbackInboxScreen({ onBack, accessToken }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);

  const [filterStatus, setFilterStatus] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);

  const load = useCallback(async (status = filterStatus) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAdminReports(accessToken, { status, limit: 20 });
      setReports(data);
      setHasMore(data.length === 20);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [accessToken, filterStatus]);

  // Load on mount
  React.useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!hasMore || loadingMore || reports.length === 0) return;
    setLoadingMore(true);
    try {
      const before = reports[reports.length - 1].created_at;
      const data = await listAdminReports(accessToken, { status: filterStatus, limit: 20, before });
      setReports((prev) => [...prev, ...data]);
      setHasMore(data.length === 20);
    } catch (err) {
      setError(err.message || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }

  function openReport(report) {
    setSelectedReport(report);
    setAdminNotes(report.admin_notes || '');
    setSelectedStatus(report.status);
    setSaveError(null);
  }

  async function saveReport() {
    if (!selectedReport) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateAdminReport(accessToken, selectedReport.id, {
        status: selectedStatus,
        admin_notes: adminNotes || undefined,
      });
      setSelectedReport(updated);
      setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function openScreenshot() {
    if (!selectedReport) return;
    setScreenshotLoading(true);
    try {
      const url = await getAdminScreenshotUrl(accessToken, selectedReport.id);
      await Linking.openURL(url);
    } catch (err) {
      setSaveError(err.message || 'Failed to open screenshot');
    } finally {
      setScreenshotLoading(false);
    }
  }

  async function copyDebugJson() {
    if (!selectedReport) return;
    const json = JSON.stringify(
      { screen_context: selectedReport.screen_context, debug_context: selectedReport.debug_context },
      null,
      2,
    );
    await Clipboard.setStringAsync(json);
  }

  if (selectedReport) {
    return (
      <View style={styles.container}>
        <HeaderBar title="Report" onBack={() => setSelectedReport(null)} />
        <ScrollView contentContainerStyle={styles.detailContent}>
          <View style={styles.badgeRow}>
            <ModeText style={styles.typeBadge}>{TYPE_LABELS[selectedReport.report_type] || selectedReport.report_type}</ModeText>
          </View>

          <ModeText style={styles.summaryText}>{selectedReport.summary}</ModeText>

          {selectedReport.steps_to_reproduce && (
            <ModeText style={styles.stepsText}>{selectedReport.steps_to_reproduce}</ModeText>
          )}

          <ModeText style={styles.sectionLabel}>Status</ModeText>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((s) => (
              <Pressable
                key={s}
                style={[styles.statusChip, selectedStatus === s && styles.statusChipActive]}
                onPress={() => setSelectedStatus(s)}
              >
                <ModeText style={[styles.statusChipText, selectedStatus === s && styles.statusChipTextActive]}>
                  {STATUS_LABELS[s]}
                </ModeText>
              </Pressable>
            ))}
          </View>

          <ModeText style={styles.sectionLabel}>Admin Notes</ModeText>
          <ModeInput
            value={adminNotes}
            onChangeText={setAdminNotes}
            placeholder="Add notes..."
            multiline
            numberOfLines={4}
            style={styles.notesInput}
            testID="feedback-admin-notes-input"
          />

          {saveError && <ModeText style={styles.error}>{saveError}</ModeText>}

          <ModeButton
            title={saving ? '...' : 'Save'}
            onPress={saveReport}
            disabled={saving}
            testID="feedback-save-btn"
          />

          {(selectedReport.screenshot_bucket && selectedReport.screenshot_object_path) && (
            <ModeButton
              title={screenshotLoading ? '...' : 'View Screenshot'}
              onPress={openScreenshot}
              variant="secondary"
              disabled={screenshotLoading}
              testID="feedback-screenshot-btn"
            />
          )}

          <ModeButton
            title="Copy Debug JSON"
            onPress={copyDebugJson}
            variant="ghost"
            testID="feedback-copy-debug-btn"
          />

          <ModeText style={styles.meta}>
            {new Date(selectedReport.created_at).toLocaleString()}
          </ModeText>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <HeaderBar title="Feedback Inbox" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.listContent}>
        {error && <ModeText style={styles.error}>{error}</ModeText>}

        {loading && <ModeText style={styles.loading}>Loading...</ModeText>}

        {reports.map((report) => (
          <Pressable
            key={report.id}
            style={styles.reportCard}
            onPress={() => openReport(report)}
            testID={`feedback-report-${report.id}`}
          >
            <View style={styles.reportCardHeader}>
              <ModeText style={styles.typeBadge}>{TYPE_LABELS[report.report_type] || report.report_type}</ModeText>
              <ModeText style={styles.statusText}>{STATUS_LABELS[report.status] || report.status}</ModeText>
            </View>
            <ModeText style={styles.reportSummary} numberOfLines={2}>{report.summary}</ModeText>
            <ModeText style={styles.meta}>{new Date(report.created_at).toLocaleString()}</ModeText>
          </Pressable>
        ))}

        {hasMore && (
          <ModeButton
            title={loadingMore ? '...' : 'Load More'}
            onPress={loadMore}
            variant="ghost"
            disabled={loadingMore}
            testID="feedback-load-more-btn"
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  detailContent: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  reportCard: {
    backgroundColor: theme.colors.surface || theme.colors.card,
    borderRadius: theme.radii.m,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  reportCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusText: {
    fontSize: 11,
    color: theme.colors.textSecondary || theme.colors.muted,
  },
  reportSummary: {
    fontSize: 14,
    color: theme.colors.text,
  },
  summaryText: {
    fontSize: 15,
    color: theme.colors.text,
    fontWeight: '500',
  },
  stepsText: {
    fontSize: 13,
    color: theme.colors.textSecondary || theme.colors.muted,
    marginTop: theme.spacing[1],
  },
  meta: {
    fontSize: 11,
    color: theme.colors.textSecondary || theme.colors.muted,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary || theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: theme.spacing[2],
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  statusChip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.border || theme.colors.muted,
  },
  statusChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  statusChipText: {
    fontSize: 12,
    color: theme.colors.textSecondary || theme.colors.muted,
  },
  statusChipTextActive: {
    color: theme.colors.background,
    fontWeight: '600',
  },
  notesInput: {
    textAlignVertical: 'top',
  },
  loading: {
    textAlign: 'center',
    color: theme.colors.textSecondary || theme.colors.muted,
    padding: theme.spacing[4],
  },
  error: {
    color: theme.colors.error,
    fontSize: 13,
  },
  badgeRow: {
    flexDirection: 'row',
  },
});
