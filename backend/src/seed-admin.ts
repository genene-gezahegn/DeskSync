
import 'dotenv/config';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

async function seedAdmin() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from .env');
  }

  const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

db.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]', err.message);
});

  try {const email = 'admin@desksync.local';
const password = 'ChangeMe123!';
const hash = await bcrypt.hash(password, 12);

    await db.query(
      `INSERT INTO users (
        full_name,
        email,
        password_hash,
        role,
        is_active,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (email)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        is_active = TRUE`,
      [
        'DeskSync Administrator',
        email,
        hash,
        'ADMIN',
        true,
      ],
    );

    console.log('================================');
    console.log('ADMIN ACCOUNT READY');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('Role: ADMIN');
    console.log('================================');
  } finally {
    await db.end();
  }
}

seedAdmin().catch((error) => {
  console.error('Admin seeding failed:', error);
  process.exit(1);
});

