const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://hacknc.duckdns.org'

const AUTH_STORAGE_KEY = 'deadlock-auth-session'

function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

function persistSession(session) {
  if (!session) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return
  }

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
}

function getToken() {
  return getStoredSession()?.token || ''
}

function getAuthorizedUrl(path) {
  const token = getToken()
  if (!token) {
    return `${API_BASE_URL}${path}`
  }
  const joiner = path.includes('?') ? '&' : '?'
  return `${API_BASE_URL}${path}${joiner}token=${encodeURIComponent(token)}`
}

function normalizePath(path) {
  return path.startsWith('/') ? path : `/${path}`
}

function buildCandidatePaths(path) {
  const normalized = normalizePath(path)
  const prefixed = normalized.startsWith('/api/') ? normalized : `/api${normalized}`
  return [normalized, prefixed]
}

async function request(path, options = {}) {
  const candidatePaths = buildCandidatePaths(path)
  const token = getToken()

  let lastError = null

  for (const candidatePath of candidatePaths) {
    let response
    try {
      response = await fetch(`${API_BASE_URL}${candidatePath}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
        ...options,
      })
    } catch {
      lastError = new Error(`Cannot reach API at ${API_BASE_URL}. Is backend running?`)
      continue
    }

    const contentType = response.headers.get('content-type') || ''
    const payload = contentType.includes('application/json') ? await response.json() : await response.text()

    if (response.ok) {
      return payload
    }

    const message = typeof payload === 'string' ? payload : payload?.error || `Request failed: ${response.status}`
    const looksLikeRouteMismatch =
      message.includes('unsupported API call') ||
      message.includes('Cannot POST') ||
      response.status === 404

    lastError = new Error(message)
    if (!looksLikeRouteMismatch || candidatePath === candidatePaths[candidatePaths.length - 1]) {
      throw lastError
    }
  }

  throw lastError || new Error('Request failed')
}

async function requestWithFallback(primaryPath, fallbackPath, options = {}) {
  try {
    return await request(primaryPath, options)
  } catch (primaryError) {
    if (!fallbackPath) {
      throw primaryError
    }
    return request(fallbackPath, options)
  }
}

export const apiClient = {
  getSession: () => getStoredSession(),
  clearSession: () => persistSession(null),

  register: async (body) => {
    const response = await request('/auth/register', { method: 'POST', body: JSON.stringify(body) })
    const session = { token: response.token, user: response.user }
    persistSession(session)
    return response
  },

  login: async (body) => {
    const response = await request('/auth/login', { method: 'POST', body: JSON.stringify(body) })
    const session = { token: response.token, user: response.user }
    persistSession(session)
    return response
  },

  getMe: () => request('/auth/me'),

  getMyVault: () => request('/vault/me'),
  upsertMyVault: (body) =>
    requestWithFallback('/vault/me', '/vault/create', { method: 'POST', body: JSON.stringify(body) }),
  storeMyShares: (body, vaultId = '') =>
    requestWithFallback('/vault/me/shares', vaultId ? `/vault/${vaultId}/shares` : '', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadMyEncryptedFile: (body, vaultId = '') =>
    requestWithFallback('/vault/me/files', vaultId ? `/vault/${vaultId}/files` : '', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listMyFiles: () => request('/vault/me/files'),
  deleteMyFile: (fileId) => request(`/vault/me/files/${fileId}`, { method: 'DELETE' }),
  downloadMyFileUrl: (fileId) => getAuthorizedUrl(`/vault/me/files/${fileId}/download`),
  checkInMyVault: (vaultId = '') =>
    requestWithFallback('/vault/me/check-in', vaultId ? `/vault/${vaultId}/check-in` : '', { method: 'POST' }),
  requestUnlockMyVault: (body, vaultId = '') =>
    requestWithFallback('/vault/me/request-unlock', vaultId ? `/vault/${vaultId}/request-unlock` : '', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getDashboard: (vaultId) => request(`/vault/${vaultId}/dashboard`),
  getApprovals: (vaultId) => request(`/vault/${vaultId}/approvals`),
  getNomineeCheckpoint: (vaultId) => request(`/vault/${vaultId}/checkpoint`),
  listNomineeFiles: (vaultId, body) => {
    const nominee = encodeURIComponent(body?.nominee || '')
    const share = encodeURIComponent(body?.share || '')
    return request(`/vault/${vaultId}/files?nominee=${nominee}&share=${share}`)
  },
  getNomineeDownloadUrl: (vaultId, fileId, body) => {
    const nominee = encodeURIComponent(body?.nominee || '')
    const share = encodeURIComponent(body?.share || '')
    return `${API_BASE_URL}/vault/${vaultId}/files/${fileId}/download?nominee=${nominee}&share=${share}`
  },
  submitNomineeShare: (vaultId, body) =>
    request(`/vault/${vaultId}/submit-share`, { method: 'POST', body: JSON.stringify(body) }),

  evaluateDeadman: () => request('/vault/evaluate-deadman', { method: 'POST' }),
}
