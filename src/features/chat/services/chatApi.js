const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';

async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || 'Request failed';
  } catch (_error) {
    return 'Request failed';
  }
}

export async function sendChatMessage({ accessToken, conversationId, message, clientContext = {} }) {
  const response = await fetch(`${API_BASE_URL}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      message,
      client_context: clientContext,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}
