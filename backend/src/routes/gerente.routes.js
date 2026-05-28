/**
 * Routes del panel gerente/admin. TODAS requieren JWT + rol gerente|admin.
 * Cubren CRUD del catálogo, empleados, mesas, configuración, reportes y auditoría.
 *
 * Endpoints (auth: JWT Bearer + rol gerente|admin para todos):
 *   Mesas:
 *     GET    /api/gerente/mesas                       → ctrl.listarMesas
 *     POST   /api/gerente/mesas                       → ctrl.crearMesa
 *     PUT    /api/gerente/mesas/:id                   → ctrl.actualizarMesa
 *     DELETE /api/gerente/mesas/:id                   → ctrl.eliminarMesa
 *     POST   /api/gerente/mesas/:id/asignar           → ctrl.asignarMesero
 *     GET    /api/gerente/mesas/:id/qr                → ctrl.getMesaQR             (png|svg|dataurl)
 *     POST   /api/gerente/mesas/:id/regenerar-qr      → ctrl.regenerarMesaQR
 *
 *   Ubicaciones:
 *     GET    /api/gerente/ubicaciones                 → ctrl.listarUbicaciones
 *     POST   /api/gerente/ubicaciones                 → ctrl.crearUbicacion
 *     PUT    /api/gerente/ubicaciones/:id             → ctrl.actualizarUbicacion
 *     DELETE /api/gerente/ubicaciones/:id             → ctrl.eliminarUbicacion
 *
 *   Productos:
 *     GET    /api/gerente/productos                   → ctrl.listarProductos
 *     POST   /api/gerente/productos                   → ctrl.crearProducto
 *     PUT    /api/gerente/productos/:id               → ctrl.actualizarProducto
 *     DELETE /api/gerente/productos/:id               → ctrl.eliminarProducto      (soft: disponible=false)
 *
 *   Categorías:
 *     GET    /api/gerente/categorias                  → ctrl.listarCategorias
 *     POST   /api/gerente/categorias                  → ctrl.crearCategoria
 *     PUT    /api/gerente/categorias/:id              → ctrl.actualizarCategoria
 *     DELETE /api/gerente/categorias/:id              → ctrl.eliminarCategoria
 *
 *   Modificadores:
 *     GET    /api/gerente/modificadores               → ctrl.listarModificadores
 *     POST   /api/gerente/modificadores               → ctrl.crearModificador
 *     POST   /api/gerente/modificadores/clonar        → ctrl.clonarPlantilla
 *     GET    /api/gerente/modificadores/:id/editar    → ctrl.getModificadorEditar
 *     POST   /api/gerente/modificadores/:id/editar    → ctrl.actualizarModificador
 *     PUT    /api/gerente/modificadores/:id           → ctrl.actualizarModificador
 *     POST   /api/gerente/modificadores/:id/plantilla → ctrl.togglePlantilla
 *     DELETE /api/gerente/modificadores/:id           → ctrl.eliminarModificador
 *
 *   Promociones:
 *     GET    /api/gerente/promociones                 → ctrl.listarPromociones
 *     POST   /api/gerente/promociones                 → ctrl.crearPromocion
 *     GET    /api/gerente/promociones/:id/editar      → ctrl.getPromocionEditar
 *     POST   /api/gerente/promociones/:id/editar      → ctrl.actualizarPromocion
 *     PUT    /api/gerente/promociones/:id             → ctrl.actualizarPromocion
 *     DELETE /api/gerente/promociones/:id             → ctrl.eliminarPromocion
 *     POST   /api/gerente/promociones/:id/toggle      → ctrl.togglePromocion
 *
 *   Tipos de descuento:
 *     GET    /api/gerente/tipos-descuento             → ctrl.listarTiposDescuento
 *
 *   Stats / dashboard:
 *     GET    /api/gerente/stats                       → ctrl.statsJson
 *     GET    /api/gerente/floor-plan/estado           → ctrl.getMesasEstado          (alias)
 *     GET    /api/gerente/mesas-estado                → ctrl.getMesasEstado
 *     GET    /api/gerente/mesa/:id/detalle            → ctrl.getDetalleMesa
 *     POST   /api/gerente/solicitudes/:id/cancelar    → ctrl.cancelarSolicitud
 *
 *   Reportes:
 *     GET    /api/gerente/reportes                    → ctrl.getReportes
 *     GET    /api/gerente/reportes/avanzados          → ctrl.getReportesAvanzados
 *     GET    /api/gerente/reportes/exportar           → ctrl.exportarReporte         (pdf|xlsx)
 *     POST   /api/gerente/reportes/exportar           → ctrl.exportarReporte
 *     POST   /api/gerente/reportes/avanzados/exportar → ctrl.exportarReporteAvanzado (xlsx)
 *     POST   /api/gerente/reportes/exportar-custom    → ctrl.exportarReporteCustom   (pdf|xlsx)
 *
 *   Auditoría:
 *     GET    /api/gerente/auditoria                   → ctrl.getAuditoria            (filtros + paginación)
 *
 *   Configuración:
 *     GET    /api/gerente/config                      → ctrl.listarConfig
 *     PUT    /api/gerente/config                      → ctrl.guardarConfig
 *     POST   /api/gerente/config                      → ctrl.guardarConfig
 *
 *   Horarios:
 *     GET    /api/gerente/horarios                    → ctrl.listarHorarios
 *     PUT    /api/gerente/horarios                    → ctrl.guardarHorarios         (bulk replace)
 *     POST   /api/gerente/horarios                    → ctrl.crearHorario
 *     POST   /api/gerente/horarios/:id/toggle         → ctrl.toggleHorario
 *     DELETE /api/gerente/horarios/:id                → ctrl.eliminarHorario
 *
 *   Imágenes:
 *     GET    /api/gerente/imagenes                    → ctrl.listarImagenes
 *     POST   /api/gerente/upload-imagen               → ctrl.uploadImagen            (multipart)
 *     POST   /api/gerente/imagenes/eliminar           → ctrl.eliminarImagen
 *
 *   Empleados:
 *     GET    /api/gerente/empleados                   → ctrl.listarEmpleados
 *     POST   /api/gerente/empleados                   → ctrl.crearEmpleado
 *     PUT    /api/gerente/empleados/:id               → ctrl.actualizarEmpleado
 *     DELETE /api/gerente/empleados/:id               → ctrl.eliminarEmpleado        (soft: activo=false)
 *     PUT    /api/gerente/empleados/:id/password      → ctrl.cambiarPasswordEmpleado
 *     PUT    /api/gerente/empleados/:id/toggle        → ctrl.toggleEmpleado
 */
const router    = require('express').Router();
const auth      = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const validate  = require('../middleware/validate');
const ctrl      = require('../controllers/gerente.controller');

router.use(auth, authorize('gerente', 'admin'));

// Mesas CRUD + QR
router.get('/mesas',                    ctrl.listarMesas);
router.post('/mesas',                   ctrl.crearMesa);
router.put('/mesas/:id',                ctrl.actualizarMesa);
router.delete('/mesas/:id',             ctrl.eliminarMesa);
router.post('/mesas/:id/asignar',       ctrl.asignarMesero);
router.get('/mesas/:id/qr',             ctrl.getMesaQR);
router.post('/mesas/:id/regenerar-qr',  ctrl.regenerarMesaQR);

// Ubicaciones
router.get('/ubicaciones',          ctrl.listarUbicaciones);
router.post('/ubicaciones',         ctrl.crearUbicacion);
router.put('/ubicaciones/:id',      ctrl.actualizarUbicacion);
router.delete('/ubicaciones/:id',   ctrl.eliminarUbicacion);

// Productos
router.get('/productos',         ctrl.listarProductos);
router.post('/productos',
  validate({ body: { nombre: 'required|string:1,100', precio: 'required|number', descripcion: 'string:0,255', id_categoria: 'int:1,' } }),
  ctrl.crearProducto);
router.put('/productos/:id',
  validate({ body: { nombre: 'string:1,100', precio: 'number', descripcion: 'string:0,255', id_categoria: 'int:1,' } }),
  ctrl.actualizarProducto);
router.delete('/productos/:id',  ctrl.eliminarProducto);

// Categorías
router.get('/categorias',         ctrl.listarCategorias);
router.post('/categorias',
  validate({ body: { nombre: 'required|string:1,100', area: 'enum:cocina,bar,ambos', orden: 'int:0,' } }),
  ctrl.crearCategoria);
router.put('/categorias/:id',
  validate({ body: { nombre: 'string:1,100', area: 'enum:cocina,bar,ambos', orden: 'int:0,' } }),
  ctrl.actualizarCategoria);
router.delete('/categorias/:id',  ctrl.eliminarCategoria);

// Modificadores
router.get('/modificadores',                    ctrl.listarModificadores);
router.post('/modificadores',                   ctrl.crearModificador);
router.post('/modificadores/clonar',            ctrl.clonarPlantilla);
router.get('/modificadores/:id/editar',         ctrl.getModificadorEditar);
router.post('/modificadores/:id/editar',        ctrl.actualizarModificador);
router.put('/modificadores/:id',                ctrl.actualizarModificador);
router.post('/modificadores/:id/plantilla',     ctrl.togglePlantilla);
router.delete('/modificadores/:id',             ctrl.eliminarModificador);

// Promociones
router.get('/promociones',                  ctrl.listarPromociones);
router.post('/promociones',                 ctrl.crearPromocion);
router.get('/promociones/:id/editar',       ctrl.getPromocionEditar);
router.post('/promociones/:id/editar',      ctrl.actualizarPromocion);
router.put('/promociones/:id',              ctrl.actualizarPromocion);
router.delete('/promociones/:id',           ctrl.eliminarPromocion);
router.post('/promociones/:id/toggle',      ctrl.togglePromocion);

// Tipos de descuento
router.get('/tipos-descuento', ctrl.listarTiposDescuento);

// Stats dashboard
router.get('/stats',              ctrl.statsJson);

// Floor plan (alias gerente)
router.get('/floor-plan/estado',  ctrl.getMesasEstado);

// Reportes
router.get('/reportes',                          ctrl.getReportes);
router.get('/reportes/avanzados',                ctrl.getReportesAvanzados);
router.get('/reportes/exportar',                 ctrl.exportarReporte);
router.post('/reportes/exportar',                ctrl.exportarReporte);
router.post('/reportes/avanzados/exportar',      ctrl.exportarReporteAvanzado);
router.post('/reportes/exportar-custom',         ctrl.exportarReporteCustom);

// Auditoría
router.get('/auditoria',          ctrl.getAuditoria);

// Configuración
router.get('/config',          ctrl.listarConfig);
router.put('/config',          ctrl.guardarConfig);
router.post('/config',         ctrl.guardarConfig);

// Horarios
router.get('/horarios',                      ctrl.listarHorarios);
router.put('/horarios',                      ctrl.guardarHorarios);
router.post('/horarios',                     ctrl.crearHorario);
router.post('/horarios/:id/toggle',          ctrl.toggleHorario);
router.delete('/horarios/:id',               ctrl.eliminarHorario);

// Imágenes
router.get('/imagenes',                      ctrl.listarImagenes);
router.post('/upload-imagen',                ctrl.uploadImagen);
router.post('/imagenes/eliminar',            ctrl.eliminarImagen);

// Empleados
router.get('/empleados',                  ctrl.listarEmpleados);
router.post('/empleados',                 ctrl.crearEmpleado);
router.put('/empleados/:id',              ctrl.actualizarEmpleado);
router.delete('/empleados/:id',           ctrl.eliminarEmpleado);
router.put('/empleados/:id/password',     ctrl.cambiarPasswordEmpleado);
router.put('/empleados/:id/toggle',       ctrl.toggleEmpleado);

// Dashboard / Floor Plan
router.get('/mesas-estado',              ctrl.getMesasEstado);
router.get('/mesa/:id/detalle',          ctrl.getDetalleMesa);
router.post('/solicitudes/:id/cancelar', ctrl.cancelarSolicitud);

module.exports = router;
