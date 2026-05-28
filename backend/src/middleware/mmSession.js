'use strict';

/**
 * Middleware de autenticación del cliente final (no staff).
 * Lee la cookie `mm_session` (token UUID emitido al escanear el QR de la
 * mesa) y busca la SesionCliente correspondiente. Adjunta:
 *   - req.sesionCliente: instancia Sequelize de SesionCliente
 *   - req.mmToken: el token plano por si se requiere reemitir la cookie
 * Responde 401 si no hay cookie o no encuentra sesión.
 */
const cookie = require('cookie');
const { SesionCliente } = require('../models');

// Autentica al cliente leyendo la cookie mm_session.
// Adjunta req.sesionCliente y req.mmToken al request.
module.exports = async (req, res, next) => {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies.mm_session;
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Sesión requerida' });
    }

    const sesion = await SesionCliente.findOne({ where: { token_cookie: token } });
    if (!sesion) {
      return res.status(401).json({ ok: false, error: 'Sesión inválida' });
    }

    req.sesionCliente = sesion;
    req.mmToken = token;
    next();
  } catch (err) { next(err); }
};
