/**
 * Motor de aplicación de promociones — puerto 1:1 de apps/pedidos/utils.py (Django).
 *
 * Soporta 5 tipos canónicos de TipoDescuento.descripcion:
 *   - "Porcentaje"
 *   - "Monto fijo"
 *   - "2x1"
 *   - "Combo precio fijo"
 *   - "Lleva X paga Y"
 *
 * Regla de negocio: máximo UNA promo por pedido.
 * Si hay varias elegibles y no se especifica `promocion_id`, no se aplica ninguna
 * y el frontend recibe la lista para que el cliente elija.
 */
const { Op } = require('sequelize');
const { Promocion, Producto, TipoDescuento } = require('../models');

const TD_PORCENTAJE = 'Porcentaje';
const TD_MONTO_FIJO = 'Monto fijo';
const TD_2X1        = '2x1';
const TD_COMBO      = 'Combo precio fijo';
const TD_LLEVA_X    = 'Lleva X paga Y';

// ─── Helpers numéricos (evitamos floats donde sea relevante) ────────────────
const r = (n) => Number(parseFloat(n).toFixed(2));

/** ¿La promoción está vigente hoy (según días_semana)? */
function aplicaHoy(promo, fecha = new Date()) {
  const dias = (promo.dias_semana || '').toString().trim();
  if (!dias) return true;
  const permitidos = new Set(
    dias.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n))
  );
  if (!permitidos.size) return true;
  // Django weekday(): 0=lunes ... 6=domingo. JS getDay(): 0=domingo ... 6=sábado.
  const jsDay = fecha.getDay();
  const django = (jsDay + 6) % 7;
  return permitidos.has(django);
}

/** Carga todas las promos activas con sus productos asociados. */
async function cargarPromosActivas() {
  const ahora = new Date();
  return Promocion.findAll({
    where: {
      activa: true,
      fecha_inicio: { [Op.lte]: ahora },
      fecha_fin:    { [Op.gte]: ahora },
    },
    include: [
      { model: TipoDescuento, as: 'tipo_descuento' },
      { model: Producto, as: 'productos_aplicables',  through: { attributes: [] } },
      { model: Producto, as: 'productos_beneficiados', through: { attributes: [] } },
    ],
    order: [['orden', 'ASC'], ['fecha_inicio', 'DESC']],
  });
}

function idsDe(promoRel) {
  return new Set((promoRel || []).map((p) => p.id));
}

/** ¿La promo es elegible para este carrito? */
function promoEsElegible(promo, carrito) {
  if (!promo.tipo_descuento) return false;
  const idsAplicables   = idsDe(promo.productos_aplicables);
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsCarrito = new Set(carrito.map((i) => i.producto_id));

  if (promo.aplicacion === 'total') return idsCarrito.size > 0;

  // Dos grupos distintos: aplicables = disparador, beneficiados = descuento.
  if (idsAplicables.size && idsBeneficiados.size) {
    const interA = [...idsAplicables].some((id) => idsCarrito.has(id));
    const interB = [...idsBeneficiados].some((id) => idsCarrito.has(id));
    return interA && interB;
  }

  const requiereTodos =
    promo.tipo_descuento.descripcion === TD_COMBO ||
    promo.requiere_todos_productos === true;

  if (requiereTodos) {
    if (!idsAplicables.size) return false;
    return [...idsAplicables].every((id) => idsCarrito.has(id));
  }

  if (!idsAplicables.size) return false;
  return [...idsAplicables].some((id) => idsCarrito.has(id));
}

/** Promos vigentes hoy y elegibles para el carrito actual. */
async function promosElegibles(carrito) {
  const promos = await cargarPromosActivas();
  return promos.filter((p) => aplicaHoy(p) && promoEsElegible(p, carrito));
}

// ─── Implementaciones por tipo ──────────────────────────────────────────────

function aplicarPorcentaje(carrito, promo, idsAplicables, aplicadas) {
  if (!promo.valor_descuento) return;
  const pct = parseFloat(promo.valor_descuento) / 100;
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.producto_id)) continue;
    const desc = parseFloat(item.subtotal) * pct;
    item.subtotal = r(parseFloat(item.subtotal) - desc);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarMontoPorItem(carrito, promo, idsAplicables, aplicadas) {
  if (!promo.valor_descuento) return;
  const descuento = parseFloat(promo.valor_descuento);
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.producto_id)) continue;
    const nuevo = Math.max(0, parseFloat(item.subtotal) - descuento);
    item.subtotal = r(nuevo);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarMontoTotal(carrito, promo, aplicadas) {
  if (!promo.valor_descuento) return;
  const total = carrito.reduce((acc, i) => acc + parseFloat(i.subtotal), 0);
  if (total <= 0) return;
  const descTotal = parseFloat(promo.valor_descuento);
  const factor = Math.max(0, (total - descTotal) / total);
  for (const item of carrito) {
    item.subtotal = r(parseFloat(item.subtotal) * factor);
    item.promocion_id = promo.id;
  }
  if (!aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicar2x1(carrito, promo, idsAplicables, aplicadas) {
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.producto_id)) continue;
    const cant = item.cantidad;
    if (cant < 2) continue;
    const pares = Math.floor(cant / 2);
    const precioUnit = parseFloat(item.subtotal) / cant;
    const descuento = precioUnit * pares;
    item.subtotal = r(parseFloat(item.subtotal) - descuento);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarLlevaXPagaY(carrito, promo, idsAplicables, aplicadas) {
  if (!promo.cantidad_minima || !promo.valor_descuento) return;
  const x = parseInt(promo.cantidad_minima, 10);
  const y = parseInt(promo.valor_descuento, 10);
  if (x <= y || x < 2) return;
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.producto_id)) continue;
    const cant = item.cantidad;
    if (cant < x) continue;
    const grupos = Math.floor(cant / x);
    const unidadesGratis = grupos * (x - y);
    const precioUnit = parseFloat(item.subtotal) / cant;
    const descuento = precioUnit * unidadesGratis;
    item.subtotal = r(parseFloat(item.subtotal) - descuento);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarCombo(carrito, promo, idsAplicables, idsBeneficiados, aplicadas) {
  if (!promo.valor_descuento) return;
  const idsCarrito = new Set(carrito.map((i) => i.producto_id));
  if (idsAplicables.size && ![...idsAplicables].every((id) => idsCarrito.has(id))) return;

  const targetIds = idsBeneficiados.size ? idsBeneficiados : idsAplicables;
  const itemsTarget = carrito.filter((i) => targetIds.has(i.producto_id));
  if (!itemsTarget.length) return;

  const totalActual = itemsTarget.reduce((acc, i) => acc + parseFloat(i.subtotal), 0);
  if (totalActual <= 0) return;

  const precioCombo = parseFloat(promo.valor_descuento);
  const factor = precioCombo / totalActual;
  for (const item of itemsTarget) {
    item.subtotal = r(parseFloat(item.subtotal) * factor);
    item.promocion_id = promo.id;
  }
  if (!aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarUna(carrito, promo, idsAplicables, aplicadas) {
  const tipo = promo.tipo_descuento.descripcion;
  if (tipo === TD_PORCENTAJE) {
    aplicarPorcentaje(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_MONTO_FIJO) {
    if (promo.aplicacion === 'total') aplicarMontoTotal(carrito, promo, aplicadas);
    else aplicarMontoPorItem(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_2X1) {
    aplicar2x1(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_LLEVA_X) {
    aplicarLlevaXPagaY(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_COMBO) {
    const idsBeneficiados = idsDe(promo.productos_beneficiados);
    aplicarCombo(carrito, promo, idsAplicables, idsBeneficiados, aplicadas);
  }
}

/**
 * Aplica una promoción al carrito (regla: máximo una por pedido).
 *
 * @param {Array<{producto_id:number, cantidad:number, subtotal:number}>} carritoItems
 * @param {number|null} promocionId — id elegido por el cliente (si hay varias elegibles)
 * @returns {Promise<{carrito, aplicadas, elegibles}>}
 *   - carrito: copia con subtotales ajustados y `promocion_id` en ítems afectados.
 *   - aplicadas: array (0 o 1) con la promoción aplicada.
 *   - elegibles: todas las promos que el cliente podría elegir.
 */
async function aplicarPromociones(carritoItems, promocionId = null) {
  const carrito = JSON.parse(JSON.stringify(carritoItems));
  const elegibles = await promosElegibles(carrito);
  const aplicadas = [];

  if (!elegibles.length) return { carrito, aplicadas, elegibles: [] };

  let promoAAplicar = null;
  if (promocionId != null) {
    promoAAplicar = elegibles.find((p) => p.id === parseInt(promocionId, 10)) || null;
  } else if (elegibles.length === 1) {
    promoAAplicar = elegibles[0];
  }

  if (promoAAplicar) {
    const idsAplicables = idsDe(promoAAplicar.productos_aplicables);
    aplicarUna(carrito, promoAAplicar, idsAplicables, aplicadas);
  }

  return { carrito, aplicadas, elegibles };
}

module.exports = {
  aplicarPromociones,
  promosElegibles,
  aplicaHoy,
  TD_PORCENTAJE, TD_MONTO_FIJO, TD_2X1, TD_COMBO, TD_LLEVA_X,
};
