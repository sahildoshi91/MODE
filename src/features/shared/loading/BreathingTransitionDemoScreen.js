import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { BREATHING_CONTEXT } from './breathingCopy';
import BreathingTransitionOverlay from './BreathingTransitionOverlay';

export const BREATHING_TRANSITION_DEMO_SCENARIOS = Object.freeze([
  Object.freeze({
    key: '1s',
    label: '1 second',
    durationMs: 1000,
    copy: 'Short load',
  }),
  Object.freeze({
    key: '3s',
    label: '3 seconds',
    durationMs: 3000,
    copy: 'Medium load',
  }),
  Object.freeze({
    key: '8s',
    label: '8 seconds',
    durationMs: 8000,
    copy: 'Long load',
  }),
  Object.freeze({
    key: 'infinite',
    label: 'Infinite',
    durationMs: null,
    copy: 'Continuous loading',
  }),
]);

function getScenarioByKey(key) {
  return BREATHING_TRANSITION_DEMO_SCENARIOS.find((scenario) => scenario.key === key)
    || BREATHING_TRANSITION_DEMO_SCENARIOS[1];
}

export default function BreathingTransitionDemoScreen() {
  const [selectedKey, setSelectedKey] = useState('3s');
  const [runId, setRunId] = useState(1);
  const [active, setActive] = useState(true);
  const timerRef = useRef(null);

  const selectedScenario = useMemo(() => getScenarioByKey(selectedKey), [selectedKey]);

  const clearLoadTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const replay = useCallback(() => {
    setRunId((current) => current + 1);
  }, []);

  const stop = useCallback(() => {
    clearLoadTimer();
    setActive(false);
  }, [clearLoadTimer]);

  const selectScenario = useCallback((key) => {
    setSelectedKey(key);
    setRunId((current) => current + 1);
  }, []);

  useEffect(() => {
    clearLoadTimer();
    setActive(true);

    if (typeof selectedScenario.durationMs === 'number') {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setActive(false);
      }, selectedScenario.durationMs);
    }

    return clearLoadTimer;
  }, [clearLoadTimer, runId, selectedScenario.durationMs]);

  return (
    <SafeScreen
      includeTopInset={false}
      includeBottomInset={false}
      style={styles.root}
      testID="breathing-transition-demo-screen"
    >
      <LinearGradient
        pointerEvents="none"
        colors={['#050D1A', '#091323', '#08111F']}
        locations={[0, 0.58, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.previewStage}>
        <BreathingTransitionOverlay
          key={`${selectedScenario.key}-${runId}`}
          active={active}
          context={BREATHING_CONTEXT.SHELL_BOOTSTRAP}
          variant="screen"
          showAfterMs={0}
          minVisibleMs={280}
          progressLabel={selectedScenario.copy}
          testID="breathing-demo-overlay"
        />
      </View>

      <View style={styles.controlDock} pointerEvents="box-none">
        <View style={styles.header}>
          <ModeText variant="bodySm" tone="secondary" style={styles.kicker}>
            Breathing transition demo
          </ModeText>
          <ModeText variant="h3" tone="primary" style={styles.title}>
            {selectedScenario.label}
          </ModeText>
        </View>

        <View style={styles.scenarioGrid}>
          {BREATHING_TRANSITION_DEMO_SCENARIOS.map((scenario) => {
            const isSelected = scenario.key === selectedScenario.key;
            return (
              <Pressable
                key={scenario.key}
                accessibilityRole="button"
                onPress={() => selectScenario(scenario.key)}
                testID={`breathing-demo-scenario-${scenario.key}`}
                style={({ pressed }) => [
                  styles.scenarioButton,
                  isSelected && styles.scenarioButtonSelected,
                  pressed && styles.pressed,
                ]}
              >
                <ModeText
                  variant="bodySm"
                  tone="primary"
                  style={[
                    styles.scenarioLabel,
                    isSelected && styles.scenarioLabelSelected,
                  ]}
                >
                  {scenario.label}
                </ModeText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            onPress={replay}
            testID="breathing-demo-replay"
            style={({ pressed }) => [
              styles.actionButton,
              pressed && styles.pressed,
            ]}
          >
            <ModeText variant="bodySm" tone="primary" style={styles.actionText}>
              Replay
            </ModeText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={stop}
            testID="breathing-demo-stop"
            style={({ pressed }) => [
              styles.actionButton,
              styles.stopButton,
              pressed && styles.pressed,
            ]}
          >
            <ModeText variant="bodySm" tone="primary" style={styles.actionText}>
              Stop
            </ModeText>
          </Pressable>
        </View>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: theme.colors.background.app,
  },
  previewStage: {
    ...StyleSheet.absoluteFillObject,
  },
  controlDock: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    zIndex: 80,
  },
  header: {
    marginBottom: 14,
  },
  kicker: {
    color: theme.colors.text.tertiary,
    textAlign: 'center',
  },
  title: {
    marginTop: 4,
    textAlign: 'center',
  },
  scenarioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  scenarioButton: {
    minWidth: 118,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  scenarioButtonSelected: {
    backgroundColor: 'rgba(143, 178, 255, 0.18)',
  },
  scenarioLabel: {
    color: theme.colors.text.secondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  scenarioLabelSelected: {
    color: theme.colors.text.primary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  stopButton: {
    backgroundColor: 'rgba(197, 122, 108, 0.18)',
  },
  actionText: {
    fontWeight: '700',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.76,
  },
});
