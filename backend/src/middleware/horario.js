'use strict';

/**
 * Middleware de gating por horario de atención.
 * Si Configuracion.horarios_activos === 'true' y la hora actual cae fuera
 * de los rangos definidos en HorarioAtencion, responde 503 con el próximo
 * horario disponible. La config se cachea en memoria 30 s para evitar
 * pegarle a la DB en cada request del cliente.
 * Se aplica en las rutas de cliente; el staff salta este middleware.
 */
const { enHorario, proximoHorario } = require('../services/horarios');

// Cache en memoria de la configuración + horarios (TTL 30 s).
// Si el gerente edita horarios se debe llamar invalidate() para refrescar.
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 30 * 1000;

/** Limpia el cache para forzar recarga desde DB en la próxima request. */
function invalidate() { _cache = null; _cacheTs = 0; }

async function _getConfig() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
  const { Configuracion, HorarioAtencion } = require('../models');
  const [actCfg, horarios] = await Promise.all([
    Configuracion.findOne({ where: { clave: 'horarios_activos' } }),
    HorarioAtencion.findAll({ where: { activo: true }, order: [['dia_semana', 'ASC'], ['abre', 'ASC']] }),
  ]);
  _cache = { horariosActivos: actCfg?.valor === 'true', horarios };
  _cacheTs = Date.now();
  return _cache;
}

async function horarioMiddleware(req, res, next) {
  try {
    const { horariosActivos, horarios } = await _getConfig();
    if (!horariosActivos) return next();
    const now = new Date();
    if (enHorario(horarios, now)) return next();
    const proximo = proximoHorario(horarios, now);
    return res.status(503).json({ ok: false, error: 'Restaurante cerrado', proximo_horario: proximo });
  } catch (err) { next(err); }
}

horarioMiddleware.invalidate = invalidate;

module.exports = horarioMiddleware;
