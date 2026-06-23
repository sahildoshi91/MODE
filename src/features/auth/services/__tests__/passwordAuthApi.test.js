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

function fakeResponse({ ok = true, status = 200, json = {} } = {}) {
  return {
    ok,
    status,
    headers: {
      get: jest.fn(() => null),
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
})
