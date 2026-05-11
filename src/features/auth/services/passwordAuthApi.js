import { buildApiNetworkError } from '../../../services/apiNetworkError'
import { fetchWithApiFallback } from '../../../services/apiRequest'

async function parseError(response) {
  try {
    const payload = await response.json()
    return payload?.detail || payload?.message || 'Request failed'
  } catch (_error) {
    return 'Request failed'
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
    const message = await parseError(response)
    const error = new Error(message || 'Request failed')
    error.status = response.status
    error.api_base_url = baseUrl
    error.request_id = response.headers.get('x-request-id')
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
