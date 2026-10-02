/**
 * auth.js — authentication middleware and helpers
 * 
 * Handles:
 *   - Password hashing (bcrypt)
 *   - JWT token creation and verification
 *   - Role-based access control middleware
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { ROLES, hasPermission } = require('./roles');

// ─────────────────────────────────────────────────────────────
// Password hashing
// ─────────────────────────────────────────────────────────────

/**
 * Hash a password using bcrypt
 * @param {string} password - plain text password
 * @returns {Promise<string>} hashed password
 */
async function hashPassword(password) {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Compare a plain password with a hash
 * @param {string} password - plain text password
 * @param {string} hash - bcrypt hash from database
 * @returns {Promise<boolean>} true if match
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ─────────────────────────────────────────────────────────────
// JWT tokens
// ─────────────────────────────────────────────────────────────

/**
 * Create a JWT token for a user
 * @param {object} user - { id, email, role }
 * @returns {string} JWT token
 */
function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiry }
  );
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token string
 * @returns {object|null} decoded payload or null if invalid
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Express middleware
// ─────────────────────────────────────────────────────────────

/**
 * Middleware: extract user from JWT token in Authorization header
 * Sets req.user = { id, email, role } if valid token
 * Does NOT reject — just sets user to null if no token
 */
function extractUser(req, res, next) {
  req.user = null;
  
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  
  next();
}

/**
 * Middleware factory: require a minimum role
 * Usage: router.get('/path', requireRole('team'), handler)
 * 
 * @param {string} minRole - minimum role ('viewer', 'team', 'engineer')
 * @returns {function} Express middleware
 */
function requireRole(minRole) {
  return (req, res, next) => {
    // No user = not logged in
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Check role level
    const userLevel = ROLES[req.user.role] || 0;
    const requiredLevel = ROLES[minRole] || 0;
    
    if (userLevel < requiredLevel) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: minRole,
        have: req.user.role 
      });
    }
    
    next();
  };
}

/**
 * Middleware: require authentication (any role)
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = {
  hashPassword,
  comparePassword,
  createToken,
  verifyToken,
  extractUser,
  requireRole,
  requireAuth,
};
