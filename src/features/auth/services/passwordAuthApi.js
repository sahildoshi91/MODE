import { buildApiNetworkError } from '../../../services/apiNetworkError'
import { fetchWithApiFallback } from '../../../services/apiRequest'

async function parseErrorPayload(response) {
  try {
    const payload = await response.json()
    const detail = payload?.detail
    if (typeof detail === 'string') {
      return { message: detail, retryAfterSeconds: null }
    }
    if (detail && typeof detail === 'object') {
      return {
        message: detail.message || 'Request failed',
        retryAfterSeconds: typeof detail.retry_after_seconds === 'number'
          ? detail.retry_after_seconds
          : null,
      }
    }
    return { message: payload?.message || 'Request failed', retryAfterSeconds: null }
  } catch (_error) {
    return { message: 'Request failed', retryAfterSeconds: null }
  }
}

async function requestPasswordAuth(path, { method = 'POST', body } = {}) {
  let response
  let baseUrl = null
  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
      timeoutMs: 10000,
    }))
  } catch (error) {
    throw buildApiNetworkError(error, path)
  }

  if (!response.ok) {
    const { message, retryAfterSeconds: jsonRetryAfter } = await parseErrorPayload(response)
    const error = new Error(message || 'Request failed')
    error.status = response.status
    error.api_base_url = baseUrl
    error.request_id = response.headers.get('x-request-id')

    const retryAfterHeader = response.headers.get('Retry-After')
    const headerSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN
    const retryAfterSeconds = !isNaN(headerSeconds) ? headerSeconds : jsonRetryAfter
    if (retryAfterSeconds !== null) {
      error.retryAfterSeconds = retryAfterSeconds
    }

    throw error
  }

  return response.json()
}

export async function signInWithPasswordProxy({ email, password }) {
  return requestPasswordAuth('/api/v1/auth/password/sign-in', {
    body: { email, password },
  })
}

export async function signUpWithPasswordProxy({ email, password }) {
  return requestPasswordAuth('/api/v1/auth/password/sign-up', {
    body: { email, password },
  })
}

export async function requestPasswordResetProxy({ email, redirectTo }) {
  return requestPasswordAuth('/api/v1/auth/password/reset', {
    body: {
      email,
      ...(redirectTo ? { redirect_to: redirectTo } : {}),
    },
  })
}
