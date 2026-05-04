import { useCallback, useEffect, useMemo, useState } from 'react';

import { listChatSessions } from '../services/chatSessionService';

function getDateKey(session) {
  return session?.session_date || String(session?.created_at || '').slice(0, 10) || 'Unknown';
}

export function groupChatSessionsByDate(sessions = []) {
  const groups = [];
  const byDate = new Map();

  (sessions || []).forEach((session) => {
    const key = getDateKey(session);
    if (!byDate.has(key)) {
      const group = {
        date: key,
        sessions: [],
      };
      byDate.set(key, group);
      groups.push(group);
    }
    byDate.get(key).sessions.push(session);
  });

  return groups;
}

export function useChatHistory({
  accessToken,
  role,
  sessionType = null,
  limit = 60,
}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ refreshing: shouldRefresh = false } = {}) => {
    if (!accessToken || !role) {
      setLoading(false);
      setRefreshing(false);
      return [];
    }
    setLoading(!shouldRefresh);
    setRefreshing(shouldRefresh);
    setError(null);
    try {
      const payload = await listChatSessions({
        accessToken,
        role,
        sessionType,
        limit,
      });
      const nextSessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
      setSessions(nextSessions);
      setLoading(false);
      setRefreshing(false);
      return nextSessions;
    } catch (nextError) {
      setError(nextError);
      setLoading(false);
      setRefreshing(false);
      return [];
    }
  }, [accessToken, limit, role, sessionType]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => load({ refreshing: true }), [load]);
  const groupedSessions = useMemo(() => groupChatSessionsByDate(sessions), [sessions]);

  return {
    sessions,
    groupedSessions,
    loading,
    refreshing,
    error,
    reload,
  };
}
