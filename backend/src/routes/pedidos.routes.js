/**
 * Routes genéricas de pedidos para staff. Lectura por mesa y acciones simples
 * (entregar, cancelar) compartidas entre meseros y gerentes.
 *
 * Endpoints (auth: JWT Bearer):
 *   GET /api/pedidos              → ctrl.listarPorMesa   [mesero, gerente, admin]   (?mesa_id=&estado=)
 *   PUT /api/pedidos/:id/entregar → ctrl.entregar        [mesero, gerente, admin]
 *   PUT /api/pedidos/:id/cancelar → ctrl.cancelar        [mesero, gerente, admin]
 */
const router    = require('express').Router();
const auth      = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const ctrl      = require('../controllers/pedidos.controller');

router.use(auth);

// GET /api/pedidos?mesa_id=X                 → pedidos activos de la mesa
router.get('/', authorize('mesero', 'gerente', 'admin'), ctrl.listarPorMesa);

// PUT /api/pedidos/:id/entregar              → marcar pedido como entregado
router.put('/:id/entregar', authorize('mesero', 'gerente', 'admin'), ctrl.entregar);

// PUT /api/pedidos/:id/cancelar              → cancelar pedido
router.put('/:id/cancelar', authorize('mesero', 'gerente', 'admin'), ctrl.cancelar);

module.exports = router;
