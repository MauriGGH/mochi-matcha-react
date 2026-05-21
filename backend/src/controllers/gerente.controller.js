/**
 * Gerente controller: panel de administración. CRUD de catálogo, empleados,
 * mesas, configuración, horarios, promociones, modificadores e imágenes, más
 * dashboard, reportes (PDF/XLSX) y auditoría. Todas las rutas requieren JWT
 * + rol gerente|admin (forzado en routes/gerente.routes.js).
 *
 * Endpoints más críticos:
 *   - getReportes / getReportesAvanzados / exportarReporte*: agregaciones por
 *     periodo (día/semana/mes) usadas por el dashboard. Pueden ser caras.
 *   - statsJson: stats en vivo del día (pedidos, ventas, mesas).
 *   - getMesasEstado / getDetalleMesa: floor plan tiempo real.
 *   - uploadImagen / listarImagenes: gestión de archivos en public/media/uploads.
 *   - crearPromocion / actualizarPromocion: validación compleja (porcentaje,
 *     "lleva X paga Y", cupones únicos).
 *
 * Exporta 58 handlers (ver routes/gerente.routes.js para mapa completo).
 */
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Mesa, UbicacionMesa, Producto, Categoria, Empleado,
  Pedido, DetallePedido, SesionCliente, SolicitudPago,
  AlertaMesero, MetodoPago, EstadoSolicitud,
  GrupoModificador, OpcionModificador, DetalleModificador,
  Promocion, TipoDescuento,
  Configuracion, HorarioAtencion,
  Auditoria,
} = require('../models');

const MEDIA_ROOT  = path.join(__dirname, '../../public/media');
const UPLOADS_DIR = path.join(MEDIA_ROOT, 'uploads');
const IMAGES_DIR  = path.join(MEDIA_ROOT, 'images');
const ALLOWED_IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// ─── Helper validación de promociones ────────────────────────────────────────
async function _validarPromoData({ titulo, fecha_inicio, fecha_fin, valor_descuento, cantidad_minima, id_tipo_descuento, codigo_cupon, id_excluir }) {
  if (!titulo || String(titulo).trim() === '') return 'El título es requerido.';
  if (String(titulo).length > 100) return 'El título no puede superar 100 caracteres.';
  const fi = fecha_inicio ? new Date(fecha_inicio) : null;
  const ff = fecha_fin ? new Date(fecha_fin) : null;
  if (!fi || isNaN(fi)) return 'fecha_inicio inválida.';
  if (!ff || isNaN(ff)) return 'fecha_fin inválida.';
  if (ff < fi) return 'fecha_fin debe ser mayor o igual a fecha_inicio.';
  const vd = parseFloat(valor_descuento ?? 0);
  if (isNaN(vd) || vd < 0) return 'valor_descuento debe ser >= 0.';
  if (id_tipo_descuento) {
    const tipo = await TipoDescuento.findByPk(id_tipo_descuento);
    if (!tipo) return 'Tipo de descuento no encontrado.';
    const desc = (tipo.descripcion || '').toUpperCase();
    if (desc.includes('PORCENTAJE')) {
      if (vd > 100) return 'Un descuento por porcentaje no puede superar 100.';
    }
    if (desc.includes('LLEVA') && desc.includes('PAGA')) {
      const cm = parseInt(cantidad_minima || 0);
      if (cm < 2) return 'Para "Lleva X paga Y", cantidad_minima debe ser >= 2.';
      if (!Number.isInteger(vd)) return 'Para "Lleva X paga Y", valor_descuento debe ser entero.';
      if (vd >= cm) return 'Para "Lleva X paga Y", valor_descuento (Y) debe ser menor que cantidad_minima (X).';
    }
  }
  if (codigo_cupon) {
    const where = { codigo_cupon };
    if (id_excluir) where.id = { [Op.ne]: id_excluir };
    const dup = await Promocion.findOne({ where });
    if (dup) return 'El código de cupón ya está en uso.';
  }
  return null;
}

// ─── Mesas ────────────────────────────────────────────────────────────────────

/**
 * GET /api/gerente/mesas
 * Autorización: gerente, admin.
 * Lista todas las mesas con ubicación + mesero asignado, ordenadas por número.
 * @returns Mesa[]
 */
exports.listarMesas = async (req, res, next) => {
  try {
    const mesas = await Mesa.findAll({
      include: [
        { model: UbicacionMesa, as: 'ubicacion' },
        { model: Empleado, as: 'mesero', attributes: ['id_empleado', 'nombre'] },
      ],
      order: [['numero_mesa', 'ASC']],
    });
    res.json(mesas);
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/mesas
 * Autorización: gerente, admin.
 * Body: { numero_mesa, capacidad, id_ubicacion?, id_mesero_asignado? }
 * Crea Mesa validando numero/capacidad enteros>0 y unicidad de numero_mesa.
 * Registra Auditoria.
 * @returns 201 { ok, id, mesa }
 */
exports.crearMesa = async (req, res, next) => {
  try {
    const { numero_mesa, capacidad, id_ubicacion, id_mesero_asignado } = req.body;
    const num = parseInt(numero_mesa);
    if (!isFinite(num) || num <= 0) return res.status(400).json({ error: 'numero_mesa debe ser un entero mayor a 0.' });
    const cap = parseInt(capacidad);
    if (!isFinite(cap) || cap <= 0) return res.status(400).json({ error: 'capacidad debe ser un entero mayor a 0.' });
    const existe = await Mesa.findOne({ where: { numero_mesa: num } });
    if (existe) return res.status(400).json({ error: `Ya existe una mesa con el número ${num}.` });
    const mesa = await Mesa.create({ numero_mesa: num, capacidad: cap, id_ubicacion: id_ubicacion || null, id_mesero_asignado: id_mesero_asignado || null });
    await Auditoria.create({ accion: 'Mesa creada', id_empleado: req.user.id, detalle: `Mesa #${mesa.numero_mesa} creada.` });
    res.status(201).json({ ok: true, id: mesa.id, mesa });
  } catch (err) { next(err); }
};

/**
 * GET /api/gerente/mesas/:id/qr?format=png|svg|dataurl|json
 * Genera y devuelve el QR de la mesa, apuntando a /bienvenida/<codigo_qr>.
 * format=png    → image/png (default)
 * format=svg    → image/svg+xml
 * format=dataurl→ {qr_data_url, codigo_qr, url} JSON
 */
exports.getMesaQR = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const baseUrl = (process.env.CORS_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
    const fullUrl = `${baseUrl}/bienvenida/${mesa.codigo_qr}`;
    const fmt = (req.query.format || 'png').toLowerCase();

    if (fmt === 'svg') {
      const svg = await QRCode.toString(fullUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 320 });
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    }
    if (fmt === 'dataurl' || fmt === 'json') {
      const dataUrl = await QRCode.toDataURL(fullUrl, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
      return res.json({
        qr_data_url: dataUrl,
        codigo_qr: mesa.codigo_qr,
        url: fullUrl,
        numero_mesa: mesa.numero_mesa,
      });
    }
    // png default
    const buffer = await QRCode.toBuffer(fullUrl, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-mesa-${mesa.numero_mesa}.png"`);
    res.send(buffer);
  } catch (err) { next(err); }
};

/** POST /api/gerente/mesas/:id/regenerar-qr → genera un nuevo codigo_qr para la mesa */
exports.regenerarMesaQR = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    const { v4: uuidv4 } = require('uuid');
    const nuevoCodigo = `mesa-${mesa.numero_mesa}-${uuidv4().replace(/-/g, '').slice(0, 8)}`;
    await mesa.update({ codigo_qr: nuevoCodigo });
    res.json({ ok: true, codigo_qr: nuevoCodigo });
  } catch (err) { next(err); }
};

/**
 * PUT /api/gerente/mesas/:id
 * Autorización: gerente, admin.
 * Actualiza campos de la mesa (numero_mesa validado y único si presente).
 * Registra Auditoria.
 * @returns { ok, mesa }
 */
exports.actualizarMesa = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (req.body.numero_mesa !== undefined) {
      const num = parseInt(req.body.numero_mesa);
      if (!isFinite(num) || num <= 0) return res.status(400).json({ error: 'numero_mesa debe ser un entero mayor a 0.' });
      const existe = await Mesa.findOne({ where: { numero_mesa: num, id: { [Op.ne]: mesa.id } } });
      if (existe) return res.status(400).json({ error: `Ya existe una mesa con el número ${num}.` });
    }
    await mesa.update(req.body);
    await Auditoria.create({ accion: 'Mesa actualizada', id_empleado: req.user.id, detalle: `Mesa #${mesa.numero_mesa} actualizada.` });
    res.json({ ok: true, mesa });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/gerente/mesas/:id
 * Autorización: gerente, admin.
 * Borrado físico solo si la mesa está 'libre' Y no tiene histórico de sesiones.
 * @returns { ok } / 400 si tiene sesiones históricas o no está libre.
 */
exports.eliminarMesa = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (mesa.estado !== 'libre') return res.status(400).json({ ok: false, error: 'Solo se eliminan mesas libres.' });
    const historial = await SesionCliente.count({ where: { id_mesa: mesa.id } });
    if (historial > 0) return res.status(400).json({ ok: false, error: 'La mesa tiene histórico de sesiones y no puede eliminarse.' });
    await mesa.destroy();
    await Auditoria.create({ accion: 'Mesa eliminada', id_empleado: req.user.id, detalle: `Mesa #${mesa.numero_mesa} eliminada.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/mesas/:id/asignar
 * Autorización: gerente, admin.
 * Body: { empleado_id? }  (empleado_id=null/falsy → desasigna)
 * Solo permite asignar empleados con rol='mesero'.
 * @returns { ok }
 */
exports.asignarMesero = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    const { empleado_id } = req.body;
    if (empleado_id) {
      const empleado = await Empleado.findByPk(empleado_id);
      if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });
      if (empleado.rol !== 'mesero') return res.status(400).json({ ok: false, error: 'Solo se puede asignar un empleado con rol de mesero.' });
      await mesa.update({ id_mesero_asignado: empleado.id_empleado });
    } else {
      await mesa.update({ id_mesero_asignado: null });
    }
    await Auditoria.create({ accion: 'Mesero asignado', id_empleado: req.user.id, detalle: `Mesa #${mesa.numero_mesa}: mesero_id=${empleado_id || 'null'}.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Ubicaciones ──────────────────────────────────────────────────────────────

/**
 * GET /api/gerente/ubicaciones — lista UbicacionMesa ordenadas por nombre. (gerente|admin)
 */
exports.listarUbicaciones = async (req, res, next) => {
  try {
    res.json(await UbicacionMesa.findAll({ order: [['nombre', 'ASC']] }));
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/ubicaciones (gerente|admin)
 * Body: { nombre } — único (case-insensitive UPPER).
 * @returns 201 { ok, id, ubicacion }
 */
exports.crearUbicacion = async (req, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre || String(nombre).trim() === '') return res.status(400).json({ error: 'El nombre es requerido.' });
    const existe = await UbicacionMesa.findOne({ where: { nombre: String(nombre).toUpperCase() } });
    if (existe) return res.status(400).json({ error: `Ya existe una ubicación llamada "${String(nombre).toUpperCase()}".` });
    const u = await UbicacionMesa.create({ nombre });
    await Auditoria.create({ accion: 'Ubicación creada', id_empleado: req.user.id, detalle: `Ubicación "${u.nombre}" creada.` });
    res.status(201).json({ ok: true, id: u.id, ubicacion: u });
  } catch (err) { next(err); }
};

/** PUT /api/gerente/ubicaciones/:id (gerente|admin) — actualiza UbicacionMesa, registra Auditoria. */
exports.actualizarUbicacion = async (req, res, next) => {
  try {
    const u = await UbicacionMesa.findByPk(req.params.id);
    if (!u) return res.status(404).json({ error: 'Ubicación no encontrada' });
    await u.update(req.body);
    await Auditoria.create({ accion: 'Ubicación actualizada', id_empleado: req.user.id, detalle: `Ubicación #${u.id} "${u.nombre}" actualizada.` });
    res.json({ ok: true, ubicacion: u });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/gerente/ubicaciones/:id (gerente|admin)
 * Borrado físico; las mesas con esa ubicación quedan con id_ubicacion=null
 * (FK ON DELETE SET NULL). Registra Auditoria.
 */
exports.eliminarUbicacion = async (req, res, next) => {
  try {
    const u = await UbicacionMesa.findByPk(req.params.id);
    if (!u) return res.status(404).json({ error: 'Ubicación no encontrada' });
    // Decisión: SET_NULL — las mesas quedan con id_ubicacion=null (FK ON DELETE SET NULL en BD)
    await u.destroy();
    await Auditoria.create({ accion: 'Ubicación eliminada', id_empleado: req.user.id, detalle: `Ubicación #${u.id} "${u.nombre}" eliminada.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Productos ────────────────────────────────────────────────────────────────

/** GET /api/gerente/productos (gerente|admin) — lista Producto[] con su Categoria. */
exports.listarProductos = async (req, res, next) => {
  try {
    res.json(await Producto.findAll({
      include: [{ model: Categoria, as: 'categoria' }],
      order: [['nombre', 'ASC']],
    }));
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/productos (gerente|admin)
 * Body: { nombre, descripcion?, precio>0, imagen_url?, disponible?, id_categoria? }
 * @returns 201 { ok, id, producto }
 */
exports.crearProducto = async (req, res, next) => {
  try {
    const { nombre, descripcion, precio, imagen_url, disponible, id_categoria } = req.body;
    if (!nombre || String(nombre).trim() === '') return res.status(400).json({ error: 'El nombre es requerido.' });
    const priceVal = parseFloat(precio);
    if (!isFinite(priceVal) || priceVal <= 0) return res.status(400).json({ error: 'El precio debe ser mayor a 0.' });
    const p = await Producto.create({ nombre, descripcion: descripcion || null, precio: priceVal, imagen_url: imagen_url || null, disponible: disponible !== false, id_categoria: id_categoria || null });
    await Auditoria.create({ accion: 'Producto creado', id_empleado: req.user.id, detalle: `Producto "${p.nombre}" creado con precio $${priceVal.toFixed(2)}.` });
    res.status(201).json({ ok: true, id: p.id, producto: p });
  } catch (err) { next(err); }
};

/** PUT /api/gerente/productos/:id (gerente|admin) — actualiza Producto. Si precio se incluye, valida >0. */
exports.actualizarProducto = async (req, res, next) => {
  try {
    const p = await Producto.findByPk(req.params.id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    if (req.body.precio !== undefined) {
      const priceVal = parseFloat(req.body.precio);
      if (!isFinite(priceVal) || priceVal <= 0) return res.status(400).json({ error: 'El precio debe ser mayor a 0.' });
    }
    await p.update(req.body);
    await Auditoria.create({ accion: 'Producto actualizado', id_empleado: req.user.id, detalle: `Producto #${p.id} "${p.nombre}" actualizado.` });
    res.json({ ok: true, producto: p });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/gerente/productos/:id (gerente|admin)
 * Soft delete: marca disponible=false (no destruye registro para preservar
 * histórico en DetallePedido).
 */
exports.eliminarProducto = async (req, res, next) => {
  try {
    const p = await Producto.findByPk(req.params.id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    await p.update({ disponible: false });
    await Auditoria.create({ accion: 'Producto deshabilitado', id_empleado: req.user.id, detalle: `Producto #${p.id} "${p.nombre}" marcado como no disponible.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Categorías ───────────────────────────────────────────────────────────────

/** GET /api/gerente/categorias (gerente|admin) — lista Categoria[] ordenadas por `orden`. */
exports.listarCategorias = async (req, res, next) => {
  try {
    res.json(await Categoria.findAll({ order: [['orden', 'ASC']] }));
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/categorias (gerente|admin)
 * Body: { nombre, area?='ambos', orden?=0 }  area in ('cocina','bar','ambos').
 * @returns 201 { ok, id, categoria }
 */
exports.crearCategoria = async (req, res, next) => {
  try {
    const { nombre, area, orden } = req.body;
    if (!nombre || String(nombre).trim() === '') return res.status(400).json({ error: 'El nombre es requerido.' });
    const c = await Categoria.create({ nombre, area: area || 'ambos', orden: orden ?? 0 });
    await Auditoria.create({ accion: 'Categoría creada', id_empleado: req.user.id, detalle: `Categoría "${c.nombre}" creada.` });
    res.status(201).json({ ok: true, id: c.id, categoria: c });
  } catch (err) { next(err); }
};

/** PUT /api/gerente/categorias/:id (gerente|admin) — actualiza Categoria, registra Auditoria. */
exports.actualizarCategoria = async (req, res, next) => {
  try {
    const c = await Categoria.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Categoría no encontrada' });
    await c.update(req.body);
    await Auditoria.create({ accion: 'Categoría actualizada', id_empleado: req.user.id, detalle: `Categoría #${c.id} "${c.nombre}" actualizada.` });
    res.json({ ok: true, categoria: c });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/gerente/categorias/:id (gerente|admin)
 * Borrado físico solo si no tiene productos asociados (400 si hay productos).
 */
exports.eliminarCategoria = async (req, res, next) => {
  try {
    const c = await Categoria.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Categoría no encontrada' });
    const count = await Producto.count({ where: { id_categoria: c.id } });
    if (count > 0) return res.status(400).json({ error: `No se puede eliminar: la categoría tiene ${count} producto(s) asociado(s).` });
    await c.destroy();
    await Auditoria.create({ accion: 'Categoría eliminada', id_empleado: req.user.id, detalle: `Categoría #${c.id} "${c.nombre}" eliminada.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Empleados ────────────────────────────────────────────────────────────────

/** GET /api/gerente/empleados (gerente|admin) — lista Empleado[] sin password, ordenados por nombre. */
exports.listarEmpleados = async (req, res, next) => {
  try {
    res.json(await Empleado.findAll({
      attributes: { exclude: ['password'] },
      order: [['nombre', 'ASC']],
    }));
  } catch (err) { next(err); }
};

const ROLES_VALIDOS = ['mesero', 'cocina', 'gerente', 'admin'];

function _validarPassword(pass) {
  if (!pass || pass.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) return 'La contraseña debe tener al menos 1 letra y 1 número.';
  return null;
}

/**
 * POST /api/gerente/empleados (gerente|admin)
 * Body: { nombre, usuario, rol?, password }
 * Password: min 8 chars, ≥1 letra, ≥1 número. Rol ∈ ROLES_VALIDOS. is_staff
 * se setea automáticamente para gerente|admin. El usuario debe ser único.
 * @returns 201 { ok, empleado_id }
 */
exports.crearEmpleado = async (req, res, next) => {
  try {
    const { nombre, usuario, rol, password } = req.body;
    if (!nombre || String(nombre).trim() === '') return res.status(400).json({ ok: false, error: 'El nombre es requerido.' });
    if (!usuario || String(usuario).trim() === '') return res.status(400).json({ ok: false, error: 'El usuario es requerido.' });
    if (!password) return res.status(400).json({ ok: false, error: 'La contraseña es requerida.' });
    const pwErr = _validarPassword(password);
    if (pwErr) return res.status(400).json({ ok: false, error: pwErr });
    const rolVal = rol || 'mesero';
    if (!ROLES_VALIDOS.includes(rolVal)) return res.status(400).json({ ok: false, error: `Rol inválido. Permitidos: ${ROLES_VALIDOS.join(', ')}.` });
    if (String(usuario).length > 50) return res.status(400).json({ ok: false, error: 'El usuario no puede superar 50 caracteres.' });
    const existe = await Empleado.findOne({ where: { usuario: String(usuario).trim() } });
    if (existe) return res.status(400).json({ ok: false, error: 'El usuario ya existe.' });
    const is_staff = ['gerente', 'admin'].includes(rolVal);
    const e = await Empleado.create({ nombre: String(nombre).trim(), usuario: String(usuario).trim(), password, rol: rolVal, is_staff, is_active: true, activo: true });
    await Auditoria.create({ accion: 'Empleado creado', id_empleado: req.user.id, detalle: `Usuario: ${e.usuario}, Rol: ${rolVal}.` });
    res.status(201).json({ ok: true, empleado_id: e.id_empleado });
  } catch (err) { next(err); }
};

/**
 * PUT /api/gerente/empleados/:id (gerente|admin)
 * Body: { nombre?, rol?, password? }
 * No permite que el usuario cambie SU PROPIO rol (defensa para evitar
 * autodemoción). Password se hashea con bcrypt si se incluye.
 * @returns { ok, empleado } (sin campo password)
 */
exports.actualizarEmpleado = async (req, res, next) => {
  try {
    const e = await Empleado.findByPk(req.params.id);
    if (!e) return res.status(404).json({ error: 'Empleado no encontrado' });
    const updates = {};
    if (req.body.nombre !== undefined) updates.nombre = String(req.body.nombre).trim();
    if (req.body.rol !== undefined) {
      if (!ROLES_VALIDOS.includes(req.body.rol)) return res.status(400).json({ ok: false, error: `Rol inválido. Permitidos: ${ROLES_VALIDOS.join(', ')}.` });
      if (e.id_empleado === req.user.id) return res.status(400).json({ ok: false, error: 'No puedes cambiar tu propio rol.' });
      updates.rol = req.body.rol;
      updates.is_staff = ['gerente', 'admin'].includes(req.body.rol);
    }
    if (req.body.password) {
      const pwErr = _validarPassword(req.body.password);
      if (pwErr) return res.status(400).json({ ok: false, error: pwErr });
      updates.password = await bcrypt.hash(req.body.password, 10);
    }
    await e.update(updates);
    await Auditoria.create({ accion: 'Empleado editado', id_empleado: req.user.id, detalle: `Empleado #${e.id_empleado} "${e.usuario}" editado.` });
    const { password: _pw, ...data } = e.toJSON();
    res.json({ ok: true, empleado: data });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/gerente/empleados/:id (gerente|admin)
 * Soft delete: marca activo=false e is_active=false (no destruye el registro
 * para preservar el histórico en Auditoria/Pedido/Mesa).
 */
exports.eliminarEmpleado = async (req, res, next) => {
  try {
    const e = await Empleado.findByPk(req.params.id);
    if (!e) return res.status(404).json({ error: 'Empleado no encontrado' });
    await e.update({ activo: false, is_active: false });
    await Auditoria.create({ accion: 'Empleado desactivado', id_empleado: req.user.id, detalle: `Empleado #${e.id_empleado} "${e.usuario}" desactivado.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Reportes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/gerente/reportes?periodo=hoy|semana|mes (gerente|admin)
 *
 * Agregaciones de ventas/operación para el dashboard. `desde` se calcula
 * según el periodo (semana = lunes 00:00, mes = día 1 00:00).
 *
 * @returns { total_ventas, total_pedidos, total_sesiones, ticket_promedio,
 *            ventas_por_dia, top_productos[], pedidos_recientes[],
 *            pedidos_cancelados[], ... }
 *
 * Costo: O(N pedidos del periodo). En picos puede ser pesada — para uso
 * intensivo migrar a vistas materializadas.
 */
exports.getReportes = async (req, res, next) => {
  try {
    const { periodo = 'semana' } = req.query;
    const ahora = new Date();
    let desde;
    if (periodo === 'hoy') {
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    } else if (periodo === 'semana') {
      const dow = ahora.getDay() || 7;
      desde = new Date(ahora);
      desde.setDate(ahora.getDate() - dow + 1);
      desde.setHours(0, 0, 0, 0);
    } else {
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    }

    const [pedidosActivos, pedidosCancelados, sesiones] = await Promise.all([
      Pedido.findAll({
        where: { fecha_hora_ingreso: { [Op.gte]: desde }, estado: { [Op.not]: 'cancelado' } },
        include: [
          { model: DetallePedido, as: 'detalles', include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }] },
          { model: SesionCliente, as: 'sesion', include: [{ model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] }] },
        ],
        order: [['fecha_hora_ingreso', 'DESC']],
      }),
      Pedido.findAll({
        where: { fecha_hora_ingreso: { [Op.gte]: desde }, estado: 'cancelado' },
        include: [{ model: SesionCliente, as: 'sesion', include: [{ model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] }] }],
        order: [['fecha_hora_ingreso', 'DESC']],
      }),
      SesionCliente.findAll({ where: { fecha_inicio: { [Op.gte]: desde } } }),
    ]);

    const total_ventas = pedidosActivos.reduce(
      (acc, p) => acc + (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0), 0
    );
    const total_pedidos = pedidosActivos.length;
    const total_sesiones = sesiones.length;
    const ticket_promedio = total_sesiones > 0 ? total_ventas / total_sesiones : 0;

    // Ventas por día
    const ventasPorDia = {};
    pedidosActivos.forEach(p => {
      const dia = new Date(p.fecha_hora_ingreso).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
      if (!ventasPorDia[dia]) ventasPorDia[dia] = { dia, total: 0, tickets: 0 };
      ventasPorDia[dia].total += (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0);
      ventasPorDia[dia].tickets += 1;
    });

    // Top productos
    const topMap = {};
    pedidosActivos.forEach(p => {
      (p.detalles || []).forEach(d => {
        const key = d.id_producto;
        const nombre = d.producto?.nombre || '?';
        if (!topMap[key]) topMap[key] = { id: key, nombre, total_vendido: 0, ingreso: 0 };
        topMap[key].total_vendido += d.cantidad;
        topMap[key].ingreso += parseFloat(d.subtotal_calculado || 0);
      });
    });
    const top_productos = Object.values(topMap).sort((a, b) => b.total_vendido - a.total_vendido).slice(0, 10);

    // Pedidos recientes
    const pedidos_recientes = pedidosActivos.slice(0, 10).map(p => ({
      id: p.id,
      mesa_numero: p.sesion?.mesa?.numero_mesa,
      alias: p.sesion?.alias,
      items_count: (p.detalles || []).length,
      fecha: p.fecha_hora_ingreso,
      total: (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0),
    }));

    // Cancelaciones
    const cancelaciones = pedidosCancelados.map(p => ({
      id: p.id,
      fecha: p.fecha_hora_ingreso,
      mesa_numero: p.sesion?.mesa?.numero_mesa,
      motivo: p.motivo_cancelacion,
    }));

    res.json({
      stats: { total_ventas, total_pedidos, total_sesiones, ticket_promedio, cancelaciones_count: cancelaciones.length },
      ventas_por_dia: Object.values(ventasPorDia),
      top_productos,
      pedidos_recientes,
      cancelaciones,
      desde,
      hasta: ahora,
    });
  } catch (err) { next(err); }
};

// ─── Reportes: exportación PDF/Excel ──────────────────────────────────────────

async function _reportesData(periodo, desdeStr, hastaStr) {
  const ahora = new Date();
  let desde, hasta = ahora;

  if (desdeStr && hastaStr) {
    desde = new Date(desdeStr);
    hasta = new Date(hastaStr);
    hasta.setHours(23, 59, 59, 999);
  } else if (periodo === 'hoy') {
    desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  } else if (periodo === 'semana') {
    const dow = ahora.getDay() || 7;
    desde = new Date(ahora); desde.setDate(ahora.getDate() - dow + 1); desde.setHours(0, 0, 0, 0);
  } else if (periodo === 'quincena') {
    desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 14);
  } else if (periodo === 'mes') {
    desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  } else if (periodo === 'anio') {
    desde = new Date(ahora.getFullYear(), 0, 1);
  } else {
    desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  }

  const pedidos = await Pedido.findAll({
    where: { fecha_hora_ingreso: { [Op.gte]: desde, [Op.lte]: hasta }, estado: { [Op.not]: 'cancelado' } },
    include: [
      { model: DetallePedido, as: 'detalles', include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }] },
      { model: SesionCliente, as: 'sesion', include: [{ model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] }] },
    ],
  });
  const cancelados = await Pedido.findAll({
    where: { fecha_hora_ingreso: { [Op.gte]: desde, [Op.lte]: hasta }, estado: 'cancelado' },
    include: [{ model: SesionCliente, as: 'sesion', include: [{ model: Mesa, as: 'mesa', attributes: ['id', 'numero_mesa'] }] }],
  });
  const sesionesCount = await SesionCliente.count({ where: { fecha_inicio: { [Op.gte]: desde, [Op.lte]: hasta } } });

  const totalVentas = pedidos.reduce((acc, p) => acc + (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0), 0);
  const topMap = {};
  pedidos.forEach((p) => (p.detalles || []).forEach((d) => {
    const k = d.id_producto;
    if (!topMap[k]) topMap[k] = { id: k, nombre: d.producto?.nombre || '?', total_vendido: 0, ingreso: 0 };
    topMap[k].total_vendido += d.cantidad;
    topMap[k].ingreso += parseFloat(d.subtotal_calculado || 0);
  }));
  const topProductos = Object.values(topMap).sort((a, b) => b.total_vendido - a.total_vendido).slice(0, 20);

  return {
    desde, hasta,
    stats: {
      total_ventas: totalVentas,
      total_pedidos: pedidos.length,
      total_sesiones: sesionesCount,
      ticket_promedio: sesionesCount > 0 ? totalVentas / sesionesCount : 0,
      cancelaciones_count: cancelados.length,
    },
    pedidos,
    cancelados,
    topProductos,
  };
}

/**
 * GET|POST /api/gerente/reportes/exportar?formato=pdf|excel&periodo=...&desde=...&hasta=...
 * Autorización: gerente, admin.
 *
 * Genera un reporte descargable. Formato XLSX (ExcelJS) con 4 hojas
 * (Resumen, Top productos, Pedidos, Cancelaciones) o PDF (PDFKit) con
 * resumen + top 10 + lista de pedidos (truncada a 80, ver mensaje al final).
 * `_reportesData` (helper privado) provee la data agregada.
 */
exports.exportarReporte = async (req, res, next) => {
  try {
    const { formato = 'pdf', periodo = 'mes', desde: desdeStr, hasta: hastaStr } = req.query;
    const data = await _reportesData(periodo, desdeStr, hastaStr);
    const fmtFecha = (d) => new Date(d).toLocaleDateString('es-MX');
    const titulo = `Reporte ${periodo[0].toUpperCase() + periodo.slice(1)} — ${fmtFecha(data.desde)} a ${fmtFecha(data.hasta)}`;

    if (formato === 'excel' || formato === 'xlsx') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Mochi Matcha POS';
      wb.created = new Date();

      // Sheet 1: Resumen
      const ws = wb.addWorksheet('Resumen');
      ws.columns = [{ width: 32 }, { width: 18 }];
      ws.addRow([titulo]);
      ws.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF3D6B4F' } };
      ws.addRow([]);
      ws.addRow(['Ventas totales',    `$${data.stats.total_ventas.toFixed(2)}`]);
      ws.addRow(['Pedidos',           data.stats.total_pedidos]);
      ws.addRow(['Sesiones',          data.stats.total_sesiones]);
      ws.addRow(['Ticket promedio',   `$${data.stats.ticket_promedio.toFixed(2)}`]);
      ws.addRow(['Cancelaciones',     data.stats.cancelaciones_count]);

      // Sheet 2: Top productos
      const ws2 = wb.addWorksheet('Top productos');
      ws2.columns = [
        { header: '#',         key: 'rank',     width: 6  },
        { header: 'Producto',  key: 'nombre',   width: 36 },
        { header: 'Unidades',  key: 'unidades', width: 12 },
        { header: 'Ingreso',   key: 'ingreso',  width: 14 },
      ];
      ws2.getRow(1).font = { bold: true };
      data.topProductos.forEach((p, i) => {
        ws2.addRow({ rank: i + 1, nombre: p.nombre, unidades: p.total_vendido, ingreso: parseFloat(p.ingreso.toFixed(2)) });
      });

      // Sheet 3: Pedidos
      const ws3 = wb.addWorksheet('Pedidos');
      ws3.columns = [
        { header: 'ID',       key: 'id',     width: 8  },
        { header: 'Fecha',    key: 'fecha',  width: 18 },
        { header: 'Mesa',     key: 'mesa',   width: 8  },
        { header: 'Cliente',  key: 'alias',  width: 18 },
        { header: 'Items',    key: 'items',  width: 8  },
        { header: 'Total',    key: 'total',  width: 12 },
        { header: 'Estado',   key: 'estado', width: 12 },
      ];
      ws3.getRow(1).font = { bold: true };
      data.pedidos.forEach((p) => {
        const total = (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0);
        ws3.addRow({
          id: p.id,
          fecha: new Date(p.fecha_hora_ingreso).toLocaleString('es-MX'),
          mesa: p.sesion?.mesa?.numero_mesa,
          alias: p.sesion?.alias,
          items: (p.detalles || []).length,
          total: parseFloat(total.toFixed(2)),
          estado: p.estado,
        });
      });

      // Sheet 4: Cancelaciones
      const ws4 = wb.addWorksheet('Cancelaciones');
      ws4.columns = [
        { header: 'ID',     key: 'id',     width: 8  },
        { header: 'Fecha',  key: 'fecha',  width: 18 },
        { header: 'Mesa',   key: 'mesa',   width: 8  },
        { header: 'Motivo', key: 'motivo', width: 40 },
      ];
      ws4.getRow(1).font = { bold: true };
      data.cancelados.forEach((p) => {
        ws4.addRow({
          id: p.id,
          fecha: new Date(p.fecha_hora_ingreso).toLocaleString('es-MX'),
          mesa: p.sesion?.mesa?.numero_mesa,
          motivo: p.motivo_cancelacion || '',
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-${periodo}-${Date.now()}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    // PDF
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${periodo}-${Date.now()}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(18).fillColor('#3D6B4F').text('Mochi Matcha · Reporte de operación', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#666').text(titulo);
    doc.moveDown(0.8);

    // Stats
    doc.fontSize(12).fillColor('#000').text('Resumen', { underline: true });
    doc.moveDown(0.3);
    const stat = data.stats;
    doc.fontSize(10).fillColor('#000');
    doc.text(`• Ventas totales: $${stat.total_ventas.toFixed(2)}`);
    doc.text(`• Pedidos: ${stat.total_pedidos}`);
    doc.text(`• Sesiones: ${stat.total_sesiones}`);
    doc.text(`• Ticket promedio: $${stat.ticket_promedio.toFixed(2)}`);
    doc.text(`• Cancelaciones: ${stat.cancelaciones_count}`);
    doc.moveDown(0.8);

    // Top productos
    doc.fontSize(12).text('Top 10 productos vendidos', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    data.topProductos.slice(0, 10).forEach((p, i) => {
      doc.text(`${i + 1}. ${p.nombre}  —  ${p.total_vendido} unidades  ·  $${p.ingreso.toFixed(2)}`);
    });
    doc.moveDown(0.8);

    // Pedidos (resumido)
    doc.fontSize(12).text(`Pedidos del período (${data.pedidos.length})`, { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(8);
    data.pedidos.slice(0, 80).forEach((p) => {
      const total = (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0);
      doc.text(
        `#${p.id}  ${new Date(p.fecha_hora_ingreso).toLocaleString('es-MX')}  Mesa ${p.sesion?.mesa?.numero_mesa || '—'}  ${p.sesion?.alias || ''}  $${total.toFixed(2)}  [${p.estado}]`
      );
    });
    if (data.pedidos.length > 80) {
      doc.moveDown(0.2).fillColor('#888').text(`... y ${data.pedidos.length - 80} pedidos más (descarga Excel para detalle completo).`);
    }
    doc.moveDown(0.5);
    doc.fontSize(7).fillColor('#999').text(`Generado el ${new Date().toLocaleString('es-MX')}`, { align: 'right' });
    doc.end();
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/gerente/empleados/:id/password (gerente|admin)
 * Body: { password } (min 4 chars — más laxo que crearEmpleado, legacy).
 * Hashea con bcrypt.
 */
exports.cambiarPasswordEmpleado = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: 'Password mínima 4 caracteres' });
    const e = await Empleado.findByPk(req.params.id);
    if (!e) return res.status(404).json({ error: 'Empleado no encontrado' });
    const hash = await bcrypt.hash(password, 10);
    await e.update({ password: hash });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * PUT /api/gerente/empleados/:id/toggle (gerente|admin)
 * Alterna activo/is_active del empleado. Bloquea autodemoción.
 * @returns { ok, activo }
 */
exports.toggleEmpleado = async (req, res, next) => {
  try {
    const e = await Empleado.findByPk(req.params.id);
    if (!e) return res.status(404).json({ error: 'Empleado no encontrado' });
    if (e.id_empleado === req.user.id) return res.status(400).json({ ok: false, error: 'No puedes desactivarte a ti mismo.' });
    const nuevoActivo = !e.activo;
    await e.update({ activo: nuevoActivo, is_active: nuevoActivo });
    await Auditoria.create({ accion: `Empleado ${nuevoActivo ? 'activado' : 'desactivado'}`, id_empleado: req.user.id, detalle: `Usuario: ${e.usuario}.` });
    res.json({ ok: true, activo: nuevoActivo });
  } catch (err) { next(err); }
};

// ─── Configuración ───────────────────────────────────────────────────────────

/**
 * GET /api/gerente/config (gerente|admin)
 * Devuelve un objeto plano { clave: valor } con todas las filas de Configuracion.
 */
exports.listarConfig = async (req, res, next) => {
  try {
    const items = await Configuracion.findAll({ order: [['clave', 'ASC']] });
    const obj = {};
    items.forEach((c) => { obj[c.clave] = c.valor; });
    res.json(obj);
  } catch (err) { next(err); }
};

/**
 * PUT|POST /api/gerente/config (gerente|admin)
 * Body: objeto plano { clave: valor }. Solo strings se validan estrictamente
 * (BOOL_KEYS deben ser "true"/"false"). Upsert por clave en tabla Configuracion.
 */
exports.guardarConfig = async (req, res, next) => {
  try {
    const updates = req.body || {};
    // Key-specific validation
    const BOOL_KEYS = ['modo_mantenimiento', 'horarios_activos'];
    for (const k of BOOL_KEYS) {
      if (updates[k] !== undefined && !['true', 'false'].includes(String(updates[k]))) {
        return res.status(400).json({ ok: false, error: `${k} debe ser "true" o "false".` });
      }
    }
    if (updates.semaforo_yellow !== undefined) {
      const y = parseInt(updates.semaforo_yellow);
      if (!isFinite(y) || y <= 0) return res.status(400).json({ ok: false, error: 'semaforo_yellow debe ser un entero positivo.' });
    }
    if (updates.semaforo_red !== undefined) {
      const r = parseInt(updates.semaforo_red);
      if (!isFinite(r) || r <= 0) return res.status(400).json({ ok: false, error: 'semaforo_red debe ser un entero positivo.' });
      const y = parseInt(updates.semaforo_yellow ?? 0);
      if (isFinite(y) && y >= r) return res.status(400).json({ ok: false, error: 'semaforo_yellow debe ser menor que semaforo_red.' });
    }
    for (const [clave, valor] of Object.entries(updates)) {
      const [c, created] = await Configuracion.findOrCreate({ where: { clave }, defaults: { valor: String(valor) } });
      if (!created && c.valor !== String(valor)) await c.update({ valor: String(valor) });
    }
    // Invalidate dependent caches
    if ('modo_mantenimiento' in updates) require('../middleware/mantenimiento').invalidate();
    if ('horarios_activos' in updates) require('../middleware/horario').invalidate();
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/** GET /api/gerente/horarios (gerente|admin) — lista HorarioAtencion[] por (dia_semana, abre). */
exports.listarHorarios = async (req, res, next) => {
  try {
    res.json(await HorarioAtencion.findAll({ order: [['dia_semana', 'ASC'], ['abre', 'ASC']] }));
  } catch (err) { next(err); }
};

/**
 * PUT /api/gerente/horarios (gerente|admin)
 * Body: { horarios: [...] }
 * BULK REPLACE: borra TODOS los HorarioAtencion existentes y reemplaza por
 * el array enviado. Invalida cache del middleware/horario.
 */
exports.guardarHorarios = async (req, res, next) => {
  try {
    const { horarios } = req.body;
    if (!Array.isArray(horarios)) return res.status(400).json({ error: 'horarios debe ser array' });
    await HorarioAtencion.destroy({ where: {} });
    if (horarios.length) await HorarioAtencion.bulkCreate(horarios);
    require('../middleware/horario').invalidate();
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Dashboard/FloorPlan endpoints ────────────────────────────────────────────

/**
 * GET /api/gerente/mesas-estado  (alias: /floor-plan/estado)
 * Autorización: gerente, admin.
 *
 * Vista en tiempo real del floor plan (similar a /api/mesero/mapa/estado pero
 * sin restricción de rol mesero). Estado visual con árbol:
 *   libre → alerta → cobrando → listo → cocina → ocupada
 *
 * @returns { ok, mesas: [{ id, numero, estado, estado_visual, pin, clientes,
 *            pedidos_cocina, pedidos_listos, tiene_solicitud, tiene_alerta }],
 *            listos_count, solicitudes_count, alertas_count }
 */
exports.getMesasEstado = async (req, res, next) => {
  try {
    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });

    const [mesas, solicitudesPend] = await Promise.all([
      Mesa.findAll({
        include: [
          {
            model: SesionCliente, as: 'sesiones', where: { estado: 'activa' }, required: false,
            include: [{ model: Pedido, as: 'pedidos', required: false }],
          },
          { model: AlertaMesero, as: 'alertas', where: { atendida: false }, required: false },
        ],
        order: [['numero_mesa', 'ASC']],
      }),
      estadoPendiente
        ? SolicitudPago.findAll({ where: { id_estado_solicitud: estadoPendiente.id }, attributes: ['id_mesa'] })
        : Promise.resolve([]),
    ]);

    const mesasConSolicitud = new Set(solicitudesPend.map(s => s.id_mesa));

    const [listosCount, solicitudesCount, alertasCount] = await Promise.all([
      Pedido.count({ where: { estado: 'listo' } }),
      estadoPendiente ? SolicitudPago.count({ where: { id_estado_solicitud: estadoPendiente.id } }) : Promise.resolve(0),
      AlertaMesero.count({ where: { atendida: false } }),
    ]);

    const result = mesas.map(m => {
      const sesiones = m.sesiones || [];
      const alertas = m.alertas || [];
      let pedidosCocina = 0, pedidosListos = 0;
      for (const s of sesiones) {
        for (const p of s.pedidos || []) {
          if (['recibido', 'preparando'].includes(p.estado)) pedidosCocina++;
          else if (p.estado === 'listo') pedidosListos++;
        }
      }
      const tieneSolicitud = mesasConSolicitud.has(m.id);
      const tieneAlerta = alertas.length > 0;

      let estado_visual;
      if (m.estado === 'libre') estado_visual = 'libre';
      else if (tieneAlerta) estado_visual = 'alerta';
      else if (tieneSolicitud) estado_visual = 'cobrando';
      else if (pedidosListos > 0) estado_visual = 'listo';
      else if (pedidosCocina > 0) estado_visual = 'cocina';
      else estado_visual = 'ocupada';

      return {
        id: m.id,
        numero: m.numero_mesa,
        estado: m.estado,
        estado_visual,
        pin: m.pin_actual || '',
        clientes: sesiones.length,
        pedidos_cocina: pedidosCocina,
        pedidos_listos: pedidosListos,
        tiene_solicitud: tieneSolicitud,
        tiene_alerta: tieneAlerta,
      };
    });

    res.json({ ok: true, mesas: result, listos_count: listosCount, solicitudes_count: solicitudesCount, alertas_count: alertasCount });
  } catch (err) { next(err); }
};

/**
 * GET /api/gerente/mesa/:id/detalle (gerente|admin)
 *
 * Detalle completo de la mesa para el panel: sesiones activas con sus
 * pedidos (no cancelados) e items, y solicitudes de pago pendientes.
 *
 * @returns { ok, mesa_id, numero_mesa, pin, estado, nota_cierre, mesa_libre,
 *            total_mesa, sesiones: [...], solicitudes: [...] }
 */
exports.getDetalleMesa = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const sesiones = await SesionCliente.findAll({
      where: { id_mesa: mesa.id, estado: 'activa' },
      include: [{
        model: Pedido, as: 'pedidos',
        include: [{ model: DetallePedido, as: 'detalles', include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre'] }] }],
        order: [['fecha_hora_ingreso', 'DESC']],
      }],
    });

    const estadoDisplay = { recibido: 'Recibido', preparando: 'Preparando', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
    const estadoPendiente = await EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });

    const solicitudes = await SolicitudPago.findAll({
      where: { id_mesa: mesa.id, ...(estadoPendiente ? { id_estado_solicitud: estadoPendiente.id } : {}) },
      include: [{ model: SesionCliente, as: 'sesion', attributes: ['id', 'alias'] }],
      order: [['fecha_hora', 'DESC']],
    });

    const sesionesData = sesiones.map(s => {
      const pedidos = (s.pedidos || []).map(p => ({
        id: p.id,
        estado: p.estado,
        estado_display: estadoDisplay[p.estado] || p.estado,
        fecha: p.fecha_hora_ingreso ? new Date(p.fecha_hora_ingreso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '',
        items: (p.detalles || []).map(d => ({
          nombre: d.producto?.nombre || '?',
          cantidad: d.cantidad,
          subtotal: parseFloat(d.subtotal_calculado || 0),
          notas: d.notas || '',
        })),
      }));
      const total = pedidos.reduce((acc, p) => acc + p.items.reduce((s, i) => s + i.subtotal, 0), 0);
      return { id: s.id, alias: s.alias, total, pedidos };
    });

    const solicitudesData = solicitudes.map(s => ({
      id: s.id,
      alias: s.tipo === 'grupal' ? 'Toda la mesa' : (s.sesion?.alias || '?'),
      tipo: s.tipo,
      tipo_display: s.tipo === 'individual' ? 'Individual' : 'Grupal',
      total: parseFloat(s.total_mesa || 0),
      fecha: s.fecha_hora ? new Date(s.fecha_hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '',
      sesion_id: s.id_sesion,
      metodo_pref: s.detalle_pago || '',
    }));

    const total_mesa = sesionesData.reduce((acc, s) => acc + s.total, 0);

    res.json({
      ok: true,
      mesa_id: mesa.id,
      numero_mesa: mesa.numero_mesa,
      pin: mesa.pin_actual || '',
      estado: mesa.estado,
      nota_cierre: mesa.nota_cierre || '',
      mesa_libre: mesa.estado === 'libre',
      total_mesa,
      sesiones: sesionesData,
      solicitudes: solicitudesData,
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/solicitudes/:id/cancelar (gerente|admin)
 * Transiciona la SolicitudPago a estado 'cancelada' (si existe ese EstadoSolicitud).
 * @returns { ok, mensaje }
 */
exports.cancelarSolicitud = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sol = await SolicitudPago.findByPk(id);
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const estadoCancelada = await EstadoSolicitud.findOne({ where: { descripcion: 'cancelada' } });
    await sol.update({ id_estado_solicitud: estadoCancelada?.id || sol.id_estado_solicitud });
    res.json({ ok: true, mensaje: 'Solicitud cancelada' });
  } catch (err) { next(err); }
};

// ─── Modificadores ────────────────────────────────────────────────────────────

/**
 * GET /api/gerente/modificadores (gerente|admin)
 * Lista GrupoModificador[] con sus opciones (ordenadas alfabéticamente) y
 * productos asociados.
 */
exports.listarModificadores = async (req, res, next) => {
  try {
    const grupos = await GrupoModificador.findAll({
      include: [
        { model: OpcionModificador, as: 'opciones', order: [['nombre_opcion', 'ASC']] },
        { model: Producto, as: 'productos', attributes: ['id', 'nombre'] },
      ],
      order: [['nombre_grupo', 'ASC']],
    });
    res.json(grupos);
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/modificadores (gerente|admin)
 * Body: { nombre_grupo, tipo?, es_obligatorio?, max_selecciones?, opciones?, productos? }
 * Crea grupo + opciones (UPPER, precio_extra parsed) + asocia productos M2M.
 * @returns 201 { ok, grupo_id }
 */
exports.crearModificador = async (req, res, next) => {
  try {
    const { nombre_grupo, tipo, es_obligatorio, max_selecciones, opciones, productos } = req.body;
    if (!nombre_grupo || String(nombre_grupo).trim() === '') return res.status(400).json({ error: 'El nombre del grupo es requerido.' });
    const grupo = await GrupoModificador.create({
      nombre_grupo,
      tipo: tipo || 'única',
      es_obligatorio: !!es_obligatorio,
      max_selecciones: max_selecciones || null,
    });
    if (opciones?.length) {
      await OpcionModificador.bulkCreate(opciones.map((o) => ({
        nombre_opcion: String(o.nombre_opcion || '').toUpperCase(),
        precio_extra: parseFloat(o.precio_extra || 0),
        activo: true,
        id_grupo: grupo.id,
      })));
    }
    if (productos?.length) await grupo.setProductos(productos);
    await Auditoria.create({ accion: 'Modificador creado', id_empleado: req.user.id, detalle: `Grupo "${grupo.nombre_grupo}" creado con ${opciones?.length || 0} opción(es).` });
    res.status(201).json({ ok: true, grupo_id: grupo.id });
  } catch (err) { next(err); }
};

/**
 * GET /api/gerente/modificadores/:id/editar (gerente|admin)
 * Devuelve el grupo con sus opciones y productos asociados (para precargar
 * el formulario de edición).
 */
exports.getModificadorEditar = async (req, res, next) => {
  try {
    const grupo = await GrupoModificador.findByPk(req.params.id, {
      include: [
        { model: OpcionModificador, as: 'opciones', attributes: ['id', 'nombre_opcion', 'precio_extra', 'activo'] },
        { model: Producto, as: 'productos', attributes: ['id', 'nombre'], through: { attributes: [] } },
      ],
    });
    if (!grupo) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json({ ok: true, grupo });
  } catch (err) { next(err); }
};

/**
 * PUT|POST /api/gerente/modificadores/:id (gerente|admin)
 * Body: { nombre_grupo?, tipo?, es_obligatorio?, max_selecciones?, opciones?, productos? }
 * Actualiza el grupo y reemplaza sus opciones / productos asociados.
 */
exports.actualizarModificador = async (req, res, next) => {
  try {
    const grupo = await GrupoModificador.findByPk(req.params.id);
    if (!grupo) return res.status(404).json({ error: 'Grupo no encontrado' });
    const { nombre_grupo, tipo, es_obligatorio, max_selecciones, opciones, productos } = req.body;
    await grupo.update({
      nombre_grupo: nombre_grupo ?? grupo.nombre_grupo,
      tipo: tipo ?? grupo.tipo,
      es_obligatorio: es_obligatorio !== undefined ? !!es_obligatorio : grupo.es_obligatorio,
      max_selecciones: max_selecciones !== undefined ? (max_selecciones || null) : grupo.max_selecciones,
    });
    if (opciones !== undefined) {
      for (const opData of opciones) {
        if (opData.id) {
          await OpcionModificador.update(
            {
              nombre_opcion: String(opData.nombre_opcion || '').toUpperCase(),
              precio_extra: parseFloat(opData.precio_extra ?? 0),
              activo: opData.activo !== undefined ? !!opData.activo : true,
            },
            { where: { id: opData.id, id_grupo: grupo.id } }
          );
        } else {
          await OpcionModificador.create({
            id_grupo: grupo.id,
            nombre_opcion: String(opData.nombre_opcion || '').toUpperCase(),
            precio_extra: parseFloat(opData.precio_extra ?? 0),
            activo: true,
          });
        }
      }
    }
    if (productos !== undefined) await grupo.setProductos(productos || []);
    await Auditoria.create({ accion: 'Modificador actualizado', id_empleado: req.user.id, detalle: `Grupo #${grupo.id} "${grupo.nombre_grupo}" actualizado.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/gerente/modificadores/:id (gerente|admin)
 * fix#1 Bug C: valida FKs antes del hard-delete. Si está vinculado a productos
 * o sus opciones aparecen en DetalleModificador histórico → 400 (no 500).
 * Cascadea opciones (FK CASCADE) cuando es seguro borrar.
 */
exports.eliminarModificador = async (req, res, next) => {
  try {
    // fix#1 Bug C: validar FKs antes del hard-delete (productos asociados +
    // DetalleModificador histórico). Si tiene, devolver 400 en vez de 500.
    const g = await GrupoModificador.findByPk(req.params.id, {
      include: [
        { model: Producto, as: 'productos', attributes: ['id'], through: { attributes: [] } },
        { model: OpcionModificador, as: 'opciones', attributes: ['id'] },
      ],
    });
    if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });

    const nProductos = (g.productos || []).length;
    if (nProductos > 0) {
      return res.status(400).json({ error: `No se puede eliminar: el grupo está vinculado a ${nProductos} producto(s). Desvincúlalos primero.` });
    }

    const opcionIds = (g.opciones || []).map((o) => o.id);
    if (opcionIds.length > 0) {
      const usado = await DetalleModificador.count({ where: { id_opcion: { [Op.in]: opcionIds } } });
      if (usado > 0) {
        return res.status(400).json({ error: `No se puede eliminar: las opciones del grupo aparecen en ${usado} pedido(s) históricos.` });
      }
    }

    await g.destroy(); // cascadea opciones (FK CASCADE en hasMany)
    await Auditoria.create({ accion: 'Modificador eliminado', id_empleado: req.user.id, detalle: `Grupo #${g.id} "${g.nombre_grupo}" eliminado.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/modificadores/:id/plantilla (gerente|admin)
 * Toggle es_plantilla. Grupos plantilla pueden ser clonados a múltiples productos.
 */
exports.togglePlantilla = async (req, res, next) => {
  try {
    const grupo = await GrupoModificador.findByPk(req.params.id);
    if (!grupo) return res.status(404).json({ error: 'Grupo no encontrado' });
    await grupo.update({ es_plantilla: !grupo.es_plantilla });
    await Auditoria.create({ accion: 'Plantilla toggled', id_empleado: req.user.id, detalle: `Grupo #${grupo.id} es_plantilla=${grupo.es_plantilla}.` });
    res.json({ ok: true, es_plantilla: grupo.es_plantilla });
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/modificadores/clonar (gerente|admin)
 * Body: { grupo_id, productos: [id...] }
 * Asocia un GrupoModificador plantilla a varios productos (M2M). Salta los
 * productos que ya estaban asociados.
 * @returns { ok, asignados: <count nuevos> }
 */
exports.clonarPlantilla = async (req, res, next) => {
  try {
    const { grupo_id, productos } = req.body;
    if (!grupo_id) return res.status(400).json({ error: 'grupo_id es requerido.' });
    const plantilla = await GrupoModificador.findByPk(grupo_id, {
      include: [{ model: Producto, as: 'productos', attributes: ['id'], through: { attributes: [] } }],
    });
    if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada.' });
    if (!plantilla.es_plantilla) return res.status(400).json({ error: 'El grupo no es una plantilla.' });
    const targetIds = Array.isArray(productos) ? productos : [];
    if (!targetIds.length) return res.status(400).json({ error: 'productos es requerido.' });
    const existingIds = (plantilla.productos || []).map((p) => p.id);
    const newIds = targetIds.filter((id) => !existingIds.includes(Number(id)));
    if (newIds.length) await plantilla.addProductos(newIds);
    await Auditoria.create({ accion: 'Plantilla clonada', id_empleado: req.user.id, detalle: `Plantilla "${plantilla.nombre_grupo}" asignada a ${newIds.length} nuevo(s) producto(s).` });
    res.json({ ok: true, asignados: newIds.length });
  } catch (err) { next(err); }
};

// ─── Promociones ──────────────────────────────────────────────────────────────

/**
 * GET /api/gerente/promociones (gerente|admin)
 * Lista Promocion[] con tipo_descuento y los productos aplicables/beneficiados.
 */
exports.listarPromociones = async (req, res, next) => {
  try {
    const promos = await Promocion.findAll({
      include: [
        { model: TipoDescuento, as: 'tipo_descuento' },
        { model: Producto, as: 'productos_aplicables',  attributes: ['id', 'nombre'], through: { attributes: [] } },
        { model: Producto, as: 'productos_beneficiados', attributes: ['id', 'nombre'], through: { attributes: [] } },
      ],
      order: [['orden', 'ASC']],
    });
    res.json(promos);
  } catch (err) { next(err); }
};

/** POST /api/gerente/promociones/:id/toggle (gerente|admin) — alterna `activa`. */
exports.togglePromocion = async (req, res, next) => {
  try {
    const p = await Promocion.findByPk(req.params.id);
    if (!p) return res.status(404).json({ error: 'Promoción no encontrada' });
    await p.update({ activa: !p.activa });
    res.json({ ok: true, activa: p.activa });
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/promociones (gerente|admin)
 * Body: { titulo, descripcion_corta?, orden?, id_tipo_descuento?,
 *         valor_descuento, cantidad_minima?, aplicacion?, fecha_inicio,
 *         fecha_fin, activa?, imagen_url?, dias_semana?, codigo_cupon?,
 *         requiere_todos_productos?, ids_aplicables?[], ids_beneficiados?[] }
 *
 * Valida con _validarPromoData:
 *   - rango fechas, valor_descuento>=0, código cupón único.
 *   - Si tipo='PORCENTAJE': valor <= 100.
 *   - Si tipo contiene 'LLEVA' Y 'PAGA': cantidad_minima>=2, valor entero <X.
 *
 * dias_semana se persiste como CSV.
 * @returns 201 { ok, id }
 */
exports.crearPromocion = async (req, res, next) => {
  try {
    const {
      titulo, descripcion_corta, orden, id_tipo_descuento,
      valor_descuento, cantidad_minima, aplicacion,
      fecha_inicio, fecha_fin, activa, imagen_url,
      dias_semana, requiere_todos_productos, codigo_cupon,
      ids_aplicables, ids_beneficiados,
    } = req.body;

    const errMsg = await _validarPromoData({ titulo, fecha_inicio, fecha_fin, valor_descuento, cantidad_minima, id_tipo_descuento, codigo_cupon });
    if (errMsg) return res.status(400).json({ ok: false, error: errMsg });

    const promo = await Promocion.create({
      titulo,
      descripcion_corta: descripcion_corta || null,
      orden: orden ?? 0,
      id_tipo_descuento: id_tipo_descuento || null,
      valor_descuento: valor_descuento != null ? parseFloat(valor_descuento) : null,
      cantidad_minima: cantidad_minima != null ? parseInt(cantidad_minima) : null,
      aplicacion: aplicacion || 'item',
      fecha_inicio,
      fecha_fin,
      activa: activa !== false,
      imagen_url: imagen_url || null,
      codigo_cupon: codigo_cupon || null,
      dias_semana: Array.isArray(dias_semana) ? dias_semana.join(',') : (dias_semana || ''),
      requiere_todos_productos: !!requiere_todos_productos,
    });

    if (ids_aplicables?.length) await promo.setProductos_aplicables(ids_aplicables);
    if (ids_beneficiados?.length) await promo.setProductos_beneficiados(ids_beneficiados);

    await Auditoria.create({ accion: 'Promoción creada', id_empleado: req.user.id, detalle: `Promoción "${promo.titulo}" creada.` });
    res.status(201).json({ ok: true, id: promo.id });
  } catch (err) { next(err); }
};

/** GET /api/gerente/promociones/:id/editar (gerente|admin) — pre-carga promo con tipo y productos M2M. */
exports.getPromocionEditar = async (req, res, next) => {
  try {
    const promo = await Promocion.findByPk(req.params.id, {
      include: [
        { model: TipoDescuento, as: 'tipo_descuento' },
        { model: Producto, as: 'productos_aplicables', attributes: ['id', 'nombre'], through: { attributes: [] } },
        { model: Producto, as: 'productos_beneficiados', attributes: ['id', 'nombre'], through: { attributes: [] } },
      ],
    });
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ ok: true, promo });
  } catch (err) { next(err); }
};

/**
 * PUT|POST /api/gerente/promociones/:id (gerente|admin)
 * Mismos campos que crearPromocion (todos opcionales — merge con valores
 * actuales). Valida con _validarPromoData usando id_excluir para permitir
 * conservar el cupón propio sin colisionar.
 */
exports.actualizarPromocion = async (req, res, next) => {
  try {
    const promo = await Promocion.findByPk(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });

    const {
      titulo, descripcion_corta, orden, id_tipo_descuento,
      valor_descuento, cantidad_minima, aplicacion,
      fecha_inicio, fecha_fin, activa, imagen_url,
      dias_semana, requiere_todos_productos, codigo_cupon,
      ids_aplicables, ids_beneficiados,
    } = req.body;

    const ti  = titulo !== undefined ? titulo : promo.titulo;
    const fi  = fecha_inicio !== undefined ? fecha_inicio : promo.fecha_inicio;
    const ff  = fecha_fin !== undefined ? fecha_fin : promo.fecha_fin;
    const vd  = valor_descuento !== undefined ? valor_descuento : promo.valor_descuento;
    const cm  = cantidad_minima !== undefined ? cantidad_minima : promo.cantidad_minima;
    const itd = id_tipo_descuento !== undefined ? id_tipo_descuento : promo.id_tipo_descuento;
    const cc  = codigo_cupon !== undefined ? codigo_cupon : promo.codigo_cupon;

    const errMsg = await _validarPromoData({ titulo: ti, fecha_inicio: fi, fecha_fin: ff, valor_descuento: vd, cantidad_minima: cm, id_tipo_descuento: itd, codigo_cupon: cc, id_excluir: promo.id });
    if (errMsg) return res.status(400).json({ ok: false, error: errMsg });

    await promo.update({
      titulo: ti,
      descripcion_corta: descripcion_corta !== undefined ? (descripcion_corta || null) : promo.descripcion_corta,
      orden: orden !== undefined ? (orden ?? 0) : promo.orden,
      id_tipo_descuento: itd || null,
      valor_descuento: vd != null ? parseFloat(vd) : null,
      cantidad_minima: cm != null ? parseInt(cm) : null,
      aplicacion: aplicacion ?? promo.aplicacion,
      fecha_inicio: fi,
      fecha_fin: ff,
      activa: activa !== undefined ? activa : promo.activa,
      imagen_url: imagen_url !== undefined ? (imagen_url || null) : promo.imagen_url,
      codigo_cupon: cc || null,
      dias_semana: dias_semana !== undefined
        ? (Array.isArray(dias_semana) ? dias_semana.join(',') : (dias_semana || ''))
        : promo.dias_semana,
      requiere_todos_productos: requiere_todos_productos !== undefined ? !!requiere_todos_productos : promo.requiere_todos_productos,
    });

    if (ids_aplicables !== undefined) await promo.setProductos_aplicables(ids_aplicables || []);
    if (ids_beneficiados !== undefined) await promo.setProductos_beneficiados(ids_beneficiados || []);

    await Auditoria.create({ accion: 'Promoción actualizada', id_empleado: req.user.id, detalle: `Promoción #${promo.id} "${promo.titulo}" actualizada.` });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/** DELETE /api/gerente/promociones/:id (gerente|admin) — borrado físico. */
exports.eliminarPromocion = async (req, res, next) => {
  try {
    const promo = await Promocion.findByPk(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });
    await promo.destroy();
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/** GET /api/gerente/tipos-descuento (gerente|admin) — lista TipoDescuento[]. */
exports.listarTiposDescuento = async (req, res, next) => {
  try {
    res.json(await TipoDescuento.findAll({ order: [['descripcion', 'ASC']] }));
  } catch (err) { next(err); }
};

// ─── Horarios CRUD ────────────────────────────────────────────────────────────

/**
 * POST /api/gerente/horarios (gerente|admin)
 * Body: { dia_semana: 0-6, abre: 'HH:MM', cierra: 'HH:MM' }
 * Crea horario individual e invalida cache del middleware/horario.
 */
exports.crearHorario = async (req, res, next) => {
  try {
    const { dia_semana, abre, cierra } = req.body;
    const dia = parseInt(dia_semana);
    if (!isFinite(dia) || dia < 0 || dia > 6) return res.status(400).json({ ok: false, error: 'dia_semana debe estar entre 0 y 6.' });
    if (!abre || !cierra) return res.status(400).json({ ok: false, error: 'abre y cierra son requeridos (HH:MM).' });
    const h = await HorarioAtencion.create({ dia_semana: dia, abre, cierra, activo: true });
    require('../middleware/horario').invalidate();
    res.status(201).json({ ok: true, id: h.id });
  } catch (err) { next(err); }
};

/** POST /api/gerente/horarios/:id/toggle (gerente|admin) — alterna `activo`. Invalida cache. */
exports.toggleHorario = async (req, res, next) => {
  try {
    const h = await HorarioAtencion.findByPk(req.params.id);
    if (!h) return res.status(404).json({ error: 'Horario no encontrado.' });
    await h.update({ activo: !h.activo });
    require('../middleware/horario').invalidate();
    res.json({ ok: true, activo: h.activo });
  } catch (err) { next(err); }
};

/** DELETE /api/gerente/horarios/:id (gerente|admin) — borrado físico, invalida cache. */
exports.eliminarHorario = async (req, res, next) => {
  try {
    const h = await HorarioAtencion.findByPk(req.params.id);
    if (!h) return res.status(404).json({ error: 'Horario no encontrado.' });
    await h.destroy();
    require('../middleware/horario').invalidate();
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Imágenes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/gerente/upload-imagen (gerente|admin)
 * Form-data multipart con campo 'file'. Acepta jpg|jpeg|png|webp|gif hasta 5MB.
 * Renombra a UUID para evitar colisiones y path traversal.
 * Guarda en public/media/uploads/.
 * @returns { ok, url: '/media/uploads/<uuid>.<ext>' }
 */
exports.uploadImagen = async (req, res, next) => {
  try {
    const { formidable } = require('formidable');
    const MAX_SIZE = 5 * 1024 * 1024;
    const form = formidable({ maxFileSize: MAX_SIZE, keepExtensions: true });
    let files;
    try {
      [, files] = await form.parse(req);
    } catch (parseErr) {
      const msg = String(parseErr);
      if (msg.includes('maxFileSize') || (parseErr.code && parseErr.code >= 1009)) {
        return res.status(400).json({ ok: false, error: 'Máximo 5MB.' });
      }
      throw parseErr;
    }
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ ok: false, error: 'Sin archivo.' });

    const mimetype = file.mimetype || '';
    if (!mimetype.startsWith('image/')) {
      fs.unlink(file.filepath, () => {});
      return res.status(400).json({ ok: false, error: 'Solo imágenes.' });
    }
    if (file.size > MAX_SIZE) {
      fs.unlink(file.filepath, () => {});
      return res.status(400).json({ ok: false, error: 'Máximo 5MB.' });
    }
    const ext = path.extname(file.originalFilename || '').toLowerCase();
    if (!ALLOWED_IMG_EXTS.includes(ext)) {
      fs.unlink(file.filepath, () => {});
      return res.status(400).json({ ok: false, error: 'Formato no soportado. Usa: jpg, jpeg, png, webp, gif.' });
    }
    const safeName = `${uuidv4().replace(/-/g, '')}${ext}`;
    const destPath = path.join(UPLOADS_DIR, safeName);
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.renameSync(file.filepath, destPath);
    return res.json({ ok: true, url: `/media/uploads/${safeName}` });
  } catch (err) { next(err); }
};

/**
 * GET /api/gerente/imagenes (gerente|admin)
 * fix#9: enriquece la respuesta con metadata por archivo (path, tamano_kb,
 * fecha) para que el frontend Gallery muestre detalles y permita eliminar.
 * Ordena por mtime DESC.
 * @returns { ok, imagenes: [{ nombre, path, url, tamano_kb, fecha }] }
 */
exports.listarImagenes = async (req, res, next) => {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    const leerDir = (dir, urlBase, deletable) =>
      fs.existsSync(dir)
        ? fs.readdirSync(dir)
            .filter((f) => ALLOWED_IMG_EXTS.includes(path.extname(f).toLowerCase()))
            .map((f) => {
              try {
                const stat = fs.statSync(path.join(dir, f));
                return {
                  nombre: f,
                  path: deletable ? f : null,
                  url: `${urlBase}/${f}`,
                  tamano_kb: Math.max(1, Math.round(stat.size / 1024)),
                  fecha: stat.mtime.toISOString(),
                  mtime_ms: stat.mtimeMs,
                  deletable,
                };
              } catch {
                return { nombre: f, path: deletable ? f : null, url: `${urlBase}/${f}`, deletable };
              }
            })
        : [];

    const uploads = leerDir(UPLOADS_DIR, '/media/uploads', true);
    const images  = leerDir(IMAGES_DIR,  '/media/images',  false);

    const archivos = [...uploads, ...images]
      .sort((a, b) => (b.mtime_ms || 0) - (a.mtime_ms || 0));

    return res.json({ ok: true, imagenes: archivos });
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/imagenes/eliminar (gerente|admin)
 * Body: { path }
 * Borra un archivo del UPLOADS_DIR. Defensa contra path traversal: rechaza
 * paths con '..' o absolutos, usa basename, y valida que el resultado quede
 * dentro de UPLOADS_DIR.
 */
exports.eliminarImagen = async (req, res, next) => {
  try {
    const { path: imgPath } = req.body;
    if (!imgPath) return res.status(400).json({ ok: false, error: 'Path requerido.' });
    if (String(imgPath).includes('..') || path.isAbsolute(imgPath)) {
      return res.status(400).json({ ok: false, error: 'Path inválido.' });
    }
    const safeName = path.basename(imgPath);
    const destPath = path.join(UPLOADS_DIR, safeName);
    const resolvedDest = path.resolve(destPath);
    const resolvedUploads = path.resolve(UPLOADS_DIR);
    if (!resolvedDest.startsWith(resolvedUploads + path.sep)) {
      return res.status(400).json({ ok: false, error: 'Path inválido.' });
    }
    if (!fs.existsSync(destPath)) return res.status(404).json({ ok: false, error: 'Archivo no encontrado.' });
    fs.unlinkSync(destPath);
    return res.json({ ok: true });
  } catch (err) { next(err); }
};

// ─── Stats dashboard (KPIs en tiempo real) ────────────────────────────────────

/**
 * GET /api/gerente/stats (gerente|admin)
 * KPIs en vivo del día y métricas operativas para el dashboard:
 *   - ventas_hoy / cobros_hoy: SolicitudPago procesada con fecha_hora >= hoy 00:00.
 *   - mesas_ocupadas / mesas_totales.
 *   - pedidos_pendientes (recibido|preparando|listo).
 *   - alertas_vivas (no atendidas).
 *   - solicitudes_pendientes (SolicitudPago pendientes).
 *
 * @returns { ok, ts, ventas_hoy, cobros_hoy, mesas_ocupadas, mesas_totales,
 *            pedidos_pendientes, alertas_vivas, solicitudes_pendientes }
 */
exports.statsJson = async (req, res, next) => {
  try {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    const [estadoProcesada, estadoPendiente] = await Promise.all([
      EstadoSolicitud.findOne({ where: { descripcion: 'procesada' } }),
      EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } }),
    ]);

    const [pagosHoy, mesasOcupadas, mesasTotales, pedidosPendientes, alertasVivas, solicitudesPendientes] = await Promise.all([
      estadoProcesada
        ? SolicitudPago.findAll({
            where: { fecha_hora: { [Op.gte]: hoy }, id_estado_solicitud: estadoProcesada.id },
            attributes: ['total_mesa', 'total_individual'],
          })
        : Promise.resolve([]),
      Mesa.count({ where: { estado: 'ocupada' } }),
      Mesa.count(),
      Pedido.count({ where: { estado: { [Op.in]: ['recibido', 'preparando', 'listo'] } } }),
      AlertaMesero.count({ where: { atendida: false } }),
      estadoPendiente
        ? SolicitudPago.count({ where: { id_estado_solicitud: estadoPendiente.id } })
        : Promise.resolve(0),
    ]);

    const ventasHoy = pagosHoy.reduce(
      (acc, p) => acc + parseFloat(p.total_mesa ?? p.total_individual ?? 0), 0
    );

    return res.json({
      ok: true,
      ventas_hoy: Math.round(ventasHoy * 100) / 100,
      cobros_hoy: pagosHoy.length,
      mesas_ocupadas: mesasOcupadas,
      mesas_totales: mesasTotales,
      pedidos_pendientes: pedidosPendientes,
      alertas_vivas: alertasVivas,
      solicitudes_pendientes: solicitudesPendientes,
      ts: Date.now(),
    });
  } catch (err) { next(err); }
};

// ─── Reportes avanzados ───────────────────────────────────────────────────────

async function _reportesAvanzadosData(periodo, desdeStr, hastaStr) {
  const base = await _reportesData(periodo, desdeStr, hastaStr);

  // Re-query pedidos including empleado_entrega for breakdown by mesero
  const pedidosConMesero = await Pedido.findAll({
    where: { fecha_hora_ingreso: { [Op.gte]: base.desde, [Op.lte]: base.hasta }, estado: { [Op.not]: 'cancelado' } },
    include: [{ model: Empleado, as: 'empleado_entrega', attributes: ['id_empleado', 'nombre', 'apellido'], required: false }],
    attributes: ['id', 'fecha_hora_ingreso', 'id_empleado_entrega'],
  });

  // Ventas por hora (from base pedidos)
  const ventasPorHora = {};
  for (let h = 0; h < 24; h++) ventasPorHora[h] = { hora: h, total: 0, count: 0 };
  base.pedidos.forEach((p) => {
    const h = new Date(p.fecha_hora_ingreso).getHours();
    const total = (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0);
    ventasPorHora[h].total += total;
    ventasPorHora[h].count += 1;
  });

  // Pedidos por mesero
  const porMesero = {};
  pedidosConMesero.forEach((p) => {
    const key = p.id_empleado_entrega ?? 0;
    const nombre = p.empleado_entrega
      ? `${p.empleado_entrega.nombre} ${p.empleado_entrega.apellido || ''}`.trim()
      : 'Sin asignar';
    if (!porMesero[key]) porMesero[key] = { id: key, nombre, count: 0 };
    porMesero[key].count += 1;
  });

  // Ventas por método de pago
  const estadoProcesada = await EstadoSolicitud.findOne({ where: { descripcion: 'procesada' } });
  const pagos = estadoProcesada
    ? await SolicitudPago.findAll({
        where: { fecha_hora: { [Op.gte]: base.desde, [Op.lte]: base.hasta }, id_estado_solicitud: estadoProcesada.id },
        include: [{ model: MetodoPago, as: 'metodo_pago', attributes: ['descripcion'], required: false }],
        attributes: ['total_mesa', 'total_individual'],
      })
    : [];

  const porMetodo = {};
  pagos.forEach((p) => {
    const key = p.metodo_pago?.descripcion || 'Efectivo';
    if (!porMetodo[key]) porMetodo[key] = { metodo: key, total: 0, count: 0 };
    porMetodo[key].total += parseFloat(p.total_mesa ?? p.total_individual ?? 0);
    porMetodo[key].count += 1;
  });

  return {
    ...base,
    ventas_por_hora: Object.values(ventasPorHora),
    pedidos_por_mesero: Object.values(porMesero).sort((a, b) => b.count - a.count),
    ventas_por_metodo_pago: Object.values(porMetodo),
  };
}

/**
 * GET /api/gerente/reportes/avanzados?periodo=&desde=&hasta= (gerente|admin)
 *
 * Reporte detallado con cortes adicionales: ventas por hora del día,
 * pedidos por mesero, ventas por método de pago, cancelaciones.
 *
 * @returns { ok, desde, hasta, stats, top_productos, ventas_por_hora,
 *            pedidos_por_mesero, ventas_por_metodo_pago, cancelaciones }
 */
exports.getReportesAvanzados = async (req, res, next) => {
  try {
    const { periodo = 'mes', desde, hasta } = req.query;
    const data = await _reportesAvanzadosData(periodo, desde, hasta);
    return res.json({
      ok: true,
      desde: data.desde,
      hasta: data.hasta,
      stats: data.stats,
      top_productos: data.topProductos,
      ventas_por_hora: data.ventas_por_hora,
      pedidos_por_mesero: data.pedidos_por_mesero,
      ventas_por_metodo_pago: data.ventas_por_metodo_pago,
      cancelaciones: data.cancelados.map((p) => ({
        id: p.id, fecha: p.fecha_hora_ingreso,
        mesa: p.sesion?.mesa?.numero_mesa, motivo: p.motivo_cancelacion,
      })),
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/reportes/avanzados/exportar (gerente|admin)
 * Body: { periodo, desde?, hasta? }
 * Genera XLSX con 5 hojas: Resumen, Top productos, Ventas por hora, Por mesero,
 * Método de pago. Devuelve buffer XLSX como attachment.
 */
exports.exportarReporteAvanzado = async (req, res, next) => {
  try {
    const { periodo = 'mes', desde, hasta } = req.body;
    const data = await _reportesAvanzadosData(periodo, desde, hasta);
    const fmtFecha = (d) => new Date(d).toLocaleDateString('es-MX');
    const titulo = `Reporte avanzado — ${fmtFecha(data.desde)} a ${fmtFecha(data.hasta)}`;

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Mochi Matcha POS';

    // Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 32 }, { width: 18 }];
    ws1.addRow([titulo]);
    ws1.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF3D6B4F' } };
    ws1.addRow([]);
    const { stats } = data;
    ws1.addRow(['Ventas totales',    `$${stats.total_ventas.toFixed(2)}`]);
    ws1.addRow(['Pedidos',           stats.total_pedidos]);
    ws1.addRow(['Sesiones',          stats.total_sesiones]);
    ws1.addRow(['Ticket promedio',   `$${stats.ticket_promedio.toFixed(2)}`]);
    ws1.addRow(['Cancelaciones',     stats.cancelaciones_count]);

    // Top productos
    const ws2 = wb.addWorksheet('Top productos');
    ws2.columns = [
      { header: '#',        key: 'rank',    width: 6  },
      { header: 'Producto', key: 'nombre',  width: 36 },
      { header: 'Unidades', key: 'unids',   width: 12 },
      { header: 'Ingreso',  key: 'ingreso', width: 14 },
    ];
    ws2.getRow(1).font = { bold: true };
    data.topProductos.forEach((p, i) => {
      ws2.addRow({ rank: i + 1, nombre: p.nombre, unids: p.total_vendido, ingreso: parseFloat(p.ingreso.toFixed(2)) });
    });

    // Ventas por hora
    const ws3 = wb.addWorksheet('Ventas por hora');
    ws3.columns = [
      { header: 'Hora',    key: 'hora',  width: 8  },
      { header: 'Total',   key: 'total', width: 14 },
      { header: 'Pedidos', key: 'count', width: 10 },
    ];
    ws3.getRow(1).font = { bold: true };
    data.ventas_por_hora.forEach((h) => {
      ws3.addRow({ hora: `${String(h.hora).padStart(2, '0')}:00`, total: parseFloat(h.total.toFixed(2)), count: h.count });
    });

    // Por mesero
    const ws4 = wb.addWorksheet('Por mesero');
    ws4.columns = [
      { header: 'Mesero',  key: 'nombre', width: 32 },
      { header: 'Pedidos', key: 'count',  width: 10 },
    ];
    ws4.getRow(1).font = { bold: true };
    data.pedidos_por_mesero.forEach((m) => ws4.addRow({ nombre: m.nombre, count: m.count }));

    // Por método de pago
    const ws5 = wb.addWorksheet('Método de pago');
    ws5.columns = [
      { header: 'Método',  key: 'metodo', width: 20 },
      { header: 'Total',   key: 'total',  width: 14 },
      { header: 'Cobros',  key: 'count',  width: 10 },
    ];
    ws5.getRow(1).font = { bold: true };
    data.ventas_por_metodo_pago.forEach((m) => {
      ws5.addRow({ metodo: m.metodo, total: parseFloat(m.total.toFixed(2)), count: m.count });
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-avanzado-${Date.now()}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
};

/**
 * POST /api/gerente/reportes/exportar-custom (gerente|admin)
 * Body: { formato='pdf'|'xlsx', secciones?: ['resumen','top_productos','pedidos','cancelaciones'],
 *         periodo, desde?, hasta? }
 * Genera el reporte sólo con las secciones indicadas (omitirlas → solo
 * resumen). Soporta tanto Excel como PDF.
 */
exports.exportarReporteCustom = async (req, res, next) => {
  try {
    const { formato = 'pdf', secciones = [], periodo = 'mes', desde, hasta } = req.body;
    const sec = Array.isArray(secciones) ? secciones : [secciones];
    const data = await _reportesData(periodo, desde, hasta);
    const fmtFecha = (d) => new Date(d).toLocaleDateString('es-MX');
    const titulo = `Reporte personalizado — ${fmtFecha(data.desde)} a ${fmtFecha(data.hasta)}`;

    if (formato === 'excel' || formato === 'xlsx') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Mochi Matcha POS';

      if (sec.length === 0 || sec.includes('resumen')) {
        const ws = wb.addWorksheet('Resumen');
        ws.columns = [{ width: 32 }, { width: 18 }];
        ws.addRow([titulo]);
        ws.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF3D6B4F' } };
        ws.addRow([]);
        ws.addRow(['Ventas totales',  `$${data.stats.total_ventas.toFixed(2)}`]);
        ws.addRow(['Pedidos',         data.stats.total_pedidos]);
        ws.addRow(['Sesiones',        data.stats.total_sesiones]);
        ws.addRow(['Ticket promedio', `$${data.stats.ticket_promedio.toFixed(2)}`]);
        ws.addRow(['Cancelaciones',   data.stats.cancelaciones_count]);
      }

      if (sec.includes('top_productos')) {
        const ws = wb.addWorksheet('Top productos');
        ws.columns = [
          { header: '#', key: 'rank', width: 6 },
          { header: 'Producto', key: 'nombre', width: 36 },
          { header: 'Unidades', key: 'unids', width: 12 },
          { header: 'Ingreso', key: 'ingreso', width: 14 },
        ];
        ws.getRow(1).font = { bold: true };
        data.topProductos.forEach((p, i) => {
          ws.addRow({ rank: i + 1, nombre: p.nombre, unids: p.total_vendido, ingreso: parseFloat(p.ingreso.toFixed(2)) });
        });
      }

      if (sec.includes('pedidos')) {
        const ws = wb.addWorksheet('Pedidos');
        ws.columns = [
          { header: 'ID',     key: 'id',     width: 8  },
          { header: 'Fecha',  key: 'fecha',  width: 18 },
          { header: 'Mesa',   key: 'mesa',   width: 8  },
          { header: 'Total',  key: 'total',  width: 12 },
          { header: 'Estado', key: 'estado', width: 12 },
        ];
        ws.getRow(1).font = { bold: true };
        data.pedidos.forEach((p) => {
          const total = (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0);
          ws.addRow({ id: p.id, fecha: new Date(p.fecha_hora_ingreso).toLocaleString('es-MX'), mesa: p.sesion?.mesa?.numero_mesa, total: parseFloat(total.toFixed(2)), estado: p.estado });
        });
      }

      if (sec.includes('cancelaciones')) {
        const ws = wb.addWorksheet('Cancelaciones');
        ws.columns = [
          { header: 'ID',     key: 'id',     width: 8  },
          { header: 'Fecha',  key: 'fecha',  width: 18 },
          { header: 'Mesa',   key: 'mesa',   width: 8  },
          { header: 'Motivo', key: 'motivo', width: 40 },
        ];
        ws.getRow(1).font = { bold: true };
        data.cancelados.forEach((p) => {
          ws.addRow({ id: p.id, fecha: new Date(p.fecha_hora_ingreso).toLocaleString('es-MX'), mesa: p.sesion?.mesa?.numero_mesa, motivo: p.motivo_cancelacion || '' });
        });
      }

      if (wb.worksheets.length === 0) {
        const ws = wb.addWorksheet('Sin datos');
        ws.addRow(['No se seleccionaron secciones.']);
      }

      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-custom-${Date.now()}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    // PDF
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-custom-${Date.now()}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).fillColor('#3D6B4F').text('Mochi Matcha · Reporte personalizado', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#666').text(titulo);
    doc.moveDown(0.8);

    if (sec.length === 0 || sec.includes('resumen')) {
      doc.fontSize(12).fillColor('#000').text('Resumen', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10);
      doc.text(`• Ventas totales: $${data.stats.total_ventas.toFixed(2)}`);
      doc.text(`• Pedidos: ${data.stats.total_pedidos}`);
      doc.text(`• Sesiones: ${data.stats.total_sesiones}`);
      doc.text(`• Ticket promedio: $${data.stats.ticket_promedio.toFixed(2)}`);
      doc.text(`• Cancelaciones: ${data.stats.cancelaciones_count}`);
      doc.moveDown(0.8);
    }

    if (sec.includes('top_productos')) {
      doc.fontSize(12).fillColor('#000').text('Top productos', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10);
      data.topProductos.slice(0, 20).forEach((p, i) => {
        doc.text(`${i + 1}. ${p.nombre}  —  ${p.total_vendido} uds  ·  $${p.ingreso.toFixed(2)}`);
      });
      doc.moveDown(0.8);
    }

    if (sec.includes('cancelaciones')) {
      doc.fontSize(12).fillColor('#000').text('Cancelaciones', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(9);
      data.cancelados.forEach((p) => {
        doc.text(`#${p.id}  ${new Date(p.fecha_hora_ingreso).toLocaleString('es-MX')}  Mesa ${p.sesion?.mesa?.numero_mesa || '—'}  ${p.motivo_cancelacion || ''}`);
      });
      doc.moveDown(0.8);
    }

    doc.fontSize(7).fillColor('#999').text(`Generado el ${new Date().toLocaleString('es-MX')}`, { align: 'right' });
    doc.end();
  } catch (err) { next(err); }
};

// ─── Auditoría ────────────────────────────────────────────────────────────────

/**
 * GET /api/gerente/auditoria?accion=&empleado_id=&fecha_desde=&fecha_hasta=&page=&page_size= (gerente|admin)
 *
 * Listado paginado de Auditoria con filtros: acción (LIKE), empleado, rango
 * de fechas. Page size máximo 200. Devuelve registros con empleado, mesa y
 * pedido relacionados (joins opcionales).
 *
 * @returns { ok, total, page, page_size, registros: [{ id, fecha_hora, accion,
 *            detalle, empleado, mesa, pedido_id }] }
 */
exports.getAuditoria = async (req, res, next) => {
  try {
    const { accion, empleado_id, fecha_desde, fecha_hasta, page = 1, page_size = 50 } = req.query;
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(page_size) || 50));
    const where = {};

    if (accion) where.accion = { [Op.like]: `%${accion}%` };
    if (empleado_id) where.id_empleado = parseInt(empleado_id);
    if (fecha_desde || fecha_hasta) {
      where.fecha_hora = {};
      if (fecha_desde) where.fecha_hora[Op.gte] = new Date(fecha_desde);
      if (fecha_hasta) {
        const h = new Date(fecha_hasta); h.setHours(23, 59, 59, 999);
        where.fecha_hora[Op.lte] = h;
      }
    }

    const [registros, total] = await Promise.all([
      Auditoria.findAll({
        where,
        include: [
          { model: Empleado, as: 'empleado', attributes: ['id_empleado', 'nombre', 'usuario'], required: false },
          { model: Mesa,     as: 'mesa',     attributes: ['id', 'numero_mesa'],                required: false },
          { model: Pedido,   as: 'pedido',   attributes: ['id'],                               required: false },
        ],
        order: [['fecha_hora', 'DESC']],
        limit:  pageSize,
        offset: (pageNum - 1) * pageSize,
      }),
      Auditoria.count({ where }),
    ]);

    return res.json({
      ok: true,
      total,
      page: pageNum,
      page_size: pageSize,
      registros: registros.map((r) => ({
        id:         r.id,
        fecha_hora: r.fecha_hora,
        accion:     r.accion,
        detalle:    r.detalle,
        empleado:   r.empleado ? { id: r.empleado.id_empleado, nombre: r.empleado.nombre, usuario: r.empleado.usuario } : null,
        mesa:       r.mesa     ? { id: r.mesa.id, numero: r.mesa.numero_mesa }   : null,
        pedido_id:  r.pedido?.id ?? null,
      })),
    });
  } catch (err) { next(err); }
};
