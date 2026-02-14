const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { query } = require('../db/postgres');

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d';

function getJwtSecret() {
  return process.env.JWT_SECRET || 'deadlock-dev-secret-change-me';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}

async function findUserByEmail(email) {
  const result = await query(
    'SELECT user_id, email, name, password_hash, created_at FROM users WHERE email = $1 LIMIT 1',
    [email]
  );

  return result.rows[0] || null;
}

async function registerUser({ email, password, name }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Email is required');
  }

  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error('Email already registered');
  }

  const now = new Date().toISOString();
  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);

  await query(
    `
      INSERT INTO users (user_id, email, name, password_hash, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
    `,
    [
      userId,
      normalizedEmail,
      String(name || normalizedEmail.split('@')[0] || 'User').trim(),
      passwordHash,
      now,
    ]
  );

  return {
    userId,
    email: normalizedEmail,
    name: String(name || normalizedEmail.split('@')[0] || 'User').trim(),
    createdAt: now,
  };
}

async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required');
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    throw new Error('Invalid credentials');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  const token = jwt.sign(
    {
      userId: user.user_id,
      email: user.email,
      name: user.name,
    },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL }
  );

  return {
    token,
    user: mapUser(user),
  };
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

module.exports = {
  registerUser,
  loginUser,
  verifyToken,
};
