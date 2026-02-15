import { useState } from 'react'
import { apiClient } from '../api/client'
import { encryptPayload } from '../crypto/encrypt'

function daysUntil(dateValue) {
  if (!dateValue) return null
  const now = Date.now()
  const target = new Date(dateValue).getTime()
  const diff = Math.max(0, target - now)
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function getCheckInProgress(vault) {
  const last = vault?.lastCheckIn ? new Date(vault.lastCheckIn).getTime() : Date.now()
  const next = vault?.deadMan?.nextCheckInDueAt
    ? new Date(vault.deadMan.nextCheckInDueAt).getTime()
    : last

  const span = Math.max(next - last, 1)
  const elapsed = Math.min(Math.max(Date.now() - last, 0), span)
  return Math.round((elapsed / span) * 100)
}

function textToBase64(value) {
  return btoa(unescape(encodeURIComponent(value)))
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read selected file'))
    reader.readAsDataURL(file)
  })
}

function Dashboard({ vault, onVaultUpdated }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [showUploadedFiles, setShowUploadedFiles] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState(null)

  const handleRefresh = async () => {
    setLoading(true)
    setError('')
    try {
      await onVaultUpdated?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCheckIn = async () => {
    if (!vault) return
    setLoading(true)
    setError('')
    try {
      await apiClient.checkInMyVault(vault.vaultId)
      await onVaultUpdated?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRequestUnlock = async () => {
    if (!vault) return
    setLoading(true)
    setError('')
    try {
      await apiClient.requestUnlockMyVault({ reason }, vault.vaultId)
      await onVaultUpdated?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFilesSelected = (event) => {
    const nextFiles = Array.from(event.target.files || [])
    if (!nextFiles.length) return

    setSelectedFiles((current) => {
      const seen = new Set(current.map((f) => `${f.name}:${f.size}:${f.lastModified}`))
      const merged = [...current]

      nextFiles.forEach((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(file)
        }
      })

      return merged
    })
  }

  const handleUploadSelected = async () => {
    if (!vault) return

    const masterKey = localStorage.getItem(`deadlock-master-key-${vault.vaultId}`)
    if (!masterKey) {
      setError('Missing master key for this vault.')
      return
    }

    if (!selectedFiles.length) {
      setError('Choose at least one file.')
      return
    }

    setLoading(true)
    setError('')

    try {
      for (const file of selectedFiles) {
        const base64File = await fileToBase64(file)
        const encryptedPayload = await encryptPayload(base64File, masterKey)

        const packedCipherText = textToBase64(
          JSON.stringify({
            type: 'encrypted-file',
            fileName: file.name,
            originalContentType: file.type || 'application/octet-stream',
            encryptedPayload,
          })
        )

        await apiClient.uploadMyEncryptedFile(
          {
            fileName: file.name,
            contentType: 'application/json',
            cipherTextBase64: packedCipherText,
          },
          vault.vaultId
        )
      }

      setSelectedFiles([])
      await onVaultUpdated?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteFile = async (file) => {
    const fileId = file?.id

    if (!fileId) {
      setError('Missing fileId for this file')
      return
    }

    const ok = window.confirm(`Delete "${file.fileName || 'this file'}"? This cannot be undone.`)
    if (!ok) return

    setDeletingFileId(fileId)
    setError('')

    try {
      await apiClient.deleteMyEncryptedFile(fileId)
      await onVaultUpdated?.()
    } catch (e) {
      setError(e.message || 'Delete failed')
    } finally {
      setDeletingFileId(null)
    }
  }

  const nominees = vault?.approvals?.nominees || []
  const pendingDays = daysUntil(vault?.deadMan?.nextCheckInDueAt)
  const checkInProgress = getCheckInProgress(vault)
  const notificationStarted =
    vault?.status === 'nominees_notified' || vault?.status === 'unlocked'

  if (!vault) {
    return (
      <section className="page dashboard-page">
        <article className="panel">
          <h3>No Vault Yet</h3>
          <p>Create your vault first.</p>
        </article>
      </section>
    )
  }

  return (
    <section className="page dashboard-page">
      {/* Vault Header */}
      <div className="panel control-row deadlock-toolbar">
        <div>
          <p className="faint">Vault ID</p>
          <code>{vault.vaultId}</code>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleRefresh}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {/* Dead Man Switch */}
      <article className="panel dm-panel">
        <div className="panel-head">
          <h3>Dead Man&apos;s Switch</h3>
          <span className="faint">
            Every {vault?.checkInPolicy?.intervalDays || 14} days
          </span>
        </div>
        <p>
          {pendingDays !== null
            ? `${pendingDays} days until next check-in`
            : 'No deadline set'}
        </p>
        <div className="progress-track">
          <span
            className="progress-bar"
            style={{ width: `${checkInProgress}%` }}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCheckIn}
          disabled={loading || notificationStarted}
        >
          I'M ALIVE - CHECK IN
        </button>
      </article>

      {/* Vault Contents */}
      <article className="panel">
        <div className="panel-head">
          <h3>Vault Contents</h3>
          <span className="pill">
            {vault.files?.length || 0} file(s)
          </span>
        </div>
        <p>
          <strong>{vault.files?.length || 0}</strong> encrypted file(s) stored.
        </p>
      </article>

      {/* Key Holders */}
      <article className="panel keyholders-panel">
        <div className="panel-head">
          <h3>Key Holders</h3>
          <span className="pill status-live">
            {nominees.length}/3 Assigned
          </span>
        </div>
        <ul className="rows-list">
          {nominees.map((nominee) => (
            <li key={nominee.email}>
              <span>{nominee.email}</span>
              <span className="faint">{nominee.status || 'pending'}</span>
            </li>
          ))}
        </ul>
      </article>

      {/* Upload Section */}
      <article className="panel unlock-panel">
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3>Upload Encrypted Files</h3>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowUploadedFiles(!showUploadedFiles)}
          >
            {showUploadedFiles ? 'Hide uploaded files' : 'Show uploaded files'}
          </button>
        </div>

        <label className="field">
          <span>Choose files</span>
          <input type="file" multiple onChange={handleFilesSelected} />
        </label>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleUploadSelected}
          disabled={loading || selectedFiles.length === 0}
        >
          {loading ? 'Uploading…' : 'Upload'}
        </button>

        {/* Uploaded Files List */}
        {showUploadedFiles && (
          <ul className="rows-list" style={{ marginTop: 16 }}>
            {vault.files?.map((file) => (
              <li
                key={file.fileId}
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <div>
                  <strong>{file.fileName}</strong>
                  {file.createdAt && (
                    <div className="faint">
                      {new Date(file.createdAt).toLocaleString()}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => handleDeleteFile(file)}
                  disabled={deletingFileId === file.fileId}
                >
                  {deletingFileId === file.fileId ? 'Deleting…' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>

      {/* Emergency Unlock Panel */}
      <article className="panel unlock-panel">
        <div className="panel-head">
          <h3>Emergency Unlock</h3>
        </div>

        <label className="field">
          <span>Reason for emergency unlock</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why vault should be unlocked"
          />
        </label>

        <button
          type="button"
          className="btn btn-danger"
          onClick={handleRequestUnlock}
          disabled={loading || notificationStarted}
        >
          {notificationStarted
            ? 'Nominees Already Notified'
            : 'Trigger Nominee Notification'}
        </button>

        {notificationStarted && (
          <p className="message error">
            Nominee notification has already started. This action cannot be reversed.
          </p>
        )}
      </article>

      {error && <p className="message error">{error}</p>}
    </section>
  )
}

export default Dashboard