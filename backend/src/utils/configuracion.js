/**
 * Helpers para leer/escribir configuración global y horarios de atención.
 * Espejo de la lógica Django (Configuracion + HorarioAtencion).
 */
const { Configuracion, HorarioAtencion } = require('../models');

/**
 * Lee un valor de la tabla configuraciones por clave.
 * @param {string} clave
 * @param {string} [fallback] valor a devolver si la clave no existe
 * @returns {Promise<string>}
 */
async function getConfig(clave, fallback = '') {
  const c = await Configuracion.findOne({ where: { clave } });
  return c ? c.valor : fallback;
}

/**
 * Upsert de configuración. Crea el registro si no existe, o lo actualiza
 * si el valor cambió. Idempotente.
 * @param {string} clave
 * @param {string|number|boolean} valor coerced a String antes de guardar
 * @returns {Promise<import('sequelize').Model>}
 */
async function setConfig(clave, valor) {
  const [c] = await Configuracion.findOrCreate({ where: { clave }, defaults: { valor: String(valor) } });
  if (c.valor !== String(valor)) await c.update({ valor: String(valor) });
  return c;
}

/**
 * Lee una clave y la interpreta como booleano (true/1/on → true).
 * @param {string} clave
 * @param {boolean} [fallback]
 * @returns {Promise<boolean>}
 */
async function getConfigBool(clave, fallback = false) {
  const v = (await getConfig(clave, fallback ? 'true' : 'false')).toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

/**
 * Lee una clave y la convierte a entero. Si no parsea, devuelve fallback.
 * @param {string} clave
 * @param {number} [fallback]
 * @returns {Promise<number>}
 */
async function getConfigInt(clave, fallback = 0) {
  const v = await getConfig(clave, String(fallback));
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * ¿La hora actual cae dentro de un HorarioAtencion del día?
 * Soporta horarios que cruzan medianoche (abre 22, cierra 02).
 */
function cubre(horario, hora) {
  const a = horario.abre, c = horario.cierra;
  if (a <= c) return a <= hora && hora < c;
  return hora >= a || hora < c;
}

/**
 * Verifica si el local está abierto en `now`.
 * Si la config `horarios_activos` está apagada, devuelve siempre true
 * (sin gating de horarios). Si está activa, requiere encontrar al menos
 * un HorarioAtencion del día actual que cubra la hora.
 * @param {Date} [now]
 * @returns {Promise<boolean>}
 */
async function estaAbierto(now = new Date()) {
  const activos = await getConfigBool('horarios_activos', false);
  if (!activos) return true; // sin gating de horarios → siempre abierto
  const dia = (now.getDay() + 6) % 7; // Django: 0=lun..6=dom
  const horaActual = now.toTimeString().slice(0, 8); // "HH:MM:SS"
  const horarios = await HorarioAtencion.findAll({ where: { dia_semana: dia, activo: true } });
  if (!horarios.length) return false;
  return horarios.some((h) => cubre(h, horaActual));
}

module.exports = { getConfig, setConfig, getConfigBool, getConfigInt, estaAbierto, cubre };
