/**
 * Pedidos controller (staff genérico): lectura por mesa y acciones simples
 * compartidas entre meseros/gerentes. Para flujos complejos (edición, cancelación
 * con motivo + auditoría) ver mesero.controller.
 *
 * Exporta: listarPorMesa, entregar, cancelar.
 */
const { Op } = require('sequelize');
const { Pedido, DetallePedido, DetalleModificador, Producto, SesionCliente, Mesa } = require('../models');

/**
 * GET /api/pedidos?mesa_id=&estado=
 * Autorización: mesero, gerente, admin.
 *
 * Dos modos:
 *   - Si `estado` se pasa: filtra todos los pedidos por estado (incluye
 *     SesionCliente+Mesa para mostrar contexto). Útil p.ej. para KDS-light
 *     filtrando estado='listo'.
 *   - Si NO se pasa estado: lista pedidos de las sesiones activas de la mesa
 *     indicada (`mesa_id`), todos los estados, ordenados desc por ingreso.
 *
 * @returns Pedido[] con detalles+producto+modificadores
 */
exports.listarPorMesa = async (req, res, next) => {
  try {
    const { mesa_id, estado } = req.query;

    if (estado) {
      const pedidos = await Pedido.findAll({
        where: { estado },
        include: [{
          model: DetallePedido,
          as: 'detalles',
          include: [
            { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
            { model: DetalleModificador, as: 'modificadores' },
          ],
        }, {
          model: SesionCliente,
          as: 'sesion',
          attributes: ['id', 'alias', 'id_mesa'],
          include: [{ model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] }],
        }],
        order: [['fecha_hora_ingreso', 'ASC']],
      });
      return res.json(pedidos);
    }

    const sesiones = await SesionCliente.findAll({ where: { id_mesa: mesa_id, estado: 'activa' }, attributes: ['id'] });
    if (!sesiones.length) return res.json([]);

    const sesionIds = sesiones.map(s => s.id);
    const pedidos = await Pedido.findAll({
      where: { id_sesion: { [Op.in]: sesionIds } },
      include: [{
        model: DetallePedido,
        as: 'detalles',
        include: [
          { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
          { model: DetalleModificador, as: 'modificadores' },
        ],
      }],
      order: [['fecha_hora_ingreso', 'DESC']],
    });
    res.json(pedidos);
  } catch (err) { next(err); }
};

/**
 * PUT /api/pedidos/:id/entregar
 * Autorización: mesero, gerente, admin.
 * Marca el pedido como entregado, registra fecha_hora_entrega y el id del
 * empleado que lo entregó (req.user.id).
 * @returns { ok }
 */
exports.entregar = async (req, res, next) => {
  try {
    const pedido = await Pedido.findByPk(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    await pedido.update({ estado: 'entregado', fecha_hora_entrega: new Date(), id_empleado_entrega: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * PUT /api/pedidos/:id/cancelar
 * Autorización: mesero, gerente, admin.
 * Body: { motivo? }
 *
 * Cancela un pedido sin reglas extra (no exige motivo). Para cancelación con
 * motivo obligatorio + auditoría usar /api/mesero/pedidos/cancelar.
 *
 * @returns { ok }
 */
exports.cancelar = async (req, res, next) => {
  try {
    const pedido = await Pedido.findByPk(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    await pedido.update({ estado: 'cancelado', motivo_cancelacion: req.body.motivo || '' });
    res.json({ ok: true });
  } catch (err) { next(err); }
};
