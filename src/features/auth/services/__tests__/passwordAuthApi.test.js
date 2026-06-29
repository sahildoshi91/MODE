jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}))

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}))

import { fetchWithApiFallback } from '../../../../services/apiRequest'

import {
  requestPasswordResetProxy,
  signInWithPasswordProxy,
  signUpWithPasswordProxy,
} from '../passwordAuthApi'

function fakeResponse({ ok = true, status = 200, json = {}, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: {
      get: jest.fn((name) => headers[name] ?? null),
    },
    json: jest.fn(async () => json),
  }
}

describe('passwordAuthApi', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calls sign-in proxy endpoint', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: fakeResponse({
        ok: true,
        json: {
          access_token: 'access',
          refresh_token: 'refresh',
        },
      }),
      baseUrl: 'https://api.example',
    })

    const payload = await signInWithPasswordProxy({
      email: 'user@example.com',
      password: 'Password123!',
    })

    expect(payload.access_token).toBe('access')
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/auth/password/sign-in',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('calls sign-up proxy endpoint', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: fakeResponse({
        ok: true,
        json: { requires_email_verification: true },
      }),
      baseUrl: 'https://api.example',
    })

    await signUpWithPasswordProxy({
      email: 'new@example.com',
      password: 'Password123!',
    })

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/auth/password/sign-up',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('calls reset proxy endpoint with redirect', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: fakeResponse({
        ok: true,
        json: { success: true },
      }),
      baseUrl: 'https://api.example',
    })

    await requestPasswordResetProxy({
      email: 'user@example.com',
      redirectTo: 'ai.modefit.app://auth/callback',
    })

    const [, options] = fetchWithApiFallback.mock.calls[0]
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/auth/password/reset',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(options.body).toContain('"redirect_to":"ai.modefit.app://auth/callback"')
  })

  it('sets retryAfterSeconds from Retry-After header on rate-limit response', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: fakeResponse({
        ok: false,
        status: 429,
        json: { detail: 'Too many requests.' },
        headers: { 'Retry-After': '38' },
      }),
      baseUrl: 'https://api.example',
    })

    await expect(
      signInWithPasswordProxy({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({
      message: 'Too many requests.',
      retryAfterSeconds: 38,
    })
  })

  it('falls back to JSON detail.retry_after_seconds when no Retry-After header', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: fakeResponse({
        ok: false,
        status: 429,
        json: { detail: { message: 'Rate limited.', retry_after_seconds: 60 } },
      }),
      baseUrl: 'https://api.example',
    })

    await expect(
      signInWithPasswordProxy({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({
      message: 'Rate limited.',
      retryAfterSeconds: 60,
    })
  })

  it('preserves existing message extraction for plain string detail', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: fakeResponse({
        ok: false,
        status: 401,
        json: { detail: 'Invalid credentials.' },
      }),
      baseUrl: 'https://api.example',
    })

    const err = await signInWithPasswordProxy({ email: 'a@b.com', password: 'pw' }).catch((e) => e)
    expect(err.message).toBe('Invalid credentials.')
    expect(err.retryAfterSeconds).toBeUndefined()
  })
})
