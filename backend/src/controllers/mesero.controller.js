/**
 * Mesero controller: operación del panel mesero (cobros, ticket, pedido
 * asistido, mapa de mesas, edición/cancelación de pedidos, gestión de sesiones).
 *
 * Endpoints más críticos:
 *   - procesarPago: cobro presencial (efectivo/tarjeta/mixto) con locks pesimistas,
 *     M2M sesiones_cubiertas y validación de monto bajo transacción.
 *   - getTicket: reconstrucción del ticket usando precedencia
 *     sesiones_cubiertas (M2M) → id_sesion → id_mesa (fallback legacy).
 *   - mesasEstado: polling 3s con árbol de decisión de estado_visual.
 *   - pedidosListos: lista global de pedidos listos para mesero (fix#1 Bug A).
 *
 * Convenciones: dinero redondeado banker-safe via r(); montos NN inválidos → 0
 * via parsePosOr0(). Helpers privados _sumarConsumo / _postPagoMesa.
 *
 * Exporta: procesarPago, getTicket, solicitarCuentaMesero, totalCobroLive,
 *          totalCobro, confirmarPedidoAsistido, pedidoAsistido,
 *          agregarSesionAsistida, entregaPedido, editarPedidoMesero,
 *          cancelarPedidoMesero, cancelarSolicitudPago, cerrarSesion,
 *          cerrarMesa, mesaDetalle, mesasEstado, pedidosListos, catalogoProductos.
 */
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  sequelize,
  Mesa, SesionCliente, Pedido, DetallePedido, DetalleModificador, OpcionModificador, Producto,
  GrupoModificador,
  SolicitudPago, MetodoPago, EstadoSolicitud, UbicacionMesa, ModalidadIngreso, AlertaMesero,
  Auditoria,
} = require('../models');

// ─── Helpers de dinero ──────────────────────────────────────────────────────
// Sin decimal.js: redondeo "banker-safe" a 2 decimales con scaling entero.
function r(n) {
  const v = parseFloat(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}
function parsePosOr0(s) {
  if (s == null || s === '') return 0;
  const n = parseFloat(s);
  return isFinite(n) ? Math.max(0, n) : 0;
}

// Suma subtotal_calculado de pedidos no cancelados que matcheen el filtro de sesión.
async function _sumarConsumo({ idSesionIn, idSesion }, t) {
  const where = { estado: { [Op.ne]: 'cancelado' } };
  if (idSesion != null) where.id_sesion = idSesion;
  if (idSesionIn != null) where.id_sesion = { [Op.in]: idSesionIn };
  const pedidos = await Pedido.findAll({
    where,
    include: [{ model: DetallePedido, as: 'detalles', attributes: ['subtotal_calculado'] }],
    transaction: t,
  });
  return r(pedidos.reduce(
    (acc, p) => acc + (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0),
    0
  ));
}

// Post-pago: NO libera la mesa. Solo limpia PIN y deja nota_cierre + AlertaMesero.
async function _postPagoMesa(mesa, userId, t) {
  const activas = await SesionCliente.findAll({
    where: { id_mesa: mesa.id, estado: 'activa' }, transaction: t,
  });
  if (!activas.length) {
    const nota = 'Cuenta saldada — lista para cerrar';
    const updates = { nota_cierre: nota };
    if (mesa.pin_actual) updates.pin_actual = null;
    await mesa.update(updates, { transaction: t });
    await AlertaMesero.create({
      id_mesa: mesa.id, tipo: 'personalizado',
      mensaje: `Mesa ${mesa.numero_mesa} pagada — lista para cerrar.`,
    }, { transaction: t });
  } else {
    const pendiente = await _sumarConsumo({ idSesionIn: activas.map((s) => s.id) }, t);
    const nota = `Queda $${pendiente.toFixed(2)} sin cobrar (${activas.length} sesión(es) activa(s))`;
    await mesa.update({ nota_cierre: nota }, { transaction: t });
    await AlertaMesero.create({
      id_mesa: mesa.id, tipo: 'personalizado',
      mensaje: `Mesa ${mesa.numero_mesa} con cobros parciales...`,
    }, { transaction: t });
  }
}

/**
 * POST /api/mesero/pago/procesar  — Procesa cobro presencial (efectivo/tarjeta/mixto).
 *
 * Body: { mesa_id, metodo_pago_id, sesion_id?, propina?, monto_recibido?,
 *         monto_efectivo?, monto_tarjeta? }
 *
 * Reglas críticas:
 *   - sesion_id presente → individual (cierra esa sesión).
 *   - sesion_id ausente  → grupal (cierra TODAS las sesiones activas de la mesa).
 *   - SELECT FOR UPDATE + re-validación de estado bajo lock.
 *   - Re-cálculo de total después del lock.
 *   - Validar monto en EFECTIVO/MIXTO contra (total + propina).
 *   - Cambio = max(0, recibido - total - propina).
 *   - NO libera la mesa: solo limpia PIN y deja nota_cierre.
 *   - sesiones_cubiertas M2M registra la(s) sesion(es) pagada(s).
 *   - Cierra otras solicitudes pendientes.
 *   - Auditoria de cada cobro.
 */
exports.procesarPago = async (req, res, next) => {
  try {
    const {
      mesa_id, sesion_id, metodo_pago_id,
      propina, monto_recibido, monto_efectivo, monto_tarjeta,
    } = req.body;

    if (!metodo_pago_id) {
      return res.status(400).json({ ok: false, error: 'Debe seleccionar un método de pago.' });
    }

    const mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    const metodo = await MetodoPago.findByPk(metodo_pago_id);
    if (!metodo) return res.status(404).json({ ok: false, error: 'Método de pago no encontrado' });

    const desc = (metodo.descripcion || '').toUpperCase();
    let detalle_pago = 'TARJETA';
    if (desc.includes('MIXTO'))         detalle_pago = 'MIXTO';
    else if (desc.includes('EFECTIVO')) detalle_pago = 'EFECTIVO';
    else if (desc.includes('PAYPAL'))   detalle_pago = 'PAYPAL';

    // ─── Pre-lock: validar estado y calcular total tentativo ───
    if (sesion_id) {
      const sPre = await SesionCliente.findOne({ where: { id: sesion_id, id_mesa: mesa.id } });
      if (!sPre) return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });
      if (sPre.estado !== 'activa') {
        return res.status(409).json({ ok: false, error: `La cuenta de ${sPre.alias || ''} ya fue saldada.` });
      }
    } else {
      const algunaActiva = await SesionCliente.findOne({ where: { id_mesa: mesa.id, estado: 'activa' } });
      if (!algunaActiva) {
        return res.status(409).json({ ok: false, error: 'La cuenta de esta mesa ya fue saldada.' });
      }
    }

    // ─── Propina (max 0) ───
    const propinaNum = r(parsePosOr0(propina));

    // ─── Estados de SolicitudPago ───
    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } })
      || await EstadoSolicitud.findOrCreate({ where: { descripcion: 'pendiente' } }).then(([m]) => m);
    const estadoProcesada = await EstadoSolicitud.findOne({ where: { descripcion: 'procesada' } })
      || await EstadoSolicitud.findOrCreate({ where: { descripcion: 'procesada' } }).then(([m]) => m);

    // ─── Transacción crítica con locks ───
    let solicitudId;
    let totalFinal;
    let bizError;

    await sequelize.transaction(async (t) => {
      let total;
      let sesionesLocked;  // [{id}]

      if (sesion_id) {
        const sLock = await SesionCliente.findOne({
          where: { id: sesion_id, id_mesa: mesa.id },
          lock: t.LOCK.UPDATE, transaction: t,
        });
        if (!sLock || sLock.estado !== 'activa') {
          bizError = { status: 409, body: { ok: false, error: 'Esta cuenta ya fue saldada por otro usuario.' } };
          return;
        }
        total = await _sumarConsumo({ idSesion: sLock.id }, t);
        sesionesLocked = [sLock];
      } else {
        const lista = await SesionCliente.findAll({
          where: { id_mesa: mesa.id, estado: 'activa' },
          lock: t.LOCK.UPDATE, transaction: t,
        });
        if (!lista.length) {
          bizError = { status: 409, body: { ok: false, error: 'La cuenta de esta mesa ya fue saldada.' } };
          return;
        }
        total = await _sumarConsumo({ idSesionIn: lista.map((s) => s.id) }, t);
        sesionesLocked = lista;
      }

      total = r(total);
      const totalConPropina = r(total + propinaNum);

      // ─── Validar monto según método ───
      let montoRecibido = null;
      let montoEfectivo = null;
      let montoTarjeta = null;
      let cambio = 0;

      if (detalle_pago === 'MIXTO') {
        montoEfectivo = r(parsePosOr0(monto_efectivo));
        montoTarjeta  = r(parsePosOr0(monto_tarjeta));
        if (r(montoEfectivo + montoTarjeta) < totalConPropina) {
          const faltante = r(totalConPropina - montoEfectivo - montoTarjeta);
          bizError = { status: 400, body: { ok: false, error: `Monto insuficiente en pago mixto. Faltan $${faltante.toFixed(2)}.` } };
          return;
        }
      } else if (detalle_pago === 'EFECTIVO') {
        if (monto_recibido != null && monto_recibido !== '') {
          const m = parseFloat(monto_recibido);
          if (!isFinite(m)) {
            bizError = { status: 400, body: { ok: false, error: 'Monto no es número válido.' } };
            return;
          }
          montoRecibido = r(m);
          if (montoRecibido < totalConPropina) {
            const faltante = r(totalConPropina - montoRecibido);
            bizError = { status: 400, body: { ok: false, error: `Monto insuficiente. Faltan $${faltante.toFixed(2)}.` } };
            return;
          }
          cambio = r(montoRecibido - totalConPropina);
        }
      }

      // ─── Buscar/crear SolicitudPago ───
      let solicitud;
      if (sesion_id) {
        solicitud = await SolicitudPago.findOne({
          where: { id_sesion: sesion_id, id_estado_solicitud: estadoPendiente.id },
          order: [['fecha_hora', 'ASC']],
          transaction: t,
        });
        if (!solicitud) {
          solicitud = await SolicitudPago.create({
            id_sesion: sesion_id, id_mesa: mesa.id,
            tipo: 'individual', total_individual: total,
            id_estado_solicitud: estadoPendiente.id,
          }, { transaction: t });
        }
      } else {
        solicitud = await SolicitudPago.findOne({
          where: { id_mesa: mesa.id, id_sesion: null, id_estado_solicitud: estadoPendiente.id },
          order: [['fecha_hora', 'ASC']],
          transaction: t,
        });
        if (!solicitud) {
          solicitud = await SolicitudPago.create({
            id_mesa: mesa.id, id_sesion: null,
            tipo: 'grupal', total_mesa: total,
            id_estado_solicitud: estadoPendiente.id,
          }, { transaction: t });
        }
      }

      // ─── Actualizar SolicitudPago con detalles del cobro ───
      await solicitud.update({
        id_estado_solicitud: estadoProcesada.id,
        id_metodo_pago: metodo.id,
        propina_sugerida: propinaNum,
        detalle_pago,
        monto_recibido: montoRecibido,
        cambio,
        monto_efectivo: montoEfectivo,
        monto_tarjeta: montoTarjeta,
        ...(sesion_id ? {} : { total_mesa: total }),
      }, { transaction: t });

      // ─── Marcar sesiones como pagadas ───
      for (const s of sesionesLocked) {
        await s.update({ estado: 'pagada' }, { transaction: t });
      }

      // ─── M2M: sesiones_cubiertas (fix#3) ────────────────────────────────
      // Registrar EXACTAMENTE las sesiones que este cobro cubre. Sin esto, el
      // ticket grupal incluye consumos de sesiones ya pagadas antes (sobre-cobro).
      // Espejo de apps/mesero/views.py:1085 (sol.sesiones_cubiertas.set(...)).
      await solicitud.setSesiones_cubiertas(
        sesionesLocked.map((s) => s.id),
        { transaction: t }
      );

      // ─── Cerrar otras solicitudes pendientes ───
      await SolicitudPago.update(
        { id_estado_solicitud: estadoProcesada.id },
        {
          where: {
            id_mesa: mesa.id,
            id_estado_solicitud: estadoPendiente.id,
            id: { [Op.ne]: solicitud.id },
          },
          transaction: t,
        }
      );
      if (!sesion_id) {
        // Para grupal: también cierra las pendientes vinculadas a las sesiones cobradas
        await SolicitudPago.update(
          { id_estado_solicitud: estadoProcesada.id },
          {
            where: {
              id_sesion: { [Op.in]: sesionesLocked.map((s) => s.id) },
              id_estado_solicitud: estadoPendiente.id,
            },
            transaction: t,
          }
        );
      }

      // ─── Post-pago: NO libera la mesa ───
      await _postPagoMesa(mesa, req.user?.id, t);

      solicitudId = solicitud.id;
      totalFinal = total;
    });

    if (bizError) return res.status(bizError.status).json(bizError.body);

    // ─── Auditoria (fuera de la TX crítica, como Django) ───
    await Auditoria.create({
      accion: 'Pago procesado',
      detalle: `Mesa ${mesa.numero_mesa} | ${sesion_id ? `Sesión #${sesion_id}` : 'Todas las sesiones'} | ` +
               `Método: ${metodo.descripcion} | Total: $${totalFinal.toFixed(2)} | Propina: $${propinaNum.toFixed(2)}`,
      id_empleado: req.user?.id || null,
      id_mesa: mesa.id,
    });

    return res.json({
      ok: true,
      solicitud_id: solicitudId,
      ticket_url: `/mesero/ticket/${solicitudId}/`,
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/mesero/ticket/:sol_id  ó  GET /api/mesero/ticket?mesa_id=
 * Autorización: mesero, gerente, admin.
 *
 * Reconstruye el ticket de una SolicitudPago aplicando la precedencia:
 *   1. sesiones_cubiertas (M2M, fix#3) — caso ideal, devuelve EXACTAMENTE las
 *      sesiones que ESTE cobro cubrió (evita sobre-cobro en cuentas múltiples).
 *   2. id_sesion — fallback individual si no hay M2M.
 *   3. id_mesa — fallback legacy para solicitudes viejas (sesiones activa|pagada).
 *
 * @returns { sol, mesa, pedidos, subtotal, descuento_total, total_final }
 *          404 si no se encuentra solicitud.
 */
exports.getTicket = async (req, res, next) => {
  try {
    const { mesa_id } = req.query;
    const { sol_id } = req.params;

    // Include compartido de DetallePedido (producto + modificadores).
    const detallesInclude = {
      model: DetallePedido, as: 'detalles',
      include: [
        { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'precio'] },
        {
          model: DetalleModificador, as: 'modificadores',
          include: [{ model: OpcionModificador, as: 'opcion', attributes: ['nombre_opcion', 'precio_extra'] }],
        },
      ],
    };

    // 1. Localizar la SolicitudPago + cargar sesiones_cubiertas (M2M).
    const baseInclude = [
      { model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] },
      { model: MetodoPago, as: 'metodo_pago' },
      { model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'] },
      // fix#3: cargar M2M para reconstruir SOLO los pedidos que ESTE cobro cubrió.
      { model: SesionCliente, as: 'sesiones_cubiertas', attributes: ['id', 'alias'], through: { attributes: [] } },
    ];

    let solicitud;
    if (sol_id) {
      solicitud = await SolicitudPago.findByPk(sol_id, { include: baseInclude });
    } else if (mesa_id) {
      const mesa = await Mesa.findByPk(mesa_id);
      if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
      solicitud = await SolicitudPago.findOne({
        where: { id_mesa: mesa_id },
        include: baseInclude,
        order: [['fecha_hora', 'DESC']],
      });
    }

    if (!solicitud) return res.status(404).json({ error: 'Ticket no encontrado' });

    // 2. Elegir las sesiones objetivo segun precedencia (espejo del Django
    //    apps/mesero/views.py:_ticket_context lines 1730-1755).
    let sesionIdsTarget = [];
    let mesaFallback = false;
    const sesionesCubiertas = solicitud.sesiones_cubiertas || [];

    if (sesionesCubiertas.length > 0) {
      // ★ Caso ideal: usar el M2M explícito.
      sesionIdsTarget = sesionesCubiertas.map((s) => s.id);
    } else if (solicitud.id_sesion) {
      // Fallback individual: usar la sesion directa.
      sesionIdsTarget = [solicitud.id_sesion];
    } else if (solicitud.id_mesa) {
      // Fallback legacy para solicitudes viejas sin M2M registrado: pedidos
      // de la mesa con estado IN ('activa','pagada'). Documentado en
      // backend/MIGRATIONS_PENDING.md.
      mesaFallback = true;
    }

    // 3. Cargar los pedidos no cancelados de las sesiones target.
    let pedidos = [];
    if (sesionIdsTarget.length > 0) {
      pedidos = await Pedido.findAll({
        where: {
          id_sesion: { [Op.in]: sesionIdsTarget },
          estado: { [Op.ne]: 'cancelado' },
        },
        include: [
          { model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'] },
          detallesInclude,
        ],
        order: [['fecha_hora_ingreso', 'ASC']],
      });
    } else if (mesaFallback) {
      const sesionesMesa = await SesionCliente.findAll({
        where: { id_mesa: solicitud.id_mesa, estado: { [Op.in]: ['activa', 'pagada'] } },
        attributes: ['id', 'alias'],
      });
      if (sesionesMesa.length) {
        pedidos = await Pedido.findAll({
          where: {
            id_sesion: { [Op.in]: sesionesMesa.map((s) => s.id) },
            estado: { [Op.ne]: 'cancelado' },
          },
          include: [
            { model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'] },
            detallesInclude,
          ],
          order: [['fecha_hora_ingreso', 'ASC']],
        });
      }
    }

    const subtotal = pedidos.reduce(
      (acc, p) => acc + (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0), 0
    );

    res.json({
      sol: solicitud,
      mesa: solicitud.mesa,
      pedidos,
      subtotal,
      descuento_total: 0,
      total_final: parseFloat(solicitud.total_mesa || solicitud.total_individual || subtotal),
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/mesero/solicitar-cuenta
 * Autorización: mesero, gerente, admin.
 * Body: { mesa_id, sesion_id?, tipo? }
 *
 * El mesero crea manualmente una SolicitudPago pendiente (caso: el cliente
 * pidió la cuenta verbalmente). Si sesion_id presente → individual; si no →
 * grupal. Calcula total sumando subtotal_calculado de pedidos no cancelados.
 * Idempotente: si ya existe una solicitud pendiente para misma mesa/sesion la
 * reutiliza (created=false).
 *
 * @returns { ok, created, solicitud_id, mensaje }
 */
exports.solicitarCuentaMesero = async (req, res, next) => {
  try {
    const { mesa_id, sesion_id, tipo } = req.body;
    if (!mesa_id) return res.status(400).json({ ok: false, error: 'mesa_id requerido' });

    const mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } })
      || await EstadoSolicitud.create({ descripcion: 'pendiente' });

    let total = 0;
    let tipoFinal = tipo || (sesion_id ? 'individual' : 'grupal');
    let sesionObj = null;

    if (sesion_id) {
      sesionObj = await SesionCliente.findOne({
        where: { id: sesion_id, id_mesa: mesa_id, estado: 'activa' },
        include: [{ model: Pedido, as: 'pedidos', include: [{ model: DetallePedido, as: 'detalles' }] }],
      });
      if (!sesionObj) return res.status(404).json({ ok: false, error: 'Sesión no encontrada o no activa' });
      total = sesionObj.pedidos.reduce(
        (acc, p) => acc + p.detalles.reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0), 0
      );
      tipoFinal = 'individual';
    } else {
      const sesionesActivas = await SesionCliente.findAll({
        where: { id_mesa: mesa_id, estado: 'activa' },
        include: [{ model: Pedido, as: 'pedidos', include: [{ model: DetallePedido, as: 'detalles' }] }],
      });
      if (!sesionesActivas.length) return res.status(400).json({ ok: false, error: 'La mesa no tiene sesiones activas.' });
      total = sesionesActivas.reduce(
        (acc, s) => acc + s.pedidos.reduce(
          (a2, p) => a2 + p.detalles.reduce((s2, d) => s2 + parseFloat(d.subtotal_calculado || 0), 0), 0
        ), 0
      );
      tipoFinal = 'grupal';
    }

    const propinaSugerida = parseFloat((total * 0.10).toFixed(2));

    const [sol, created] = await SolicitudPago.findOrCreate({
      where: {
        id_mesa: mesa_id,
        id_sesion: sesionObj ? sesionObj.id : null,
        id_estado_solicitud: estadoPendiente.id,
      },
      defaults: {
        tipo: tipoFinal,
        total_mesa: total,
        propina_sugerida: propinaSugerida,
        id_estado_solicitud: estadoPendiente.id,
      },
    });

    res.json({
      ok: true,
      created,
      solicitud_id: sol.id,
      mensaje: created ? 'Solicitud de cuenta creada.' : 'Ya existe una solicitud pendiente para esta mesa.',
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/mesero/pago/total?mesa=<id>&sesion=<id>
 * Total EN VIVO calculado desde BD (Sum subtotal_calculado, excl. cancelados).
 * Si sesion presente → solo esa sesión; si no → todas las activas de la mesa.
 */
exports.totalCobroLive = async (req, res, next) => {
  try {
    const { mesa, sesion } = req.query;
    if (!mesa) return res.status(400).json({ ok: false, error: 'mesa requerido' });

    const mesaObj = await Mesa.findByPk(mesa);
    if (!mesaObj) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    let total;
    if (sesion) {
      total = await _sumarConsumo({ idSesion: parseInt(sesion, 10) });
    } else {
      const activas = await SesionCliente.findAll({
        where: { id_mesa: mesa, estado: 'activa' }, attributes: ['id'],
      });
      total = activas.length
        ? await _sumarConsumo({ idSesionIn: activas.map((s) => s.id) })
        : 0;
    }

    return res.json({ ok: true, total: r(total) });
  } catch (err) { next(err); }
};

/**
 * GET /api/mesero/total-cobro?mesa=<id>&sesion=<id>
 *
 * Si se pasa sesion, calcula solo el consumo de esa sesión activa.
 * Si no, calcula el consumo de TODAS las sesiones de la mesa que aún NO
 * estén pagadas (excluye automáticamente lo que ya se cobró). Esto soporta
 * el caso "un cliente ya pagó individual, queda el resto de la mesa".
 */
exports.totalCobro = async (req, res, next) => {
  try {
    const { mesa, sesion } = req.query;
    if (!mesa) return res.status(400).json({ ok: false, error: 'mesa requerido' });

    const mesaObj = await Mesa.findByPk(mesa);
    if (!mesaObj) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    let total = 0;
    let detallesPagar = [];

    if (sesion) {
      // Cobro individual: solo esta sesión, solo si está activa
      const ses = await SesionCliente.findOne({
        where: { id: sesion, id_mesa: mesa, estado: 'activa' },
        include: [{
          model: Pedido, as: 'pedidos',
          where: { estado: { [Op.ne]: 'cancelado' } }, required: false,
          include: [{ model: DetallePedido, as: 'detalles' }],
        }],
      });
      if (ses) {
        total = (ses.pedidos || []).reduce(
          (acc, p) => acc + (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0), 0
        );
        detallesPagar = [{ sesion: ses.alias, total }];
      }
    } else {
      // Grupal: descontar las sesiones ya pagadas (solo cobrar lo activo)
      const sesionesActivas = await SesionCliente.findAll({
        where: { id_mesa: mesa, estado: 'activa' },
        include: [{
          model: Pedido, as: 'pedidos',
          where: { estado: { [Op.ne]: 'cancelado' } }, required: false,
          include: [{ model: DetallePedido, as: 'detalles' }],
        }],
      });
      for (const s of sesionesActivas) {
        const subt = (s.pedidos || []).reduce(
          (acc, p) => acc + (p.detalles || []).reduce((sa, d) => sa + parseFloat(d.subtotal_calculado || 0), 0), 0
        );
        total += subt;
        detallesPagar.push({ sesion: s.alias, total: subt });
      }
    }

    res.json({ ok: true, total, detalles: detallesPagar });
  } catch (err) { next(err); }
};

/**
 * POST /api/mesero/asistido/confirmar
 * Body: { sesion_id, items[{producto_id,cantidad,modificadores?,notas?}], promocion_id?, idempotency_key? }
 *
 * El mesero crea un pedido calculando precios desde BD (no confía en el body).
 * Mismas reglas de idempotencia + promos que /carrito/confirmar/.
 */
exports.confirmarPedidoAsistido = async (req, res, next) => {
  try {
    const { sesion_id, items, promocion_id = null, idempotency_key } = req.body;

    if (!sesion_id || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos' });
    }

    // Pre-check idempotencia fuera de la transacción (fast path)
    if (idempotency_key) {
      const yaExiste = await Pedido.findOne({ where: { token_idempotencia: idempotency_key } });
      if (yaExiste) return res.json({ ok: true, pedido_id: yaExiste.id, duplicado: true });
    }

    const sesion = await SesionCliente.findOne({ where: { id: sesion_id, estado: 'activa' } });
    if (!sesion) return res.status(404).json({ ok: false, error: 'Sesión no encontrada o no activa' });

    const modalidad = await ModalidadIngreso.findOne({ where: { descripcion: 'asistido' } })
      || await ModalidadIngreso.findOrCreate({ where: { descripcion: 'asistido' } }).then(([m]) => m);

    // Normalizar ítems: calcular subtotales desde Producto.precio + precio_extra de mods
    const itemsNorm = [];
    const modsMap = {}; // producto_id → OpcionModificador[]
    for (const item of items) {
      const producto = await Producto.findOne({ where: { id: item.producto_id, disponible: true } });
      if (!producto) {
        return res.status(404).json({ ok: false, error: `Producto ${item.producto_id} no disponible` });
      }

      const cantidad = parseInt(item.cantidad, 10) || 1;
      const modificadoresIds = item.modificadores || [];
      let precioExtra = 0;

      if (modificadoresIds.length) {
        const ops = await OpcionModificador.findAll({ where: { id: { [Op.in]: modificadoresIds } } });
        precioExtra = ops.reduce((acc, op) => acc + parseFloat(op.precio_extra || 0), 0);
        modsMap[producto.id] = ops;
      }

      itemsNorm.push({
        producto_id: producto.id,
        cantidad,
        modificadores: modificadoresIds,
        notas: item.notas || '',
        subtotal: (parseFloat(producto.precio) + precioExtra) * cantidad,
      });
    }

    const { aplicarPromociones } = require('../utils/promociones');
    const { carrito: itemsFinal } = await aplicarPromociones(itemsNorm, promocion_id);

    let pedidoId;
    let duplicado = false;

    await sequelize.transaction(async (t) => {
      // Re-check idempotencia dentro de la transacción
      if (idempotency_key) {
        const yaExiste = await Pedido.findOne({ where: { token_idempotencia: idempotency_key }, transaction: t });
        if (yaExiste) {
          pedidoId = yaExiste.id;
          duplicado = true;
          return;
        }
      }

      const pedido = await Pedido.create({
        id_sesion: sesion.id,
        id_modalidad: modalidad.id,
        id_empleado_entrega: req.user?.id || null,
        token_idempotencia: idempotency_key || null,
      }, { transaction: t });
      pedidoId = pedido.id;

      for (let idx = 0; idx < items.length; idx++) {
        const original = items[idx];
        const calc = itemsFinal[idx];

        const detalle = await DetallePedido.create({
          id_pedido: pedido.id,
          id_producto: calc.producto_id,
          cantidad: calc.cantidad,
          notas: original.notas || null,
          subtotal_calculado: calc.subtotal,
          id_promocion: calc.promocion_id || null,
        }, { transaction: t });

        const opciones = modsMap[calc.producto_id] || [];
        for (const op of opciones) {
          await DetalleModificador.create({
            id_detalle: detalle.id,
            id_opcion: op.id,
            precio_extra_aplicado: parseFloat(op.precio_extra || 0),
            nombre_opcion_historico: op.nombre_opcion || '',
          }, { transaction: t });
        }
      }
    });

    if (duplicado) return res.json({ ok: true, pedido_id: pedidoId, duplicado: true });
    return res.status(201).json({ ok: true, pedido_id: pedidoId });
  } catch (err) { next(err); }
};

/**
 * POST /api/mesero/asistido
 * Body: { sesion_id, items[], promocion_id?, token_idempotencia? }
 *
 * Crea un pedido en nombre de una sesión existente (asistido por el mesero).
 * Aplica promociones igual que el endpoint cliente. Requiere autenticación mesero.
 */
exports.pedidoAsistido = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { sesion_id, items, promocion_id = null, token_idempotencia } = req.body;
    if (!sesion_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, error: 'sesion_id requerido' });
    }
    if (!Array.isArray(items) || !items.length) {
      await t.rollback();
      return res.status(400).json({ ok: false, error: 'El carrito está vacío' });
    }

    const sesion = await SesionCliente.findOne({
      where: { id: sesion_id, estado: 'activa' },
      lock: t.LOCK.UPDATE, transaction: t,
    });
    if (!sesion) {
      await t.rollback();
      return res.status(409).json({ ok: false, error: 'Sesión no encontrada o ya cerrada' });
    }

    // Idempotencia
    if (token_idempotencia) {
      const existing = await Pedido.findOne({
        where: { token_idempotencia }, transaction: t,
      });
      if (existing) {
        await t.commit();
        return res.json({ ok: true, pedido_id: existing.id, duplicado: true });
      }
    }

    // Aplicar promociones
    const { aplicarPromociones } = require('../utils/promociones');
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
      id_empleado_entrega: req.user?.id || null,
      token_idempotencia: token_idempotencia || null,
    }, { transaction: t });

    for (let idx = 0; idx < items.length; idx++) {
      const original = items[idx];
      const calc = itemsFinal[idx];
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
    res.status(201).json({ ok: true, pedido_id: pedido.id });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

/**
 * POST /api/mesero/sesion-asistida  (alias: /sesion/agregar)
 * Autorización: mesero, gerente, admin.
 * Body: { mesa_id, alias }
 *
 * Crea una SesionCliente en modalidad 'asistido' (sin QR — el mesero la agrega
 * desde el panel). Si es la primera sesión de la mesa genera PIN aleatorio
 * 4 dígitos y pasa la mesa a 'ocupada'. Transacción para evitar carrera con
 * otra creación.
 *
 * @returns { ok, sesion_id, alias, pin }
 */
exports.agregarSesionAsistida = async (req, res, next) => {
  try {
    const { mesa_id, alias } = req.body;
    if (!mesa_id || !alias?.trim()) return res.status(400).json({ ok: false, error: 'mesa_id y alias son obligatorios' });

    const mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    const modalidad = await ModalidadIngreso.findOne({ where: { descripcion: 'asistido' } })
      || await ModalidadIngreso.findOrCreate({ where: { descripcion: 'asistido' } }).then(([m]) => m);

    let sesion;
    let pin = mesa.pin_actual;

    await sequelize.transaction(async (t) => {
      const primeraSession = !(await SesionCliente.count({
        where: { id_mesa: mesa_id, estado: 'activa' },
        transaction: t,
      }));

      sesion = await SesionCliente.create({
        alias: alias.trim(),  // model beforeSave hook uppercases
        token_cookie: uuidv4(),
        id_mesa: mesa_id,
        id_modalidad: modalidad.id,
        estado: 'activa',
      }, { transaction: t });

      if (primeraSession) {
        pin = String(Math.floor(1000 + Math.random() * 9000));
        await mesa.update({ pin_actual: pin, estado: 'ocupada' }, { transaction: t });
      }
    });

    res.json({ ok: true, sesion_id: sesion.id, alias: sesion.alias, pin: pin || '' });
  } catch (err) { next(err); }
};

/**
 * POST /api/mesero/pedidos/entregar
 * Autorización: mesero, gerente, admin.
 * Body: { pedido_id }
 * Marca pedido como 'entregado', registra empleado y timestamp.
 * @returns { ok }
 */
exports.entregaPedido = async (req, res, next) => {
  try {
    const { pedido_id } = req.body;
    const pedido = await Pedido.findByPk(pedido_id);
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    await pedido.update({
      estado: 'entregado',
      id_empleado_entrega: req.user?.id || null,
      fecha_hora_entrega: new Date(),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * GET/PUT/POST /api/mesero/pedidos/:pedido_id/editar
 * Autorización: mesero, gerente, admin.
 *
 * Solo permite editar pedidos en estado 'recibido' (la cocina aún no empezó).
 * GET:  devuelve { items: [{detalle_id, producto_nombre, cantidad, notas,
 *                            subtotal, precio_unitario, modificadores}] }
 * POST/PUT: body { cambios: [{detalle_id, cantidad?, notas?}] }
 *   - SELECT FOR UPDATE sobre Pedido + re-verificación de estado bajo lock.
 *   - Recalcula subtotal manteniendo precio_unitario original.
 *   - Notas UPPER y cantidad >= 1 (qty_zero error si <1).
 *   - Registra auditoría con diff (qty old→new, subtotal old→new).
 *
 * @returns { ok, mensaje } / 400 si pedido no en 'recibido' o cambios inválidos
 */
exports.editarPedidoMesero = async (req, res, next) => {
  try {
    const { pedido_id } = req.params;
    const pedido = await Pedido.findByPk(pedido_id, {
      include: [{ model: SesionCliente, as: 'sesion', attributes: ['id_mesa'] }],
    });
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    if (pedido.estado !== 'recibido') {
      return res.status(400).json({
        ok: false,
        error: `Solo se pueden editar pedidos en estado 'recibido'. Este está en '${pedido.estado}'.`,
      });
    }

    if (req.method === 'GET') {
      const detalles = await DetallePedido.findAll({
        where: { id_pedido: pedido_id },
        include: [
          { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
          { model: DetalleModificador, as: 'modificadores', include: [{ model: OpcionModificador, as: 'opcion', attributes: ['nombre_opcion'] }] },
        ],
      });
      return res.json({
        ok: true,
        pedido_id: pedido.id,
        estado: pedido.estado,
        items: detalles.map((d) => ({
          detalle_id: d.id,
          producto_nombre: d.producto?.nombre,
          cantidad: d.cantidad,
          notas: d.notas || '',
          subtotal: parseFloat(d.subtotal_calculado),
          precio_unitario: d.cantidad ? parseFloat(d.subtotal_calculado) / d.cantidad : 0,
          modificadores: (d.modificadores || []).map((m) => m.opcion?.nombre_opcion).filter(Boolean),
        })),
      });
    }

    // POST / PUT — SELECT FOR UPDATE re-verifies state under lock
    const { cambios } = req.body;
    if (!cambios?.length) return res.status(400).json({ ok: false, error: 'No se enviaron cambios' });

    const registros = [];
    await sequelize.transaction(async (t) => {
      const pedidoLocked = await Pedido.findOne({
        where: { id: pedido_id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (pedidoLocked.estado !== 'recibido') {
        const err = new Error('not_recibido'); err.code = 'NOT_RECIBIDO';
        throw err;
      }

      for (const cambio of cambios) {
        const detalle = await DetallePedido.findOne({
          where: { id: cambio.detalle_id, id_pedido: pedido_id },
          include: [{ model: Producto, as: 'producto', attributes: ['nombre'] }],
          transaction: t,
        });
        if (!detalle) continue;

        const nuevaCantidad = parseInt(cambio.cantidad ?? detalle.cantidad, 10);
        const nuevasNotas = ((cambio.notas ?? detalle.notas ?? '').trim()).toUpperCase();

        if (nuevaCantidad < 1) {
          const err = new Error('qty_zero'); err.code = 'QTY_ZERO';
          throw err;
        }

        if (nuevaCantidad !== detalle.cantidad || nuevasNotas !== (detalle.notas || '')) {
          const subtotalAnterior = parseFloat(detalle.subtotal_calculado);
          const precioUnitario = detalle.cantidad ? subtotalAnterior / detalle.cantidad : 0;
          const nuevoSubtotal = precioUnitario * nuevaCantidad;
          registros.push(
            `  • ${detalle.producto?.nombre || detalle.id}: qty ${detalle.cantidad}→${nuevaCantidad}, ` +
            `subtotal $${subtotalAnterior.toFixed(2)}→$${nuevoSubtotal.toFixed(2)}`
          );
          await detalle.update({
            cantidad: nuevaCantidad,
            notas: nuevasNotas || null,
            subtotal_calculado: nuevoSubtotal,
          }, { transaction: t });
        }
      }

      if (registros.length) {
        await Auditoria.create({
          accion: 'Pedido editado por mesero',
          detalle: `Pedido #${pedido_id} modificado:\n${registros.join('\n')}`,
          id_empleado: req.user?.id || null,
          id_mesa: pedido.sesion?.id_mesa || null,
          id_pedido: pedido.id,
        }, { transaction: t });
      }
    });

    res.json({ ok: true, mensaje: 'Pedido actualizado correctamente.' });
  } catch (err) {
    if (err.code === 'NOT_RECIBIDO') return res.status(400).json({ ok: false, error: "El pedido ya no está en 'recibido'." });
    if (err.code === 'QTY_ZERO')    return res.status(400).json({ ok: false, error: 'Cantidad mínima 1' });
    next(err);
  }
};

/**
 * POST /api/mesero/pedidos/cancelar  (alias: /api/mesero/cancelar-pedido)
 * Autorización: mesero, gerente, admin.
 * Body: { pedido_id, motivo }  motivo es OBLIGATORIO (UPPER).
 *
 * No permite cancelar pedidos ya 'entregado' o 'cancelado'. Marca el pedido
 * como 'cancelado' con motivo_cancelacion y registra Auditoria.
 *
 * @returns { ok } / 400 si motivo vacío o estado no permite cancelación.
 */
exports.cancelarPedidoMesero = async (req, res, next) => {
  try {
    const { pedido_id, motivo } = req.body;
    const motivoTrimmed = motivo?.trim();
    if (!motivoTrimmed) return res.status(400).json({ ok: false, error: 'El motivo es obligatorio' });

    const pedido = await Pedido.findByPk(pedido_id, {
      include: [{ model: SesionCliente, as: 'sesion', attributes: ['id_mesa'] }],
    });
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    if (['entregado', 'cancelado'].includes(pedido.estado)) {
      return res.status(400).json({ ok: false, error: 'No se puede cancelar' });
    }

    const motivoUpper = motivoTrimmed.toUpperCase();
    await sequelize.transaction(async (t) => {
      await pedido.update({ estado: 'cancelado', motivo_cancelacion: motivoUpper }, { transaction: t });
      await Auditoria.create({
        accion: 'Pedido cancelado por mesero',
        detalle: `Pedido #${pedido.id}. Motivo: ${motivoUpper}`,
        id_empleado: req.user?.id || null,
        id_mesa: pedido.sesion?.id_mesa || null,
        id_pedido: pedido.id,
      }, { transaction: t });
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * POST /api/mesero/cancelar-solicitud
 * Autorización: mesero, gerente, admin.
 * Body: { solicitud_id }
 *
 * Cancela una SolicitudPago en estado 'pendiente' (la transiciona a 'cancelada').
 * Solo aplica si la solicitud sigue pendiente — si ya está procesada/cancelada
 * devuelve 400.
 *
 * @returns { ok, mensaje }
 */
exports.cancelarSolicitudPago = async (req, res, next) => {
  try {
    const { solicitud_id } = req.body;
    if (!solicitud_id) return res.status(400).json({ ok: false, error: 'solicitud_id requerido' });

    const solicitud = await SolicitudPago.findByPk(solicitud_id, {
      include: [{ model: EstadoSolicitud, as: 'estado_solicitud' }],
    });
    if (!solicitud) return res.status(404).json({ ok: false, error: 'Solicitud no encontrada' });

    if (solicitud.estado_solicitud?.descripcion !== 'pendiente') {
      return res.status(400).json({
        ok: false,
        error: `No se puede cancelar: la solicitud está en estado '${solicitud.estado_solicitud?.descripcion}'.`,
      });
    }

    const estadoCancelada = await EstadoSolicitud.findOne({ where: { descripcion: 'cancelada' } })
      || await EstadoSolicitud.create({ descripcion: 'cancelada' });

    await solicitud.update({ id_estado_solicitud: estadoCancelada.id });
    res.json({ ok: true, mensaje: 'Solicitud cancelada correctamente.' });
  } catch (err) { next(err); }
};

/**
 * POST /api/mesero/sesion/cerrar  (alias: /api/mesero/cerrar-sesion)
 * Autorización: mesero, gerente, admin.
 * Body: { sesion_id }
 *
 * Cierra UNA sesión bajo lock pesimista. Si tras cerrarla no quedan sesiones
 * activas en la mesa, libera la mesa (estado='libre', pin_actual=null).
 * Idempotente: si ya está cerrada devuelve { ok, ya_cerrada:true }.
 *
 * @returns { ok, ya_cerrada? } / 404 si sesión inexistente.
 */
exports.cerrarSesion = async (req, res, next) => {
  try {
    const { sesion_id } = req.body;
    if (!sesion_id) return res.status(400).json({ ok: false, error: 'sesion_id requerido' });

    const result = await sequelize.transaction(async (t) => {
      const sesion = await SesionCliente.findOne({
        where: { id: sesion_id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!sesion) {
        const err = new Error('not_found'); err.code = 'NOT_FOUND';
        throw err;
      }
      if (sesion.estado !== 'activa') return { ya_cerrada: true };

      await sesion.update({ estado: 'cerrada' }, { transaction: t });

      const mesa = await Mesa.findOne({
        where: { id: sesion.id_mesa },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      const quedan = await SesionCliente.count({
        where: { id_mesa: sesion.id_mesa, estado: 'activa' },
        transaction: t,
      });
      if (!quedan && mesa) {
        await mesa.update({ estado: 'libre', pin_actual: null }, { transaction: t });
      }
      return {};
    });

    return res.json({ ok: true, ...(result.ya_cerrada ? { ya_cerrada: true } : {}) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'Sesión no encontrada.' });
    next(err);
  }
};

/**
 * POST /api/mesero/mesa/cerrar
 * Autorización: mesero, gerente, admin.
 * Body: { mesa_id }
 *
 * Cierre forzado de la mesa: marca TODAS las sesiones activa|pagada como
 * 'cerrada' y libera la mesa (estado='libre', pin_actual=null, nota_cierre='').
 * Registra Auditoria. Operación atómica en una transacción.
 *
 * @returns { ok }
 */
exports.cerrarMesa = async (req, res, next) => {
  try {
    const { mesa_id } = req.body;
    if (!mesa_id) return res.status(400).json({ ok: false, error: 'mesa_id requerido' });

    const mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    await sequelize.transaction(async (t) => {
      await SesionCliente.update(
        { estado: 'cerrada' },
        { where: { id_mesa: mesa_id, estado: ['activa', 'pagada'] }, transaction: t }
      );
      await mesa.update(
        { estado: 'libre', pin_actual: null, nota_cierre: '' },
        { transaction: t }
      );
      await Auditoria.create({
        accion: 'Mesa cerrada',
        detalle: `Mesa ${mesa.numero_mesa} cerrada manualmente por mesero.`,
        id_empleado: req.user?.id || null,
        id_mesa: mesa.id,
      }, { transaction: t });
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
};

function toHHMM(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const ESTADO_DISPLAY = {
  recibido: 'Recibido', preparando: 'Preparando',
  listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado',
};

/**
 * GET /api/mesero/mapa/:mesaId
 * Autorización: mesero, gerente, admin.
 *
 * Detalle completo de la mesa para panel lateral: sesiones activas con sus
 * pedidos no cancelados (con items + modificadores), solicitudes de pago
 * pendientes, totales por sesión y total_mesa.
 *
 * @returns { ok, mesa_libre, mesa_id, numero_mesa, pin, estado, nota_cierre,
 *            sesiones: [{ id, alias, total, pedidos: [{...}] }],
 *            solicitudes: [{ id, alias, sesion_id, tipo, total, fecha, metodo_pref }],
 *            total_mesa }
 */
exports.mesaDetalle = async (req, res, next) => {
  try {
    const mesaId = parseInt(req.params.mesaId, 10);
    const mesa = await Mesa.findByPk(mesaId);
    if (!mesa) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    const [sesiones, estadoPendienteRow] = await Promise.all([
      SesionCliente.findAll({
        where: { id_mesa: mesaId, estado: 'activa' },
        include: [{
          model: Pedido, as: 'pedidos',
          where: { estado: { [Op.ne]: 'cancelado' } },
          required: false,
          include: [{
            model: DetallePedido, as: 'detalles',
            include: [
              { model: Producto, as: 'producto', attributes: ['nombre'] },
              {
                model: DetalleModificador, as: 'modificadores', required: false,
                include: [{ model: OpcionModificador, as: 'opcion', attributes: ['nombre_opcion'] }],
              },
            ],
          }],
        }],
        order: [['fecha_inicio', 'ASC'], [{ model: Pedido, as: 'pedidos' }, 'fecha_hora_ingreso', 'DESC']],
      }),
      EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } }),
    ]);

    const sesionesData = sesiones.map((s) => {
      const pedidosList = (s.pedidos || []).map((p) => ({
        id: p.id,
        estado: p.estado,
        estado_display: ESTADO_DISPLAY[p.estado] || p.estado,
        fecha: toHHMM(p.fecha_hora_ingreso),
        items: (p.detalles || []).map((d) => ({
          nombre: d.producto?.nombre || '',
          cantidad: d.cantidad,
          subtotal: parseFloat(d.subtotal_calculado || 0),
          notas: d.notas || '',
          modificadores: (d.modificadores || []).map((m) => m.opcion?.nombre_opcion || '').filter(Boolean),
        })),
      }));
      const total = (s.pedidos || []).reduce(
        (acc, p) => acc + (p.detalles || []).reduce((s2, d) => s2 + parseFloat(d.subtotal_calculado || 0), 0),
        0
      );
      return { id: s.id, alias: s.alias, total, pedidos: pedidosList };
    });

    let solicitudesData = [];
    if (estadoPendienteRow) {
      const solicitudes = await SolicitudPago.findAll({
        where: { id_mesa: mesaId, id_estado_solicitud: estadoPendienteRow.id },
        include: [{ model: SesionCliente, as: 'sesion', attributes: ['alias'] }],
        order: [['fecha_hora', 'DESC']],
      });
      solicitudesData = solicitudes.map((sol) => ({
        id: sol.id,
        alias: sol.tipo === 'grupal' ? 'Toda la mesa' : (sol.sesion?.alias || ''),
        sesion_id: sol.tipo === 'grupal' ? null : (sol.id_sesion || null),
        tipo: sol.tipo,
        tipo_display: sol.tipo === 'grupal' ? 'Grupal' : 'Individual',
        total: sol.tipo === 'grupal'
          ? parseFloat(sol.total_mesa || 0)
          : parseFloat(sol.total_individual || sol.total_mesa || 0),
        fecha: toHHMM(sol.fecha_hora),
        metodo_pref: sol.detalle_pago || '',
      }));
    }

    const totalMesa = sesionesData.reduce((acc, s) => acc + s.total, 0);

    return res.json({
      ok: true,
      mesa_libre: mesa.estado === 'libre',
      mesa_id: mesa.id,
      numero_mesa: mesa.numero_mesa,
      pin: mesa.pin_actual || '',
      estado: mesa.estado,
      nota_cierre: mesa.nota_cierre || '',
      sesiones: sesionesData,
      solicitudes: solicitudesData,
      total_mesa: totalMesa,
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/mesero/mapa/estado
 * Autorización: mesero, gerente, admin.
 * Polling 3s del mapa de mesas. Devuelve estado_visual calculado por mesa más
 * contadores globales (listos, solicitudes pendientes, alertas no atendidas).
 *
 * Árbol de decisión de estado_visual (orden importa):
 *   libre → alerta(ayuda) → cobrando(solicitud) → listo → cocina → ocupada
 *
 * @returns { ok, ts, mesas: [{ id, numero, estado, estado_visual, ubicacion,
 *            capacidad, pin, clientes, pedidos_cocina, pedidos_listos,
 *            tiene_solicitud, tiene_alerta_ayuda, nota_cierre }],
 *            listos_count, solicitudes_count, alertas_count }
 */
exports.mesasEstado = async (req, res, next) => {
  try {
    const estadoPendienteRow = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });

    const [mesas, listosCount, solicitudesCount, alertasCount, solicitudesPendientes] = await Promise.all([
      Mesa.findAll({
        include: [
          { model: UbicacionMesa, as: 'ubicacion', attributes: ['descripcion'] },
          {
            model: SesionCliente, as: 'sesiones', required: false,
            include: [{ model: Pedido, as: 'pedidos', required: false }],
          },
          { model: AlertaMesero, as: 'alertas', required: false },
        ],
        order: [['numero_mesa', 'ASC']],
      }),
      Pedido.count({ where: { estado: 'listo' } }),
      estadoPendienteRow
        ? SolicitudPago.count({ where: { id_estado_solicitud: estadoPendienteRow.id } })
        : Promise.resolve(0),
      AlertaMesero.count({ where: { atendida: false } }),
      estadoPendienteRow
        ? SolicitudPago.findAll({ where: { id_estado_solicitud: estadoPendienteRow.id }, attributes: ['id_mesa'] })
        : Promise.resolve([]),
    ]);

    const mesasConSolicitud = new Set(
      solicitudesPendientes.map((s) => s.id_mesa).filter(Boolean)
    );

    const result = mesas.map((m) => {
      const sesionesActivas = (m.sesiones || []).filter((s) => s.estado === 'activa');
      const clientes = sesionesActivas.length;

      const alertasVivas = (m.alertas || []).filter((a) => !a.atendida);
      const tieneAlertaAyuda = alertasVivas.some((a) => a.tipo === 'ayuda');
      const tieneSolicitud = mesasConSolicitud.has(m.id);

      const pedidos = sesionesActivas.flatMap((s) => s.pedidos || []);
      const pedidosListos  = pedidos.filter((p) => p.estado === 'listo').length;
      const pedidosCocina  = pedidos.filter((p) => ['recibido', 'preparando'].includes(p.estado)).length;

      // estado_visual decision tree — order is critical
      let estadoVisual;
      if (m.estado === 'libre')      estadoVisual = 'libre';
      else if (tieneAlertaAyuda)     estadoVisual = 'alerta';
      else if (tieneSolicitud)       estadoVisual = 'cobrando';
      else if (pedidosListos > 0)    estadoVisual = 'listo';
      else if (pedidosCocina > 0)    estadoVisual = 'cocina';
      else                           estadoVisual = 'ocupada';

      return {
        id: m.id,
        numero: m.numero_mesa,
        estado: m.estado,
        estado_visual: estadoVisual,
        ubicacion: m.ubicacion?.descripcion || '',
        capacidad: m.capacidad || 0,
        pin: m.pin_actual || '',
        clientes,
        pedidos_cocina: pedidosCocina,
        pedidos_listos: pedidosListos,
        tiene_solicitud: tieneSolicitud,
        tiene_alerta_ayuda: tieneAlertaAyuda,
        nota_cierre: m.nota_cierre || '',
      };
    });

    return res.json({
      ok: true,
      ts: Date.now(),
      mesas: result,
      listos_count: listosCount,
      solicitudes_count: solicitudesCount,
      alertas_count: alertasCount,
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/mesero/pedidos-listos  (fix#1 Bug A)
 * Autorización: mesero, gerente, admin.
 *
 * Lista global de pedidos en estado='listo' para que el panel mesero pueda
 * hacer polling cada 3s con el rol 'mesero' (antes consumía /cocina/pedidos
 * que exige rol 'cocina' y devolvía 403).
 *
 * @returns { ok, ts, pedidos: [{ id, mesa, mesa_id, alias, fecha (ISO),
 *            items: [{ id, cantidad, nombre, notas }] }] }
 */
exports.pedidosListos = async (req, res, next) => {
  try {
    const pedidos = await Pedido.findAll({
      where: { estado: 'listo' },
      include: [
        {
          model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'],
          include: [{ model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] }],
        },
        {
          model: DetallePedido, as: 'detalles',
          include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }],
        },
      ],
      order: [['fecha_hora_ingreso', 'ASC']],
    });

    const result = pedidos.map((p) => ({
      id: p.id,
      mesa: p.sesion?.mesa?.numero_mesa,
      mesa_id: p.sesion?.mesa?.id,
      alias: p.sesion?.alias || '',
      fecha: p.fecha_hora_ingreso instanceof Date
        ? p.fecha_hora_ingreso.toISOString()
        : new Date(p.fecha_hora_ingreso).toISOString(),
      items: (p.detalles || []).map((d) => ({
        id: d.id,
        cantidad: d.cantidad,
        nombre: d.producto?.nombre || '',
        notas: d.notas || '',
      })),
    }));

    return res.json({ ok: true, ts: Date.now(), pedidos: result });
  } catch (err) { next(err); }
};

/**
 * GET /api/mesero/productos/json
 * Autorización: mesero, gerente, admin.
 *
 * Catálogo de productos disponibles para el modal "pedido asistido". Incluye
 * grupos de modificadores con sus opciones activas (id, nombre, precio_extra).
 *
 * @returns { ok, productos: [{ id, nombre, precio, grupos_modificadores: [{
 *            id, nombre, tipo, es_obligatorio, max_selecciones,
 *            opciones: [{ id, nombre, precio_extra }] }] }] }
 */
exports.catalogoProductos = async (req, res, next) => {
  try {
    const productos = await Producto.findAll({
      where: { disponible: true },
      attributes: ['id', 'nombre', 'precio'],
      include: [{
        model: GrupoModificador,
        as: 'grupos_modificadores',
        through: { attributes: [] },
        attributes: ['id', 'nombre_grupo', 'tipo', 'es_obligatorio', 'max_selecciones'],
        include: [{
          model: OpcionModificador,
          as: 'opciones',
          where: { activo: true },
          required: false,
          attributes: ['id', 'nombre_opcion', 'precio_extra'],
        }],
      }],
      order: [['nombre', 'ASC']],
    });

    const data = productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: parseFloat(p.precio),
      grupos_modificadores: (p.grupos_modificadores || []).map((g) => ({
        id: g.id,
        nombre: g.nombre_grupo,
        tipo: g.tipo,
        es_obligatorio: g.es_obligatorio,
        max_selecciones: g.max_selecciones,
        opciones: (g.opciones || []).map((op) => ({
          id: op.id,
          nombre: op.nombre_opcion,
          precio_extra: parseFloat(op.precio_extra),
        })),
      })),
    }));

    return res.json({ ok: true, productos: data });
  } catch (err) { next(err); }
};
