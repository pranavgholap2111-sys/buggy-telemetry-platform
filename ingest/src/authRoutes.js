/**
 * authRoutes.js — authentication and user management endpoints
 * 
 * Routes:
 *   POST /api/auth/login     — login with email/password, returns JWT
 *   GET  /api/auth/me        — get current user info
 *   GET  /api/users          — list all users (engineer only)
 *   POST /api/users          — create user (engineer only)
 *   DELETE /api/users/:id    — delete user (engineer only)
 */

const express = require('express');
const router = express.Router();
const { pool } = require('./db');
const { hashPassword, comparePassword, createToken, requireAuth, requireRole } = require('./auth');

// ─────────────────────────────────────────────────────────────
// POST /api/auth/login
// Login with email and password, returns JWT token
// ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Find user by email
    const result = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Create JWT token
    const token = createToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me
// Get current user info (requires authentication)
// ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[auth] Me error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/users
// List all users (engineer only)
// ─────────────────────────────────────────────────────────────
router.get('/users', requireRole('engineer'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[auth] List users error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/users
// Create a new user (engineer only)
// ─────────────────────────────────────────────────────────────
router.post('/users', requireRole('engineer'), async (req, res) => {
  try {
    const { email, password, role } = req.body;
    
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role required' });
    }
    
    // Validate role
    const validRoles = ['viewer', 'team', 'engineer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    
    // Hash password
    const passwordHash = await hashPassword(password);
    
    // Insert user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, role, created_at`,
      [email, passwordHash, role]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[auth] Create user error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/users/:id
// Delete a user (engineer only)
// ─────────────────────────────────────────────────────────────
router.delete('/users/:id', requireRole('engineer'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    // Prevent deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted', id: userId });
  } catch (err) {
    console.error('[auth] Delete user error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
