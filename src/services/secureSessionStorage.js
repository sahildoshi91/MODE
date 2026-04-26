import * as SecureStore from 'expo-secure-store'

const MEMORY_FALLBACK = new Map()
const SECURE_PREFIX = 'mode.auth.'

function resolveSecureKey(key) {
  return `${SECURE_PREFIX}${String(key || '').trim()}`
}

function canUseSecureStore() {
  return Boolean(
    SecureStore
      && typeof SecureStore.getItemAsync === 'function'
      && typeof SecureStore.setItemAsync === 'function'
      && typeof SecureStore.deleteItemAsync === 'function',
  )
}

async function getFromSecureStore(key) {
  const secureKey = resolveSecureKey(key)
  return SecureStore.getItemAsync(secureKey)
}

async function setInSecureStore(key, value) {
  const secureKey = resolveSecureKey(key)
  await SecureStore.setItemAsync(secureKey, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

async function removeFromSecureStore(key) {
  const secureKey = resolveSecureKey(key)
  await SecureStore.deleteItemAsync(secureKey)
}

export const secureSessionStorage = {
  async getItem(key) {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey) {
      return null
    }
    if (canUseSecureStore()) {
      try {
        return await getFromSecureStore(normalizedKey)
      } catch (_error) {
        return MEMORY_FALLBACK.get(normalizedKey) || null
      }
    }
    return MEMORY_FALLBACK.get(normalizedKey) || null
  },
  async setItem(key, value) {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey) {
      return
    }
    const normalizedValue = String(value || '')
    if (canUseSecureStore()) {
      try {
        await setInSecureStore(normalizedKey, normalizedValue)
        return
      } catch (_error) {
        MEMORY_FALLBACK.set(normalizedKey, normalizedValue)
        return
      }
    }
    MEMORY_FALLBACK.set(normalizedKey, normalizedValue)
  },
  async removeItem(key) {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey) {
      return
    }
    if (canUseSecureStore()) {
      try {
        await removeFromSecureStore(normalizedKey)
      } catch (_error) {
        // no-op; we still clear fallback memory below
      }
    }
    MEMORY_FALLBACK.delete(normalizedKey)
  },
}
