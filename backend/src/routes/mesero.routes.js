/**
 * Routes del panel de mesero: cobros, ticket, pedido asistido, mapa de mesas,
 * gestión de sesiones, edición/cancelación de pedidos, integración PayPal.
 * Todas requieren JWT + rol mesero|gerente|admin.
 *
 * Endpoints (auth: JWT Bearer; todas [mesero, gerente, admin] salvo nota):
 *   Pago:
 *     POST /api/mesero/pago                       → ctrl.procesarPago        (legacy)
 *     POST /api/mesero/pago/procesar              → ctrl.procesarPago        (efectivo/tarjeta/mixto)
 *     GET  /api/mesero/pago/total                 → ctrl.totalCobroLive      (?mesa=)
 *     GET  /api/mesero/total-cobro                → ctrl.totalCobro          (?mesa=&sesion=)
 *
 *   Ticket:
 *     GET  /api/mesero/ticket                     → ctrl.getTicket           (?mesa_id=)
 *     GET  /api/mesero/ticket/:sol_id             → ctrl.getTicket
 *
 *   Cuenta:
 *     POST /api/mesero/solicitar-cuenta           → ctrl.solicitarCuentaMesero
 *
 *   Pedido asistido:
 *     POST /api/mesero/asistido/confirmar         → ctrl.confirmarPedidoAsistido  (precios desde BD)
 *     POST /api/mesero/asistido                   → ctrl.pedidoAsistido           (legacy, subtotal en body)
 *     POST /api/mesero/sesion-asistida            → ctrl.agregarSesionAsistida
 *     POST /api/mesero/sesion/agregar             → ctrl.agregarSesionAsistida    (alias)
 *
 *   Sesión / Mesa:
 *     POST /api/mesero/cerrar-sesion              → ctrl.cerrarSesion
 *     POST /api/mesero/sesion/cerrar              → ctrl.cerrarSesion             (alias)
 *     POST /api/mesero/mesa/cerrar                → ctrl.cerrarMesa
 *
 *   Pedidos:
 *     POST /api/mesero/pedidos/entregar           → ctrl.entregaPedido
 *     GET  /api/mesero/pedidos/:pedido_id/editar  → ctrl.editarPedidoMesero       (lectura, solo recibido)
 *     PUT  /api/mesero/pedidos/:pedido_id/editar  → ctrl.editarPedidoMesero
 *     POST /api/mesero/pedidos/:pedido_id/editar  → ctrl.editarPedidoMesero
 *     POST /api/mesero/pedidos/cancelar           → ctrl.cancelarPedidoMesero     (motivo requerido)
 *     POST /api/mesero/cancelar-pedido            → ctrl.cancelarPedidoMesero     (alias)
 *     POST /api/mesero/cancelar-solicitud         → ctrl.cancelarSolicitudPago
 *
 *   Mapa / detalle:
 *     GET  /api/mesero/mapa/estado                → ctrl.mesasEstado              (polling 3s)
 *     GET  /api/mesero/pedidos-listos             → ctrl.pedidosListos            (polling 3s, fix#1)
 *     GET  /api/mesero/mapa/:mesaId               → ctrl.mesaDetalle              (panel lateral)
 *     GET  /api/mesero/productos/json             → ctrl.catalogoProductos        (modal asistido)
 *
 *   PayPal:
 *     POST /api/mesero/paypal/crear-orden         → paypalCtrl.crearOrdenMesero
 *     POST /api/mesero/paypal/capturar            → paypalCtrl.capturarOrdenMesero
 */
const router    = require('express').Router();
const auth      = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const ctrl      = require('../controllers/mesero.controller');
const validate  = require('../middleware/validate');

router.use(auth);

// Pago (legacy y nueva ruta /pago/procesar apuntan al mismo handler)
router.post('/pago',
  validate({ body: { mesa_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.procesarPago);
router.post('/pago/procesar',
  validate({ body: { mesa_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.procesarPago);

// Total en vivo desde BD
router.get('/pago/total',
  validate({ query: { mesa: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.totalCobroLive);

// Ticket
router.get('/ticket',         authorize('mesero', 'gerente', 'admin'), ctrl.getTicket);
router.get('/ticket/:sol_id', authorize('mesero', 'gerente', 'admin'), ctrl.getTicket);

// Solicitud de cuenta (el mesero la crea manualmente)
router.post('/solicitar-cuenta',
  validate({ body: { mesa_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.solicitarCuentaMesero);

// Total cobro en vivo
router.get('/total-cobro',
  validate({ query: { mesa: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.totalCobro);

// Pedido asistido — confirmar (precios calculados en BD)
router.post('/asistido/confirmar',
  validate({ body: { sesion_id: 'required|int:1,', items: 'required|array:1,100' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.confirmarPedidoAsistido);

// Pedido asistido (legacy — espera subtotales ya calculados en el body)
router.post('/asistido',
  validate({ body: { sesion_id: 'required|int:1,', items: 'required|array:1,100' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.pedidoAsistido);

// Agregar sesión asistida (sin QR)
router.post('/sesion-asistida',
  validate({ body: { mesa_id: 'required|int:1,', alias: 'required|string:1,50' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.agregarSesionAsistida);

// Cerrar sesión individual
router.post('/cerrar-sesion',
  validate({ body: { sesion_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.cerrarSesion);
router.post('/sesion/cerrar',
  validate({ body: { sesion_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.cerrarSesion);

// Cerrar mesa (todas las sesiones)
router.post('/mesa/cerrar',
  validate({ body: { mesa_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.cerrarMesa);

// Agregar sesión asistida
router.post('/sesion/agregar',
  validate({ body: { mesa_id: 'required|int:1,', alias: 'required|string:1,50' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.agregarSesionAsistida);

// Entregar pedido
router.post('/pedidos/entregar',
  validate({ body: { pedido_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.entregaPedido);

// Editar pedido (solo estado recibido)
router.get('/pedidos/:pedido_id/editar',  authorize('mesero', 'gerente', 'admin'), ctrl.editarPedidoMesero);
router.put('/pedidos/:pedido_id/editar',  authorize('mesero', 'gerente', 'admin'), ctrl.editarPedidoMesero);
router.post('/pedidos/:pedido_id/editar', authorize('mesero', 'gerente', 'admin'), ctrl.editarPedidoMesero);

// Cancelar pedido
router.post('/pedidos/cancelar',
  validate({ body: { pedido_id: 'required|int:1,', motivo: 'required|string:1,500' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.cancelarPedidoMesero);
router.post('/cancelar-pedido',
  validate({ body: { pedido_id: 'required|int:1,', motivo: 'required|string:1,500' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.cancelarPedidoMesero);

// Cancelar solicitud de pago
router.post('/cancelar-solicitud',
  validate({ body: { solicitud_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), ctrl.cancelarSolicitudPago);

// Mapa de estado de mesas — polling 3s
router.get('/mapa/estado', authorize('mesero', 'gerente', 'admin'), ctrl.mesasEstado);

// Pedidos listos para entregar (rol mesero) — polling 3s (fix#1 Bug A)
router.get('/pedidos-listos', authorize('mesero', 'gerente', 'admin'), ctrl.pedidosListos);

// Detalle completo de mesa (panel lateral)
router.get('/mapa/:mesaId', authorize('mesero', 'gerente', 'admin'), ctrl.mesaDetalle);

// Catálogo de productos (modal pedido asistido)
router.get('/productos/json', authorize('mesero', 'gerente', 'admin'), ctrl.catalogoProductos);

// ─── PayPal (mesero) ──────────────────────────────────────────────────────
const paypalCtrl = require('../controllers/paypal.controller');
router.post('/paypal/crear-orden',
  validate({ body: { mesa_id: 'required|int:1,' } }),
  authorize('mesero', 'gerente', 'admin'), paypalCtrl.crearOrdenMesero);
router.post('/paypal/capturar',
  validate({ body: { mesa_id: 'required|int:1,', order_id: 'required|string:1,255' } }),
  authorize('mesero', 'gerente', 'admin'), paypalCtrl.capturarOrdenMesero);

module.exports = router;
