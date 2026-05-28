/**
 * Routes del menú público. No requieren JWT — los clientes en mesa los
 * consumen libremente, y el panel gerente también los usa para vistas previas.
 *
 * Endpoints:
 *   GET /api/menu                  → ctrl.getMenu          (categorías + productos + grupos/opciones)
 *   GET /api/menu/promociones      → ctrl.getPromociones   (activas con filtro dias_semana)
 */
const router = require('express').Router();
const ctrl   = require('../controllers/menu.controller');

// GET /api/menu            → menú completo (público, lo usan clientes sin JWT)
router.get('/', ctrl.getMenu);

// GET /api/menu/promociones → promociones activas (público)
router.get('/promociones', ctrl.getPromociones);

module.exports = router;
