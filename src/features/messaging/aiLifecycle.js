import {
  AI_PROGRESS_MIN_DWELL_MS,
  AI_PROGRESS_STAGES,
  normalizeAIProgressStage,
} from './progressStages';

function waitFor(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createAIProgressController({
  onStageChange,
  minDwellMs = AI_PROGRESS_MIN_DWELL_MS,
  now = () => Date.now(),
} = {}) {
  let currentStage = null;
  let lastStageAtMs = 0;
  let queue = Promise.resolve();

  const applyStage = async (nextStage, force = false) => {
    const normalizedStage = normalizeAIProgressStage(nextStage || AI_PROGRESS_STAGES.REVIEWING_MESSAGE);
    if (!force && normalizedStage === currentStage) {
      return normalizedStage;
    }

    const elapsedMs = lastStageAtMs > 0 ? now() - lastStageAtMs : minDwellMs;
    const remainingMs = Math.max(0, minDwellMs - elapsedMs);
    if (!force && currentStage && remainingMs > 0) {
      await waitFor(remainingMs);
    }

    currentStage = normalizedStage;
    lastStageAtMs = now();
    if (typeof onStageChange === 'function') {
      onStageChange(normalizedStage);
    }
    return normalizedStage;
  };

  return {
    setStage(stage, { force = false } = {}) {
      queue = queue.then(() => applyStage(stage, force), () => applyStage(stage, force));
      return queue;
    },
    getCurrentStage() {
      return currentStage;
    },
    async flush() {
      await queue;
    },
  };
}
