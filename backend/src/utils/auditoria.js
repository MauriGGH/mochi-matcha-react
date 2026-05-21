/**
 * Helper para registrar acciones de auditoría.
 * Espejo de los `Auditoria.objects.create(...)` que abundan en el Django.
 */
const { Auditoria } = require('../models');

/**
 * Registra una entrada en la tabla `auditorias`.
 * Falla silenciosa: si el insert revienta, loguea a stderr y devuelve null
 * para no romper el flujo principal del controller que lo invoca.
 *
 * @param {number|null} empleadoId id_empleado responsable (null para acciones del sistema)
 * @param {string} accion etiqueta corta de la acción (ej. 'pedido.cancelar')
 * @param {string|object|null} detalle texto libre u objeto serializable; los objetos se guardan como JSON
 * @param {{mesaId?:number, pedidoId?:number, solicitudId?:number}} [refs] FKs opcionales para joins de reporte
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function logAccion(empleadoId, accion, detalle = null, refs = {}) {
  try {
    return await Auditoria.create({
      id_empleado: empleadoId,
      accion,
      detalle: typeof detalle === 'string' ? detalle : JSON.stringify(detalle || {}),
      id_mesa: refs.mesaId || null,
      id_pedido: refs.pedidoId || null,
      id_solicitud_pago: refs.solicitudId || null,
    });
  } catch (e) {
    console.error('auditoria.logAccion failed:', e.message);
    return null;
  }
}

module.exports = { logAccion };
