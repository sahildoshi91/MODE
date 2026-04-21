import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const BREATHING_PHASE = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',
  ENTERING: 'entering',
  INHALE: 'inhale',
  EXHALE: 'exhale',
  SETTLING: 'settling',
  EXITING: 'exiting',
});

const INHALE_PAUSE_MS = 140;
const EXHALE_PAUSE_MS = 120;
const DEFAULT_ENTER_MS = 220;
const DEFAULT_SETTLE_MS = 220;
const DEFAULT_EXIT_MS = 180;
const REDUCED_ENTER_MS = 170;
const REDUCED_SETTLE_MS = 140;
const REDUCED_EXIT_MS = 140;
const QUICK_FINISH_MS = 160;
const QUICK_FINISH_REDUCED_MS = 110;
const INHALE_LATE_THRESHOLD = 0.58;
const EXHALE_EARLY_THRESHOLD = 0.42;

function buildIdleState() {
  return {
    phase: BREATHING_PHASE.IDLE,
    durationMs: 0,
    cycleCount: 0,
    exitRequested: false,
  };
}

function clearTimer(timerRef) {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function coerceDuration(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function useBreathingTransitionMachine({
  active,
  showAfterMs = 140,
  minVisibleMs = 280,
  inhaleMs = 4000,
  exhaleMs = 4000,
  reducedMotion = false,
  onExitComplete,
} = {}) {
  const [state, setState] = useState(buildIdleState);
  const phaseRef = useRef(state.phase);
  const activeRef = useRef(Boolean(active));
  const phaseTimerRef = useRef(null);
  const showTimerRef = useRef(null);
  const phaseStartedAtRef = useRef(0);
  const phaseDurationRef = useRef(0);
  const visibleSinceRef = useRef(0);
  const cycleCountRef = useRef(0);
  const stopModeRef = useRef('none');
  const onExitCompleteRef = useRef(onExitComplete);
  const handlePhaseCompleteRef = useRef(() => {});

  const config = useMemo(() => {
    const resolvedInhaleMs = coerceDuration(inhaleMs, 4000);
    const resolvedExhaleMs = coerceDuration(exhaleMs, 4000);
    const inhaleDuration = resolvedInhaleMs + (reducedMotion ? 0 : INHALE_PAUSE_MS);
    const exhaleDuration = resolvedExhaleMs + (reducedMotion ? 0 : EXHALE_PAUSE_MS);
    return {
      enterDuration: reducedMotion ? REDUCED_ENTER_MS : DEFAULT_ENTER_MS,
      inhaleDuration,
      exhaleDuration,
      settleDuration: reducedMotion ? REDUCED_SETTLE_MS : DEFAULT_SETTLE_MS,
      exitDuration: reducedMotion ? REDUCED_EXIT_MS : DEFAULT_EXIT_MS,
      quickFinishDuration: reducedMotion ? QUICK_FINISH_REDUCED_MS : QUICK_FINISH_MS,
    };
  }, [exhaleMs, inhaleMs, reducedMotion]);

  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  useEffect(() => {
    activeRef.current = Boolean(active);
  }, [active]);

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  const clearPhaseTimer = useCallback(() => {
    clearTimer(phaseTimerRef);
  }, []);

  const clearShowTimer = useCallback(() => {
    clearTimer(showTimerRef);
  }, []);

  const enterPhase = useCallback((nextPhase, durationMs, options = {}) => {
    const {
      resetCycle = false,
      exitRequested = null,
    } = options;

    clearPhaseTimer();

    if (resetCycle) {
      cycleCountRef.current = 0;
    }

    if (nextPhase === BREATHING_PHASE.ENTERING && !visibleSinceRef.current) {
      visibleSinceRef.current = Date.now();
    }

    phaseStartedAtRef.current = Date.now();
    phaseDurationRef.current = Math.max(0, Math.round(coerceDuration(durationMs, 0)));
    phaseRef.current = nextPhase;

    setState((previous) => ({
      ...previous,
      phase: nextPhase,
      durationMs: phaseDurationRef.current,
      cycleCount: cycleCountRef.current,
      exitRequested: typeof exitRequested === 'boolean' ? exitRequested : previous.exitRequested,
    }));

    if (phaseDurationRef.current > 0) {
      phaseTimerRef.current = setTimeout(() => {
        handlePhaseCompleteRef.current(nextPhase);
      }, phaseDurationRef.current);
      return;
    }

    phaseTimerRef.current = setTimeout(() => {
      handlePhaseCompleteRef.current(nextPhase);
    }, 0);
  }, [clearPhaseTimer]);

  const startSettling = useCallback(() => {
    clearPhaseTimer();
    clearShowTimer();

    const elapsedVisibleMs = visibleSinceRef.current
      ? Date.now() - visibleSinceRef.current
      : minVisibleMs;
    const waitForMinVisibleMs = Math.max(0, coerceDuration(minVisibleMs, 0) - elapsedVisibleMs);

    if (waitForMinVisibleMs > 0) {
      phaseTimerRef.current = setTimeout(() => {
        enterPhase(BREATHING_PHASE.SETTLING, config.settleDuration, { exitRequested: true });
      }, waitForMinVisibleMs);
      return;
    }

    enterPhase(BREATHING_PHASE.SETTLING, config.settleDuration, { exitRequested: true });
  }, [clearPhaseTimer, clearShowTimer, config.settleDuration, enterPhase, minVisibleMs]);

  const accelerateCurrentPhase = useCallback(() => {
    const phase = phaseRef.current;
    if (phase !== BREATHING_PHASE.ENTERING
      && phase !== BREATHING_PHASE.INHALE
      && phase !== BREATHING_PHASE.EXHALE) {
      return;
    }

    clearPhaseTimer();
    phaseStartedAtRef.current = Date.now();
    phaseDurationRef.current = config.quickFinishDuration;

    setState((previous) => ({
      ...previous,
      durationMs: config.quickFinishDuration,
      exitRequested: true,
    }));

    phaseTimerRef.current = setTimeout(() => {
      handlePhaseCompleteRef.current(phase);
    }, config.quickFinishDuration);
  }, [clearPhaseTimer, config.quickFinishDuration]);

  const resetToIdle = useCallback(() => {
    clearPhaseTimer();
    clearShowTimer();
    stopModeRef.current = 'none';
    cycleCountRef.current = 0;
    visibleSinceRef.current = 0;
    phaseDurationRef.current = 0;
    phaseStartedAtRef.current = 0;
    phaseRef.current = BREATHING_PHASE.IDLE;
    setState(buildIdleState());
  }, [clearPhaseTimer, clearShowTimer]);

  const requestExit = useCallback(() => {
    const phase = phaseRef.current;
    if (phase === BREATHING_PHASE.IDLE) {
      return;
    }

    if (phase === BREATHING_PHASE.PREPARING) {
      resetToIdle();
      if (typeof onExitCompleteRef.current === 'function') {
        onExitCompleteRef.current();
      }
      return;
    }

    setState((previous) => ({
      ...previous,
      exitRequested: true,
    }));

    if (phase === BREATHING_PHASE.SETTLING || phase === BREATHING_PHASE.EXITING) {
      return;
    }

    if (phase === BREATHING_PHASE.ENTERING) {
      stopModeRef.current = 'finish_current_then_settle';
      accelerateCurrentPhase();
      return;
    }

    const durationMs = Math.max(1, phaseDurationRef.current);
    const elapsedMs = Math.max(0, Date.now() - phaseStartedAtRef.current);
    const progress = elapsedMs / durationMs;

    if (phase === BREATHING_PHASE.INHALE) {
      if (progress >= INHALE_LATE_THRESHOLD) {
        stopModeRef.current = 'finish_current_then_settle';
        accelerateCurrentPhase();
      } else {
        stopModeRef.current = 'settle_now';
        startSettling();
      }
      return;
    }

    if (phase === BREATHING_PHASE.EXHALE) {
      if (progress <= EXHALE_EARLY_THRESHOLD) {
        stopModeRef.current = 'finish_current_then_settle';
        accelerateCurrentPhase();
      } else {
        stopModeRef.current = 'settle_now';
        startSettling();
      }
    }
  }, [accelerateCurrentPhase, resetToIdle, startSettling]);

  const startPreparing = useCallback(() => {
    clearShowTimer();
    clearPhaseTimer();
    stopModeRef.current = 'none';
    phaseRef.current = BREATHING_PHASE.PREPARING;
    visibleSinceRef.current = 0;
    cycleCountRef.current = 0;

    setState({
      phase: BREATHING_PHASE.PREPARING,
      durationMs: 0,
      cycleCount: 0,
      exitRequested: false,
    });

    const delay = Math.max(0, Math.round(coerceDuration(showAfterMs, 0)));
    if (delay === 0) {
      enterPhase(BREATHING_PHASE.ENTERING, config.enterDuration, {
        resetCycle: true,
        exitRequested: false,
      });
      return;
    }

    showTimerRef.current = setTimeout(() => {
      if (!activeRef.current) {
        return;
      }
      enterPhase(BREATHING_PHASE.ENTERING, config.enterDuration, {
        resetCycle: true,
        exitRequested: false,
      });
    }, delay);
  }, [clearPhaseTimer, clearShowTimer, config.enterDuration, enterPhase, showAfterMs]);

  const handlePhaseComplete = useCallback((completedPhase) => {
    if (phaseRef.current !== completedPhase) {
      return;
    }

    if (completedPhase === BREATHING_PHASE.ENTERING) {
      if (!activeRef.current || stopModeRef.current === 'finish_current_then_settle') {
        startSettling();
        return;
      }
      enterPhase(BREATHING_PHASE.INHALE, config.inhaleDuration, { exitRequested: false });
      return;
    }

    if (completedPhase === BREATHING_PHASE.INHALE) {
      if (!activeRef.current || stopModeRef.current === 'finish_current_then_settle') {
        startSettling();
        return;
      }
      enterPhase(BREATHING_PHASE.EXHALE, config.exhaleDuration, { exitRequested: false });
      return;
    }

    if (completedPhase === BREATHING_PHASE.EXHALE) {
      if (!activeRef.current || stopModeRef.current === 'finish_current_then_settle') {
        startSettling();
        return;
      }
      cycleCountRef.current += 1;
      enterPhase(BREATHING_PHASE.INHALE, config.inhaleDuration, { exitRequested: false });
      return;
    }

    if (completedPhase === BREATHING_PHASE.SETTLING) {
      if (activeRef.current) {
        startPreparing();
        return;
      }
      enterPhase(BREATHING_PHASE.EXITING, config.exitDuration, { exitRequested: true });
      return;
    }

    if (completedPhase === BREATHING_PHASE.EXITING) {
      if (activeRef.current) {
        startPreparing();
        return;
      }
      resetToIdle();
      if (typeof onExitCompleteRef.current === 'function') {
        onExitCompleteRef.current();
      }
    }
  }, [
    config.exhaleDuration,
    config.exitDuration,
    config.inhaleDuration,
    enterPhase,
    resetToIdle,
    startPreparing,
    startSettling,
  ]);

  useEffect(() => {
    handlePhaseCompleteRef.current = handlePhaseComplete;
  }, [handlePhaseComplete]);

  useEffect(() => {
    if (active) {
      setState((previous) => (previous.exitRequested
        ? { ...previous, exitRequested: false }
        : previous));

      const phase = phaseRef.current;
      if (phase === BREATHING_PHASE.IDLE || phase === BREATHING_PHASE.PREPARING) {
        startPreparing();
        return undefined;
      }
      if (phase === BREATHING_PHASE.SETTLING || phase === BREATHING_PHASE.EXITING) {
        startPreparing();
      }
      stopModeRef.current = 'none';
      return undefined;
    }

    requestExit();
    return undefined;
  }, [active, requestExit, startPreparing]);

  useEffect(() => () => {
    clearPhaseTimer();
    clearShowTimer();
  }, [clearPhaseTimer, clearShowTimer]);

  const isMounted = state.phase !== BREATHING_PHASE.IDLE
    && state.phase !== BREATHING_PHASE.PREPARING;
  const shouldBlockPointerEvents = isMounted && !state.exitRequested;

  return {
    phase: state.phase,
    durationMs: state.durationMs,
    cycleCount: state.cycleCount,
    exitRequested: state.exitRequested,
    isMounted,
    shouldBlockPointerEvents,
  };
}
