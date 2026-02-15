import { useEffect, useState } from 'react'
import CreateVault from './pages/CreateVault'
import Dashboard from './pages/Dashboard'
import NomineeUnlock from './pages/NomineeUnlock'
import Login from './pages/Login'
import { apiClient } from './api/client'
import './App.css'

const TABS = {
  dashboard: 'dashboard',
  createVault: 'createVault',
}

function App() {
  const [activeTab, setActiveTab] = useState(TABS.dashboard)
  const [authView, setAuthView] = useState('owner')
  const [session, setSession] = useState(() => apiClient.getSession())
  const [vault, setVault] = useState(null)
  const [vaultLoading, setVaultLoading] = useState(false)

  const loadVault = async () => {
    if (!session?.token) {
      setVault(null)
      return
    }

    setVaultLoading(true)
    try {
      const response = await apiClient.getMyVault()
      setVault(response.vault || null)
    } catch {
      const fallbackVaultId = localStorage.getItem('deadlock-last-vault-id') || ''
      if (!fallbackVaultId) {
        setVault(null)
      } else {
        try {
          const fallbackResponse = await apiClient.getDashboard(fallbackVaultId)
          setVault(fallbackResponse.vault || null)
        } catch {
          setVault(null)
        }
      }
    } finally {
      setVaultLoading(false)
    }
  }

  useEffect(() => {
    loadVault()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token])

  const handleLogout = () => {
    apiClient.clearSession()
    localStorage.removeItem('deadlock-last-vault-id')
    setSession(null)
    setVault(null)
    setActiveTab(TABS.dashboard)
  }

  if (!session?.token) {
    return (
      <main className="app-shell">
        <header className="app-header card hero-header">
          <p className="app-kicker">Secure Legacy Vault</p>
          <h1>DEAD SERIOUS</h1>
          <p className="app-mono">YOUR DIGITAL LEGACY, SEALED UNTIL IT MATTERS</p>
          <p className="app-subtitle">
            A cryptographic vault that protects your most sensitive files, passwords, and memories.
          </p>
        </header>
        {authView === 'owner' ? (
          <>
            <Login onAuthenticated={setSession} />
            <section className="page card auth-card">
              <button type="button" className="btn btn-ghost" onClick={() => setAuthView('nominee')}>
                Nominee access via OTP
              </button>
            </section>
          </>
        ) : (
          <NomineeUnlock onBackToLogin={() => setAuthView('owner')} />
        )}
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand">
          <p>DEAD SERIOUS</p>
        </div>
        <div className="user-row">
          <span className="pill status-live">{vault ? 'Vault Ready' : 'No Vault Yet'}</span>
          <span className="pill">{session.user?.email || session.user?.userId}</span>
          <button type="button" className="btn btn-ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <nav className="tab-nav card" aria-label="Main navigation">
        <button
          type="button"
          className={activeTab === TABS.dashboard ? 'tab-button is-active' : 'tab-button'}
          onClick={() => setActiveTab(TABS.dashboard)}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={activeTab === TABS.createVault ? 'tab-button is-active' : 'tab-button'}
          onClick={() => setActiveTab(TABS.createVault)}
        >
          {vault ? 'Edit Vault' : 'Create Vault'}
        </button>
      </nav>

      <section className="active-vault card">
        <span className="status-dot" />
        <p>
          {vaultLoading
            ? 'Loading vault...'
            : vault
              ? `Vault: ${vault.vaultName} (${vault.vaultId})`
              : 'No vault created yet. Use Create Vault to initialize your only vault.'}
        </p>
      </section>

      {activeTab === TABS.dashboard && (
        <Dashboard
          vault={vault}
          onVaultUpdated={loadVault}
          onEditVault={() => setActiveTab(TABS.createVault)}
        />
      )}
      {activeTab === TABS.createVault && (
        <CreateVault currentUser={session.user} existingVault={vault} onVaultUpdated={loadVault} />
      )}
    </main>
  )
}

export default App
