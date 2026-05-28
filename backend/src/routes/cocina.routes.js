/**
 * Routes del KDS (Kitchen Display System). Todas requieren JWT (auth) y rol
 * autorizado. La separación cocina/bar se hace en el controller filtrando
 * por Categoria.area.
 *
 * Endpoints (auth: JWT Bearer):
 *   GET  /api/cocina/pedidos                   → ctrl.getPedidos             [cocina, gerente, admin]
 *   GET  /api/cocina/pedidos-json              → ctrl.pedidosJson            [cocina, gerente, admin] (polling 3s)
 *   POST /api/cocina/marcar-detalle-listo      → ctrl.marcarDetalleListo     [cocina, gerente, admin]
 *   POST /api/cocina/marcar-detalle-no-listo   → ctrl.marcarDetalleNoListo   [cocina, gerente, admin]
 *   POST /api/cocina/marcar-listo              → ctrl.marcarListo            [cocina, gerente, admin] (legacy)
 *   POST /api/cocina/marcar-entregado          → ctrl.marcarEntregado        [mesero, cocina, gerente, admin]
 */
const router    = require('express').Router();
const auth      = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const ctrl      = require('../controllers/cocina.controller');

router.use(auth);

// GET /api/cocina/pedidos?area=cocina|bar    → pedidos filtrados por área (formato interno)
router.get('/pedidos', authorize('cocina', 'gerente', 'admin'), ctrl.getPedidos);

// GET /api/cocina/pedidos-json?area=cocina|bar → KDS polling, contrato público
router.get('/pedidos-json', authorize('cocina', 'gerente', 'admin'), ctrl.pedidosJson);

// POST /api/cocina/marcar-detalle-listo     → { detalle_id }
router.post('/marcar-detalle-listo',    authorize('cocina', 'gerente', 'admin'), ctrl.marcarDetalleListo);
router.post('/marcar-detalle-no-listo', authorize('cocina', 'gerente', 'admin'), ctrl.marcarDetalleNoListo);

// POST /api/cocina/marcar-listo             → { pedido_id } legacy: avanza estado completo
router.post('/marcar-listo',     authorize('cocina', 'gerente', 'admin'), ctrl.marcarListo);

// POST /api/cocina/marcar-entregado         → { pedido_id }
router.post('/marcar-entregado', authorize('mesero', 'cocina', 'gerente', 'admin'), ctrl.marcarEntregado);

module.exports = router;
