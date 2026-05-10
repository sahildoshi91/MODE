import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

function normalizeCards(review) {
  const cards = Array.isArray(review?.cards) ? review.cards : [];
  return cards.filter((card) => (
    card
    && typeof card === 'object'
    && card.client_name
    && card.priority
    && card.main_issue
    && card.why_it_matters
    && card.next_action
    && (card.discussion_prompt || card.client_message)
  ));
}

function signalTone(signal, priority) {
  const normalized = String(signal?.tone || priority || '').toLowerCase();
  if (normalized === 'high') {
    return styles.signalHigh;
  }
  if (normalized === 'medium') {
    return styles.signalMedium;
  }
  return styles.signalLow;
}

function normalizeActionSignal(card) {
  const signal = card?.action_signal && typeof card.action_signal === 'object'
    ? card.action_signal
    : {};
  return {
    label: String(signal.label || card?.priority || 'Review').trim(),
    tone: String(signal.tone || card?.priority || 'low').trim().toLowerCase(),
  };
}

function normalizeMetrics(card) {
  const breakdown = Array.isArray(card?.metrics_breakdown)
    ? card.metrics_breakdown
      .filter((item) => item && typeof item === 'object' && (item.domain || item.signal))
      .map((item) => ({
        domain: String(item.domain || 'Signal').trim(),
        signal: String(item.signal || '').trim(),
        coaching_meaning: String(item.coaching_meaning || '').trim(),
        detail: String(item.detail || '').trim(),
      }))
    : [];
  if (breakdown.length > 0) {
    return breakdown;
  }
  return (Array.isArray(card?.metrics_summary) ? card.metrics_summary : [])
    .filter(Boolean)
    .map((signal) => ({
      domain: 'Signal',
      signal: String(signal).trim(),
      coaching_meaning: '',
      detail: '',
    }));
}

function metricCopyText(metric) {
  return [
    `${metric.domain}: ${metric.signal}`.trim(),
    metric.coaching_meaning,
    metric.detail,
  ].filter(Boolean).join(' ');
}

function CopyableBlock({
  label,
  value,
  tone = 'secondary',
  style,
  labelStyle,
  textStyle,
  onCopyField,
  testID,
}) {
  const copyValue = String(value || '').trim();
  if (!copyValue) {
    return null;
  }
  return (
    <Pressable
      delayLongPress={280}
      onLongPress={() => onCopyField?.(copyValue)}
      style={({ pressed }) => [style || styles.summaryBlock, pressed && styles.pressed]}
      testID={testID}
    >
      <ModeText variant="caption" tone="tertiary" style={[styles.kicker, labelStyle]}>
        {label}
      </ModeText>
      <ModeText variant="bodySm" tone={tone} style={[styles.bodyText, textStyle]}>
        {copyValue}
      </ModeText>
    </Pressable>
  );
}

function FlaggedClientReviewCard({
  card,
  index,
  expanded,
  onToggleMetrics,
  onCopyField,
  testIDPrefix,
}) {
  const actionSignal = normalizeActionSignal(card);
  const discussionPrompt = card.discussion_prompt || card.client_message;
  const metrics = normalizeMetrics(card);
  const hasMetrics = metrics.length > 0;

  return (
    <View style={styles.card} testID={`${testIDPrefix}-card-${index}`}>
      <View style={styles.headerRow}>
        <Pressable
          delayLongPress={280}
          onLongPress={() => onCopyField?.(card.client_name)}
          style={({ pressed }) => [styles.clientNamePressable, pressed && styles.pressed]}
          testID={`${testIDPrefix}-client-name-${index}`}
        >
          <ModeText variant="label" tone="primary" style={styles.clientName}>
            {card.client_name}
          </ModeText>
        </Pressable>
        <Pressable
          accessibilityLabel={`${actionSignal.label}, ${card.priority} priority`}
          delayLongPress={280}
          onLongPress={() => onCopyField?.(actionSignal.label)}
          style={({ pressed }) => [
            styles.actionSignalPill,
            signalTone(actionSignal, card.priority),
            pressed && styles.pressed,
          ]}
          testID={`${testIDPrefix}-action-signal-${index}`}
        >
          <ModeText variant="caption" tone="primary" style={styles.actionSignalText}>
            {actionSignal.label}
          </ModeText>
        </Pressable>
      </View>

      <CopyableBlock
        label="Main issue"
        value={card.main_issue}
        tone="primary"
        onCopyField={onCopyField}
        testID={`${testIDPrefix}-main-issue-${index}`}
      />

      <CopyableBlock
        label="Why it matters"
        value={card.why_it_matters}
        tone="secondary"
        onCopyField={onCopyField}
        testID={`${testIDPrefix}-why-it-matters-${index}`}
      />

      <CopyableBlock
        label="Next action"
        value={card.next_action}
        tone="primary"
        style={styles.nextAction}
        labelStyle={styles.nextActionLabel}
        textStyle={styles.nextActionText}
        onCopyField={onCopyField}
        testID={`${testIDPrefix}-next-action-${index}`}
      />

      <CopyableBlock
        label="Discussion cue"
        value={discussionPrompt}
        tone="secondary"
        style={styles.discussionBlock}
        onCopyField={onCopyField}
        testID={`${testIDPrefix}-discussion-cue-${index}`}
      />

      {hasMetrics ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleMetrics}
            style={({ pressed }) => [styles.metricsToggle, pressed && styles.pressed]}
            testID={`${testIDPrefix}-metrics-toggle-${index}`}
          >
            <ModeText variant="caption" tone="tertiary" style={styles.metricsToggleText}>
              Metrics
            </ModeText>
            {expanded ? (
              <ChevronUp size={14} color={theme.colors.text.tertiary} />
            ) : (
              <ChevronDown size={14} color={theme.colors.text.tertiary} />
            )}
          </Pressable>
          {expanded ? (
            <View style={styles.metricsPanel} testID={`${testIDPrefix}-metrics-panel-${index}`}>
              {metrics.map((metric, signalIndex) => (
                <Pressable
                  delayLongPress={280}
                  key={`${metric.domain}-${metric.signal}-${signalIndex}`}
                  onLongPress={() => onCopyField?.(metricCopyText(metric))}
                  style={({ pressed }) => [styles.metricRow, pressed && styles.pressed]}
                  testID={`${testIDPrefix}-metric-row-${index}-${signalIndex}`}
                >
                  <View style={styles.metricDot} />
                  <View style={styles.metricCopy}>
                    <ModeText variant="caption" tone="primary" style={styles.metricDomain}>
                      {metric.domain}
                    </ModeText>
                    {metric.signal ? (
                      <ModeText variant="caption" tone="secondary" style={styles.metricText}>
                        {metric.signal}
                      </ModeText>
                    ) : null}
                    {metric.coaching_meaning ? (
                      <ModeText variant="caption" tone="secondary" style={styles.metricText}>
                        {metric.coaching_meaning}
                      </ModeText>
                    ) : null}
                    {metric.detail ? (
                      <ModeText variant="caption" tone="tertiary" style={styles.metricDetail}>
                        {metric.detail}
                      </ModeText>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export default function FlaggedClientReviewCardList({
  review,
  onCopyField,
  testIDPrefix = 'flagged-client-review',
}) {
  const cards = useMemo(() => normalizeCards(review), [review]);
  const [expanded, setExpanded] = useState({});

  if (cards.length === 0) {
    return null;
  }

  return (
    <View style={styles.root} testID={`${testIDPrefix}-root`}>
      {cards.map((card, index) => {
        const key = card.client_id || `${card.client_name}-${index}`;
        const isExpanded = Boolean(expanded[key]);
        return (
          <FlaggedClientReviewCard
            key={key}
            card={card}
            index={index}
            expanded={isExpanded}
            onCopyField={onCopyField}
            onToggleMetrics={() => setExpanded((current) => ({
              ...current,
              [key]: !current[key],
            }))}
            testIDPrefix={testIDPrefix}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 8,
    width: '100%',
  },
  card: {
    borderRadius: theme.radii.xs,
    borderWidth: 1,
    borderColor: 'rgba(214, 230, 255, 0.16)',
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
    width: '100%',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  clientName: {
    fontWeight: '800',
  },
  clientNamePressable: {
    flex: 1,
  },
  actionSignalPill: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    maxWidth: '48%',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  signalHigh: {
    backgroundColor: theme.colors.feedback.errorBg,
    borderColor: theme.colors.feedback.errorBorder,
  },
  signalMedium: {
    backgroundColor: theme.colors.feedback.warningBg,
    borderColor: theme.colors.feedback.warningBorder,
  },
  signalLow: {
    backgroundColor: theme.colors.feedback.infoBg,
    borderColor: theme.colors.feedback.infoBorder,
  },
  actionSignalText: {
    fontWeight: '800',
    textAlign: 'center',
  },
  summaryBlock: {
    gap: 2,
  },
  kicker: {
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  bodyText: {
    lineHeight: theme.typography.body2.lineHeight,
  },
  nextAction: {
    borderRadius: theme.radii.xs,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderActive,
    backgroundColor: 'rgba(143, 178, 255, 0.12)',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  nextActionLabel: {
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  nextActionText: {
    fontWeight: '700',
    lineHeight: theme.typography.body2.lineHeight,
  },
  discussionBlock: {
    borderRadius: theme.radii.xs,
    borderWidth: 1,
    borderColor: 'rgba(214, 230, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  metricsToggle: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 2,
  },
  metricsToggleText: {
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metricsPanel: {
    borderTopColor: theme.colors.glass.borderSoft,
    borderTopWidth: 1,
    gap: 5,
    paddingTop: 7,
  },
  metricRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
  },
  metricDot: {
    backgroundColor: theme.colors.text.tertiary,
    borderRadius: 3,
    height: 6,
    marginTop: 5,
    width: 6,
  },
  metricText: {
    lineHeight: theme.typography.body3.lineHeight,
  },
  metricCopy: {
    flex: 1,
    gap: 1,
  },
  metricDomain: {
    fontWeight: '800',
    lineHeight: theme.typography.body3.lineHeight,
  },
  metricDetail: {
    lineHeight: theme.typography.body3.lineHeight,
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
  },
});
