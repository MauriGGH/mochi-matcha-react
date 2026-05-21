/**
 * Menu controller: catálogo público (sin auth). Cliente y staff consumen el
 * menú completo (categorías + productos disponibles + grupos/opciones de
 * modificadores activos) y la lista de promociones vigentes.
 *
 * Exporta: getMenu, getPromociones.
 */
const { Op } = require('sequelize');
const { Categoria, Producto, GrupoModificador, OpcionModificador, Promocion, TipoDescuento } = require('../models');
const { imagenEfectiva } = require('../utils/imagenEfectiva');
const { aplicaHoy } = require('../utils/promociones');

/**
 * GET /api/menu
 * Público. Devuelve todas las categorías ordenadas por `orden`, con sus
 * productos disponibles (disponible=true) y grupos de modificadores cuyas
 * opciones estén activas. Productos sin grupos se incluyen igualmente.
 * @returns Categoria[] con eager-load de productos.grupos_modificadores.opciones
 */
exports.getMenu = async (req, res, next) => {
  try {
    const categorias = await Categoria.findAll({
      order: [['orden', 'ASC']],
      include: [{
        model: Producto,
        as: 'productos',
        where: { disponible: true },
        required: false,
        include: [{
          model: GrupoModificador,
          as: 'grupos_modificadores',
          include: [{
            model: OpcionModificador,
            as: 'opciones',
            where: { activo: true },
            required: false,
          }],
        }],
      }],
    });
    res.json(categorias);
  } catch (err) { next(err); }
};

/**
 * GET /api/menu/promociones
 * Público. Devuelve promociones activas vigentes (fecha_inicio<=hoy<=fecha_fin
 * + activa=true), filtradas adicionalmente en JS por `aplicaHoy(p, hoy)` que
 * respeta el campo `dias_semana`. Enriquece cada promo con `imagen_efectiva`
 * (utils/imagenEfectiva) y `tipo_descuento_descripcion`.
 * @returns Promocion[] con tipo_descuento, productos_aplicables, productos_beneficiados.
 */
exports.getPromociones = async (req, res, next) => {
  try {
    const hoy = new Date();
    const promos = await Promocion.findAll({
      where: {
        activa: true,
        fecha_inicio: { [Op.lte]: hoy },
        fecha_fin:    { [Op.gte]: hoy },
      },
      include: [
        { model: TipoDescuento, as: 'tipo_descuento' },
        { model: Producto, as: 'productos_aplicables',  attributes: ['id', 'nombre', 'imagen_url'], through: { attributes: [] } },
        { model: Producto, as: 'productos_beneficiados', attributes: ['id', 'nombre', 'imagen_url'], through: { attributes: [] } },
      ],
      order: [['orden', 'ASC']],
    });

    // Filtrar por dias_semana y enriquecer con imagen_efectiva
    const filtradas = promos.filter((p) => aplicaHoy(p, hoy));
    const payload = filtradas.map((p) => {
      const obj = p.toJSON();
      obj.imagen_efectiva = imagenEfectiva(obj);
      obj.tipo_descuento_descripcion = obj.tipo_descuento?.descripcion || null;
      return obj;
    });
    res.json(payload);
  } catch (err) { next(err); }
};
