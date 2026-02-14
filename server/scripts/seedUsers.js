const fs = require('fs')
const path = require('path')

const { initPostgres } = require('../db/postgres')
const { registerUser } = require('../services/authService')

const SEED_PATH = path.join(__dirname, '..', 'seed', 'users.seed.json')

async function seedUsers() {
  await initPostgres()

  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Seed file not found: ${SEED_PATH}`)
  }

  const seedUsers = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'))

  if (!Array.isArray(seedUsers) || seedUsers.length === 0) {
    throw new Error('Seed file must contain a non-empty array of users')
  }

  let created = 0
  let skipped = 0

  for (const seedUser of seedUsers) {
    try {
      await registerUser({
        name: seedUser.name,
        email: seedUser.email,
        password: seedUser.password,
      })
      created += 1
      console.log(`created: ${seedUser.email}`)
    } catch (error) {
      if (error.message === 'Email already registered') {
        skipped += 1
        console.log(`skipped (exists): ${seedUser.email}`)
      } else {
        throw error
      }
    }
  }

  console.log(`done. created=${created} skipped=${skipped}`)
}

seedUsers().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
