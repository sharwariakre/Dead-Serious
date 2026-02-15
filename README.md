# Dead Serious
### A Cryptographic Dead Man's Vault

> A zero-knowledge digital vault that unlocks secrets **only if the owner fails to check in**, and **only with unanimous nominee approval**.

---

## 🚀 Overview

**Dead Serious** is a secure, cryptographically enforced inheritance vault built for HackNC 2026 under *The Agency* (cybersecurity & privacy) track.

It allows users to store sensitive digital secrets that:

- 🔐 Are encrypted **client-side**
- ⏳ Unlock only after missed check-ins
- 👥 Require **multi-party consensus (3-of-3)**
- 🧩 Cannot be decrypted by the server
- 📬 Keep nominees secret until activation

Unlike traditional password managers, nominees do **not** know they are nominees until the unlock phase begins.

---

## 🎯 Problem

Modern digital assets include crypto wallet seed phrases, password managers, confidential documents, business continuity plans, and personal final messages — yet there is no widely accessible system that provides:

- Zero-knowledge encryption
- Time-locked activation
- Distributed trust via key splitting
- Silent nomination

**Dead Serious addresses this gap.**

---

## 🔐 How It Works

### 1️⃣ Vault Creation

- User uploads secret files
- Browser generates a **256-bit AES key**
- Secret is encrypted using **AES-256-GCM**
- Master key is split into 3 shares using **Shamir's Secret Sharing**
- Encrypted vault + encrypted shares stored
- Check-in interval set

### 2️⃣ Dead Man's Switch

- User must click **"I'm Alive"** to stay active
- TTL refreshes on each check-in
- If TTL expires → system assumes inactivity

### 3️⃣ Unlock Process

When TTL expires:

1. Nominees are notified
2. Each nominee submits their key fragment
3. Shares are combined **client-side**
4. Master key reconstructed
5. Vault decrypted locally

> The server never sees plaintext or reconstructed keys.

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Vite), React Router, TailwindCSS |
| Cryptography | Web Crypto API (AES-256-GCM), secrets.js-grempe |
| Backend | Node.js, Express |
| Datastore | PostgreSQL, Amazon S3 |

---

## 🗂️ Project Structure

```
Dead-Serious/
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── CreateVault.jsx
│       │   ├── Dashboard.jsx
│       │   └── NomineeUnlock.jsx
│       ├── components/
│       │   ├── VaultForm.jsx
│       │   ├── CheckInCard.jsx
│       │   └── ApprovalStatus.jsx
│       ├── crypto/
│       │   ├── encrypt.js
│       │   ├── decrypt.js
│       │   └── shamir.js
│       ├── api/
│       │   └── client.js
│       ├── App.jsx
│       └── main.jsx
│
├── server/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   └── server.js
│
└── README.md
```

---


## 🚀 Running the Project

### Prerequisites

- Node.js v18+


### Backend

```bash
cd server
npm install
npm start
```

Create a `.env` file in `server/`:

```env
PORT=3000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

> If you run into Node version issues, install: `npm install -D vite@5 @vitejs/plugin-react@4`

---

## 🧪 Demo Flow

1. Create vault with a short TTL for demo purposes
2. Show encrypted vault stored in Valkey
3. Allow TTL to expire
4. Nominees each submit approval
5. Shares combined client-side
6. Vault decrypted in the browser

> *"Not even we can decrypt this vault — only mathematics can."*

---

## 🛡️ Security Design

Dead Serious protects against:

| Threat | Mitigation |
|--------|-----------|
| Server compromise | No plaintext ever stored server-side |
| Single-party misuse | Requires unanimous 3-of-3 approval |
| Early access | Time-lock via TTL |
| Insider threats | Zero-knowledge architecture |
| Replay token misuse | Single-use invite tokens |

### Out of MVP Scope

- Legal death verification
- Identity verification for nominees
- File upload scaling
- Multi-device recovery

---

## 🌍 Future Improvements

- [ ] Flexible threshold schemes (2-of-3, 3-of-5)
- [ ] Secure file upload support
- [ ] On-chain notarization
- [ ] Hardware key integration
- [ ] Executor roles
- [ ] Multi-factor nominee authentication

---

## 👥 Team

| Name |
|------|
| Sharwari Akre |
| Divya Kannan | 
| Dhruva Kamble | 
| Soham Deshpande |

---

## 🏆 Track Alignment — The Agency

Dead Serious directly addresses the cybersecurity & privacy track through:

- **Data privacy** — client-side encryption only
- **Zero-knowledge architecture** — server holds no usable secrets
- **Distributed trust** — Shamir's Secret Sharing prevents single-party control
- **Cryptographic enforcement** — mathematics, not policy, enforces access

---

## 📜 License

Hackathon project — NC State HackNC 2026
