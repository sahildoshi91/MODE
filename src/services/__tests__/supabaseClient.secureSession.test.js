const mockCreateClient = jest.fn(() => ({ auth: {} }))

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args) => mockCreateClient(...args),
}))

jest.mock('../secureSessionStorage', () => ({
  secureSessionStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}))

describe('supabaseClient secure session config', () => {
  beforeEach(() => {
    jest.resetModules()
    mockCreateClient.mockClear()
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })

  it('configures Supabase auth storage to secureSessionStorage', async () => {
    const { secureSessionStorage } = require('../secureSessionStorage')
    require('../supabaseClient')

    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    const [, , options] = mockCreateClient.mock.calls[0]
    expect(options.auth.storage).toBe(secureSessionStorage)
    expect(options.auth.storageKey).toBe('sb-example-auth-token')
    expect(options.auth.autoRefreshToken).toBe(true)
    expect(options.auth.persistSession).toBe(true)
  })

  it('clears Supabase auth session storage keys', async () => {
    const { clearSupabaseAuthSessionStorage } = require('../supabaseClient')
    const { secureSessionStorage } = require('../secureSessionStorage')

    await clearSupabaseAuthSessionStorage()

    expect(secureSessionStorage.removeItem).toHaveBeenCalledWith('sb-example-auth-token')
    expect(secureSessionStorage.removeItem).toHaveBeenCalledWith('sb-example-auth-token-code-verifier')
    expect(secureSessionStorage.removeItem).toHaveBeenCalledWith('sb-example-auth-token-user')
  })

  it('recognizes invalid refresh token errors', () => {
    const { isInvalidRefreshTokenError } = require('../supabaseClient')

    expect(
      isInvalidRefreshTokenError(new Error('Invalid Refresh Token: Refresh Token Not Found')),
    ).toBe(true)
    expect(
      isInvalidRefreshTokenError({ code: 'refresh_token_not_found' }),
    ).toBe(true)
    expect(isInvalidRefreshTokenError(new Error('Network request failed'))).toBe(false)
  })
})
