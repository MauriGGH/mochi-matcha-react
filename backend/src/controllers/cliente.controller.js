/**
 * Cliente controller (variante token_sesion en body/query, sin cookie).
 *
 * Este controller atiende el flujo "legacy/REST" donde el cliente pasa
 * `token_sesion` explícitamente en cada request (a diferencia del carrito que
 * usa cookie mm_session). Cubre crear/recuperar sesión, crear pedidos,
 * solicitar pago, polling de estado y cierre voluntario.
 *
 * Exporta: verificarMesa, crearSesion, recuperarSesion, calcularDescuentos,
 *          crearPedido, getPedidos, estadoPedidos, crearAlerta, solicitarPago,
 *          estadoSesion, cerrarSesionCliente.
 */
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  sequelize,
  Mesa, SesionCliente, Pedido, DetallePedido, DetalleModificador,
  AlertaMesero, SolicitudPago, ModalidadIngreso, EstadoSolicitud,
  Producto, MetodoPago, Promocion, TipoDescuento, Categoria,
} = require('../models');
const { aplicarPromociones, promosElegibles } = require('../utils/promociones');

function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ─── Mesa & sesión ──────────────────────────────────────────────────────────

/**
 * GET /api/cliente/mesa/:codigo_qr
 * Público. Verifica si la mesa existe y está disponible para crear sesión.
 * @returns { id, numero_mesa } si libre.
 *          404 si no encontrada.
 *          409 si está ocupada (incluye sesiones_activas count para mostrar
 *               "Únete a la mesa" en la UI).
 */
exports.verificarMesa = async (req, res, next) => {
  try {
    const mesa = await Mesa.findOne({ where: { codigo_qr: req.params.codigo_qr } });
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (mesa.estado === 'ocupada') {
      const sesiones_activas = await SesionCliente.count({
        where: { id_mesa: mesa.id, estado: 'activa' },
      });
      return res.status(409).json({
        error: 'Mesa ocupada',
        sesiones_activas,
        numero_mesa: mesa.numero_mesa,
      });
    }
    res.json({ id: mesa.id, numero_mesa: mesa.numero_mesa });
  } catch (err) { next(err); }
};

/**
 * POST /api/cliente/sesion
 * Público. Crea nueva SesionCliente con token_cookie devuelto en JSON
 * (variante para frontend que prefiere LocalStorage en vez de cookie).
 * Body: { id_mesa, alias }
 *
 * Genera/reutiliza PIN de mesa. Marca la mesa como 'ocupada'. Usa modalidad 'QR'.
 *
 * @returns 201 { token_sesion, id_sesion, pin, numero_mesa, was_first }
 *
 * Nota: a diferencia de bienvenida.crearSesion no usa SELECT FOR UPDATE — bug
 * potencial documentado abajo si dos clientes crean simultáneamente.
 */
exports.crearSesion = async (req, res, next) => {
  try {
    const { id_mesa, alias } = req.body;
    if (!id_mesa || !alias) return res.status(400).json({ error: 'id_mesa y alias requeridos' });

    const mesa = await Mesa.findByPk(id_mesa);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const was_first = mesa.estado === 'libre';
    let pin = mesa.pin_actual;
    if (!pin) {
      pin = genPin();
      await mesa.update({ pin_actual: pin });
    }

    const modalidad = await ModalidadIngreso.findOne({ where: { descripcion: 'QR' } });
    const sesion = await SesionCliente.create({
      alias,
      token_cookie: uuidv4(),
      id_mesa,
      id_modalidad: modalidad?.id || 1,
    });
    await mesa.update({ estado: 'ocupada' });

    res.status(201).json({
      token_sesion: sesion.token_cookie,
      id_sesion: sesion.id,
      pin,
      numero_mesa: mesa.numero_mesa,
      was_first,
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/cliente/recuperar
 * Público. Recupera la sesión activa de una mesa con codigo_qr + pin.
 * Body: { codigo_qr, pin }
 * @returns { token_sesion, id_sesion, alias, numero_mesa, pin_mesa }
 *          403 si PIN incorrecto, 404 si no hay sesión activa.
 */
exports.recuperarSesion = async (req, res, next) => {
  try {
    const { codigo_qr, pin } = req.body;
    if (!codigo_qr || !pin) return res.status(400).json({ error: 'codigo_qr y pin requeridos' });

    const mesa = await Mesa.findOne({ where: { codigo_qr, pin_actual: pin } });
    if (!mesa) return res.status(403).json({ error: 'PIN incorrecto o mesa no encontrada' });

    const sesion = await SesionCliente.findOne({
      where: { id_mesa: mesa.id, estado: 'activa' },
    });
    if (!sesion) return res.status(404).json({ error: 'No hay sesión activa en esta mesa' });

    res.json({
      token_sesion: sesion.token_cookie,
      id_sesion: sesion.id,
      alias: sesion.alias,
      numero_mesa: mesa.numero_mesa,
      pin_mesa: mesa.pin_actual,
    });
  } catch (err) { next(err); }
};

// ─── Pedidos ────────────────────────────────────────────────────────────────

/**
 * POST /api/cliente/calcular-descuentos
 * Público. Body: { items:[{producto_id, cantidad, subtotal}], promocion_id? }
 *
 * Pre-calculadora de carrito: aplica promociones y devuelve subtotal, descuento,
 * total, promociones aplicadas/elegibles. Si hay varias elegibles y no se pasó
 * `promocion_id`, `requiere_seleccion=true` (el frontend debe pedir al cliente
 * que elija una).
 *
 * @returns { ok, subtotal, descuento, total, promociones, promociones_elegibles,
 *           promocion_seleccionada, requiere_seleccion, precios_map }
 */
exports.calcularDescuentos = async (req, res, next) => {
  try {
    const { items = [], promocion_id = null } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.json({
        ok: true, subtotal: 0, descuento: 0, total: 0,
        promociones: [], promociones_elegibles: [],
        promocion_seleccionada: null, requiere_seleccion: false, precios_map: {},
      });
    }

    const itemsCalc = items.map((i) => ({
      producto_id: i.producto_id,
      cantidad: parseInt(i.cantidad, 10) || 1,
      subtotal: parseFloat(i.subtotal) || 0,
      modificadores: i.modificadores || [],
      notas: i.notas || '',
    }));

    const subtotalOriginal = itemsCalc.reduce((acc, i) => acc + i.subtotal, 0);
    const { carrito: itemsConPromo, aplicadas, elegibles } =
      await aplicarPromociones(itemsCalc, promocion_id);

    const totalConPromo = itemsConPromo.reduce((acc, i) => acc + i.subtotal, 0);
    const descuento = subtotalOriginal - totalConPromo;
    const preciosMap = {};
    itemsConPromo.forEach((i) => { preciosMap[i.producto_id] = i.subtotal; });

    const serializa = (p) => ({
      id: p.id,
      titulo: p.titulo,
      descripcion: p.descripcion_corta || p.tipo_descuento?.descripcion || '',
    });

    res.json({
      ok: true,
      subtotal: parseFloat(subtotalOriginal.toFixed(2)),
      descuento: parseFloat(descuento.toFixed(2)),
      total: parseFloat(totalConPromo.toFixed(2)),
      promociones: aplicadas.map(serializa),
      promociones_elegibles: elegibles.map(serializa),
      promocion_seleccionada: aplicadas.length ? aplicadas[0].id : null,
      requiere_seleccion: elegibles.length > 1 && aplicadas.length === 0,
      precios_map: preciosMap,
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/cliente/pedidos
 * Público. Body: { token_sesion, items[], token_idempotencia?, promocion_id? }
 *
 * Crea Pedido + DetallePedido + DetalleModificador para una sesión.
 * - Lock pesimista sobre SesionCliente.
 * - Idempotencia por `token_idempotencia` (devuelve duplicado:true).
 * - Aplica promociones (subtotal_calculado se congela con descuento aplicado).
 *
 * @returns 201 { ok, id_pedido } / 409 sesion_pagada / 400 carrito vacío
 */
exports.crearPedido = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { token_sesion, items, token_idempotencia, promocion_id = null } = req.body;
    if (!token_sesion) {
      await t.rollback();
      return res.status(400).json({ error: 'token_sesion requerido' });
    }
    if (!Array.isArray(items) || !items.length) {
      await t.rollback();
      return res.status(400).json({ error: 'El carrito está vacío' });
    }

    const sesion = await SesionCliente.findOne({
      where: { token_cookie: token_sesion },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!sesion || sesion.estado !== 'activa') {
      await t.rollback();
      return res.status(409).json({
        error: 'Tu cuenta ya fue cerrada. No puedes agregar más pedidos.',
        sesion_pagada: true,
      });
    }

    // Idempotencia
    if (token_idempotencia) {
      const existing = await Pedido.findOne({
        where: { token_idempotencia },
        transaction: t,
      });
      if (existing) {
        await t.commit();
        return res.json({ ok: true, pedido_id: existing.id, duplicado: true });
      }
    }

    // Aplicar promociones (mutate subtotal + injecta promocion_id)
    const itemsCalc = items.map((i) => ({
      producto_id: i.id_producto || i.producto_id,
      cantidad: parseInt(i.cantidad, 10) || 1,
      subtotal: parseFloat(i.subtotal) || 0,
      modificadores: i.modificadores || [],
      notas: i.notas || '',
    }));
    const { carrito: itemsFinal } = await aplicarPromociones(itemsCalc, promocion_id);

    const pedido = await Pedido.create({
      id_sesion: sesion.id,
      id_modalidad: sesion.id_modalidad,
      token_idempotencia: token_idempotencia || null,
    }, { transaction: t });

    for (let idx = 0; idx < items.length; idx++) {
      const original = items[idx];
      const calc = itemsFinal[idx]; // mismo orden
      const detalle = await DetallePedido.create({
        id_pedido: pedido.id,
        id_producto: original.id_producto || original.producto_id,
        cantidad: original.cantidad,
        notas: original.notas || null,
        subtotal_calculado: calc.subtotal,
        id_promocion: calc.promocion_id || null,
      }, { transaction: t });

      if (original.modificadores?.length) {
        await DetalleModificador.bulkCreate(
          original.modificadores.map((m) => ({
            id_detalle: detalle.id,
            id_opcion: m.id_opcion || m.id,
            precio_extra_aplicado: m.precio_extra || m.extra || 0,
            nombre_opcion_historico: m.nombre || m.nombre_opcion || '',
          })),
          { transaction: t }
        );
      }
    }

    await t.commit();
    res.status(201).json({ ok: true, id_pedido: pedido.id });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

/**
 * GET /api/cliente/pedidos?token_sesion=
 * Público. Lista pedidos de la sesión con detalles+producto, junto con
 * metadata de la sesión (alias, estado, numero_mesa, pin_mesa).
 * @returns { pedidos, sesion: { id, alias, estado, numero_mesa, pin_mesa } }
 *          403 si sesión inválida.
 */
exports.getPedidos = async (req, res, next) => {
  try {
    const { token_sesion } = req.query;
    const sesion = await SesionCliente.findOne({
      where: { token_cookie: token_sesion },
      attributes: ['id', 'alias', 'estado', 'id_mesa'],
      include: [{ model: Mesa, as: 'mesa', attributes: ['numero_mesa', 'pin_actual'] }],
    });
    if (!sesion) return res.status(403).json({ error: 'Sesión inválida' });

    const pedidos = await Pedido.findAll({
      where: { id_sesion: sesion.id },
      include: [{
        model: DetallePedido,
        as: 'detalles',
        include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }],
      }],
      order: [['fecha_hora_ingreso', 'DESC']],
    });

    res.json({
      pedidos,
      sesion: {
        id: sesion.id,
        alias: sesion.alias,
        estado: sesion.estado,
        numero_mesa: sesion.mesa?.numero_mesa,
        pin_mesa: sesion.mesa?.pin_actual,
      },
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/cliente/estado-pedidos?token_sesion=
 * Público. Polling endpoint para el cliente — devuelve estado_display
 * humanizado por pedido, items, flag listo por item.
 * @returns { ok, ts, sesion_estado, pedidos: [{ id, estado, estado_display,
 *            fecha, items: [{nombre, cantidad, listo}] }] }
 */
exports.estadoPedidos = async (req, res, next) => {
  try {
    const { token_sesion } = req.query;
    const sesion = await SesionCliente.findOne({ where: { token_cookie: token_sesion } });
    if (!sesion) return res.status(403).json({ error: 'Sesión inválida' });

    const pedidos = await Pedido.findAll({
      where: { id_sesion: sesion.id },
      include: [{
        model: DetallePedido, as: 'detalles',
        include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }],
      }],
      order: [['fecha_hora_ingreso', 'DESC']],
    });

    const estadoDisplay = {
      recibido: 'Recibido', preparando: 'Preparando', listo: 'Listo',
      entregado: 'Entregado', cancelado: 'Cancelado',
    };

    res.json({
      ok: true,
      ts: Date.now(),
      sesion_estado: sesion.estado,
      pedidos: pedidos.map(p => ({
        id: p.id,
        estado: p.estado,
        estado_display: estadoDisplay[p.estado] || p.estado,
        fecha: p.fecha_hora_ingreso,
        items: (p.detalles || []).map(d => ({
          nombre: d.producto?.nombre,
          cantidad: d.cantidad,
          listo: d.listo,
        })),
      })),
    });
  } catch (err) { next(err); }
};

// ─── Alertas / pago / sesión ────────────────────────────────────────────────

// Rate-limit en memoria: máximo 1 alerta cada 30s por sesión
const _alertaCooldown = new Map();

/**
 * POST /api/cliente/alerta
 * Público. Body: { token_sesion, tipo: 'ayuda'|'cuenta'|'personalizado', mensaje? }
 *
 * Crea AlertaMesero asociada a la sesión. Rate-limit en memoria: máx 1 alerta
 * cada 30s por sesión. Devuelve 429 con cooldown_segundos si está limitado.
 *
 * @returns 201 { id }
 */
exports.crearAlerta = async (req, res, next) => {
  try {
    const { token_sesion, tipo, mensaje } = req.body;
    const sesion = await SesionCliente.findOne({ where: { token_cookie: token_sesion, estado: 'activa' } });
    if (!sesion) return res.status(403).json({ error: 'Sesión inválida' });

    const ahora = Date.now();
    const last = _alertaCooldown.get(sesion.id) || 0;
    const COOLDOWN_MS = 30000; // 30 segundos
    if (ahora - last < COOLDOWN_MS) {
      const restantes = Math.ceil((COOLDOWN_MS - (ahora - last)) / 1000);
      return res.status(429).json({
        error: `Espera ${restantes}s antes de enviar otra alerta al mesero.`,
        cooldown_segundos: restantes,
      });
    }
    _alertaCooldown.set(sesion.id, ahora);

    const alerta = await AlertaMesero.create({
      id_mesa: sesion.id_mesa,
      id_sesion: sesion.id,
      tipo: tipo || 'ayuda',
      mensaje: mensaje || '',
    });
    res.status(201).json({ id: alerta.id });
  } catch (err) { next(err); }
};

/**
 * POST /api/cliente/pago
 * Público. Body: { token_sesion, tipo?, metodo_preferido?, propina? }
 *
 * Crea SolicitudPago (pendiente) + AlertaMesero (tipo='cuenta'). Calcula total
 * sumando subtotal_calculado de pedidos no cancelados. Propina por defecto 10%
 * si no se especifica.
 *
 * @returns 201 { id, total }
 */
exports.solicitarPago = async (req, res, next) => {
  try {
    const { token_sesion, tipo, metodo_preferido, propina } = req.body;
    const sesion = await SesionCliente.findOne({
      where: { token_cookie: token_sesion, estado: 'activa' },
      include: [{ model: Pedido, as: 'pedidos', include: [{ model: DetallePedido, as: 'detalles' }] }],
    });
    if (!sesion) return res.status(403).json({ error: 'Sesión inválida' });

    const total = sesion.pedidos.reduce(
      (acc, p) => acc + p.detalles.reduce((s, d) => s + parseFloat(d.subtotal_calculado), 0), 0
    );
    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });

    const solicitud = await SolicitudPago.create({
      id_sesion: sesion.id,
      id_mesa: sesion.id_mesa,
      tipo: tipo || 'grupal',
      total_individual: tipo === 'individual' ? total : null,
      total_mesa: tipo === 'grupal' ? total : total,
      propina_sugerida: propina != null
        ? parseFloat(propina).toFixed(2)
        : parseFloat((total * 0.10).toFixed(2)),
      id_estado_solicitud: estadoPendiente?.id || 1,
      detalle_pago: metodo_preferido || '',
    });

    // Notificar mesero
    await AlertaMesero.create({
      id_mesa: sesion.id_mesa,
      id_sesion: sesion.id,
      tipo: 'cuenta',
      mensaje: `${sesion.alias} solicita la cuenta (${tipo || 'grupal'})`,
    });

    res.status(201).json({ id: solicitud.id, total });
  } catch (err) { next(err); }
};

/**
 * GET /api/cliente/estado-sesion?token_sesion=
 * Público. Polling 5s para detectar cuando la sesión pasa a 'pagada'.
 * Si está pagada, reconstruye el ticket (items, totales, método de pago,
 * propina) buscando primero SolicitudPago individual por id_sesion y luego
 * la grupal por id_mesa.
 *
 * @returns { ok, ts, estado, pagada, ticket? }
 */
exports.estadoSesion = async (req, res, next) => {
  try {
    const { token_sesion } = req.query;
    const sesion = await SesionCliente.findOne({
      where: { token_cookie: token_sesion },
      include: [{ model: Mesa, as: 'mesa', attributes: ['numero_mesa'] }],
    });
    if (!sesion) return res.status(403).json({ error: 'Sesión inválida' });

    const pagada = sesion.estado === 'pagada';
    const payload = { ok: true, ts: Date.now(), estado: sesion.estado, pagada };

    if (!pagada) return res.json(payload);

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
        items.push({ nombre: d.producto?.nombre, cantidad: d.cantidad, subtotal: parseFloat(d.subtotal_calculado) });
        totalSesion += parseFloat(d.subtotal_calculado || 0);
      }
    }

    let sol = await SolicitudPago.findOne({
      where: { id_sesion: sesion.id },
      include: [{ model: MetodoPago, as: 'metodo_pago' }, { model: EstadoSolicitud, as: 'estado_solicitud' }],
      order: [['fecha_hora', 'DESC']],
    });
    if (!sol) {
      sol = await SolicitudPago.findOne({
        where: { id_mesa: sesion.id_mesa, tipo: 'grupal' },
        include: [{ model: MetodoPago, as: 'metodo_pago' }, { model: EstadoSolicitud, as: 'estado_solicitud' }],
        order: [['fecha_hora', 'DESC']],
      });
    }

    let metodo = '';
    let tipoPago = 'individual';
    let totalPagado = totalSesion;
    if (sol) {
      metodo = sol.metodo_pago?.descripcion || sol.detalle_pago || '';
      tipoPago = sol.tipo;
      if (sol.tipo === 'grupal' && sol.total_mesa != null) totalPagado = parseFloat(sol.total_mesa);
      else if (sol.total_individual != null) totalPagado = parseFloat(sol.total_individual);
    }

    payload.ticket = {
      alias: sesion.alias,
      mesa: String(sesion.mesa?.numero_mesa || ''),
      tipo: tipoPago,
      metodo,
      items,
      subtotal_sesion: parseFloat(totalSesion.toFixed(2)),
      total_pagado: parseFloat(totalPagado.toFixed(2)),
      propina: sol?.propina_sugerida ? parseFloat(sol.propina_sugerida) : 0,
      sol_id: sol?.id || null,
    };

    res.json(payload);
  } catch (err) { next(err); }
};

/**
 * POST /api/cliente/cerrar-sesion
 * Público. Body: { token_sesion }
 * Cliente cierra voluntariamente su sesión tras pagar. No permite cerrar
 * con cuenta abierta (estado='activa' → 409).
 * @returns { ok }
 */
exports.cerrarSesionCliente = async (req, res, next) => {
  try {
    const { token_sesion } = req.body;
    const sesion = await SesionCliente.findOne({ where: { token_cookie: token_sesion } });
    if (!sesion) return res.status(403).json({ error: 'Sesión inválida' });

    if (sesion.estado === 'activa') {
      return res.status(409).json({ error: 'No puedes cerrar una sesión con cuenta abierta.' });
    }
    if (sesion.estado !== 'cerrada') await sesion.update({ estado: 'cerrada' });
    res.json({ ok: true });
  } catch (err) { next(err); }
};
