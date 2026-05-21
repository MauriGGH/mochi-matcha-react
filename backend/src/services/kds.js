'use strict';

/**
 * Helpers de filtrado para el KDS (Kitchen Display System).
 * Cada estación (cocina/bar) ve sólo los items de su área, además de los
 * marcados como 'ambos'. Sin filtro de área se ven todos (vista gerente).
 */

/**
 * Devuelve el set de áreas visibles para una estación KDS.
 * @param {'bar'|'cocina'|undefined} area
 * @returns {Set<string>}
 */
function areasDe(area) {
  if (area === 'bar')    return new Set(['bar', 'ambos']);
  if (area === 'cocina') return new Set(['cocina', 'ambos']);
  return new Set(['cocina', 'bar', 'ambos']);
}

/**
 * Comprueba si un DetallePedido (con producto.categoria.area cargado)
 * pertenece a las áreas que el KDS está mostrando.
 * @param {object} detalle
 * @param {Set<string>} areasSet
 * @returns {boolean}
 */
function detalleEsDeArea(detalle, areasSet) {
  return areasSet.has(detalle.producto?.categoria?.area);
}

module.exports = { areasDe, detalleEsDeArea };
