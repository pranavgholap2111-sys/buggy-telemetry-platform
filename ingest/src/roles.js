/**
 * roles.js — role-permission map
 * 
 * Defines which roles can access which routes.
 * This is the single source of truth for permissions.
 * 
 * Roles (from contract section 5.6):
 *   - viewer:   read-only live view and trip records
 *   - team:     viewer + analytics, trip story, geofence deploy
 *   - engineer: everything, including users and re-running analysis
 * 
 * In Stage 3 this file is not yet used (no auth middleware).
 * Stage 7 will import this and enforce permissions on every route.
 */

const ROLES = {
  viewer: 1,
  team: 2,
  engineer: 3,
};

// Route → minimum role required
const PERMISSIONS = {
  // Public (no auth required)
  'GET /api/health': null,
  'POST /api/auth/login': null,

  // Viewer and above
  'GET /api/me': ROLES.viewer,
  'GET /api/live/latest': ROLES.viewer,
  'GET /api/trips': ROLES.viewer,
  'GET /api/trips/:id': ROLES.viewer,
  'GET /api/trips/:id/stream': ROLES.viewer,

  // Team and above
  'GET /api/trips/:id/summary': ROLES.team,
  'POST /api/geofence': ROLES.team,
  'DELETE /api/geofence': ROLES.team,
  'GET /api/geofence/history': ROLES.team,
  
  // Viewer and above (geofence current is read-only)
  'GET /api/geofence/current': ROLES.viewer,

  // Engineer only
  'POST /api/trips/:id/reanalyze': ROLES.engineer,
  'DELETE /api/trips/:id': ROLES.engineer,
  'GET /api/users': ROLES.engineer,
  'POST /api/users': ROLES.engineer,
  'DELETE /api/users/:id': ROLES.engineer,
};

/**
 * Check if a role has permission for a route.
 * Returns true if allowed, false if denied.
 * 
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - route path (e.g., '/api/trips/123')
 * @param {string} role - user role ('viewer', 'team', 'engineer')
 * @returns {boolean}
 */
function hasPermission(method, path, role) {
  // Normalize path: replace numeric IDs with :id placeholder
  const normalizedPath = path.replace(/\/\d+/g, '/:id');
  const key = `${method} ${normalizedPath}`;
  
  const requiredRole = PERMISSIONS[key];
  
  // Public route
  if (requiredRole === null) return true;
  
  // Unknown route — deny by default
  if (requiredRole === undefined) return false;
  
  // Check role level
  const userRoleLevel = ROLES[role] || 0;
  return userRoleLevel >= requiredRole;
}

module.exports = {
  ROLES,
  PERMISSIONS,
  hasPermission,
};
