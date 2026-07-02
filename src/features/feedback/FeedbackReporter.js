import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Accelerometer } from 'expo-sensors';

import { RAGE_SHAKE_FEEDBACK_ENABLED } from '../../config/featureFlags';
import { buildDebugContext, buildScreenContext } from './useFeedbackContext';
import FeedbackSheet from './FeedbackSheet';

const SHAKE_THRESHOLD = 2.5;
const SHAKE_LOCKOUT_MS = 3000;
const ACCELEROMETER_INTERVAL_MS = 100;

export default function FeedbackReporter({
  accessToken,
  activeTab,
  viewerRole,
  sessionId,
  trainerId,
  clientId,
  isStreaming,
  appContentRef,
  children,
}) {
  const [sheetVisible, setSheetVisible] = useState(false);
  const lastShakeAt = useRef(0);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  const handleShake = useCallback(() => {
    if (!RAGE_SHAKE_FEEDBACK_ENABLED) return;
    if (sheetVisible) return;
    if (isStreaming) return;
    if (appStateRef.current !== 'active') return;
    const now = Date.now();
    if (now - lastShakeAt.current < SHAKE_LOCKOUT_MS) return;
    lastShakeAt.current = now;
    setSheetVisible(true);
  }, [sheetVisible, isStreaming]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(ACCELEROMETER_INTERVAL_MS);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude > SHAKE_THRESHOLD) {
        handleShake();
      }
    });
    return () => sub.remove();
  }, [handleShake]);

  const screenContext = buildScreenContext({
    activeTab,
    viewerRole,
    sessionId,
    trainerId,
    clientId,
  });

  const debugContext = buildDebugContext();

  return (
    <>
      {children}
      <FeedbackSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        accessToken={accessToken}
        appContentRef={appContentRef}
        screenContext={screenContext}
        debugContext={debugContext}
      />
    </>
  );
}
