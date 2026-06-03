jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}))

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}))

import { fetchWithApiFallback } from '../../../../services/apiRequest'
import {
  deleteMyAccount,
  getMyTrainerSchedule,
  updateAccountEmail,
  updateAccountPassword,
} from '../profileApi'

function mockJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: {
      get: jest.fn(() => null),
    },
    json: jest.fn(async () => payload),
  }
}

describe('profileApi', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calls schedule endpoint with auth header', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({ trainer_display_name: 'Coach Alex' }),
      baseUrl: 'https://api.example',
    })

    const payload = await getMyTrainerSchedule({ accessToken: 'token-123' })
    expect(payload.trainer_display_name).toBe('Coach Alex')
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/profiles/me/trainer-schedule',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    )
  })

  it('calls delete account endpoint with confirmation payload', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({
        deletion_request_id: '123',
        outcome: 'succeeded',
      }),
      baseUrl: 'https://api.example',
    })

    await deleteMyAccount({ accessToken: 'token-123', confirmation: 'DELETE' })
    const [path, options] = fetchWithApiFallback.mock.calls[0]
    expect(path).toBe('/api/v1/account/me')
    expect(options.method).toBe('DELETE')
    expect(options.body).toContain('"confirmation":"DELETE"')
  })

  it('calls account email endpoint with normalized auth payload', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({ success: true }),
      baseUrl: 'https://api.example',
    })

    await updateAccountEmail({ accessToken: 'token-123', email: 'next@example.com' })
    const [path, options] = fetchWithApiFallback.mock.calls[0]
    expect(path).toBe('/api/v1/account/email')
    expect(options.method).toBe('PATCH')
    expect(options.headers.Authorization).toBe('Bearer token-123')
    expect(options.body).toBe('{"email":"next@example.com"}')
  })

  it('calls account password endpoint with current and new password fields', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({ success: true }),
      baseUrl: 'https://api.example',
    })

    await updateAccountPassword({
      accessToken: 'token-123',
      currentPassword: 'currentpassword123',
      newPassword: 'newpassword1234',
    })
    const [path, options] = fetchWithApiFallback.mock.calls[0]
    expect(path).toBe('/api/v1/account/password')
    expect(options.method).toBe('PATCH')
    expect(options.headers.Authorization).toBe('Bearer token-123')
    expect(options.body).toBe('{"current_password":"currentpassword123","new_password":"newpassword1234"}')
  })
})
