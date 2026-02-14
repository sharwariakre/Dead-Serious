import { useEffect, useMemo, useState } from 'react'

function VaultForm({ onSubmit, isSubmitting = false, ownerLabel = '', initialValues = null, submitLabel = 'Create Vault' }) {
  const [vaultName, setVaultName] = useState('')
  const [nominees, setNominees] = useState('')
  const [triggerTime, setTriggerTime] = useState('')
  const [checkInIntervalDays, setCheckInIntervalDays] = useState(14)
  const [gracePeriodDays, setGracePeriodDays] = useState(30)
  const [maxMissedCheckIns, setMaxMissedCheckIns] = useState(2)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!initialValues) {
      return
    }

    setVaultName(initialValues.vaultName || '')
    setNominees((initialValues.nominees || []).map((nominee) => nominee.email || nominee).join(','))
    setTriggerTime(initialValues.triggerTime ? String(initialValues.triggerTime).slice(0, 16) : '')
    setCheckInIntervalDays(initialValues.checkInPolicy?.intervalDays || 14)
    setGracePeriodDays(initialValues.checkInPolicy?.gracePeriodDays || 30)
    setMaxMissedCheckIns(initialValues.checkInPolicy?.maxMissedCheckIns || 2)
  }, [initialValues])

  const parsedNominees = useMemo(
    () =>
      nominees
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    [nominees]
  )

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!vaultName.trim()) {
      setError('Vault name is required.')
      return
    }

    if (parsedNominees.length !== 3) {
      setError('Exactly 3 nominees are required for DEADLOCK.')
      return
    }

    if (new Set(parsedNominees).size !== parsedNominees.length) {
      setError('Nominee emails must be unique.')
      return
    }

    const intervalValue = Number(checkInIntervalDays)
    const graceValue = Number(gracePeriodDays)
    const missedValue = Number(maxMissedCheckIns)

    if (!Number.isInteger(intervalValue) || intervalValue < 1) {
      setError('Check-in interval must be a positive integer.')
      return
    }

    if (!Number.isInteger(graceValue) || graceValue < 1) {
      setError('Grace period must be a positive integer.')
      return
    }

    if (!Number.isInteger(missedValue) || missedValue < 1) {
      setError('Max missed check-ins must be a positive integer.')
      return
    }

    setError('')
    await onSubmit?.({
      vaultName: vaultName.trim(),
      nominees: parsedNominees,
      threshold: 3,
      triggerTime: triggerTime || null,
      checkInIntervalDays: intervalValue,
      gracePeriodDays: graceValue,
      maxMissedCheckIns: missedValue,
    })
  }

  return (
    <form className="vault-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Logged in as</span>
        <input value={ownerLabel} disabled />
      </label>
      <label className="field">
        <span>Vault name</span>
        <input
          value={vaultName}
          onChange={(event) => setVaultName(event.target.value)}
          placeholder="Family Documents"
        />
      </label>
      <label className="field">
        <span>Nominees (exactly 3, comma-separated)</span>
        <input
          value={nominees}
          onChange={(event) => setNominees(event.target.value)}
          placeholder="alice@example.com, bob@example.com, chris@example.com"
        />
      </label>
      <label className="field">
        <span>Trigger time (optional)</span>
        <input
          type="datetime-local"
          value={triggerTime}
          onChange={(event) => setTriggerTime(event.target.value)}
        />
      </label>
      <div className="grid-two compact grid-three">
        <label className="field">
          <span>Check-in interval (days)</span>
          <input
            type="number"
            min="1"
            value={checkInIntervalDays}
            onChange={(event) => setCheckInIntervalDays(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Grace period (days)</span>
          <input
            type="number"
            min="1"
            value={gracePeriodDays}
            onChange={(event) => setGracePeriodDays(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Max missed check-ins</span>
          <input
            type="number"
            min="1"
            value={maxMissedCheckIns}
            onChange={(event) => setMaxMissedCheckIns(event.target.value)}
          />
        </label>
      </div>
      {error && <p className="message error">{error}</p>}
      <button className="btn" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : submitLabel}
      </button>
    </form>
  )
}

export default VaultForm
