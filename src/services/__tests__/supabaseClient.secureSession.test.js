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
    expect(options.auth.persistSession).toBe(true)
  })
})
