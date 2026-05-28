'use strict';

/**
 * Rate limiting en memoria por sesión de cliente.
 * Aplica a las acciones críticas del cliente (confirmar pedido, solicitar
 * ayuda/cuenta) para mitigar spam y clicks accidentales repetidos.
 * Mapa interno: clave → array de timestamps (ms). Cada chequeo purga los
 * timestamps fuera de la ventana antes de evaluar el límite.
 *
 * NOTA OPS: el almacenamiento es por proceso. En despliegues multi-instancia
 * el límite efectivo es N × LIMIT (uno por cada réplica) — migrar a Redis
 * cuando se escale horizontalmente.
 */

// Rate limit en memoria. En prod multi-instancia → migrar a Redis.
// Mapa: sesionId → array de timestamps (ms). Se purga al consultar.

const LIMIT_DEFAULT = 5;
const WINDOW_DEFAULT_MS = 60_000;

const _stamps = new Map();
exports._stamps = _stamps; // expuesto para tests

/**
 * Verifica/registra un intento de confirmar pedido para sesionId.
 * @returns {null|{retryAfter:number}} null si OK, objeto con seg. de retry si bloqueado.
 */
function checkConfirmarPedido(sesionId, { limit = LIMIT_DEFAULT, windowMs = WINDOW_DEFAULT_MS } = {}) {
  const now = Date.now();
  const list = (_stamps.get(sesionId) || []).filter((t) => now - t < windowMs);

  if (list.length >= limit) {
    _stamps.set(sesionId, list);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000));
    return { retryAfter };
  }

  list.push(now);
  _stamps.set(sesionId, list);
  return null;
}

exports.checkConfirmarPedido = checkConfirmarPedido;

/**
 * Núcleo del rate limit por ventana deslizante.
 * @param {string} key clave de agrupación (ej. `ayuda:42`)
 * @param {number} limit máximo de eventos permitidos
 * @param {number} windowMs tamaño de la ventana en ms
 * @returns {null|{retryAfter:number}} null si pasa; objeto con segundos
 *   restantes si está bloqueado.
 */
function _consumeWindow(key, limit, windowMs) {
  const now = Date.now();
  const list = (_stamps.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    _stamps.set(key, list);
    return { retryAfter: Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000)) };
  }
  list.push(now);
  _stamps.set(key, list);
  return null;
}

/**
 * Limita una sesión a 1 alerta de ayuda cada 30 s y un máximo de 3 alertas
 * vivas (no atendidas) simultáneas.
 * @param {number} sesionId
 * @param {number} alertasVivas conteo actual de alertas sin atender
 * @returns {null|{retryAfter:number}}
 */
function checkSolicitarAyuda(sesionId, alertasVivas) {
  if (alertasVivas >= 3) return { retryAfter: 30 };
  return _consumeWindow(`ayuda:${sesionId}`, 1, 30_000);
}
exports.checkSolicitarAyuda = checkSolicitarAyuda;

/**
 * Limita una sesión a 1 solicitud de cuenta cada 30 s.
 * @param {number} sesionId
 * @returns {null|{retryAfter:number}}
 */
function checkSolicitarCuenta(sesionId) {
  return _consumeWindow(`cuenta:${sesionId}`, 1, 30_000);
}
exports.checkSolicitarCuenta = checkSolicitarCuenta;

/**
 * Factory de middleware Express para limitar intentos por IP. Pensado para
 * endpoints públicos sensibles (ej. /auth/login) y mitigar fuerza bruta.
 * @param {{limit?:number, windowMs?:number, prefix?:string}} opts
 * @returns {import('express').RequestHandler}
 */
function ipRateLimit({ limit = 10, windowMs = 5 * 60_000, prefix = 'ip' } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const blocked = _consumeWindow(`${prefix}:${ip}`, limit, windowMs);
    if (blocked) {
      res.set('Retry-After', String(blocked.retryAfter));
      return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.', retryAfter: blocked.retryAfter });
    }
    next();
  };
}
exports.ipRateLimit = ipRateLimit;
