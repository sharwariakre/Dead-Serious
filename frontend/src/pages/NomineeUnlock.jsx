import { useState } from 'react'
import { apiClient } from '../api/client'

function NomineeUnlock() {
  const [vaultId, setVaultId] = useState('')
  const [nominee, setNominee] = useState('')
  const [share, setShare] = useState('')
  const [checkpoint, setCheckpoint] = useState(null)
  const [approvalData, setApprovalData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [nomineeFiles, setNomineeFiles] = useState([])

  const loadStatus = async () => {
    if (!vaultId.trim()) {
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const [checkpointResponse, approvalResponse] = await Promise.all([
        apiClient.getNomineeCheckpoint(vaultId.trim()),
        apiClient.getApprovals(vaultId.trim()),
      ])
      setCheckpoint(checkpointResponse.checkpoint)
      setApprovalData(approvalResponse.approvals)
    } catch (loadError) {
      setError(loadError.message)
      setCheckpoint(null)
      setApprovalData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleLoadFiles = async () => {
    if (!vaultId.trim() || !nominee.trim() || !share.trim()) {
      setError('Vault ID, nominee email, and share are required.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await apiClient.listNomineeFiles(vaultId.trim(), {
        nominee: nominee.trim().toLowerCase(),
        share: share.trim(),
      })
      setNomineeFiles(response.files || [])
    } catch (loadError) {
      setError(loadError.message)
      setNomineeFiles([])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitShare = async () => {
    if (!vaultId.trim() || !nominee.trim() || !share.trim()) {
      setError('Vault ID, nominee email, and share are required.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await apiClient.submitNomineeShare(vaultId.trim(), {
        nominee: nominee.trim().toLowerCase(),
        share: share.trim(),
      })

      setSuccess(
        response.result.canAccess
          ? 'All 3 valid nominee shares submitted. Vault access unlocked.'
          : `Share accepted. ${response.result.submittedCount}/3 checkpoints complete.`
      )
      await loadStatus()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page card">
      <div className="page-header">
        <h2>Nominee Unlock</h2>
        <p>Nominees must submit all 3 valid share fragments before vault access is unlocked.</p>
      </div>

      <label className="field">
        <span>Vault ID</span>
        <input value={vaultId} onChange={(event) => setVaultId(event.target.value)} />
      </label>

      <div className="action-group">
        <button type="button" className="btn" onClick={loadStatus} disabled={loading || !vaultId.trim()}>
          Load Checkpoint Status
        </button>
      </div>

      {approvalData && (
        <div className="panel">
          <p className="vault-meta">
            <strong>{approvalData.vaultName}</strong>
            <span className="pill">{approvalData.status}</span>
          </p>
          <ul className="rows-list">
            {(approvalData.nominees || []).map((person) => (
              <li key={person.id}>
                <span>{person.email}</span>
                <span className="faint">{person.shareSubmittedAt ? 'checkpoint submitted' : 'pending'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkpoint && (
        <div className="panel">
          <p>
            Checkpoint: <strong>{checkpoint.submittedCount}/3</strong>
          </p>
          <p>
            Access: <strong>{checkpoint.canAccess ? 'Unlocked' : 'Locked until all 3 shares are submitted'}</strong>
          </p>
        </div>
      )}

      {!!nomineeFiles.length && (
        <div className="panel">
          <p className="faint">Nominee read-only files</p>
          <ul className="rows-list">
            {nomineeFiles.map((file) => (
              <li key={file.id}>
                <span>{file.fileName}</span>
                <a
                  className="btn btn-ghost btn-inline"
                  href={apiClient.getNomineeDownloadUrl(vaultId.trim(), file.id, {
                    nominee: nominee.trim().toLowerCase(),
                    share: share.trim(),
                  })}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="field">
        <span>Nominee email</span>
        <input
          type="email"
          value={nominee}
          onChange={(event) => setNominee(event.target.value)}
          placeholder="nominee@example.com"
        />
      </label>

      <label className="field">
        <span>Share fragment (from notification email)</span>
        <input
          value={share}
          onChange={(event) => setShare(event.target.value)}
          placeholder="Enter your share value"
        />
      </label>

      <div className="action-group">
        <button type="button" className="btn" onClick={handleSubmitShare} disabled={loading}>
          Submit Share Checkpoint
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleLoadFiles} disabled={loading}>
          View/Download Files
        </button>
      </div>

      {loading && <p className="message">Loading...</p>}
      {success && <p className="message success">{success}</p>}
      {error && <p className="message error">{error}</p>}
    </section>
  )
}

export default NomineeUnlock
