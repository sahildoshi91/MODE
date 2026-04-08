import { fetchWithApiFallback } from '../../../services/apiRequest';

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
    const rootError = error?.cause || error;
    const errorMessage = typeof rootError?.message === 'string' ? rootError.message : 'Network request failed';
    const isTimeout = /timed out/i.test(errorMessage);
    const attemptedHosts = Array.isArray(error?.attemptedBaseUrls) && error.attemptedBaseUrls.length > 0
      ? ` Tried: ${error.attemptedBaseUrls.join(', ')}.`
      : '';

    throw new Error(
      isTimeout
        ? `Request to ${baseUrl || 'the backend'}/api/v1/chat timed out.${attemptedHosts} If you are testing on a phone, make sure the backend is running on your computer and that EXPO_PUBLIC_API_BASE_URL points to your computer's LAN IP, for example http://192.168.6.137:8000.`
        : `Unable to reach the backend at /api/v1/chat.${attemptedHosts} Check that the backend is running and that your app can reach your computer on the same network.`,
    );
  }

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}
