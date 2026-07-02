import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View, Vibration } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import {
  ModeButton,
  ModeChip,
  ModeInput,
  ModeText,
  SystemActionSheet,
} from '../../../lib/components';
import { theme } from '../../../lib/theme';
import { submitFeedbackReport } from './feedbackApi';
import { uploadScreenshot } from './feedbackStorage';

const REPORT_TYPES = [
  { key: 'bug', label: 'Bug' },
  { key: 'feature_request', label: 'Feature' },
  { key: 'feedback', label: 'Feedback' },
];

export default function FeedbackSheet({
  visible,
  onClose,
  accessToken,
  appContentRef,
  screenContext,
  debugContext,
}) {
  const [reportType, setReportType] = useState('bug');
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState('');
  const [screenshotUri, setScreenshotUri] = useState(null);
  const [screenshotWarning, setScreenshotWarning] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setReportType('bug');
    setSummary('');
    setSteps('');
    setScreenshotUri(null);
    setScreenshotWarning(null);
    setSubmitting(false);
    setError(null);
    setSuccess(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function captureScreenshot() {
    setScreenshotWarning(null);
    try {
      if (visible) {
        // Briefly hide sheet so we capture app content cleanly
        onClose();
        await new Promise((r) => setTimeout(r, 150));
        const uri = await captureRef(appContentRef, { format: 'png', quality: 0.8 });
        // Re-open the sheet
        // The parent will re-show us if sheetVisible is still true — but since we
        // called onClose, we set the uri and trust the parent to re-render.
        // Instead: capture while temporarily invisible using opacity trick below.
        setScreenshotUri(uri);
      } else {
        const uri = await captureRef(appContentRef, { format: 'png', quality: 0.8 });
        setScreenshotUri(uri);
      }
    } catch (err) {
      setScreenshotWarning('Could not capture screenshot');
    }
  }

  async function handleSubmit() {
    if (!summary.trim()) return;
    setSubmitting(true);
    setError(null);

    let screenshotBucket = null;
    let screenshotObjectPath = null;

    if (screenshotUri) {
      const result = await uploadScreenshot(accessToken, screenshotUri);
      if (result.warning) {
        setScreenshotWarning(result.warning);
      } else {
        screenshotBucket = result.bucket;
        screenshotObjectPath = result.object_path;
      }
    }

    try {
      await submitFeedbackReport(accessToken, {
        report_type: reportType,
        summary: summary.trim(),
        steps_to_reproduce: reportType === 'bug' && steps.trim() ? steps.trim() : undefined,
        screen_context: screenContext,
        debug_context: debugContext,
        screenshot_bucket: screenshotBucket,
        screenshot_object_path: screenshotObjectPath,
      });
      setSuccess(true);
      Vibration.vibrate(20);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SystemActionSheet visible={visible} onClose={handleClose} testID="feedback-sheet">
      <View style={styles.container}>
        <ModeText style={styles.title} variant="label">
          {success ? 'Thanks for the feedback!' : 'Send Feedback'}
        </ModeText>

        {!success && (
          <>
            <View style={styles.typeRow}>
              {REPORT_TYPES.map(({ key, label }) => (
                <ModeChip
                  key={key}
                  label={label}
                  selected={reportType === key}
                  onPress={() => setReportType(key)}
                  style={styles.typeChip}
                />
              ))}
            </View>

            <ModeInput
              placeholder="Summary *"
              value={summary}
              onChangeText={setSummary}
              multiline
              numberOfLines={3}
              style={styles.input}
              testID="feedback-summary-input"
            />

            {reportType === 'bug' && (
              <ModeInput
                placeholder="Steps to reproduce (optional)"
                value={steps}
                onChangeText={setSteps}
                multiline
                numberOfLines={3}
                style={styles.input}
                testID="feedback-steps-input"
              />
            )}

            <View style={styles.screenshotRow}>
              {screenshotUri ? (
                <>
                  <Image
                    source={{ uri: screenshotUri }}
                    style={styles.screenshotThumb}
                    testID="feedback-screenshot-thumb"
                  />
                  <Pressable onPress={() => setScreenshotUri(null)}>
                    <ModeText style={styles.removeText}>Remove</ModeText>
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={captureScreenshot} testID="feedback-attach-screenshot">
                  <ModeText style={styles.attachText}>Attach Screenshot</ModeText>
                </Pressable>
              )}
            </View>

            {screenshotWarning && (
              <ModeText style={styles.warning}>{screenshotWarning}</ModeText>
            )}

            {error && (
              <ModeText style={styles.error}>{error}</ModeText>
            )}

            <ModeButton
              title={submitting ? '...' : 'Submit'}
              onPress={handleSubmit}
              disabled={!summary.trim() || submitting}
              testID="feedback-submit-btn"
            />
          </>
        )}
      </View>
    </SystemActionSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  title: {
    marginBottom: theme.spacing[1],
    fontWeight: '600',
  },
  typeRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
  },
  typeChip: {
    flex: 1,
  },
  input: {
    textAlignVertical: 'top',
  },
  screenshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  screenshotThumb: {
    width: 60,
    height: 100,
    borderRadius: 6,
  },
  removeText: {
    color: theme.colors.error,
    fontSize: 13,
  },
  attachText: {
    color: theme.colors.primary,
    fontSize: 13,
  },
  warning: {
    color: theme.colors.warning || theme.colors.error,
    fontSize: 12,
  },
  error: {
    color: theme.colors.error,
    fontSize: 13,
  },
});
