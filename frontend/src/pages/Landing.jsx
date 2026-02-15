function Landing({ onCreateVault }) {
  const scrollToSection = (id) => {
    const section = document.getElementById(id)
    if (!section) return
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="landing-page">
      <article className="card landing-hero">
        <p className="landing-kicker">Your digital legacy, sealed until it matters</p>
        <h1>DEADLOCK</h1>
        <p className="landing-subtitle">
          A cryptographic vault for files, passwords, and memories. No one knows. No one presses.
          No one accesses. Until it is time.
        </p>
        <div className="landing-actions">
          <button type="button" className="btn btn-primary landing-cta" onClick={onCreateVault}>
            Create Your Vault
          </button>
          <button type="button" className="btn btn-ghost landing-ghost" onClick={() => scrollToSection('how-deadlock-works')}>
            How It Works
          </button>
        </div>
      </article>

      <article id="how-deadlock-works" className="card landing-section">
        <div className="landing-section-head">
          <h2>How Deadlock Works</h2>
          <p>Four steps between your secrets and eternity.</p>
        </div>
        <div className="landing-grid">
          <div className="landing-step-card">
            <h3>1. Seal Your Vault</h3>
            <p>Upload files and sensitive data. Content is encrypted before storage.</p>
          </div>
          <div className="landing-step-card">
            <h3>2. Designate Nominees</h3>
            <p>Pick 3 key holders. They are not notified while you are active.</p>
          </div>
          <div className="landing-step-card">
            <h3>3. Check In</h3>
            <p>Tap I&apos;m alive on your own schedule. Miss check-ins and the switch starts.</p>
          </div>
          <div className="landing-step-card">
            <h3>4. The Unlock</h3>
            <p>Only after inactivity do nominees combine their key shares to unlock.</p>
          </div>
        </div>
      </article>

      <article id="built-for-inevitable" className="card landing-section">
        <div className="landing-section-head">
          <h2>Built for the Inevitable</h2>
          <p>Every feature designed around one truth: you will not be here forever.</p>
        </div>
        <div className="landing-grid landing-feature-grid">
          <div className="landing-feature-card">
            <h3>Client-Side Encryption</h3>
            <p>AES-256 before upload. Server never sees plaintext.</p>
          </div>
          <div className="landing-feature-card">
            <h3>Shamir Secret Sharing</h3>
            <p>Master key split into 3 fragments, no single point of failure.</p>
          </div>
          <div className="landing-feature-card landing-feature-highlight">
            <h3>Zero-Knowledge Nominees</h3>
            <p>Nominees do not know they are selected until trigger conditions are met.</p>
          </div>
          <div className="landing-feature-card">
            <h3>Dead Man&apos;s Switch</h3>
            <p>Configurable check-in cadence, grace handling, and hard trigger support.</p>
          </div>
          <div className="landing-feature-card">
            <h3>Multi-Format Vault</h3>
            <p>Encrypted docs, images, videos, credentials, and private artifacts.</p>
          </div>
          <div className="landing-feature-card">
            <h3>Nominee Coordination</h3>
            <p>All 3 nominee shares must be submitted before vault access is granted.</p>
          </div>
        </div>
      </article>
    </section>
  )
}

export default Landing
