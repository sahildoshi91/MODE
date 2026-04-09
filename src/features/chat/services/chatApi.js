import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

async function parseError(response) {
  try {
    const rawBody = await response.text();
    if (!rawBody) {
      return 'Request failed';
    }

    try {
      const payload = JSON.parse(rawBody);
      return payload?.detail || payload?.message || rawBody || 'Request failed';
    } catch (_parseError) {
      return rawBody;
    }
  } catch (_error) {
    return 'Request failed';
  }
}

export async function sendChatMessage({ accessToken, conversationId, message, clientContext = {} }) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback('/api/v1/chat', {
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
    }));
  } catch (error) {
    throw buildApiNetworkError(error, '/api/v1/chat', {
      timeoutMessage: `Request to ${baseUrl || 'the backend'}/api/v1/chat timed out. If you are testing on a phone, make sure the backend is running on your computer and that EXPO_PUBLIC_API_BASE_URL points to your computer's LAN IP, for example http://192.168.6.137:8000.`,
      unreachableMessage: 'Unable to reach the backend at /api/v1/chat. Check that the backend is running and that your app can reach your computer on the same network.',
    });
  }

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}
