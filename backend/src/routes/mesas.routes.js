/**
 * Routes de operación de mesas para staff. Requieren JWT + rol
 * mesero|gerente|admin. Lo usa el floor plan y el panel del mesero.
 *
 * Endpoints (auth: JWT Bearer):
 *   GET  /api/mesas                                       → ctrl.listar             [mesero, gerente, admin]
 *   GET  /api/mesas/alertas                               → ctrl.listarAlertas      [mesero, gerente, admin]
 *   GET  /api/mesas/solicitudes                           → ctrl.listarSolicitudes  [mesero, gerente, admin]
 *   GET  /api/mesas/:id                                   → ctrl.detalle            [mesero, gerente, admin]
 *   GET  /api/mesas/:id/pedidos                           → ctrl.getPedidosMesa     [mesero, gerente, admin]
 *   PUT  /api/mesas/:id/cerrar                            → ctrl.cerrar             [mesero, gerente, admin]
 *   POST /api/mesas/sesion/cerrar                         → ctrl.cerrarSesion       [mesero, gerente, admin]
 *   PUT  /api/mesas/:id/alerta/:alertaId/atender          → ctrl.atenderAlerta      [mesero, gerente, admin]
 */
const router    = require('express').Router();
const auth      = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const ctrl      = require('../controllers/mesas.controller');

router.use(auth);

// GET  /api/mesas                            → lista de mesas (mesero, gerente, admin)
router.get('/', authorize('mesero', 'gerente', 'admin'), ctrl.listar);

// GET  /api/mesas/alertas                    → alertas no atendidas de todas las mesas
router.get('/alertas', authorize('mesero', 'gerente', 'admin'), ctrl.listarAlertas);

// GET  /api/mesas/solicitudes                → solicitudes de pago pendientes
router.get('/solicitudes', authorize('mesero', 'gerente', 'admin'), ctrl.listarSolicitudes);

// GET  /api/mesas/:id                        → detalle de una mesa
router.get('/:id', authorize('mesero', 'gerente', 'admin'), ctrl.detalle);

// GET  /api/mesas/:id/pedidos                → pedidos de la sesión activa de la mesa
router.get('/:id/pedidos', authorize('mesero', 'gerente', 'admin'), ctrl.getPedidosMesa);

// PUT  /api/mesas/:id/cerrar                 → cerrar mesa y sus sesiones
router.put('/:id/cerrar', authorize('mesero', 'gerente', 'admin'), ctrl.cerrar);

// POST /api/mesas/sesion/cerrar              → cerrar sesión individual
router.post('/sesion/cerrar', authorize('mesero', 'gerente', 'admin'), ctrl.cerrarSesion);

// PUT  /api/mesas/:id/alerta/:alertaId/atender → marcar alerta como atendida
router.put('/:id/alerta/:alertaId/atender', authorize('mesero', 'gerente', 'admin'), ctrl.atenderAlerta);

module.exports = router;
