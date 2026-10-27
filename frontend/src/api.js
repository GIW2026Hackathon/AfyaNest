// AfyaNest API client.
// * Same-origin only: the session lives in an HttpOnly cookie the page can't read,
//   so a script injected into the page can't steal it.
// * Every write sends the CSRF token (X-CSRF-Token), which an attacker's site can't know.
// * No secrets in the bundle: there is no admin key here any more.

const BASE = import.meta.env.VITE_API_URL || ''
let csrf = null

function cookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-_]/g, '\\$&') + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}
function csrfToken() {
  return csrf || cookie('__Host-afya_csrf') || cookie('afya_csrf')
}

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onSignedOut = () => {}
export function setSignedOutHandler(fn) {
  onSignedOut = fn
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') {
    const t = csrfToken()
    if (t) headers['X-CSRF-Token'] = t
  }
  let r
  try {
    r = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the AfyaNest server. Check your connection.')
  }
  let data = null
  const text = await r.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text                                  // plain-text replies (USSD)
  }
  if (!r.ok) {
    let msg = data?.detail
    if (Array.isArray(msg)) msg = msg.map((d) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join(' · ')
    const err = new ApiError(r.status, msg || `Request failed (${r.status})`, data?.code)
    if (r.status === 401 && !path.startsWith('/api/v1/auth/login') && !path.startsWith('/api/v1/auth/mfa')) {
      onSignedOut(err)
    }
    throw err
  }
  if (data && typeof data === 'object' && data.csrf) csrf = data.csrf
  return data
}

export const api = {
  // auth
  me: () => request('GET', '/api/v1/auth/me'),
  login: (email, password) => request('POST', '/api/v1/auth/login', { email, password }),
  signup: (b) => request('POST', '/api/v1/auth/signup', b),
  mfa: (code) => request('POST', '/api/v1/auth/mfa', { code }),
  logout: (everywhere = false) => request('POST', `/api/v1/auth/logout${everywhere ? '?everywhere=true' : ''}`).finally(() => (csrf = null)),
  changePassword: (current_password, new_password) => request('POST', '/api/v1/auth/password', { current_password, new_password }),
  mfaSetup: () => request('POST', '/api/v1/auth/mfa/setup'),
  mfaEnable: (code) => request('POST', '/api/v1/auth/mfa/enable', { code }),
  mfaDisable: (password) => request('POST', '/api/v1/auth/mfa/disable', { password }),
  sessions: () => request('GET', '/api/v1/auth/sessions'),
  revokeSession: (id) => request('DELETE', `/api/v1/auth/sessions/${encodeURIComponent(id)}`),
  // team & org
  team: () => request('GET', '/api/v1/team'),
  invite: (b) => request('POST', '/api/v1/team', b),
  updateMember: (id, b) => request('PATCH', `/api/v1/team/${encodeURIComponent(id)}`, b),
  resetMember: (id) => request('POST', `/api/v1/team/${encodeURIComponent(id)}/reset-password`),
  updateOrg: (b) => request('PATCH', '/api/v1/org', b),
  audit: (limit = 200) => request('GET', `/api/v1/audit?limit=${limit}`),
  // houses
  houses: () => request('GET', '/api/v1/houses'),
  house: (id) => request('GET', `/api/v1/houses/${encodeURIComponent(id)}`),
  history: (id, hours = 24) => request('GET', `/api/v1/houses/${encodeURIComponent(id)}/history?hours=${hours}`),
  addHouse: (b) => request('POST', '/api/v1/houses', b),
  updateHouse: (id, b) => request('PATCH', `/api/v1/houses/${encodeURIComponent(id)}`, b),
  deleteHouse: (id) => request('DELETE', `/api/v1/houses/${encodeURIComponent(id)}`),
  rotateKey: (id) => request('POST', `/api/v1/houses/${encodeURIComponent(id)}/rotate-key`),
  health: () => request('GET', '/health'),
  // the three models
  models: () => request('GET', '/api/v1/models'),
  outbreaks: () => request('GET', '/api/v1/outbreaks'),
  refreshOutbreaks: () => request('POST', '/api/v1/outbreaks/refresh'),
  approveOutbreak: (id) => request('POST', `/api/v1/outbreaks/${encodeURIComponent(id)}/approve`),
  dismissOutbreak: (id) => request('POST', `/api/v1/outbreaks/${encodeURIComponent(id)}/dismiss`),
  counties: () => request('GET', '/api/v1/counties'),
  // operator console
  overview: () => request('GET', '/api/v1/overview'),
  farmers: () => request('GET', '/api/v1/farmers'),
  farmer: (id) => request('GET', `/api/v1/farmers/${encodeURIComponent(id)}`),
  addFarmer: (b) => request('POST', '/api/v1/farmers', b),
  updateFarmer: (id, b) => request('PATCH', `/api/v1/farmers/${encodeURIComponent(id)}`, b),
  deleteFarmer: (id) => request('DELETE', `/api/v1/farmers/${encodeURIComponent(id)}`),
  // sandbox (simulated phones)
  sandboxSms: (phone, text) => request('POST', '/api/v1/sandbox/sms', { phone, text }),
  sandboxInbox: (phone) => request('GET', `/api/v1/sandbox/inbox?phone=${encodeURIComponent(phone)}`),
  sandboxScenario: (device_id, kind) => request('POST', '/api/v1/sandbox/scenario', { device_id, kind }),
  // sensor simulator + model boards
  simReading: (b) => request('POST', '/api/v1/simulator/reading', b),
  simRelease: (device_id) => request('POST', '/api/v1/simulator/release', { device_id }),
  dangerBoard: () => request('GET', '/api/v1/models/danger'),
  predictionBoard: () => request('GET', '/api/v1/models/prediction'),
}
