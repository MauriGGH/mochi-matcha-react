'use strict';
/**
 * Carrito controller: maneja el carrito en memoria del cliente autenticado por
 * cookie mm_session. Convierte el carrito a Pedido + DetallePedido bajo
 * transacción + lock pesimista. También expone solicitarAyuda/solicitarCuenta
 * y los endpoints de polling de estado (estadoPedidos, sesionEstado, sesionCerrar).
 *
 * Notas:
 *   - El carrito vive en `_carritos` (Map<mmToken, items[]>) — se pierde al
 *     reiniciar el proceso (paridad con MemoryStore de Django dev).
 *   - Idempotencia por `token_idempotencia` en Pedido (UNIQUE) para tolerar
 *     reintentos del frontend.
 *   - Promociones se aplican ANTES de la transacción (sin efectos colaterales).
 *   - Rate-limit centralizado en middleware/rateLimit.
 *
 * Exporta: agregar, actualizar, eliminar, limpiar, confirmar, estadoPedidos,
 *          solicitarAyuda, solicitarCuenta, sesionEstado, sesionCerrar, _carritos.
 */

const { Op } = require('sequelize');
const {
  Producto, OpcionModificador,
  SesionCliente, Pedido, DetallePedido, DetalleModificador,
  AlertaMesero, Mesa, SolicitudPago, EstadoSolicitud, MetodoPago,
  sequelize,
} = require('../models');
const { aplicarPromociones } = require('../utils/promociones');
const {
  checkConfirmarPedido,
  checkSolicitarAyuda,
  checkSolicitarCuenta,
} = require('../middleware/rateLimit');

function toHHMM(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Carrito en memoria, keyed por token mm_session (equivalente a request.session["carrito"]).
// Se pierde al reiniciar el proceso, igual que el MemoryStore de Django en dev.
const _carritos = new Map();
exports._carritos = _carritos; // expuesto para tests

/**
 * POST /api/cliente/carrito/agregar
 * Auth: cookie mm_session (middleware mmSession popula req.sesionCliente y req.mmToken).
 * Body: { producto_id, cantidad?, modificadores?: [opcion_id], notas? }
 *
 * Calcula subtotal = (precio_unitario + sumaPrecioExtra) * cantidad.
 * Opciones inactivas se ignoran silenciosamente para no romper el flujo.
 * Notas se UPPER y se truncan a 100 chars.
 *
 * @returns { ok, carrito_count }
 *          409 si sesion.estado != 'activa' (cuenta ya cerrada).
 *          400 si cantidad < 1 o producto no disponible.
 */
exports.agregar = async (req, res, next) => {
  try {
    const sesion = req.sesionCliente;

    if (sesion.estado !== 'activa') {
      return res.status(409).json({
        ok: false,
        error: 'Tu cuenta ya fue cerrada. No puedes modificar el pedido.',
        sesion_pagada: true,
      });
    }

    const { producto_id, cantidad: cantRaw = 1, modificadores: modsIds = [], notas: notasRaw = '' } = req.body;

    const cantidad = parseInt(cantRaw, 10);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      return res.status(400).json({ ok: false, error: 'cantidad debe ser un entero ≥ 1' });
    }

    const notas = String(notasRaw || '').trim().slice(0, 100).toUpperCase();

    const producto = await Producto.findOne({ where: { id: producto_id, disponible: true } });
    if (!producto) {
      return res.status(404).json({ ok: false, error: 'Producto no encontrado o no disponible' });
    }

    // Precio extra de modificadores activos (opciones inactivas se ignoran silenciosamente)
    let precioExtra = 0;
    const opcionesDetalle = [];
    if (Array.isArray(modsIds) && modsIds.length) {
      const opciones = await OpcionModificador.findAll({
        where: { id: { [Op.in]: modsIds }, activo: true },
      });
      for (const op of opciones) {
        const extra = parseFloat(op.precio_extra) || 0;
        precioExtra += extra;
        opcionesDetalle.push({ id: op.id, nombre: op.nombre_opcion, extra });
      }
    }

    const precioUnitario = parseFloat(producto.precio);
    const subtotal = parseFloat(((precioUnitario + precioExtra) * cantidad).toFixed(2));

    const items = _carritos.get(req.mmToken) || [];
    items.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      precio_unitario: precioUnitario,
      cantidad,
      modificadores: opcionesDetalle,
      notas,
      subtotal,
    });
    _carritos.set(req.mmToken, items);

    return res.json({ ok: true, carrito_count: items.length });
  } catch (err) { next(err); }
};

/**
 * POST /api/cliente/carrito/actualizar
 * Auth: cookie mm_session.
 * Body: { index, cantidad }
 *
 * Cambia la cantidad del item en `index` y re-calcula subtotal. Si cantidad <= 0
 * elimina el item. Recalcula total del carrito.
 *
 * @returns { ok, carrito_count, total }
 *          409 si sesión no activa.
 */
exports.actualizar = (req, res) => {
  const sesion = req.sesionCliente;
  if (sesion.estado !== 'activa') {
    return res.status(409).json({
      ok: false,
      error: 'Tu cuenta ya fue cerrada.',
      sesion_pagada: true,
    });
  }

  const { index, cantidad } = req.body;
  const items = _carritos.get(req.mmToken) || [];

  if (index == null || index < 0 || index >= items.length) {
    return res.status(400).json({ ok: false, error: 'Índice inválido' });
  }

  const cant = parseInt(cantidad, 10);
  if (cant <= 0) {
    items.splice(index, 1);
  } else {
    const item = items[index];
    const precioExtras = (item.modificadores || []).reduce((s, op) => s + op.extra, 0);
    item.cantidad = cant;
    item.subtotal = parseFloat(((item.precio_unitario + precioExtras) * cant).toFixed(2));
    items[index] = item;
  }
  _carritos.set(req.mmToken, items);

  const total = parseFloat(items.reduce((s, i) => s + i.subtotal, 0).toFixed(2));
  return res.json({ ok: true, carrito_count: items.length, total });
};

/**
 * POST /api/cliente/carrito/eliminar
 * Auth: cookie mm_session.
 * Body: { index }
 *
 * Elimina un item del carrito por índice. Permitido incluso con sesión pagada
 * para que el cliente pueda limpiar su ticket visualmente.
 *
 * @returns { ok, carrito_count, total }
 */
exports.eliminar = (req, res) => {
  // No bloquea si sesión pagada — el cliente puede limpiar su ticket
  const { index } = req.body;
  const items = _carritos.get(req.mmToken) || [];

  if (index == null || index < 0 || index >= items.length) {
    return res.status(400).json({ ok: false, error: 'Índice inválido' });
  }

  items.splice(index, 1);
  _carritos.set(req.mmToken, items);

  const total = parseFloat(items.reduce((s, i) => s + i.subtotal, 0).toFixed(2));
  return res.json({ ok: true, carrito_count: items.length, total });
};

/**
 * POST /api/cliente/carrito/limpiar
 * Auth: cookie mm_session.
 * Vacía el carrito en memoria.
 * @returns { ok }
 */
exports.limpiar = (req, res) => {
  _carritos.set(req.mmToken, []);
  return res.json({ ok: true });
};

/**
 * POST /api/cliente/carrito/confirmar
 * Auth: cookie mm_session.
 * Body: { idempotency_key?, promocion_id? }
 *
 * Convierte el carrito en Pedido + DetallePedido + DetalleModificador.
 * Rate-limited (5/min por sesión).
 *
 * Flujo crítico (en transacción):
 *   1. SELECT FOR UPDATE sobre SesionCliente, re-valida estado='activa'.
 *   2. Si idempotency_key existe y ya creó pedido → devuelve el existente (duplicado:true).
 *   3. Re-lee carrito DENTRO del lock (otra request concurrente pudo procesarlo).
 *   4. Crea Pedido (token_idempotencia UNIQUE).
 *   5. Por cada item: crea DetallePedido (subtotal_calculado CONGELADO con descuentos).
 *   6. Por cada modificador: crea DetalleModificador (precio_extra_aplicado y
 *      nombre_opcion_historico para preservar histórico si la opción es editada).
 *   7. Limpia el carrito solo si la transacción commit-eó.
 *
 * Maneja UniqueConstraintError post-commit (race condition entre 2 confirmaciones).
 *
 * @returns { ok, pedido_id, duplicado? }
 *          409 sesion_pagada / 400 carrito_vacio / 429 rate limit
 */
exports.confirmar = async (req, res, next) => {
  const sesion = req.sesionCliente;
  const items = _carritos.get(req.mmToken) || [];

  if (!items.length) {
    return res.status(400).json({ ok: false, error: 'El carrito está vacío' });
  }

  // Rate limit (máx 5 por 60s por sesión)
  const rate = checkConfirmarPedido(sesion.id);
  if (rate) {
    res.set('Retry-After', String(rate.retryAfter));
    return res.status(429).json({
      ok: false,
      rate_limited: true,
      retry_after: rate.retryAfter,
      error: `Estás enviando pedidos demasiado seguido. Espera ${rate.retryAfter}s antes de reintentar.`,
    });
  }

  const { idempotency_key = null, promocion_id = null } = req.body || {};

  // Promociones se aplican ANTES de la transacción (no hay efectos colaterales)
  const { carrito: itemsFinal } = await aplicarPromociones(items, promocion_id);

  try {
    const result = await sequelize.transaction(async (t) => {
      // 1) Lock pesimista sobre la sesión + re-validar estado
      const sesionLocked = await SesionCliente.findOne({
        where: { id: sesion.id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!sesionLocked || sesionLocked.estado !== 'activa') {
        const err = new Error('sesion_pagada'); err.code = 'SESION_PAGADA';
        throw err;
      }

      // 2) Idempotencia: si ya existe pedido con este token, devolver el existente
      if (idempotency_key) {
        const existente = await Pedido.findOne({
          where: { token_idempotencia: idempotency_key },
          transaction: t,
        });
        if (existente) {
          _carritos.set(req.mmToken, []);
          return { pedido_id: existente.id, duplicado: true };
        }
      }

      // 3) Re-leer carrito DENTRO del lock (otra request concurrente pudo procesarlo)
      const itemsActuales = _carritos.get(req.mmToken) || [];
      if (!itemsActuales.length) {
        const err = new Error('carrito_vacio'); err.code = 'CARRITO_VACIO';
        throw err;
      }

      // 4) Crear Pedido + DetallePedido + DetalleModificador
      const pedido = await Pedido.create({
        id_sesion: sesionLocked.id,
        id_modalidad: sesionLocked.id_modalidad,
        token_idempotencia: idempotency_key || null,
      }, { transaction: t });

      for (let i = 0; i < items.length; i++) {
        const original = items[i];
        const calc = itemsFinal[i] || original;

        const producto = await Producto.findByPk(original.producto_id, { transaction: t });
        if (!producto) continue; // producto eliminado: omitir

        const detalle = await DetallePedido.create({
          id_pedido: pedido.id,
          id_producto: producto.id,
          cantidad: original.cantidad,
          notas: original.notas || '',
          subtotal_calculado: calc.subtotal, // ★ CONGELADO con descuento aplicado
          id_promocion: calc.promocion_id || null,
        }, { transaction: t });

        for (const op of (original.modificadores || [])) {
          try {
            const opcion = await OpcionModificador.findByPk(op.id, { transaction: t });
            if (!opcion) continue; // opción eliminada: omitir silenciosamente
            await DetalleModificador.create({
              id_detalle: detalle.id,
              id_opcion:  opcion.id,
              precio_extra_aplicado:   op.extra,
              nombre_opcion_historico: opcion.nombre_opcion,
            }, { transaction: t });
          } catch (_e) {
            // ignora silenciosamente si la opción fue eliminada
          }
        }
      }

      // 5) Limpiar carrito SOLO si el pedido se creó
      _carritos.set(req.mmToken, []);
      return { pedido_id: pedido.id };
    });

    return res.json({ ok: true, ...result });

  } catch (err) {
    if (err.code === 'SESION_PAGADA') {
      return res.status(409).json({
        ok: false,
        error: 'Tu cuenta ya fue cerrada. No puedes agregar más pedidos.',
        sesion_pagada: true,
      });
    }
    if (err.code === 'CARRITO_VACIO') {
      return res.status(400).json({ ok: false, error: 'El carrito está vacío' });
    }
    // Race condition con UNIQUE(token_idempotencia): re-consultar y devolver el existente
    if (err.name === 'SequelizeUniqueConstraintError' && idempotency_key) {
      const existente = await Pedido.findOne({ where: { token_idempotencia: idempotency_key } });
      if (existente) {
        _carritos.set(req.mmToken, []);
        return res.json({ ok: true, pedido_id: existente.id, duplicado: true });
      }
    }
    return next(err);
  }
};

const ESTADO_DISPLAY = {
  recibido: 'Recibido', preparando: 'Preparando', listo: 'Listo',
  entregado: 'Entregado', cancelado: 'Cancelado',
};

/**
 * GET /api/cliente/pedidos/estado
 * Auth: cookie mm_session. Polling cada 5s desde el frontend cliente.
 * Devuelve los pedidos de la sesión con estado human-readable y la lista de
 * items. Incluye estado de la sesión para detectar si fue pagada.
 *
 * @returns { ok, ts, sesion_estado, pedidos: [{ id, estado, estado_display,
 *           fecha (HH:MM), items: [{nombre, cantidad}] }] }
 */
exports.estadoPedidos = async (req, res, next) => {
  try {
    const sesion = req.sesionCliente;

    const pedidos = await Pedido.findAll({
      where: { id_sesion: sesion.id },
      include: [{
        model: DetallePedido, as: 'detalles',
        include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }],
      }],
      order: [['fecha_hora_ingreso', 'DESC']],
    });

    return res.json({
      ok: true,
      ts: Date.now(),
      sesion_estado: sesion.estado,
      pedidos: pedidos.map((p) => ({
        id: p.id,
        estado: p.estado,
        estado_display: ESTADO_DISPLAY[p.estado] || p.estado,
        fecha: toHHMM(p.fecha_hora_ingreso),
        items: (p.detalles || []).map((d) => ({
          nombre: d.producto?.nombre || '',
          cantidad: d.cantidad,
        })),
      })),
    });
  } catch (err) { next(err); }
};

// ─── POST /pedidos/ayuda — llama al mesero ────────────────────────────────────

/**
 * POST /api/cliente/pedidos/ayuda
 * Auth: cookie mm_session.
 * Body: { mensaje? } (texto opcional)
 *
 * Crea una AlertaMesero (tipo='ayuda') asociada a la sesión.
 * Rate-limited: si ya hay una alerta no atendida del mismo cliente, espera.
 *
 * @returns { ok, mensaje } / 429 si rate-limit / 409 si sesión no activa.
 */
exports.solicitarAyuda = async (req, res, next) => {
  try {
    const sesion = req.sesionCliente;
    if (sesion.estado !== 'activa') {
      return res.status(409).json({ ok: false, error: 'Tu cuenta ya fue cerrada.', sesion_pagada: true });
    }

    const alertasVivas = await AlertaMesero.count({
      where: { id_sesion: sesion.id, atendida: false },
    });

    const rate = checkSolicitarAyuda(sesion.id, alertasVivas);
    if (rate) {
      res.set('Retry-After', String(rate.retryAfter));
      return res.status(429).json({
        ok: false, rate_limited: true, retry_after: rate.retryAfter,
        error: `Acabas de llamar al mesero. Espera ${rate.retryAfter}s antes de reintentar.`,
      });
    }

    const mensaje = req.body?.mensaje || 'El cliente solicita atención.';
    await AlertaMesero.create({ id_mesa: sesion.id_mesa, id_sesion: sesion.id, tipo: 'ayuda', mensaje });

    return res.json({ ok: true, mensaje: 'Se ha notificado a tu mesero.' });
  } catch (err) { next(err); }
};

// ─── POST /pedidos/cuenta — solicitar la cuenta ───────────────────────────────

/**
 * POST /api/cliente/pedidos/cuenta
 * Auth: cookie mm_session.
 * Body: { tipo: 'individual'|'grupal', confirmar_sin_entrega?: bool,
 *         metodo_preferido?: 'EFECTIVO'|'TARJETA' }
 *
 * Crea SolicitudPago (pendiente) + AlertaMesero (tipo='cuenta'). Calcula
 * total individual o grupal según `tipo`. Si hay pedidos sin entregar y
 * confirmar_sin_entrega=false, exige confirmación (requiere_confirmacion:true).
 *
 * findOrCreate evita duplicar solicitudes pendientes (clave: id_sesion+tipo+estado).
 * Para 'grupal' usa lock pesimista sobre Mesa.
 *
 * @returns { ok, mensaje } o { ok:false, requiere_confirmacion:true, pedidos_pendientes }
 *          409 si sesión pagada / 429 rate limit
 */
exports.solicitarCuenta = async (req, res, next) => {
  try {
    const sesion = req.sesionCliente;
    if (sesion.estado !== 'activa') {
      return res.status(409).json({ ok: false, error: 'Esta cuenta ya fue saldada.', sesion_pagada: true });
    }

    const rate = checkSolicitarCuenta(sesion.id);
    if (rate) {
      res.set('Retry-After', String(rate.retryAfter));
      return res.status(429).json({
        ok: false, rate_limited: true, retry_after: rate.retryAfter,
        error: `Espera ${rate.retryAfter}s antes de reintentar.`,
      });
    }

    const { tipo = 'individual', confirmar_sin_entrega = false, metodo_preferido = '' } = req.body || {};
    const detalle = ['EFECTIVO', 'TARJETA'].includes(String(metodo_preferido).toUpperCase())
      ? String(metodo_preferido).toUpperCase() : '';

    // Totals and pending check — individual pedidos (always needed)
    const pedidosSesion = await Pedido.findAll({
      where: { id_sesion: sesion.id, estado: { [Op.ne]: 'cancelado' } },
      include: [{ model: DetallePedido, as: 'detalles' }],
    });
    let pedidosPendientes = 0;
    let total_individual = 0;
    for (const p of pedidosSesion) {
      if (!confirmar_sin_entrega && ['recibido', 'preparando', 'listo'].includes(p.estado)) {
        pedidosPendientes++;
      }
      for (const d of p.detalles || []) {
        total_individual += parseFloat(d.subtotal_calculado || 0);
      }
    }

    let total_mesa = null;
    if (tipo === 'grupal') {
      const sesionesMesa = await SesionCliente.findAll({
        where: { id_mesa: sesion.id_mesa, estado: 'activa' },
        include: [{
          model: Pedido, as: 'pedidos',
          where: { estado: { [Op.ne]: 'cancelado' } },
          required: false,
          include: [{ model: DetallePedido, as: 'detalles' }],
        }],
      });
      total_mesa = 0;
      for (const s of sesionesMesa) {
        for (const p of s.pedidos || []) {
          if (!confirmar_sin_entrega && ['recibido', 'preparando', 'listo'].includes(p.estado)) {
            pedidosPendientes++;
          }
          for (const d of p.detalles || []) {
            total_mesa += parseFloat(d.subtotal_calculado || 0);
          }
        }
      }
    }

    if (!confirmar_sin_entrega && pedidosPendientes > 0) {
      return res.json({
        ok: false,
        requiere_confirmacion: true,
        pedidos_pendientes: pedidosPendientes,
        error: `Tienes ${pedidosPendientes} pedido(s) sin entregar. ¿Continuar?`,
      });
    }

    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });
    const idEstado = estadoPendiente?.id || 1;

    const result = await sequelize.transaction(async (t) => {
      if (tipo === 'grupal') {
        await Mesa.findOne({ where: { id: sesion.id_mesa }, lock: t.LOCK.UPDATE, transaction: t });
        const [sol, created] = await SolicitudPago.findOrCreate({
          where: { id_sesion: null, id_mesa: sesion.id_mesa, tipo: 'grupal', id_estado_solicitud: idEstado },
          defaults: {
            total_mesa: parseFloat((total_mesa || 0).toFixed(2)),
            propina_sugerida: parseFloat(((total_mesa || 0) * 0.10).toFixed(2)),
            detalle_pago: detalle,
          },
          transaction: t,
        });
        if (created) {
          const msg = metodo_preferido ? `Solicitud de cuenta (${detalle.toLowerCase()})` : 'Solicitud de cuenta';
          await AlertaMesero.create({ id_mesa: sesion.id_mesa, id_sesion: sesion.id, tipo: 'cuenta', mensaje: msg }, { transaction: t });
        }
        return sol;
      } else {
        const [sol, created] = await SolicitudPago.findOrCreate({
          where: { id_sesion: sesion.id, tipo: 'individual', id_estado_solicitud: idEstado },
          defaults: {
            id_mesa: sesion.id_mesa,
            total_individual: parseFloat(total_individual.toFixed(2)),
            propina_sugerida: parseFloat((total_individual * 0.10).toFixed(2)),
            detalle_pago: detalle,
          },
          transaction: t,
        });
        if (created) {
          const msg = metodo_preferido ? `Solicitud de cuenta (${detalle.toLowerCase()})` : 'Solicitud de cuenta';
          await AlertaMesero.create({ id_mesa: sesion.id_mesa, id_sesion: sesion.id, tipo: 'cuenta', mensaje: msg }, { transaction: t });
        }
        return sol;
      }
    });

    return res.json({ ok: true, mensaje: 'Tu mesero se acercará en breve.' });
  } catch (err) { next(err); }
};

// ─── GET /sesion/estado — polling 5s, detectar pagada ────────────────────────

/**
 * GET /api/cliente/sesion/estado
 * Auth: cookie mm_session. Polling cada 5s para detectar cuando la sesión
 * pasa a 'pagada' (cobro procesado por mesero o PayPal).
 *
 * Si está pagada, agrega `ticket` con desglose: items, subtotal_sesion,
 * total_pagado, método y tipo (individual/grupal). El ticket se reconstruye
 * desde SolicitudPago procesada (primero individual por id_sesion, luego
 * grupal por id_mesa).
 *
 * @returns { ok, ts, estado, pagada, ticket? }
 */
exports.sesionEstado = async (req, res, next) => {
  try {
    const sesion = req.sesionCliente;
    const pagada = sesion.estado === 'pagada';
    const payload = { ok: true, ts: Date.now(), estado: sesion.estado, pagada };

    if (!pagada) return res.json(payload);

    // Construir ticket
    const pedidos = await Pedido.findAll({
      where: { id_sesion: sesion.id, estado: { [Op.ne]: 'cancelado' } },
      include: [{
        model: DetallePedido, as: 'detalles',
        include: [{ model: Producto, as: 'producto', attributes: ['nombre'] }],
      }],
    });
    const items = [];
    let totalSesion = 0;
    for (const p of pedidos) {
      for (const d of p.detalles || []) {
        items.push({
          nombre: d.producto?.nombre || '',
          cantidad: d.cantidad,
          subtotal: parseFloat(d.subtotal_calculado || 0),
        });
        totalSesion += parseFloat(d.subtotal_calculado || 0);
      }
    }

    // Buscar SolicitudPago: individual procesada de esta sesión, luego grupal procesada de la mesa
    let sol = await SolicitudPago.findOne({
      where: { id_sesion: sesion.id },
      include: [
        { model: MetodoPago, as: 'metodo_pago' },
        { model: EstadoSolicitud, as: 'estado_solicitud', where: { descripcion: 'procesada' }, required: true },
      ],
      order: [['fecha_hora', 'DESC']],
    });
    if (!sol) {
      sol = await SolicitudPago.findOne({
        where: { id_mesa: sesion.id_mesa, tipo: 'grupal' },
        include: [
          { model: MetodoPago, as: 'metodo_pago' },
          { model: EstadoSolicitud, as: 'estado_solicitud', where: { descripcion: 'procesada' }, required: true },
        ],
        order: [['fecha_hora', 'DESC']],
      });
    }

    let metodo = '';
    let tipoPago = 'individual';
    let totalPagado = totalSesion;
    if (sol) {
      metodo = sol.metodo_pago?.descripcion || sol.detalle_pago || '';
      tipoPago = sol.tipo;
      if (sol.tipo === 'grupal' && sol.total_mesa != null) {
        totalPagado = parseFloat(sol.total_mesa);
      } else if (sol.total_individual != null) {
        totalPagado = parseFloat(sol.total_individual);
      }
    }

    const mesa = await Mesa.findOne({ where: { id: sesion.id_mesa }, attributes: ['numero_mesa'] });

    payload.ticket = {
      alias: sesion.alias,
      mesa: String(mesa?.numero_mesa || ''),
      tipo: tipoPago,
      metodo,
      items,
      subtotal_sesion: parseFloat(totalSesion.toFixed(2)),
      total_pagado: parseFloat(totalPagado.toFixed(2)),
      sol_id: sol?.id || null,
    };

    return res.json(payload);
  } catch (err) { next(err); }
};

// ─── POST /sesion/cerrar — cliente cierra sesión voluntariamente ──────────────

/**
 * POST /api/cliente/sesion/cerrar
 * Auth: cookie mm_session.
 *
 * El cliente cierra voluntariamente su sesión tras el pago. Solo permitido si
 * la sesión NO está 'activa' (no se puede cerrar con cuenta abierta).
 * Si el estado es != 'cerrada', la transiciona a 'cerrada' y limpia la cookie.
 *
 * @returns { ok, redirect: '/bienvenida/' }
 *          409 si la sesión sigue activa.
 */
exports.sesionCerrar = async (req, res, next) => {
  try {
    const sesion = req.sesionCliente;
    if (sesion.estado === 'activa') {
      return res.status(409).json({ ok: false, error: 'No puedes cerrar una sesión con cuenta abierta.' });
    }
    if (sesion.estado !== 'cerrada') {
      await sesion.update({ estado: 'cerrada' });
    }
    res.clearCookie('mm_session');
    return res.json({ ok: true, redirect: '/bienvenida/' });
  } catch (err) { next(err); }
};
