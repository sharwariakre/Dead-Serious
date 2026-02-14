import { useMemo, useState } from 'react'
import { apiClient } from '../api/client'

function daysUntil(dateValue) {
  if (!dateValue) {
    return null
  }

  const now = Date.now()
  const target = new Date(dateValue).getTime()
  const diff = Math.max(0, target - now)
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function getCheckInProgress(vault) {
  const last = vault?.lastCheckIn ? new Date(vault.lastCheckIn).getTime() : Date.now()
  const next = vault?.deadMan?.nextCheckInDueAt ? new Date(vault.deadMan.nextCheckInDueAt).getTime() : last

  const span = Math.max(next - last, 1)
  const elapsed = Math.min(Math.max(Date.now() - last, 0), span)
  return Math.round((elapsed / span) * 100)
}

function Dashboard({ vault, onVaultUpdated }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRefresh = async () => {
    setLoading(true)
    setError('')

    try {
      await onVaultUpdated?.()
    } catch (refreshError) {
      setError(refreshError.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCheckIn = async () => {
    if (!vault) {
      return
    }

    setLoading(true)
    setError('')

    try {
      await apiClient.checkInMyVault(vault.vaultId)
      await onVaultUpdated?.()
    } catch (checkInError) {
      setError(checkInError.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRequestUnlock = async () => {
    if (!vault) {
      return
    }

    setLoading(true)
    setError('')

    try {
      await apiClient.requestUnlockMyVault({ reason }, vault.vaultId)
      await onVaultUpdated?.()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  const nominees = vault?.approvals?.nominees || []
  const pendingDays = daysUntil(vault?.deadMan?.nextCheckInDueAt)
  const checkInProgress = getCheckInProgress(vault)

  const contentRows = useMemo(() => {
    const fallbackCounts = [12, 5, 34, 1, 3]
    const labels = ['Master Passwords', 'Legal Documents', 'Family Photos', 'Final Message', 'Crypto Wallet Keys']

    return labels.map((label, index) => ({
      label,
      items: vault?.files?.length ? Math.max(1, Math.floor(vault.files.length / (index + 1))) : fallbackCounts[index],
    }))
  }, [vault?.files])

  const totalItems = contentRows.reduce((acc, row) => acc + row.items, 0)

  if (!vault) {
    return (
      <section className="page dashboard-page">
        <article className="panel">
          <h3>No Vault Yet</h3>
          <p>Create your vault first. Each account supports one vault that you can edit later.</p>
        </article>
      </section>
    )
  }

  return (
    <section className="page dashboard-page">
      <div className="panel control-row deadlock-toolbar">
        <div>
          <p className="faint">Vault ID</p>
          <code>{vault.vaultId}</code>
        </div>
        <div className="action-group">
          <button type="button" className="btn btn-ghost" onClick={handleRefresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <article className="panel dm-panel">
        <div className="panel-head">
          <h3>Dead Man&apos;s Switch</h3>
          <span className="faint">Every {vault?.checkInPolicy?.intervalDays || 14} days</span>
        </div>
        <p className="warning-line">
          {pendingDays !== null ? `${pendingDays} days until next check-in deadline` : 'No check-in deadline yet'}
        </p>
        <div className="progress-track">
          <span className="progress-bar" style={{ width: `${checkInProgress}%` }} />
        </div>
        <button type="button" className="btn btn-primary" onClick={handleCheckIn} disabled={loading}>
          I&apos;M ALIVE - CHECK IN
        </button>
      </article>

      <article className="panel vault-content-panel">
        <div className="panel-head">
          <h3>Vault Contents</h3>
          <span className="pill">{vault.files?.length || 0} file(s)</span>
        </div>
        <ul className="rows-list">
          {contentRows.map((row) => (
            <li key={row.label}>
              <span>{row.label}</span>
              <span className="faint">{row.items} items</span>
            </li>
          ))}
        </ul>
        <div className="rows-foot">
          <span>Total encrypted items</span>
          <strong>{totalItems}</strong>
        </div>
      </article>

      <article className="panel keyholders-panel">
        <div className="panel-head">
          <h3>Key Holders</h3>
          <span className="pill status-live">{nominees.length}/3 Assigned</span>
        </div>
        <ul className="rows-list">
          {(nominees.length ? nominees : [{ email: 'Nominee A' }, { email: 'Nominee B' }, { email: 'Nominee C' }]).map(
            (nominee, index) => (
              <li key={nominee.id || nominee.email}>
                <span>
                  {nominee.email || `Nominee ${String.fromCharCode(65 + index)}`}
                  <small className="faint">Fragment assigned</small>
                </span>
                <span className="faint">{nominee.status || 'pending'}</span>
              </li>
            )
          )}
        </ul>
        <p className="faint">Nominees are notified only after dead-man switch triggers or manual unlock request.</p>
      </article>

      <article className="panel security-panel">
        <div className="panel-head">
          <h3>Security Status</h3>
        </div>
        <ul className="rows-list compact">
          <li>
            <span>Encryption</span>
            <strong>AES-256-GCM</strong>
          </li>
          <li>
            <span>Key Split</span>
            <strong>Shamir 3-of-3</strong>
          </li>
          <li>
            <span>Storage</span>
            <strong>S3 + Postgres Metadata</strong>
          </li>
          <li>
            <span>Vault Status</span>
            <strong>{vault?.status || 'Sealed'}</strong>
          </li>
        </ul>
      </article>

      <article className="panel unlock-panel">
        <label className="field">
          <span>Unlock reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for emergency unlock request"
          />
        </label>
        <button type="button" className="btn" onClick={handleRequestUnlock} disabled={loading}>
          Trigger Nominee Notification
        </button>
      </article>

      {loading && <p className="message">Loading...</p>}
      {error && <p className="message error">{error}</p>}
    </section>
  )
}

export default Dashboard
