'use strict';

/**
 * Middleware de modo mantenimiento.
 * Si Configuracion.modo_mantenimiento === 'true', responde 503 con el
 * mensaje configurado. Excepción: si la request lleva un JWT válido de
 * staff con rol gerente/admin se permite el acceso (bypass para mantener
 * operaciones administrativas activas). El estado se cachea 30 s.
 */
const jwt = require('jsonwebtoken');

let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 30 * 1000;

function invalidate() { _cache = null; _cacheTs = 0; }

async function _getConfig() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
  const { Configuracion } = require('../models');
  const [modo, msg] = await Promise.all([
    Configuracion.findOne({ where: { clave: 'modo_mantenimiento' } }),
    Configuracion.findOne({ where: { clave: 'mensaje_mantenimiento' } }),
  ]);
  _cache = {
    activo: modo?.valor === 'true',
    mensaje: msg?.valor || 'Sistema en mantenimiento. Intente más tarde.',
  };
  _cacheTs = Date.now();
  return _cache;
}

async function mantenimientoMiddleware(req, res, next) {
  try {
    const cfg = await _getConfig();
    if (!cfg.activo) return next();
    // Staff (gerente/admin) bypass
    const header = req.headers['authorization'];
    if (header?.startsWith('Bearer ')) {
      try {
        const user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
        if (['gerente', 'admin'].includes(user.rol)) return next();
      } catch (_) { /* invalid token — treat as non-staff */ }
    }
    return res.status(503).json({ ok: false, error: 'Sistema en mantenimiento', mensaje: cfg.mensaje });
  } catch (err) { next(err); }
}

mantenimientoMiddleware.invalidate = invalidate;

module.exports = mantenimientoMiddleware;
