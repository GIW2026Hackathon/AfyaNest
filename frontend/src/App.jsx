import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, setSignedOutHandler } from './api'
import { DICTS, LangContext } from './lib/i18n'
import Account from './pages/Account'
import Login, { ForcedStep } from './pages/Auth'
import Farmer from './pages/Farmer'
import Farmers from './pages/Farmers'
import House from './pages/House'
import Intro from './pages/Intro'
import Danger from './pages/Danger'
import Outbreaks from './pages/Outbreaks'
import Prediction from './pages/Prediction'
import Simulator from './pages/Simulator'
import Overview from './pages/Overview'
import Remote, { useSecretTaps } from './pages/Remote'
import { Icon, initials, Logo, ServerStatus } from './pages/ui'

function useHashRoute() {
  const get = () => window.location.hash.replace(/^#/, '') || '/'
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const f = () => { setRoute(get()); window.scrollTo({ top: 0 }) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return route
}

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

export default function App() {
  const [user, setUser] = useState(undefined)
  const [notice, setNotice] = useState(null)
  const [lang, setLangState] = useState(() => store.get('afya.lang', 'en'))
  const [theme, setTheme] = useState(() => store.get('afya.theme.v2', 'light'))
  const [intro, setIntro] = useState(() => { try { return sessionStorage.getItem('afya.introSeen') !== '1' } catch { return true } })
  const route = useHashRoute()

  const setLang = (l) => { setLangState(l); store.set('afya.lang', l) }
  useEffect(() => { document.documentElement.dataset.theme = theme; store.set('afya.theme.v2', theme) }, [theme])

  const refreshMe = useCallback(() => api.me().then(setUser).catch(() => setUser(null)), [])
  useEffect(() => {
    setSignedOutHandler((err) => {
      setUser(null)
      if (err?.code === 'expired') setNotice('You were signed out after a period of inactivity.')
    })
    refreshMe()
  }, [refreshMe])

  // sign out after 30 minutes without activity (the server enforces it too)
  useEffect(() => {
    if (!user) return
    let last = Date.now()
    const bump = () => { last = Date.now() }
    const evs = ['pointerdown', 'keydown', 'scroll']
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const id = setInterval(() => {
      if (Date.now() - last > 30 * 60 * 1000) {
        api.logout().catch(() => {})
        setUser(null)
        setNotice('You were signed out after 30 minutes of inactivity.')
      }
    }, 30000)
    return () => { clearInterval(id); evs.forEach((e) => window.removeEventListener(e, bump)) }
  }, [user])

  const ctx = useMemo(() => ({ t: DICTS[lang] || DICTS.en, lang, setLang }), [lang])
  const signOut = async () => {
    await api.logout().catch(() => {})
    setUser(null)
    window.location.hash = '/'
  }

  let page
  if (user === undefined) page = <div className="splash"><Logo big /></div>
  else if (user === null) page = <Login onSignedIn={(u) => { setNotice(null); setUser(u) }} notice={notice} />
  else if (user.must_change_password || user.mfa_setup_required) page = <ForcedStep user={user} onDone={refreshMe} onSignOut={signOut} />
  else {
    const [path, qs] = route.split('?')
    const query = new URLSearchParams(qs || '')
    const [, section, id] = path.split('/')
    let body
    if (section === 'farmers' && id) body = <Farmer id={decodeURIComponent(id)} user={user} />
    else if (section === 'farmers') body = <Farmers user={user} query={query} key={route} />
    else if (section === 'house' && id) body = <House id={decodeURIComponent(id)} user={user} />
    else if (section === 'disease') body = <Outbreaks user={user} />
    else if (section === 'danger') body = <Danger user={user} />
    else if (section === 'prediction') body = <Prediction user={user} />
    else if (section === 'simulator') body = <Simulator user={user} query={query} key={route} />
    else if (section === 'account') body = <Account user={user} onChange={refreshMe} />
    else body = <Overview user={user} />
    page = <Shell user={user} section={section || ''} onSignOut={signOut} theme={theme} setTheme={setTheme}>{body}</Shell>
  }
  return <LangContext.Provider value={ctx}>{page}{intro && <Intro onDone={() => setIntro(false)} />}</LangContext.Provider>
}

const NAV = [
  { group: 'Monitor' },
  { key: '', href: '#/', icon: 'overview', label: 'Dashboard' },
  { key: 'farmers', href: '#/farmers', icon: 'farmers', label: 'Farmers live monitoring', also: ['house'] },
  { group: 'AI models' },
  { key: 'disease', href: '#/disease', icon: 'shield', label: 'Disease news', n: '1' },
  { key: 'danger', href: '#/danger', icon: 'bell', label: 'Danger alarm', n: '2' },
  { key: 'prediction', href: '#/prediction', icon: 'chart', label: 'Prediction', n: '3' },
]

function Shell({ user, section, onSignOut, theme, setTheme, children }) {
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState(false)
  const toggleRemote = useCallback(() => setRemote((r) => !r), [])
  const tap = useSecretTaps(toggleRemote)
  useEffect(() => setOpen(false), [section])
  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <a href="#/" className="side-brand" onClick={tap}><Logo /></a>
        {NAV.map((n) => {
          if (n.group) return <div key={n.group} className="side-section">{n.group}</div>
          const on = section === n.key || n.also?.includes(section)
          return (
            <a key={n.key} href={n.href} className={`nav-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
              <Icon name={n.icon} /><span className="grow">{n.label}</span>{n.n && <span className="nav-n">{n.n}</span>}
            </a>
          )
        })}
        <div className="side-bottom">
          <ServerStatus />
          <div className="side-row">
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Switch light/dark" title="Light / dark">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button className="icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
          </div>
          <a href="#/account" className={`me ${section === 'account' ? 'on' : ''}`}>
            <span className="avatar">{initials(user.name || user.email)}</span>
            <span><b>{user.name}</b><span>{user.role} · {user.tenant.name}</span></span>
          </a>
        </div>
      </aside>
      <div>
        <div className="mobile-top">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <span onClick={tap}><Logo /></span>
          <span style={{ width: 36 }} />
        </div>
        <main className="main" onClick={() => open && setOpen(false)}>{children}</main>
        <Remote open={remote} onClose={() => setRemote(false)} user={user} />
      </div>
    </div>
  )
}
