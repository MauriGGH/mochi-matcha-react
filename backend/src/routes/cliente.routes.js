/**
 * Routes del cliente (POS-cliente desde móvil). Todas son públicas (sin JWT).
 * La identidad se valida con `token_sesion` (body/query) o con la cookie
 * `mm_session` (middleware mmSession) según el endpoint.
 *
 * Endpoints (auth = público salvo nota):
 *   GET  /api/cliente/mesa/:codigo_qr          → ctrl.verificarMesa
 *   GET  /api/cliente/pedidos                  → ctrl.getPedidos          (?token_sesion=)
 *   POST /api/cliente/recuperar                → ctrl.recuperarSesion     (alias+PIN)
 *   POST /api/cliente/sesion                   → ctrl.crearSesion         (id_mesa+alias)
 *   POST /api/cliente/pedidos                  → ctrl.crearPedido         (token_sesion + items)
 *   POST /api/cliente/calcular-descuentos      → ctrl.calcularDescuentos
 *   POST /api/cliente/alerta                   → ctrl.crearAlerta         (tipo ayuda|cuenta|personalizado)
 *   POST /api/cliente/pago                     → ctrl.solicitarPago
 *   GET  /api/cliente/estado-pedidos           → ctrl.estadoPedidos       (polling)
 *   GET  /api/cliente/estado-sesion            → ctrl.estadoSesion        (polling)
 *   POST /api/cliente/cerrar-sesion            → ctrl.cerrarSesionCliente
 *
 *   Carrito (auth = mmSession cookie):
 *   POST /api/cliente/carrito/agregar          → carritoCtrl.agregar
 *   POST /api/cliente/carrito/actualizar       → carritoCtrl.actualizar
 *   POST /api/cliente/carrito/eliminar         → carritoCtrl.eliminar
 *   POST /api/cliente/carrito/limpiar          → carritoCtrl.limpiar
 *   POST /api/cliente/carrito/confirmar        → carritoCtrl.confirmar
 *   POST /api/cliente/carrito/calcular         → ctrl.calcularDescuentos   (informativo, sin auth)
 *
 *   Pedidos / sesión (auth = mmSession cookie):
 *   GET  /api/cliente/pedidos/estado           → carritoCtrl.estadoPedidos (polling 5s)
 *   POST /api/cliente/pedidos/ayuda            → carritoCtrl.solicitarAyuda
 *   POST /api/cliente/pedidos/cuenta           → carritoCtrl.solicitarCuenta
 *   GET  /api/cliente/sesion/estado            → carritoCtrl.sesionEstado  (polling 5s)
 *   POST /api/cliente/sesion/cerrar            → carritoCtrl.sesionCerrar
 *
 *   PayPal sandbox/live:
 *   GET  /api/cliente/paypal/config            → paypalCtrl.getConfig
 *   POST /api/cliente/paypal/orden             → paypalCtrl.crearOrden     (individual|grupal)
 *   POST /api/cliente/paypal/capturar          → paypalCtrl.capturarOrden
 */
const router    = require('express').Router();
const ctrl      = require('../controllers/cliente.controller');
const validate  = require('../middleware/validate');
const mmSession = require('../middleware/mmSession');
const carritoCtrl = require('../controllers/carrito.controller');

// Todas las rutas del cliente son públicas (sin JWT).
// La identidad del cliente se verifica mediante token_sesion (cookie/body).

// GET  /api/cliente/mesa/:codigo_qr   → verificar que la mesa existe y está libre
router.get('/mesa/:codigo_qr',
  validate({ params: { codigo_qr: 'required|string:1,255' } }),
  ctrl.verificarMesa);

// GET  /api/cliente/pedidos?token_sesion=... → pedidos + estado de sesión
router.get('/pedidos',
  validate({ query: { token_sesion: 'required|string:1,255' } }),
  ctrl.getPedidos);

// POST /api/cliente/recuperar
router.post('/recuperar',
  validate({ body: { codigo_qr: 'required|string:1,255', pin: 'required|string:1,10' } }),
  ctrl.recuperarSesion);

// POST /api/cliente/sesion
router.post('/sesion',
  validate({ body: { id_mesa: 'required|int:1,', alias: 'required|string:1,50' } }),
  ctrl.crearSesion);

// POST /api/cliente/pedidos
router.post('/pedidos',
  validate({ body: { token_sesion: 'required|string:1,255', items: 'required|array:1,100' } }),
  ctrl.crearPedido);

// POST /api/cliente/calcular-descuentos
router.post('/calcular-descuentos',
  validate({ body: { items: 'required|array' } }),
  ctrl.calcularDescuentos);

// POST /api/cliente/alerta
router.post('/alerta',
  validate({ body: { token_sesion: 'required|string:1,255', tipo: 'enum:ayuda,cuenta,personalizado' } }),
  ctrl.crearAlerta);

// POST /api/cliente/pago
router.post('/pago',
  validate({ body: { token_sesion: 'required|string:1,255' } }),
  ctrl.solicitarPago);

// GET  /api/cliente/estado-pedidos
router.get('/estado-pedidos',
  validate({ query: { token_sesion: 'required|string:1,255' } }),
  ctrl.estadoPedidos);

// GET  /api/cliente/estado-sesion
router.get('/estado-sesion',
  validate({ query: { token_sesion: 'required|string:1,255' } }),
  ctrl.estadoSesion);

// POST /api/cliente/cerrar-sesion
router.post('/cerrar-sesion',
  validate({ body: { token_sesion: 'required|string:1,255' } }),
  ctrl.cerrarSesionCliente);

// POST /api/cliente/carrito/* — requieren cookie mm_session
router.post('/carrito/agregar',    mmSession, carritoCtrl.agregar);
router.post('/carrito/actualizar', mmSession, carritoCtrl.actualizar);
router.post('/carrito/eliminar',   mmSession, carritoCtrl.eliminar);
router.post('/carrito/limpiar',    mmSession, carritoCtrl.limpiar);
router.post('/carrito/confirmar',  mmSession, carritoCtrl.confirmar);

// GET /api/cliente/pedidos/estado — polling cada 5s, auth via mm_session cookie
router.get('/pedidos/estado', mmSession, carritoCtrl.estadoPedidos);

// POST /api/cliente/pedidos/ayuda  — llama al mesero
// POST /api/cliente/pedidos/cuenta — solicitar cuenta (individual/grupal)
router.post('/pedidos/ayuda',  mmSession, carritoCtrl.solicitarAyuda);
router.post('/pedidos/cuenta', mmSession, carritoCtrl.solicitarCuenta);

// GET  /api/cliente/sesion/estado — polling 5s para detectar pagada
// POST /api/cliente/sesion/cerrar — cierre voluntario tras pago
router.get('/sesion/estado',  mmSession, carritoCtrl.sesionEstado);
router.post('/sesion/cerrar', mmSession, carritoCtrl.sesionCerrar);

// POST /api/cliente/carrito/calcular — informativo, items en el body, sin auth
router.post('/carrito/calcular',
  validate({ body: { items: 'required|array' } }),
  ctrl.calcularDescuentos);

// ─── PayPal sandbox ──────────────────────────────────────────────────────────
const paypalCtrl = require('../controllers/paypal.controller');
router.get('/paypal/config', paypalCtrl.getConfig);
router.post('/paypal/orden',
  validate({ body: { token_sesion: 'required|string:1,255', tipo: 'enum:individual,grupal' } }),
  paypalCtrl.crearOrden);
router.post('/paypal/capturar',
  validate({ body: { token_sesion: 'required|string:1,255', order_id: 'required|string:1,255' } }),
  paypalCtrl.capturarOrden);

module.exports = router;
