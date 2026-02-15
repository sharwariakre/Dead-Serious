import { useState } from 'react'
import { apiClient } from '../api/client'

function Login({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isLogin = mode === 'login'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const cleanEmail = email.trim().toLowerCase()
      const cleanName = name.trim()
      const cleanPassword = password.trim()
      const response = isLogin
        ? await apiClient.login({ email: cleanEmail, password: cleanPassword })
        : await apiClient.register({ name: cleanName, email: cleanEmail, password: cleanPassword })

      onAuthenticated?.({ token: response.token, user: response.user })
    } catch (authError) {
      setError(authError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page card auth-card">
      <div className="page-header">
        <h2>{isLogin ? 'Login' : 'Create Account'}</h2>
        <p>Sign in to access your encrypted DEAD SERIOUS vault workspace.</p>
      </div>

      <form className="vault-form" onSubmit={handleSubmit}>
        {!isLogin && (
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Doe" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Minimum 8 characters"
            required
          />
        </label>

        {error && <p className="message error">{error}</p>}

        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Please wait...' : isLogin ? 'Login' : 'Create Account'}
        </button>
      </form>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setMode(isLogin ? 'register' : 'login')}
      >
        {isLogin ? 'Need an account? Register' : 'Already have an account? Login'}
      </button>
    </section>
  )
}

export default Login
