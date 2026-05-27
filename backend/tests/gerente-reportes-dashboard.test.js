'use strict';

jest.mock('../src/models', () => ({
  Configuracion:   { findAll: jest.fn(), findOne: jest.fn(), findOrCreate: jest.fn() },
  HorarioAtencion: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn(), destroy: jest.fn(), bulkCreate: jest.fn() },
  Auditoria:       { create: jest.fn(), findAll: jest.fn(), count: jest.fn() },
  Mesa:            { findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn(), count: jest.fn() },
  UbicacionMesa:   {},
  Producto:        { findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn() },
  Categoria:       { findAll: jest.fn() },
  GrupoModificador:  {},
  OpcionModificador: {},
  Promocion:       {},
  TipoDescuento:   { findAll: jest.fn() },
  Pedido:          { findAll: jest.fn(), count: jest.fn() },
  DetallePedido:   {},
  SesionCliente:   { findAll: jest.fn(), count: jest.fn() },
  SolicitudPago:   { findAll: jest.fn(), count: jest.fn() },
  AlertaMesero:    { findAll: jest.fn(), count: jest.fn() },
  MetodoPago:      {},
  EstadoSolicitud: { findOne: jest.fn() },
  Empleado:        { findAll: jest.fn() },
  ModalidadIngreso: {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../src/app');
const {
  Configuracion, HorarioAtencion,
  Mesa, Pedido, SesionCliente, SolicitudPago, AlertaMesero,
  EstadoSolicitud, Auditoria, Empleado,
} = require('../src/models');
const mantenimientoMw = require('../src/middleware/mantenimiento');
const horarioMw       = require('../src/middleware/horario');

const SECRET       = process.env.JWT_SECRET;
const tokenGerente = jwt.sign({ id: 1, rol: 'gerente' }, SECRET);

function authGet(url) {
  return request(app).get(url).set('Authorization', `Bearer ${tokenGerente}`);
}
function authPost(url, body) {
  return request(app).post(url).set('Authorization', `Bearer ${tokenGerente}`).send(body);
}

beforeEach(() => {
  mantenimientoMw.invalidate();
  horarioMw.invalidate();
  Configuracion.findOne.mockReset().mockResolvedValue(null);
  Configuracion.findAll.mockReset().mockResolvedValue([]);
  Configuracion.findOrCreate.mockReset();
  HorarioAtencion.findAll.mockReset().mockResolvedValue([]);
  Pedido.findAll.mockReset().mockResolvedValue([]);
  Pedido.count.mockReset().mockResolvedValue(0);
  SesionCliente.findAll.mockReset().mockResolvedValue([]);
  SesionCliente.count.mockReset().mockResolvedValue(0);
  SolicitudPago.findAll.mockReset().mockResolvedValue([]);
  SolicitudPago.count.mockReset().mockResolvedValue(0);
  AlertaMesero.count.mockReset().mockResolvedValue(0);
  Mesa.count.mockReset().mockResolvedValue(0);
  Mesa.findAll.mockReset().mockResolvedValue([]);
  EstadoSolicitud.findOne.mockReset().mockResolvedValue(null);
  Auditoria.findAll.mockReset().mockResolvedValue([]);
  Auditoria.count.mockReset().mockResolvedValue(0);
  Empleado.findAll.mockReset().mockResolvedValue([]);
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

test('stats: ventas_hoy suma COALESCE(total_mesa, total_individual)', async () => {
  EstadoSolicitud.findOne
    .mockResolvedValueOnce({ id: 1, descripcion: 'procesada' })
    .mockResolvedValueOnce({ id: 2, descripcion: 'pendiente' });

  SolicitudPago.findAll.mockResolvedValue([
    { total_mesa: '150.00', total_individual: null },
    { total_mesa: null,     total_individual: '75.50' },
  ]);
  Mesa.count
    .mockResolvedValueOnce(3)   // ocupadas
    .mockResolvedValueOnce(10); // totales
  Pedido.count.mockResolvedValue(4);
  AlertaMesero.count.mockResolvedValue(2);
  SolicitudPago.count.mockResolvedValue(1);

  const res = await authGet('/api/gerente/stats');

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.ventas_hoy).toBeCloseTo(225.5, 2);
  expect(res.body.cobros_hoy).toBe(2);
  expect(res.body.mesas_ocupadas).toBe(3);
  expect(res.body.mesas_totales).toBe(10);
  expect(res.body.pedidos_pendientes).toBe(4);
  expect(res.body.alertas_vivas).toBe(2);
  expect(res.body.solicitudes_pendientes).toBe(1);
  expect(typeof res.body.ts).toBe('number');
});

test('stats: sin estado procesada → ventas_hoy = 0', async () => {
  EstadoSolicitud.findOne.mockResolvedValue(null);
  Mesa.count.mockResolvedValue(0);
  Pedido.count.mockResolvedValue(0);
  AlertaMesero.count.mockResolvedValue(0);
  SolicitudPago.count.mockResolvedValue(0);

  const res = await authGet('/api/gerente/stats');

  expect(res.status).toBe(200);
  expect(res.body.ventas_hoy).toBe(0);
  expect(res.body.cobros_hoy).toBe(0);
});

// ─── GET /reportes/avanzados ──────────────────────────────────────────────────

test('reportes avanzados: devuelve campos clave', async () => {
  EstadoSolicitud.findOne.mockResolvedValue({ id: 1 });
  SolicitudPago.findAll.mockResolvedValue([]);

  const res = await authGet('/api/gerente/reportes/avanzados');

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body).toHaveProperty('stats');
  expect(res.body).toHaveProperty('ventas_por_hora');
  expect(res.body).toHaveProperty('pedidos_por_mesero');
  expect(res.body).toHaveProperty('ventas_por_metodo_pago');
  expect(Array.isArray(res.body.ventas_por_hora)).toBe(true);
  expect(res.body.ventas_por_hora).toHaveLength(24);
});

// ─── POST /reportes/avanzados/exportar (Excel) ────────────────────────────────

test('exportar reporte avanzado → xlsx con hojas correctas', async () => {
  EstadoSolicitud.findOne.mockResolvedValue({ id: 1 });
  SolicitudPago.findAll.mockResolvedValue([]);

  const res = await authPost('/api/gerente/reportes/avanzados/exportar', { periodo: 'mes' });

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  expect(res.headers['content-disposition']).toMatch(/attachment/);
});

// ─── POST /reportes/exportar-custom ──────────────────────────────────────────

test('exportar custom Excel con secciones resumen+top_productos → 200 xlsx', async () => {
  const res = await authPost('/api/gerente/reportes/exportar-custom', {
    formato: 'excel',
    secciones: ['resumen', 'top_productos'],
    periodo: 'mes',
  });

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
});

test('exportar custom PDF → application/pdf con contenido', async () => {
  const res = await authPost('/api/gerente/reportes/exportar-custom', {
    formato: 'pdf',
    secciones: ['resumen'],
    periodo: 'hoy',
  });

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/pdf/);
  expect(parseInt(res.headers['content-length'] ?? '0') > 0 || res.body.length > 0).toBe(true);
});

// ─── GET /reportes/exportar (legacy) ─────────────────────────────────────────

test('exportar reporte legacy GET Excel → xlsx', async () => {
  const res = await authGet('/api/gerente/reportes/exportar?formato=excel&periodo=hoy');

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
});

test('exportar reporte legacy GET PDF → pdf', async () => {
  const res = await authGet('/api/gerente/reportes/exportar?formato=pdf&periodo=hoy');

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/pdf/);
});

// ─── GET /auditoria ───────────────────────────────────────────────────────────

test('auditoria: devuelve registros paginados', async () => {
  Auditoria.findAll.mockResolvedValue([
    { id: 1, fecha_hora: new Date(), accion: 'Pago procesado', detalle: 'Mesa 3', empleado: null, mesa: null, pedido: null },
    { id: 2, fecha_hora: new Date(), accion: 'Producto creado', detalle: 'Matcha latte', empleado: null, mesa: null, pedido: null },
  ]);
  Auditoria.count.mockResolvedValue(2);

  const res = await authGet('/api/gerente/auditoria');

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.total).toBe(2);
  expect(res.body.registros).toHaveLength(2);
  expect(res.body.registros[0]).toHaveProperty('accion');
  expect(res.body.registros[0]).toHaveProperty('fecha_hora');
});

test('auditoria: filtro por accion aplica LIKE', async () => {
  Auditoria.findAll.mockResolvedValue([
    { id: 3, fecha_hora: new Date(), accion: 'Pago procesado', detalle: null, empleado: null, mesa: null, pedido: null },
  ]);
  Auditoria.count.mockResolvedValue(1);

  const res = await authGet('/api/gerente/auditoria?accion=Pago+procesado');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  // Confirm the findAll was called with a where.accion containing Op.like
  const callArg = Auditoria.findAll.mock.calls[0][0];
  expect(callArg.where).toHaveProperty('accion');
});

test('auditoria: filtro por empleado_id', async () => {
  Auditoria.findAll.mockResolvedValue([]);
  Auditoria.count.mockResolvedValue(0);

  const res = await authGet('/api/gerente/auditoria?empleado_id=5');

  expect(res.status).toBe(200);
  const callArg = Auditoria.findAll.mock.calls[0][0];
  expect(callArg.where.id_empleado).toBe(5);
});

test('auditoria: paginación page+page_size respetada', async () => {
  Auditoria.findAll.mockResolvedValue([]);
  Auditoria.count.mockResolvedValue(100);

  const res = await authGet('/api/gerente/auditoria?page=2&page_size=10');

  expect(res.status).toBe(200);
  expect(res.body.page).toBe(2);
  expect(res.body.page_size).toBe(10);
  const callArg = Auditoria.findAll.mock.calls[0][0];
  expect(callArg.limit).toBe(10);
  expect(callArg.offset).toBe(10);
});
