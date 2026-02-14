import { useState } from 'react'
import VaultForm from '../components/VaultForm'
import { apiClient } from '../api/client'
import { splitSecret } from '../crypto/shamir'
import { encryptPayload } from '../crypto/encrypt'

function bytesToBase64(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
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

function generateMasterKey() {
  const keyBytes = new Uint8Array(32)
  crypto.getRandomValues(keyBytes)
  return bytesToBase64(keyBytes)
}

function CreateVault({ currentUser, existingVault, onVaultUpdated }) {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [warning, setWarning] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState([])

  const handleFilesSelected = (event) => {
    const nextFiles = Array.from(event.target.files || [])
    if (!nextFiles.length) {
      return
    }

    setSelectedFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
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

    event.target.value = ''
  }

  const handleRemoveSelectedFile = (fileToRemove) => {
    setSelectedFiles((current) =>
      current.filter(
        (file) =>
          !(
            file.name === fileToRemove.name &&
            file.size === fileToRemove.size &&
            file.lastModified === fileToRemove.lastModified
          )
      )
    )
  }

  const handleCreateVault = async (payload) => {
    setError('')
    setSuccess('')
    setWarning('')
    setIsSubmitting(true)

    try {
      const response = await apiClient.upsertMyVault(payload)
      const newVaultId = response?.vault?.vaultId
      if (!newVaultId) {
        throw new Error('Vault saved but no vault ID returned')
      }

      const masterKey = generateMasterKey()
      localStorage.setItem(`deadlock-master-key-${newVaultId}`, masterKey)

      let sharesStored = false
      try {
        const shares = splitSecret(masterKey, 3, 3)
        await apiClient.storeMyShares({
          shares: shares.map((share) => share.value),
          threshold: 3,
          totalShares: 3,
        }, newVaultId)
        sharesStored = true
      } catch (shareError) {
        const message = shareError?.message || 'Failed to store encrypted shares'
        setWarning(
          message.includes('MASTER_SHARE_ENCRYPTION_KEY')
            ? 'Vault saved, but share escrow is unavailable: backend MASTER_SHARE_ENCRYPTION_KEY is not configured.'
            : `Vault saved, but encrypted share storage failed: ${message}`
        )
      }

      for (const selectedFile of selectedFiles) {
        const base64File = await fileToBase64(selectedFile)
        const encryptedPayload = await encryptPayload(base64File, masterKey)
        const packedCipherText = textToBase64(
          JSON.stringify({
            type: 'encrypted-file',
            fileName: selectedFile.name,
            encryptedPayload,
          })
        )

        await apiClient.uploadMyEncryptedFile({
          fileName: selectedFile.name,
          contentType: 'application/json',
          cipherTextBase64: packedCipherText,
        }, newVaultId)
      }

      localStorage.setItem('deadlock-last-vault-id', newVaultId)
      await onVaultUpdated?.()
      setSuccess(
        existingVault
          ? `Vault updated: ${newVaultId}.${sharesStored ? ' Shares rotated successfully.' : ''}`
          : `Vault created: ${newVaultId}.${sharesStored ? ' 3 encrypted shares stored.' : ''}`
      )
      setSelectedFiles([])
    } catch (createError) {
      setError(createError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page card">
      <div className="page-header">
        <h2>{existingVault ? 'Edit Vault' : 'Create Vault'}</h2>
        <p>
          {existingVault
            ? 'Your account has one vault. Update nominees and policy below.'
            : 'Create your single vault and define nominees, threshold, and dead-man switch policy.'}
        </p>
      </div>
      <VaultForm
        onSubmit={handleCreateVault}
        isSubmitting={isSubmitting}
        ownerLabel={currentUser?.email || currentUser?.userId || 'Unknown user'}
        initialValues={existingVault}
        submitLabel={existingVault ? 'Update Vault' : 'Create Vault'}
      />

      <label className="field">
        <span>Optional encrypted uploads (stored in S3)</span>
        <input type="file" multiple onChange={handleFilesSelected} />
      </label>
      {!!selectedFiles.length && (
        <div className="panel">
          <p className="faint">Files queued for upload: {selectedFiles.length}</p>
          <ul className="rows-list">
            {selectedFiles.map((file) => (
              <li key={`${file.name}-${file.size}-${file.lastModified}`} className="file-row">
                <span>{file.name}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-inline"
                  onClick={() => handleRemoveSelectedFile(file)}
                  disabled={isSubmitting}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {success && <p className="message success">{success}</p>}
      {warning && <p className="message warning">{warning}</p>}
      {error && <p className="message error">{error}</p>}
    </section>
  )
}

export default CreateVault
