import { useCallback, useEffect, useState } from 'react';

import { getProgressMetrics } from '../services/progressApi';

export function useProgressMetrics({ accessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState(7);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!accessToken) {
      return;
    }
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await getProgressMetrics({ accessToken, periodDays: period });
      setData(result);
    } catch (err) {
      setError(err?.message || 'Unable to load progress metrics.');
    } finally {
      if (refresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [accessToken, period]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load({ refresh: true }), [load]);

  return {
    data,
    loading,
    refreshing,
    error,
    period,
    setPeriod,
    refresh,
    reload: load,
  };
}
