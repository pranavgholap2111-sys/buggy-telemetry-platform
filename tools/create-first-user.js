#!/usr/bin/env node
/**
 * create-first-user.js — creates the first engineer account
 * 
 * Run this ONCE after setting up the database:
 *   node tools/create-first-user.js
 * 
 * It will prompt for email and password, then create an engineer user.
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const readline = require('readline');
require('dotenv').config({ path: require('path').join(__dirname, '..', 'ingest', '.env') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Create First Engineer Account');
  console.log('═══════════════════════════════════════════════════\n');

  const email = await ask('Email: ');
  const password = await ask('Password: ');

  if (!email || !password) {
    console.error('\n✗ Email and password are required');
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('\n✗ Password must be at least 6 characters');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.DB_USER || 'buggy',
    password: process.env.DB_PASSWORD || 'buggy_dev_pw',
    database: process.env.DB_NAME || 'buggy_telemetry',
  });

  try {
    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.error(`\n✗ User with email "${email}" already exists`);
      process.exit(1);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role) 
       VALUES ($1, $2, 'engineer') 
       RETURNING id, email, role`,
      [email, passwordHash]
    );

    console.log('\n✓ Engineer account created successfully!');
    console.log(`  ID: ${result.rows[0].id}`);
    console.log(`  Email: ${result.rows[0].email}`);
    console.log(`  Role: ${result.rows[0].role}`);
    console.log('\nYou can now log in at http://localhost:3000/login');

  } catch (err) {
    console.error('\n✗ Error creating user:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    rl.close();
  }
}

main();
