const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { isS3Enabled, getBucketNameForUser, ensureBucketExists } = require("../utils/s3");

const USE_POSTGRES =
  process.env.USE_POSTGRES === 'true' || Boolean(String(process.env.DATABASE_URL || '').trim())
const USERS_DIR = path.join(__dirname, '..', 'storage', 'users')
const USERS_FILE = path.join(USERS_DIR, 'users.json')
const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d'

function getJwtSecret() {
  return process.env.JWT_SECRET || 'deadlock-dev-secret-change-me'
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function mapUser(row) {
  if (!row) {
    return null
  }

  return {
    userId: row.user_id || row.userId,
    email: row.email,
    name: row.name,
    createdAt: row.created_at || row.createdAt,
  }
}

function ensureUsersFile() {
  fs.mkdirSync(USERS_DIR, { recursive: true })
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2))
  }
}

function readUsers() {
  ensureUsersFile()
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
}

function writeUsers(users) {
  ensureUsersFile()
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
}

async function findUserByEmail(email) {
  if (!USE_POSTGRES) {
    const users = readUsers()
    return users.find((user) => user.email === email) || null
  }

  const { query } = require('../db/postgres')
  const result = await query(
    'SELECT user_id, email, name, password_hash, created_at FROM users WHERE email = $1 LIMIT 1',
    [email]
  )

  return result.rows[0] || null
}

async function registerUser({ email, password, name }) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    throw new Error('Email is required')
  }

  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  const existing = await findUserByEmail(normalizedEmail)
  if (existing) {
    throw new Error('Email already registered')
  }

  const now = new Date().toISOString()
  const userId = randomUUID()
  const resolvedName = String(name || normalizedEmail.split('@')[0] || 'User').trim()
  const passwordHash = await bcrypt.hash(password, 10)

  if (!USE_POSTGRES) {
    const users = readUsers()
    users.push({ userId, email: normalizedEmail, name: resolvedName, passwordHash, createdAt: now, updatedAt: now })
    writeUsers(users)

    console.log("[signup] USE_POSTGRES=", USE_POSTGRES, "S3_ENABLED=", isS3Enabled(), "DB=", process.env.DATABASE_URL);
    // Create a per-user bucket immediately on signup (only if S3 enabled)
    if (isS3Enabled()) {
      const bucketName = getBucketNameForUser(userId);
      await ensureBucketExists(bucketName);
    }

    return { userId, email: normalizedEmail, name: resolvedName, createdAt: now }
  }

  const { query } = require('../db/postgres')
  await query(
    `
      INSERT INTO users (user_id, email, name, password_hash, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
    `,
    [userId, normalizedEmail, resolvedName, passwordHash, now]
  )
  // Create a per-user bucket immediately on signup (only if S3 enabled)
  if (isS3Enabled()) {
    const bucketName = getBucketNameForUser(userId);
    await ensureBucketExists(bucketName);

    await query(
    `UPDATE users SET bucket_name = $2, updated_at = now() WHERE user_id = $1`,
    [userId, bucketName]
    )
  }

  return { userId, email: normalizedEmail, name: resolvedName, createdAt: now }
}

async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required')
  }

  const user = await findUserByEmail(normalizedEmail)
  if (!user) {
    throw new Error('Invalid credentials')
  }

  const passwordHash = user.password_hash || user.passwordHash
  const isValid = await bcrypt.compare(password, passwordHash)
  if (!isValid) {
    throw new Error('Invalid credentials')
  }

  const mappedUser = mapUser(user)
  const token = jwt.sign(
    {
      userId: mappedUser.userId,
      email: mappedUser.email,
      name: mappedUser.name,
    },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL }
  )

  return {
    token,
    user: mappedUser,
  }
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret())
}

module.exports = {
  registerUser,
  loginUser,
  verifyToken,
}
