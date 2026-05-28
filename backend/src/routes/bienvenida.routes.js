'use strict';
/**
 * Routes de la pantalla de bienvenida (escaneo QR del cliente).
 * Públicas: cliente entra escaneando QR, crea sesión y recibe cookie mm_session.
 *
 * Endpoints:
 *   GET  /api/bienvenida/estado/:mesaId       → ctrl.estadoMesa       (público)
 *   POST /api/bienvenida/crear/:mesaId        → ctrl.crearSesion      (público, setea cookie mm_session)
 *   POST /api/bienvenida/recuperar/:mesaId    → ctrl.recuperarSesion  (público, alias+PIN)
 */
const router = require('express').Router();
const ctrl   = require('../controllers/bienvenida.controller');

// GET /api/bienvenida/estado/:mesaId  — público, sin auth
router.get('/estado/:mesaId', ctrl.estadoMesa);

// POST /api/bienvenida/crear/:mesaId  — crea SesionCliente, setea cookie mm_session
router.post('/crear/:mesaId', ctrl.crearSesion);

// POST /api/bienvenida/recuperar/:mesaId  — recupera sesión con alias+PIN
router.post('/recuperar/:mesaId', ctrl.recuperarSesion);

module.exports = router;
