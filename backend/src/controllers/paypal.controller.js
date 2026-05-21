/**
 * PayPal sandbox/live integration — espejo de apps/cliente/views.py paypal_*.
 * Flujo:
 *   1) POST /api/cliente/paypal/orden    { token_sesion, tipo, propina } → {order_id, approve_url}
 *   2) Cliente aprueba en paypal.com → redirige a return_url
 *   3) POST /api/cliente/paypal/capturar { token_sesion, order_id, tipo, propina } → {ticket}
 *
 * Credenciales se leen desde Configuracion (paypal_client_id, paypal_secret, paypal_modo)
 * o desde .env (PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE).
 */
const paypal = require('@paypal/checkout-server-sdk');
const { Op } = require('sequelize');
const {
  sequelize,
  SesionCliente, Mesa, Pedido, DetallePedido,
  SolicitudPago, MetodoPago, EstadoSolicitud, AlertaMesero, Auditoria,
} = require('../models');
const { getConfig } = require('../utils/configuracion');

async function paypalCreds() {
  const client_id = (await getConfig('paypal_client_id', process.env.PAYPAL_CLIENT_ID || '')).trim();
  const secret    = (await getConfig('paypal_secret',    process.env.PAYPAL_SECRET    || '')).trim();
  const modo      = (await getConfig('paypal_modo',      process.env.PAYPAL_MODO      || 'sandbox')).trim();
  return { client_id, secret, modo };
}

function buildClient(client_id, secret, modo) {
  const env = modo === 'live'
    ? new paypal.core.LiveEnvironment(client_id, secret)
    : new paypal.core.SandboxEnvironment(client_id, secret);
  return new paypal.core.PayPalHttpClient(env);
}

async function totalSesion(sesion) {
  const pedidos = await Pedido.findAll({
    where: { id_sesion: sesion.id, estado: { [Op.ne]: 'cancelado' } },
    include: [{ model: DetallePedido, as: 'detalles' }],
  });
  return pedidos.reduce((acc, p) =>
    acc + p.detalles.reduce((s, d) => s + parseFloat(d.subtotal_calculado), 0), 0);
}

async function totalMesa(mesa_id) {
  const sesiones = await SesionCliente.findAll({
    where: { id_mesa: mesa_id, estado: 'activa' },
    include: [{ model: Pedido, as: 'pedidos', include: [{ model: DetallePedido, as: 'detalles' }] }],
  });
  return sesiones.reduce((acc, s) =>
    acc + s.pedidos.reduce((sa, p) =>
      sa + (p.estado === 'cancelado' ? 0 : p.detalles.reduce((sd, d) =>
        sd + parseFloat(d.subtotal_calculado), 0)), 0), 0);
}

// ─── POST /api/cliente/paypal/orden ─────────────────────────────────────────
exports.crearOrden = async (req, res, next) => {
  try {
    const { token_sesion, tipo = 'individual', propina = 0 } = req.body;
    const sesion = await SesionCliente.findOne({
      where: { token_cookie: token_sesion, estado: 'activa' },
      include: [{ model: Mesa, as: 'mesa' }],
    });
    if (!sesion) return res.status(403).json({ ok: false, error: 'Sesión inválida o cerrada.' });

    const propinaNum = Math.max(0, parseFloat(propina) || 0);
    const subtotal = tipo === 'grupal'
      ? await totalMesa(sesion.id_mesa)
      : await totalSesion(sesion);
    const subtotalFix = parseFloat(subtotal.toFixed(2));
    const propinaFix  = parseFloat(propinaNum.toFixed(2));
    const total       = parseFloat((subtotalFix + propinaFix).toFixed(2));

    const { client_id, secret, modo } = await paypalCreds();
    if (!client_id || !secret) {
      return res.status(503).json({ ok: false, error: 'Pago en línea no disponible en este momento.' });
    }
    const client = buildClient(client_id, secret, modo);

    const breakdown = {
      item_total: { currency_code: 'MXN', value: subtotalFix.toFixed(2) },
    };
    if (propinaFix > 0) {
      breakdown.handling = { currency_code: 'MXN', value: propinaFix.toFixed(2) };
    }

    const origin = (process.env.CORS_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
    const id_sesion = sesion.id;
    const returnUrl = `${origin}/paypal-return?paypal_ok=1&id_sesion=${id_sesion}`;
    const cancelUrl = `${origin}/paypal-return?paypal_cancelado=1&id_sesion=${id_sesion}`;

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'MXN', value: total.toFixed(2), breakdown },
      }],
      application_context: {
        brand_name: 'Mochi Matcha',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    });

    const order = await client.execute(request);
    const approve = (order.result.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve) {
      return res.status(502).json({ ok: false, error: 'PayPal no devolvió URL de aprobación.' });
    }

    res.json({
      ok: true,
      order_id: order.result.id,
      approve_url: approve.href,
      subtotal: subtotalFix,
      propina: propinaFix,
      total,
    });
  } catch (err) {
    console.error('paypal.crearOrden:', err.message);
    res.status(502).json({ ok: false, error: `Error al contactar PayPal: ${err.message}` });
  }
};

// ─── POST /api/cliente/paypal/capturar ──────────────────────────────────────
exports.capturarOrden = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { token_sesion, order_id, tipo = 'individual', propina = 0 } = req.body;
    const sesion = await SesionCliente.findOne({
      where: { token_cookie: token_sesion },
      include: [{ model: Mesa, as: 'mesa' }],
      transaction: t,
    });
    if (!sesion) {
      await t.rollback();
      return res.status(403).json({ ok: false, error: 'Sesión inválida.' });
    }

    // Validar estado ANTES de capturar (no cobrar a clientes sin cuenta abierta)
    if (tipo === 'grupal') {
      const activas = await SesionCliente.count({
        where: { id_mesa: sesion.id_mesa, estado: 'activa' },
        transaction: t,
      });
      if (!activas) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'La cuenta de esta mesa ya fue saldada.' });
      }
    } else if (sesion.estado !== 'activa') {
      await t.rollback();
      return res.status(409).json({ ok: false, error: 'Tu cuenta ya fue saldada.' });
    }

    const { client_id, secret, modo } = await paypalCreds();
    if (!client_id || !secret) {
      await t.rollback();
      return res.status(503).json({ ok: false, error: 'Pago en línea no disponible.' });
    }

    const client = buildClient(client_id, secret, modo);
    const captureReq = new paypal.orders.OrdersCaptureRequest(order_id);
    captureReq.requestBody({});
    let capture;
    try {
      capture = await client.execute(captureReq);
    } catch (e) {
      await t.rollback();
      return res.status(502).json({ ok: false, error: `Error al capturar pago: ${e.message}` });
    }
    if (capture.result.status !== 'COMPLETED') {
      await t.rollback();
      return res.status(402).json({ ok: false, error: 'El pago no fue completado en PayPal.' });
    }

    const metodoPaypal = await MetodoPago.findOne({ where: { descripcion: { [Op.like]: '%PayPal%' } }, transaction: t });
    const estProc = await EstadoSolicitud.findOne({ where: { descripcion: 'procesada' }, transaction: t });
    const estPend = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' }, transaction: t });
    const propinaFix = Math.max(0, parseFloat(propina) || 0);

    let totalConsumo = 0;
    let sesionesCubiertas = [];

    if (tipo === 'grupal') {
      const sesionesAct = await SesionCliente.findAll({
        where: { id_mesa: sesion.id_mesa, estado: 'activa' },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      sesionesCubiertas = sesionesAct;
      const pedidos = await Pedido.findAll({
        where: {
          id_sesion: sesionesAct.map((s) => s.id),
          estado: { [Op.ne]: 'cancelado' },
        },
        include: [{ model: DetallePedido, as: 'detalles' }],
        transaction: t,
      });
      totalConsumo = pedidos.reduce((acc, p) =>
        acc + p.detalles.reduce((s, d) => s + parseFloat(d.subtotal_calculado), 0), 0);

      // Actualiza o crea SolicitudPago
      let sol = null;
      for (const s of sesionesAct) {
        const existing = await SolicitudPago.findOne({
          where: { id_sesion: s.id, id_estado_solicitud: estPend?.id },
          transaction: t,
        });
        if (existing) {
          await existing.update({
            id_estado_solicitud: estProc?.id,
            id_metodo_pago: metodoPaypal?.id,
            referencia_externa: order_id,
            detalle_pago: 'PAYPAL',
            propina_sugerida: propinaFix,
            total_mesa: totalConsumo,
          }, { transaction: t });
          if (!sol) sol = existing;
        }
        await s.update({ estado: 'pagada' }, { transaction: t });
      }
      if (!sol) {
        sol = await SolicitudPago.create({
          id_mesa: sesion.id_mesa,
          tipo: 'grupal',
          total_mesa: totalConsumo,
          propina_sugerida: propinaFix,
          id_estado_solicitud: estProc?.id,
          id_metodo_pago: metodoPaypal?.id,
          referencia_externa: order_id,
          detalle_pago: 'PAYPAL',
        }, { transaction: t });
      }
      await sol.setSesiones_cubiertas(sesionesAct, { transaction: t });
    } else {
      const sesionLocked = await SesionCliente.findOne({
        where: { id: sesion.id, estado: 'activa' },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!sesionLocked) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'Esta sesión ya fue procesada.' });
      }
      sesionesCubiertas = [sesionLocked];

      const pedidos = await Pedido.findAll({
        where: { id_sesion: sesionLocked.id, estado: { [Op.ne]: 'cancelado' } },
        include: [{ model: DetallePedido, as: 'detalles' }],
        transaction: t,
      });
      totalConsumo = pedidos.reduce((acc, p) =>
        acc + p.detalles.reduce((s, d) => s + parseFloat(d.subtotal_calculado), 0), 0);

      let sol = await SolicitudPago.findOne({
        where: { id_sesion: sesionLocked.id, id_estado_solicitud: estPend?.id },
        transaction: t,
      });
      if (!sol) {
        sol = await SolicitudPago.create({
          id_sesion: sesionLocked.id,
          id_mesa: sesionLocked.id_mesa,
          tipo: 'individual',
          total_individual: totalConsumo,
          propina_sugerida: propinaFix,
          id_estado_solicitud: estProc?.id,
          id_metodo_pago: metodoPaypal?.id,
          referencia_externa: order_id,
          detalle_pago: 'PAYPAL',
        }, { transaction: t });
      } else {
        await sol.update({
          id_estado_solicitud: estProc?.id,
          id_metodo_pago: metodoPaypal?.id,
          referencia_externa: order_id,
          detalle_pago: 'PAYPAL',
          propina_sugerida: propinaFix,
          total_individual: totalConsumo,
        }, { transaction: t });
      }
      await sesionLocked.update({ estado: 'pagada' }, { transaction: t });
      await sol.setSesiones_cubiertas([sesionLocked], { transaction: t });
    }

    // Post-pago: NO libera la mesa, solo limpia PIN + nota_cierre si todas pagaron
    const restantes = await SesionCliente.count({
      where: { id_mesa: sesion.id_mesa, estado: 'activa' }, transaction: t,
    });
    if (restantes === 0) {
      const mesa = await Mesa.findByPk(sesion.id_mesa, { transaction: t });
      if (mesa) {
        const updates = { nota_cierre: 'Cuenta saldada — lista para cerrar' };
        if (mesa.pin_actual) updates.pin_actual = null;
        await mesa.update(updates, { transaction: t });
      }
    }

    // Alerta mesero
    await AlertaMesero.create({
      id_mesa: sesion.id_mesa,
      id_sesion: sesion.id,
      tipo: 'cuenta',
      mensaje: `${tipo === 'grupal' ? 'Toda la mesa' : sesion.alias} pagó por PayPal — $${(totalConsumo + propinaFix).toFixed(2)}${propinaFix > 0 ? ` (incluye propina $${propinaFix.toFixed(2)})` : ''}`,
    }, { transaction: t });

    await t.commit();

    res.json({
      ok: true,
      total_pagado: parseFloat((totalConsumo + propinaFix).toFixed(2)),
      subtotal: parseFloat(totalConsumo.toFixed(2)),
      propina: propinaFix,
      order_id,
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── POST /api/mesero/paypal/crear-orden ────────────────────────────────────
// Body: { mesa_id, sesion_id?, propina? } → { order_id, approve_url, ... }
exports.crearOrdenMesero = async (req, res) => {
  try {
    const { mesa_id, sesion_id, propina = 0 } = req.body;
    if (!mesa_id) return res.status(400).json({ ok: false, error: 'mesa_id requerido' });

    const mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });

    // Validar estado pre-PayPal
    if (sesion_id) {
      const s = await SesionCliente.findOne({ where: { id: sesion_id, id_mesa: mesa_id } });
      if (!s) return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });
      if (s.estado !== 'activa') {
        return res.status(409).json({ ok: false, error: `La cuenta de ${s.alias || ''} ya fue saldada.` });
      }
    } else {
      const activas = await SesionCliente.count({ where: { id_mesa: mesa_id, estado: 'activa' } });
      if (!activas) return res.status(409).json({ ok: false, error: 'La cuenta de esta mesa ya fue saldada.' });
    }

    const propinaNum = Math.max(0, parseFloat(propina) || 0);
    const subtotal = sesion_id
      ? await totalSesion({ id: sesion_id })
      : await totalMesa(mesa_id);
    const subtotalFix = parseFloat(subtotal.toFixed(2));
    const propinaFix  = parseFloat(propinaNum.toFixed(2));
    const total       = parseFloat((subtotalFix + propinaFix).toFixed(2));

    const { client_id, secret, modo } = await paypalCreds();
    if (!client_id || !secret) {
      return res.status(503).json({ ok: false, error: 'Pago en línea no disponible.' });
    }
    const client = buildClient(client_id, secret, modo);

    const breakdown = {
      item_total: { currency_code: 'MXN', value: subtotalFix.toFixed(2) },
    };
    if (propinaFix > 0) {
      breakdown.handling = { currency_code: 'MXN', value: propinaFix.toFixed(2) };
    }

    const origin = (process.env.CORS_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
    const returnUrl = `${origin}/mesero/mapa?paypal_ok=1&mesa=${mesa_id}`;
    const cancelUrl = `${origin}/mesero/mapa?paypal_cancelado=1&mesa=${mesa_id}`;

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'MXN', value: total.toFixed(2), breakdown },
      }],
      application_context: {
        brand_name: 'Mochi Matcha',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    });

    const order = await client.execute(request);
    const approve = (order.result.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve) {
      return res.status(502).json({ ok: false, error: 'PayPal no devolvió URL de aprobación.' });
    }

    return res.json({
      ok: true,
      order_id: order.result.id,
      approve_url: approve.href,
      subtotal: subtotalFix,
      propina: propinaFix,
      total,
    });
  } catch (err) {
    console.error('paypal.crearOrdenMesero:', err.message);
    return res.status(502).json({ ok: false, error: `Error al contactar PayPal: ${err.message}` });
  }
};

// ─── POST /api/mesero/paypal/capturar ───────────────────────────────────────
// Body: { order_id, mesa_id, sesion_id?, propina? } → { solicitud_id, ticket_url, ... }
exports.capturarOrdenMesero = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { order_id, mesa_id, sesion_id, propina = 0 } = req.body;
    if (!order_id || !mesa_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, error: 'order_id y mesa_id requeridos' });
    }

    const mesa = await Mesa.findByPk(mesa_id, { transaction: t });
    if (!mesa) {
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Mesa no encontrada' });
    }

    // ★ CRÍTICO: validar estado ANTES de capturar en PayPal
    if (sesion_id) {
      const sPre = await SesionCliente.findOne({
        where: { id: sesion_id, id_mesa: mesa_id },
        transaction: t,
      });
      if (!sPre || sPre.estado !== 'activa') {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'Esta cuenta ya fue saldada.' });
      }
    } else {
      const activas = await SesionCliente.count({
        where: { id_mesa: mesa_id, estado: 'activa' }, transaction: t,
      });
      if (!activas) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'La cuenta de esta mesa ya fue saldada.' });
      }
    }

    const { client_id, secret, modo } = await paypalCreds();
    if (!client_id || !secret) {
      await t.rollback();
      return res.status(503).json({ ok: false, error: 'Pago en línea no disponible.' });
    }

    // ─── Capturar en PayPal ───
    const client = buildClient(client_id, secret, modo);
    const captureReq = new paypal.orders.OrdersCaptureRequest(order_id);
    captureReq.requestBody({});
    let capture;
    try {
      capture = await client.execute(captureReq);
    } catch (e) {
      await t.rollback();
      return res.status(502).json({ ok: false, error: `Error al capturar pago: ${e.message}` });
    }
    if (capture.result.status !== 'COMPLETED') {
      await t.rollback();
      return res.status(402).json({ ok: false, error: 'El pago no fue completado en PayPal.' });
    }

    // ─── Aplicar pago en BD ───
    const metodoPaypal = await MetodoPago.findOne({
      where: { descripcion: { [Op.like]: '%PayPal%' } }, transaction: t,
    });
    const estProc = await EstadoSolicitud.findOne({ where: { descripcion: 'procesada' }, transaction: t });
    const estPend = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' }, transaction: t });
    const propinaFix = Math.max(0, parseFloat(propina) || 0);

    let totalConsumo = 0;
    let sesionesCubiertas = [];
    let sol;

    if (sesion_id) {
      const sLock = await SesionCliente.findOne({
        where: { id: sesion_id, estado: 'activa' },
        lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!sLock) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'Esta sesión ya fue procesada.' });
      }
      sesionesCubiertas = [sLock];

      const pedidos = await Pedido.findAll({
        where: { id_sesion: sLock.id, estado: { [Op.ne]: 'cancelado' } },
        include: [{ model: DetallePedido, as: 'detalles' }], transaction: t,
      });
      totalConsumo = pedidos.reduce((acc, p) =>
        acc + p.detalles.reduce((s, d) => s + parseFloat(d.subtotal_calculado), 0), 0);

      sol = await SolicitudPago.findOne({
        where: { id_sesion: sLock.id, id_estado_solicitud: estPend?.id },
        transaction: t,
      });
      if (!sol) {
        sol = await SolicitudPago.create({
          id_sesion: sLock.id, id_mesa: mesa.id,
          tipo: 'individual', total_individual: totalConsumo,
          propina_sugerida: propinaFix,
          id_estado_solicitud: estProc?.id,
          id_metodo_pago: metodoPaypal?.id,
          referencia_externa: order_id,
          detalle_pago: 'PAYPAL',
        }, { transaction: t });
      } else {
        await sol.update({
          id_estado_solicitud: estProc?.id,
          id_metodo_pago: metodoPaypal?.id,
          referencia_externa: order_id,
          detalle_pago: 'PAYPAL',
          propina_sugerida: propinaFix,
          total_individual: totalConsumo,
        }, { transaction: t });
      }
      await sLock.update({ estado: 'pagada' }, { transaction: t });
      if (sol.setSesiones_cubiertas) {
        await sol.setSesiones_cubiertas([sLock], { transaction: t });
      }
    } else {
      const sesionesAct = await SesionCliente.findAll({
        where: { id_mesa: mesa.id, estado: 'activa' },
        lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!sesionesAct.length) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'La cuenta de esta mesa ya fue saldada.' });
      }
      sesionesCubiertas = sesionesAct;

      const pedidos = await Pedido.findAll({
        where: {
          id_sesion: sesionesAct.map((s) => s.id),
          estado: { [Op.ne]: 'cancelado' },
        },
        include: [{ model: DetallePedido, as: 'detalles' }], transaction: t,
      });
      totalConsumo = pedidos.reduce((acc, p) =>
        acc + p.detalles.reduce((s, d) => s + parseFloat(d.subtotal_calculado), 0), 0);

      for (const s of sesionesAct) {
        const existing = await SolicitudPago.findOne({
          where: { id_sesion: s.id, id_estado_solicitud: estPend?.id },
          transaction: t,
        });
        if (existing) {
          await existing.update({
            id_estado_solicitud: estProc?.id,
            id_metodo_pago: metodoPaypal?.id,
            referencia_externa: order_id,
            detalle_pago: 'PAYPAL',
            propina_sugerida: propinaFix,
            total_mesa: totalConsumo,
          }, { transaction: t });
          if (!sol) sol = existing;
        }
        await s.update({ estado: 'pagada' }, { transaction: t });
      }
      if (!sol) {
        sol = await SolicitudPago.create({
          id_mesa: mesa.id, id_sesion: null,
          tipo: 'grupal', total_mesa: totalConsumo,
          propina_sugerida: propinaFix,
          id_estado_solicitud: estProc?.id,
          id_metodo_pago: metodoPaypal?.id,
          referencia_externa: order_id,
          detalle_pago: 'PAYPAL',
        }, { transaction: t });
      }
      if (sol.setSesiones_cubiertas) {
        await sol.setSesiones_cubiertas(sesionesAct, { transaction: t });
      }
    }

    // Post-pago: NO libera la mesa, solo limpia PIN + nota_cierre
    const restantes = await SesionCliente.count({
      where: { id_mesa: mesa.id, estado: 'activa' }, transaction: t,
    });
    if (restantes === 0) {
      const updates = { nota_cierre: 'Cuenta saldada — lista para cerrar' };
      if (mesa.pin_actual) updates.pin_actual = null;
      await mesa.update(updates, { transaction: t });
    }

    // AlertaMesero del cobro
    const totalPagado = parseFloat((totalConsumo + propinaFix).toFixed(2));
    const propinaTxt = propinaFix > 0 ? ` (incluye propina $${propinaFix.toFixed(2)})` : '';
    await AlertaMesero.create({
      id_mesa: mesa.id,
      id_sesion: sesion_id || null,
      tipo: 'cuenta',
      mensaje: `${sesion_id ? `Sesión #${sesion_id}` : 'Toda la mesa'} pagó por PayPal — $${totalPagado.toFixed(2)}${propinaTxt}`,
    }, { transaction: t });

    await t.commit();

    // Auditoria (fuera de la TX crítica)
    await Auditoria.create({
      accion: 'Pago PayPal procesado por mesero',
      detalle: `Mesa ${mesa.numero_mesa} | ${sesion_id ? `Sesión #${sesion_id}` : 'Todas las sesiones'} | ` +
               `Referencia: ${order_id} | Total: $${totalConsumo.toFixed(2)} | Propina: $${propinaFix.toFixed(2)}`,
      id_empleado: req.user?.id || null,
      id_mesa: mesa.id,
    });

    return res.json({
      ok: true,
      solicitud_id: sol?.id,
      ticket_url: sol ? `/mesero/ticket/${sol.id}/` : null,
      total_pagado: totalPagado,
      subtotal: parseFloat(totalConsumo.toFixed(2)),
      propina: propinaFix,
      order_id,
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── GET /api/cliente/paypal/config ─────────────────────────────────────────
exports.getConfig = async (_req, res) => {
  try {
    const { client_id, modo } = await paypalCreds();
    res.json({
      enabled: !!client_id,
      client_id: client_id || null,
      modo: modo || 'sandbox',
    });
  } catch (err) {
    res.json({ enabled: false, client_id: null, modo: 'sandbox' });
  }
};
