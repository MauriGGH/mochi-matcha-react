/**
 * Mesas controller (staff): operación general de mesas/sesiones para el panel
 * mesero/gerente. Calcula estado visual (libre/alerta/cobrando/listo/cocina/
 * ocupada) según alertas y pedidos activos. También expone detalle de mesa,
 * cierre de mesa/sesión, listado de alertas/solicitudes pendientes.
 *
 * Exporta: listar, detalle, cerrar, atenderAlerta, listarAlertas,
 *          listarSolicitudes, getPedidosMesa, cerrarSesion.
 */
const { Op } = require('sequelize');
const {
  Mesa, UbicacionMesa, SesionCliente, AlertaMesero, Empleado,
  SolicitudPago, Pedido, DetallePedido, Producto, EstadoSolicitud,
} = require('../models');

/**
 * GET /api/mesas
 * Autorización: mesero, gerente, admin.
 * Lista todas las mesas con ubicación, mesero asignado, alertas no atendidas,
 * sesiones activas y sus pedidos (recibido|preparando|listo — fix#1 Bug B
 * extiende esto para poder pintar 'cocina' además de 'listo').
 *
 * Calcula estado_visual con precedencia:
 *   libre → alerta → cobrando → listo → cocina → ocupada
 *
 * @returns Mesa[] enriquecida con { estado_visual, alertas, pedidosListos, pedidosCocina, nota_cierre }
 */
exports.listar = async (req, res, next) => {
  try {
    const mesas = await Mesa.findAll({
      include: [
        { model: UbicacionMesa, as: 'ubicacion' },
        { model: Empleado, as: 'mesero', attributes: ['id_empleado', 'nombre'] },
        { model: AlertaMesero, as: 'alertas', where: { atendida: false }, required: false },
        {
          model: SesionCliente, as: 'sesiones',
          where: { estado: 'activa' }, required: false,
          include: [{
            model: Pedido, as: 'pedidos',
            // BugB(fix#1): incluir recibido/preparando para poder pintar estado 'cocina'
            where: { estado: { [Op.in]: ['recibido', 'preparando', 'listo'] } }, required: false,
          }],
        },
      ],
      order: [['numero_mesa', 'ASC']],
    });

    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });
    const solicitudesPendientes = estadoPendiente
      ? await SolicitudPago.findAll({ where: { id_estado_solicitud: estadoPendiente.id }, attributes: ['id_mesa'] })
      : [];
    const mesasConSolicitud = new Set(solicitudesPendientes.map(s => s.id_mesa));

    const result = mesas.map(m => {
      const sesiones = m.sesiones || [];
      const alertas = m.alertas || [];
      const pedidos = sesiones.flatMap((s) => s.pedidos || []);
      const pedidosListos = pedidos.filter((p) => p.estado === 'listo').length;
      const pedidosCocina = pedidos.filter((p) => ['recibido', 'preparando'].includes(p.estado)).length;
      const tieneSolicitud = mesasConSolicitud.has(m.id);

      let estado_visual;
      if (m.estado === 'libre') estado_visual = 'libre';
      else if (alertas.length > 0) estado_visual = 'alerta';
      else if (tieneSolicitud) estado_visual = 'cobrando';
      else if (pedidosListos > 0) estado_visual = 'listo';
      else if (pedidosCocina > 0) estado_visual = 'cocina';
      else estado_visual = 'ocupada';

      return {
        id: m.id,
        numero_mesa: m.numero_mesa,
        estado: m.estado,
        estado_visual,
        pin_actual: m.pin_actual,
        capacidad: m.capacidad,
        ubicacion: m.ubicacion,
        alertas,
        pedidosListos,
        pedidosCocina,
        nota_cierre: m.nota_cierre || '',
      };
    });

    res.json(result);
  } catch (err) { next(err); }
};

/**
 * GET /api/mesas/:id
 * Autorización: mesero, gerente, admin.
 * Detalle completo de una mesa: sesiones activas + sus pedidos (no cancelados)
 * con items + subtotales, además de solicitudes de pago pendientes.
 * @returns { ok, mesa_libre, mesa_id, numero_mesa, pin, estado, nota_cierre,
 *            sesiones: [...], solicitudes: [...], total_mesa }
 */
exports.detalle = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const sesiones = await SesionCliente.findAll({
      where: { id_mesa: mesa.id, estado: 'activa' },
      order: [['fecha_inicio', 'ASC']],
    });

    const sesionesData = [];
    for (const s of sesiones) {
      const pedidos = await Pedido.findAll({
        where: { id_sesion: s.id, estado: { [Op.ne]: 'cancelado' } },
        include: [{
          model: DetallePedido, as: 'detalles',
          include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }],
        }],
        order: [['fecha_hora_ingreso', 'DESC']],
      });
      const totalSesion = pedidos.reduce(
        (acc, p) => acc + (p.detalles || []).reduce((s2, d) => s2 + parseFloat(d.subtotal_calculado || 0), 0), 0
      );
      sesionesData.push({
        id: s.id,
        alias: s.alias,
        total: totalSesion,
        pedidos: pedidos.map(p => ({
          id: p.id,
          estado: p.estado,
          fecha: p.fecha_hora_ingreso,
          items: (p.detalles || []).map(d => ({
            nombre: d.producto?.nombre,
            cantidad: d.cantidad,
            subtotal: parseFloat(d.subtotal_calculado),
            notas: d.notas || '',
          })),
        })),
      });
    }

    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });
    const solicitudesData = [];
    if (estadoPendiente) {
      const solicitudes = await SolicitudPago.findAll({
        where: { id_mesa: mesa.id, id_estado_solicitud: estadoPendiente.id },
        include: [{ model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'] }],
        order: [['fecha_hora', 'DESC']],
      });
      for (const sol of solicitudes) {
        solicitudesData.push({
          id: sol.id,
          alias: sol.tipo === 'grupal' ? 'Toda la mesa' : (sol.sesion?.alias || ''),
          sesion_id: sol.id_sesion || null,
          tipo: sol.tipo,
          total: parseFloat(sol.total_mesa || 0),
          fecha: sol.fecha_hora,
          metodo_pref: sol.detalle_pago || '',
        });
      }
    }

    const totalMesa = sesionesData.reduce((acc, s) => acc + s.total, 0);

    res.json({
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
 * PUT /api/mesas/:id/cerrar
 * Autorización: mesero, gerente, admin.
 * Cierre forzado de la mesa: marca todas las sesiones activa|pagada como
 * 'cerrada' y libera la mesa (estado='libre', pin_actual=null, nota_cierre='').
 * @returns { ok }
 */
exports.cerrar = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    await SesionCliente.update(
      { estado: 'cerrada' },
      { where: { id_mesa: mesa.id, estado: ['activa', 'pagada'] } }
    );
    await mesa.update({ estado: 'libre', pin_actual: null, nota_cierre: '' });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * PUT /api/mesas/:id/alerta/:alertaId/atender
 * Autorización: mesero, gerente, admin.
 * Marca una AlertaMesero como atendida (atendida=true).
 * @returns { ok }
 */
exports.atenderAlerta = async (req, res, next) => {
  try {
    const alerta = await AlertaMesero.findByPk(req.params.alertaId);
    if (!alerta) return res.status(404).json({ error: 'Alerta no encontrada' });
    await alerta.update({ atendida: true });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * GET /api/mesas/alertas
 * Autorización: mesero, gerente, admin.
 * Lista AlertaMesero no atendidas, con la mesa asociada, ordenadas por fecha
 * de creación ascendente (FIFO para atención).
 * @returns AlertaMesero[]
 */
exports.listarAlertas = async (req, res, next) => {
  try {
    const alertas = await AlertaMesero.findAll({
      where: { atendida: false },
      include: [{ model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] }],
      order: [['fecha_creacion', 'ASC']],
    });
    res.json(alertas);
  } catch (err) { next(err); }
};

/**
 * GET /api/mesas/solicitudes
 * Autorización: mesero, gerente, admin.
 * Lista SolicitudPago en estado 'pendiente' con Mesa y Sesion. Si no existe
 * el estado pendiente devuelve todas las solicitudes (defensa por si la
 * tabla EstadoSolicitud no fue seeded).
 * @returns SolicitudPago[]
 */
exports.listarSolicitudes = async (req, res, next) => {
  try {
    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });
    const solicitudes = await SolicitudPago.findAll({
      where: estadoPendiente ? { id_estado_solicitud: estadoPendiente.id } : {},
      include: [
        { model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] },
        { model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'] },
      ],
      order: [['fecha_hora', 'ASC']],
    });
    res.json(solicitudes);
  } catch (err) { next(err); }
};

/**
 * GET /api/mesas/:id/pedidos
 * Autorización: mesero, gerente, admin.
 * Pedidos de las sesiones activas de la mesa, con detalle+producto. Solo
 * estados operativos (recibido|preparando|listo|entregado), descarta cancelados.
 * @returns Pedido[]
 */
exports.getPedidosMesa = async (req, res, next) => {
  try {
    const sesiones = await SesionCliente.findAll({
      where: { id_mesa: req.params.id, estado: 'activa' },
      attributes: ['id'],
    });
    if (!sesiones.length) return res.json([]);

    const sesionIds = sesiones.map(s => s.id);
    const pedidos = await Pedido.findAll({
      where: {
        id_sesion: { [Op.in]: sesionIds },
        estado: { [Op.in]: ['recibido', 'preparando', 'listo', 'entregado'] },
      },
      include: [{
        model: DetallePedido,
        as: 'detalles',
        include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }],
      }],
      order: [['fecha_hora_ingreso', 'DESC']],
    });
    res.json(pedidos);
  } catch (err) { next(err); }
};

/**
 * POST /api/mesas/sesion/cerrar
 * Autorización: mesero, gerente, admin.
 * Body: { sesion_id }
 *
 * Cierra UNA sesión individual. Si tras el cierre no quedan sesiones activas
 * en la mesa, libera la mesa (estado='libre', pin_actual=null). Idempotente:
 * si la sesión no está activa devuelve { ok, ya_cerrada:true }.
 *
 * @returns { ok, ya_cerrada? }
 */
exports.cerrarSesion = async (req, res, next) => {
  try {
    const { sesion_id } = req.body;
    if (!sesion_id) return res.status(400).json({ ok: false, error: 'sesion_id requerido' });

    const sesion = await SesionCliente.findByPk(sesion_id);
    if (!sesion) return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });

    if (sesion.estado !== 'activa') return res.json({ ok: true, ya_cerrada: true });

    await sesion.update({ estado: 'cerrada' });

    const quedan = await SesionCliente.count({ where: { id_mesa: sesion.id_mesa, estado: 'activa' } });
    if (!quedan) {
      await Mesa.update({ estado: 'libre', pin_actual: null }, { where: { id: sesion.id_mesa } });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
};
