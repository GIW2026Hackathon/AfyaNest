import { useState } from 'react'
import { api } from '../api'
import { usePoll } from '../lib/hooks'
import { ChangePassword } from './Auth'
import { ago, ErrorNote, Field, Icon, initials, Modal, SecretOnce, Spinner } from './ui'

const ROLE = { owner: 'Owner - can do everything', manager: 'Manager - adds and edits farmers', viewer: 'Viewer - can only look' }

export default function Account({ user }) {
  return (
    <div className="page">
      <section className="hero rise">
        <div>
          <p className="eyebrow">My account</p>
          <h1 className="display">{user.name}</h1>
          <p className="muted">{user.email} · {user.tenant.name}</p>
        </div>
      </section>
      <section className="grid-2">
        <div className="card rise">
          <div className="me-card">
            <span className="avatar xl">{initials(user.name)}</span>
            <div><b>{user.name}</b><span className="muted">{ROLE[user.role]}</span></div>
          </div>
          <p className="muted small" style={{ marginTop: 14 }}>You are signed out automatically after 30 minutes without activity.</p>
        </div>
        <div className="card rise" style={{ animationDelay: '80ms' }}><ChangePassword /></div>
      </section>
      {user.role !== 'viewer' && <Team user={user} />}
    </div>
  )
}

function Team({ user }) {
  const team = usePoll(() => api.team(), [], 0)
  const [adding, setAdding] = useState(false)
  const [temp, setTemp] = useState(null)
  const [err, setErr] = useState(null)
  const owner = user.role === 'owner'
  const act = async (fn) => { setErr(null); try { const r = await fn(); team.reload(); return r } catch (e) { setErr(e) } }
  return (
    <section className="card rise" style={{ animationDelay: '140ms' }}>
      <div className="card-head">
        <h3>Our team</h3>
        {owner && <button className="btn primary small" onClick={() => setAdding(true)}><Icon name="plus" />Add staff</button>}
      </div>
      <ErrorNote error={err || team.error} />
      {temp && <SecretOnce label={`Temporary password for ${temp.name}`} value={temp.pw} note="Give it to them in person. They choose their own password when they first sign in." />}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th>{owner && <th />}</tr></thead>
          <tbody>
            {(team.data || []).map((m) => (
              <tr key={m.id} className={m.disabled ? 'dim' : ''}>
                <td><div className="who"><span className="mini-avatar">{initials(m.name)}</span><div><b>{m.name}{m.you ? ' (you)' : ''}</b><span>{m.email}</span></div></div></td>
                <td>{owner && !m.you ? (
                  <select value={m.role} onChange={(e) => act(() => api.updateMember(m.id, { role: e.target.value }))}>
                    <option value="owner">Owner</option><option value="manager">Manager</option><option value="viewer">Viewer</option>
                  </select>) : <span className="role-chip">{m.role}</span>}
                  {m.disabled && <span className="badge tone-none" style={{ marginLeft: 8 }}>blocked</span>}</td>
                <td className="muted">{m.last_login_ts ? ago(m.last_login_ts) : 'never'}</td>
                {owner && <td className="row-end">{!m.you && (<>
                  <button className="btn small" onClick={async () => { const r = await act(() => api.resetMember(m.id)); if (r) setTemp({ name: m.name, pw: r.temporary_password }) }}>New password</button>
                  <button className="btn small" onClick={() => act(() => api.updateMember(m.id, { disabled: !m.disabled }))}>{m.disabled ? 'Unblock' : 'Block'}</button>
                </>)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <AddStaff onClose={() => setAdding(false)} onDone={(name, pw) => { setTemp({ name, pw }); team.reload() }} />}
    </section>
  )
}

function AddStaff({ onClose, onDone }) {
  const [v, setV] = useState({ name: '', email: '', role: 'manager' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { const r = await api.invite(v); onDone(v.name, r.temporary_password); onClose() } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }
  return (
    <Modal title="Add staff member" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Full name"><input value={v.name} onChange={set('name')} required maxLength={80} autoFocus /></Field>
        <Field label="Email"><input type="email" value={v.email} onChange={set('email')} required maxLength={254} /></Field>
        <Field label="Role"><select value={v.role} onChange={set('role')}>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <ErrorNote error={err} />
        <div className="row-end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : 'Add'}</button></div>
      </form>
    </Modal>
  )
}
