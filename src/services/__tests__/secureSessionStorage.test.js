jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}))

import * as SecureStore from 'expo-secure-store'

import { secureSessionStorage } from '../secureSessionStorage'

describe('secureSessionStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('stores session values in SecureStore when available', async () => {
    await secureSessionStorage.setItem('sb-session', 'token-value')

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'mode.auth.sb-session',
      'token-value',
      expect.objectContaining({
        keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      }),
    )
  })

  it('reads session values from SecureStore when available', async () => {
    SecureStore.getItemAsync.mockResolvedValueOnce('stored-value')
    const value = await secureSessionStorage.getItem('sb-session')

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('mode.auth.sb-session')
    expect(value).toBe('stored-value')
  })

  it('falls back to in-memory storage when SecureStore write fails', async () => {
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('secure-store-failed'))
    await secureSessionStorage.setItem('sb-session', 'fallback-token')

    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('secure-store-failed'))
    const value = await secureSessionStorage.getItem('sb-session')
    expect(value).toBe('fallback-token')
  })

  it('removes values from both secure and fallback stores', async () => {
    await secureSessionStorage.setItem('sb-session', 'value-to-delete')
    await secureSessionStorage.removeItem('sb-session')

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('mode.auth.sb-session')
    SecureStore.getItemAsync.mockResolvedValueOnce(null)
    const value = await secureSessionStorage.getItem('sb-session')
    expect(value).toBeNull()
  })
})
