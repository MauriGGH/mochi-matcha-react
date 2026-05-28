/**
 * Routes de autenticación de personal (staff): mesero, cocina, gerente, admin.
 * Emite JWT (Bearer) en /login; /me devuelve el payload del JWT vigente.
 *
 * Endpoints:
 *   POST /api/auth/login        → ctrl.login    (público)
 *   GET  /api/auth/me           → ctrl.me       (auth middleware)
 */
const router = require('express').Router();
const auth   = require('../middleware/auth');
const { ipRateLimit } = require('../middleware/rateLimit');
const ctrl   = require('../controllers/auth.controller');

// POST /api/auth/login   → recibe { usuario, password }, devuelve { token, empleado }
// Rate limit por IP: máx. 10 intentos cada 5 min para mitigar fuerza bruta.
router.post('/login', ipRateLimit({ limit: 10, windowMs: 5 * 60_000, prefix: 'login' }), ctrl.login);

// GET  /api/auth/me      → devuelve el payload del JWT del usuario autenticado
router.get('/me', auth, ctrl.me);

module.exports = router;
