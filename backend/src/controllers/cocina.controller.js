/**
 * KDS — separación cocina/bar.
 *
 * Reglas (1:1 con apps/cocina/views.py Django):
 *   - Cada DetallePedido tiene su propio flag `listo` que el área correspondiente cambia.
 *   - El Pedido global pasa a "listo" SOLO cuando TODOS sus DetallePedido están listos.
 *   - Si un pedido mezcla productos de cocina y bar, ambas áreas marcan los suyos por
 *     separado, y el pedido global pasa a "listo" cuando AMBAS terminaron sus ítems.
 *   - El KDS filtra los ítems por categoría: 'cocina' ve cocina+ambos, 'bar' ve bar+ambos.
 *
 * Por qué el filtrado se hace en JS (post-query) en lugar de SQL:
 *   Con INNER JOIN sobre Categoria.area, Sequelize a veces incluye detalles huérfanos
 *   (producto sin filtrar) que generan `undefined` en el frontend. Cargamos TODO el
 *   pedido completo y filtramos los detalles del área visible en JS — esto garantiza
 *   que `d.producto.nombre` siempre exista y que el progreso "X/Y items del área"
 *   sea correcto incluso si el pedido mezcla categorías.
 */
const { Op } = require('sequelize');
const {
  Pedido, DetallePedido, DetalleModificador, OpcionModificador,
  Producto, Categoria, SesionCliente, Mesa,
  sequelize,
} = require('../models');
const { areasDe, detalleEsDeArea } = require('../services/kds');

// 'cocina' ve cocina+ambos; 'bar' ve bar+ambos; otros (gerente) ven todos.
function areasParaFiltro(area) {
  if (area === 'bar')    return new Set(['bar', 'ambos']);
  if (area === 'cocina') return new Set(['cocina', 'ambos']);
  return new Set(['cocina', 'bar', 'ambos']);
}

/**
 * GET /api/cocina/pedidos?area=cocina|bar
 * Autorización: cocina, gerente, admin.
 *
 * Vista interna del KDS (formato propio del controller, distinto al contrato
 * de /pedidos-json). Filtra detalles visibles por área en JS (ver explicación
 * en el header del archivo).
 *
 * @returns { ok, ts, area, pendientes, listos } cada pedido con items del
 *          área visible, progreso (totalArea, listosArea), todos_listos_global,
 *          items_otras_areas (cuenta lo que maneja la otra área).
 */
exports.getPedidos = async (req, res, next) => {
  try {
    const area = req.query.area || 'cocina';
    const areasVisibles = areasParaFiltro(area);

    // Cargamos TODO el pedido (todos los detalles, sin filtrar en SQL)
    // y filtramos los detalles visibles después. Así nunca hay productos null/undefined.
    const pedidos = await Pedido.findAll({
      where: { estado: { [Op.in]: ['recibido', 'preparando', 'listo'] } },
      include: [
        {
          model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'],
          include: [{ model: Mesa, as: 'mesa', attributes: ['numero_mesa'] }],
        },
        {
          model: DetallePedido, as: 'detalles', required: true,
          include: [
            {
              model: Producto, as: 'producto', attributes: ['id', 'nombre'],
              required: true,
              include: [{
                model: Categoria, as: 'categoria',
                attributes: ['area', 'nombre'], required: true,
              }],
            },
            {
              model: DetalleModificador, as: 'modificadores',
              required: false,
              include: [{ model: OpcionModificador, as: 'opcion', attributes: ['nombre_opcion'], required: false }],
            },
          ],
        },
      ],
      order: [['fecha_hora_ingreso', 'ASC']],
    });

    const mapPedido = (p) => {
      // Filtrar SOLO los detalles del área visible. Los otros se ignoran (los maneja la otra área).
      const detallesVisibles = (p.detalles || []).filter((d) => {
        const a = d.producto?.categoria?.area;
        return a && areasVisibles.has(a);
      });

      const items = detallesVisibles.map((d) => ({
        id: d.id,
        nombre: d.producto?.nombre || '(sin nombre)',
        cantidad: d.cantidad || 0,
        notas: d.notas || '',
        listo: !!d.listo,
        fecha_listo: d.fecha_listo,
        categoria: d.producto?.categoria?.nombre || '',
        area: d.producto?.categoria?.area || '',
        modificadores: (d.modificadores || [])
          .map((m) => m.opcion?.nombre_opcion)
          .filter(Boolean),
      }));

      // Progreso del área visible: ítems listos / totales
      const totalArea  = items.length;
      const listosArea = items.filter((i) => i.listo).length;

      // El pedido global está "listo" si TODOS sus detalles (de TODAS las áreas) están listos
      const todosGlobal = (p.detalles || []).length > 0
        && (p.detalles || []).every((d) => d.listo);

      return {
        id: p.id,
        estado: p.estado,
        estado_display: { recibido: 'Recibido', preparando: 'Preparando', listo: 'Listo' }[p.estado] || p.estado,
        mesa: p.sesion?.mesa?.numero_mesa || '?',
        alias: p.sesion?.alias || '',
        fecha: p.fecha_hora_ingreso,
        area_pedido_listo: totalArea > 0 && listosArea === totalArea,
        items,
        items_otras_areas: (p.detalles || []).length - totalArea,
        todos_listos_global: todosGlobal,
      };
    };

    const todos = pedidos
      .map(mapPedido)
      // Solo mostrar pedidos que tengan ítems de esta área
      .filter((p) => p.items.length > 0);

    const pendientes = todos.filter((p) => p.estado !== 'listo');
    const listos     = todos.filter((p) => p.estado === 'listo');

    res.json({ ok: true, ts: Date.now(), area, pendientes, listos });
  } catch (err) { next(err); }
};

/**
 * POST /api/cocina/marcar-detalle-listo  { detalle_id }
 *
 * Marca un DetallePedido como listo. Recalcula el estado del pedido:
 *   - Si todos los detalles del pedido están listos → pedido pasa a 'listo'.
 *   - Si no, y el pedido estaba 'recibido' → pasa a 'preparando'.
 *   - Si ya estaba 'preparando' y no todos están listos → se queda en 'preparando'.
 *
 * Devuelve también `nombre_producto` para que el toast del frontend pueda mostrar
 * un mensaje claro ("Matcha latte marcado como listo") y `pedido_completo` para
 * que el frontend sepa si ya puede notificar al mesero.
 */
exports.marcarDetalleListo = async (req, res, next) => {
  try {
    const { detalle_id } = req.body;
    const detalle = await DetallePedido.findByPk(detalle_id, {
      include: [{
        model: Producto, as: 'producto', attributes: ['nombre'],
        include: [{ model: Categoria, as: 'categoria', attributes: ['area'] }],
      }],
    });
    if (!detalle) return res.status(404).json({ error: 'Detalle no encontrado' });

    if (!detalle.listo) await detalle.update({ listo: true, fecha_listo: new Date() });

    const pedido = await Pedido.findByPk(detalle.id_pedido, {
      include: [{ model: DetallePedido, as: 'detalles' }],
    });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const todos = (pedido.detalles || []).every((d) => d.listo);
    let nuevoEstado = pedido.estado;

    if (todos) {
      nuevoEstado = 'listo';
      await pedido.update({ estado: 'listo' });
    } else if (pedido.estado === 'recibido') {
      nuevoEstado = 'preparando';
      await pedido.update({ estado: 'preparando' });
    }

    res.json({
      ok: true,
      detalle_listo: true,
      pedido_estado: nuevoEstado,
      pedido_completo: todos,
      nombre_producto: detalle.producto?.nombre || '',
      area: detalle.producto?.categoria?.area || '',
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/cocina/marcar-detalle-no-listo  { detalle_id }
 * Revierte la marca de listo (si se marcó por error).
 */
exports.marcarDetalleNoListo = async (req, res, next) => {
  try {
    const { detalle_id } = req.body;
    const detalle = await DetallePedido.findByPk(detalle_id, {
      include: [{ model: Producto, as: 'producto', attributes: ['nombre'] }],
    });
    if (!detalle) return res.status(404).json({ error: 'Detalle no encontrado' });

    await detalle.update({ listo: false, fecha_listo: null });
    const pedido = await Pedido.findByPk(detalle.id_pedido);
    if (pedido && pedido.estado === 'listo') {
      await pedido.update({ estado: 'preparando' });
    }
    res.json({
      ok: true,
      nombre_producto: detalle.producto?.nombre || '',
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/cocina/marcar-listo  (legacy — preferir /marcar-detalle-listo).
 * Autorización: cocina, gerente, admin.
 * Body: { pedido_id, area?='cocina'|'bar' }
 *
 * Flujo de avance del pedido bajo lock pesimista (FOR UPDATE):
 *   - Primer click sobre pedido 'recibido' → pasa a 'preparando' (sin marcar items).
 *   - Click sobre pedido 'preparando' → marca como listos TODOS los items del
 *     área del pedido. Si tras esto todos los items (de TODAS las áreas) están
 *     listos, el pedido pasa a 'listo'; si no, permanece 'preparando'.
 *   - Idempotente: si pedido ya está 'listo'/'entregado'/'cancelado', no hace nada.
 *
 * @returns { ok, nuevo_estado, area_completa } / 404 si pedido inexistente.
 */
exports.marcarListo = async (req, res, next) => {
  const { pedido_id } = req.body;
  let area = req.body.area || 'cocina';
  if (!['cocina', 'bar'].includes(area)) area = 'cocina';
  const areasSet = areasDe(area);

  try {
    const result = await sequelize.transaction(async (t) => {
      const pedido = await Pedido.findOne({
        where: { id: pedido_id },
        lock: t.LOCK.UPDATE,
        transaction: t,
        include: [{
          model: DetallePedido, as: 'detalles',
          include: [{
            model: Producto, as: 'producto',
            attributes: ['id', 'nombre'],
            include: [{ model: Categoria, as: 'categoria', attributes: ['area'] }],
          }],
        }],
      });

      if (!pedido) {
        const err = new Error('not_found'); err.code = 'NOT_FOUND';
        throw err;
      }

      // Idempotente: si ya pasó de preparando, devolver sin cambios
      if (!['recibido', 'preparando'].includes(pedido.estado)) {
        return { nuevo_estado: pedido.estado, area_completa: true };
      }

      const detalles = pedido.detalles || [];
      const detallesArea = detalles.filter((d) => detalleEsDeArea(d, areasSet));

      // Primer click: recibido → preparando (no marca items)
      if (pedido.estado === 'recibido') {
        await pedido.update({ estado: 'preparando' }, { transaction: t });
        const areaCompleta = detallesArea.length === 0 || detallesArea.every((d) => d.listo);
        return { nuevo_estado: 'preparando', area_completa: areaCompleta };
      }

      // Estado preparando: marcar items no listos de esta área
      const ids = detallesArea.filter((d) => !d.listo).map((d) => d.id);
      if (ids.length) {
        await DetallePedido.update(
          { listo: true, fecha_listo: new Date() },
          { where: { id: { [Op.in]: ids } }, transaction: t }
        );
        for (const d of detallesArea) d.listo = true; // actualizar en memoria
      }

      // Pedido global pasa a listo SOLO si TODOS sus detalles están listos
      const todosListos = detalles.every((d) => d.listo);
      const nuevoEstado = todosListos ? 'listo' : 'preparando';
      if (pedido.estado !== nuevoEstado) {
        await pedido.update({ estado: nuevoEstado }, { transaction: t });
      }

      return { nuevo_estado: nuevoEstado, area_completa: true };
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado.' });
    }
    next(err);
  }
};

/**
 * POST /api/cocina/marcar-entregado
 * Autorización: mesero, cocina, gerente, admin.
 * Body: { pedido_id }
 *
 * Solo transiciona a 'entregado' si el pedido está en estado 'listo' (409 si no).
 * Registra empleado y timestamp de entrega.
 */
exports.marcarEntregado = async (req, res, next) => {
  try {
    const { pedido_id } = req.body;
    const pedido = await Pedido.findByPk(pedido_id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'listo') {
      return res.status(409).json({ error: 'El pedido aún no está listo' });
    }
    await pedido.update({
      estado: 'entregado',
      fecha_hora_entrega: new Date(),
      id_empleado_entrega: req.user?.id || null,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── GET /pedidos-json?area=cocina|bar — KDS polling cada 3s ─────────────────

function _serializarItem(d) {
  return {
    nombre: d.producto?.nombre || '',
    cantidad: d.cantidad,
    notas: d.notas || '',
    listo: !!d.listo,
    modificadores: (d.modificadores || [])
      .map((m) => m.opcion?.nombre_opcion || '').filter(Boolean),
  };
}

function _serializarPendiente(p, areasSet) {
  const detallesArea = (p.detalles || []).filter((d) => detalleEsDeArea(d, areasSet));
  const items = detallesArea.map(_serializarItem);
  const fecha = p.fecha_hora_ingreso instanceof Date
    ? p.fecha_hora_ingreso.toISOString()
    : new Date(p.fecha_hora_ingreso).toISOString();
  return {
    id: p.id,
    estado: p.estado,
    mesa: p.sesion?.mesa?.numero_mesa,
    alias: p.sesion?.alias || '',
    fecha,
    area_completa: detallesArea.length === 0 || detallesArea.every((d) => d.listo),
    detalles_filtrados: items,
    items,
  };
}

function _serializarListo(p) {
  const items = (p.detalles || []).map(_serializarItem);
  const fecha = p.fecha_hora_ingreso instanceof Date
    ? p.fecha_hora_ingreso.toISOString()
    : new Date(p.fecha_hora_ingreso).toISOString();
  return {
    id: p.id,
    estado: p.estado,
    mesa: p.sesion?.mesa?.numero_mesa,
    alias: p.sesion?.alias || '',
    fecha,
    area_completa: true,
    detalles_filtrados: items,
    items,
  };
}

/**
 * GET /api/cocina/pedidos-json?area=cocina|bar
 * Autorización: cocina, gerente, admin.
 *
 * Endpoint de polling del KDS (contrato público estable, distinto al interno
 * de /pedidos). El frontend lo consulta cada 3s.
 *
 * @returns { ok, ts, area, pendientes: [...], listos: [...] } donde cada item
 *          incluye items, area_completa, mesa, alias, fecha (ISO).
 */
exports.pedidosJson = async (req, res, next) => {
  try {
    const area = req.query.area || 'cocina';
    const areasSet = areasDe(area);

    const pedidos = await Pedido.findAll({
      where: { estado: { [Op.in]: ['recibido', 'preparando', 'listo'] } },
      include: [
        {
          model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'],
          include: [{ model: Mesa, as: 'mesa', attributes: ['numero_mesa'] }],
        },
        {
          model: DetallePedido, as: 'detalles',
          include: [
            {
              model: Producto, as: 'producto', attributes: ['id', 'nombre'],
              include: [{ model: Categoria, as: 'categoria', attributes: ['area', 'nombre'] }],
            },
            {
              model: DetalleModificador, as: 'modificadores', required: false,
              include: [{ model: OpcionModificador, as: 'opcion', attributes: ['nombre_opcion'], required: false }],
            },
          ],
        },
      ],
      order: [['fecha_hora_ingreso', 'ASC']],
    });

    // pendientes: recibido|preparando con ≥1 detalle del área no listo
    const pendientes = pedidos
      .filter((p) => ['recibido', 'preparando'].includes(p.estado))
      .filter((p) => (p.detalles || []).some((d) => detalleEsDeArea(d, areasSet) && !d.listo))
      .map((p) => _serializarPendiente(p, areasSet));

    // listos: estado=listo con ≥1 detalle del área — se devuelven TODOS los items
    const listos = pedidos
      .filter((p) => p.estado === 'listo')
      .filter((p) => (p.detalles || []).some((d) => detalleEsDeArea(d, areasSet)))
      .map(_serializarListo);

    return res.json({ ok: true, ts: Date.now(), pendientes, listos });
  } catch (err) { next(err); }
};
