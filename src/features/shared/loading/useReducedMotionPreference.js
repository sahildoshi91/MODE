import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';

export function useReducedMotionPreference() {
  const [reducedMotionEnabled, setReducedMotionEnabled] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const applyPreference = (value) => {
      if (isMounted) {
        setReducedMotionEnabled(Boolean(value));
      }
    };

    if (typeof AccessibilityInfo?.isReduceMotionEnabled === 'function') {
      AccessibilityInfo.isReduceMotionEnabled()
        .then(applyPreference)
        .catch(() => {
          applyPreference(false);
        });
    }

    const subscription = typeof AccessibilityInfo?.addEventListener === 'function'
      ? AccessibilityInfo.addEventListener('reduceMotionChanged', applyPreference)
      : null;

    return () => {
      isMounted = false;
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  return reducedMotionEnabled;
}
