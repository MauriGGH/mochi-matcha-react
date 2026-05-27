'use strict';

jest.mock('../src/models', () => ({
  Mesa:            { findByPk: jest.fn() },
  SesionCliente:   { findAll: jest.fn() },
  Pedido:          {},
  DetallePedido:   {},
  DetalleModificador: {},
  OpcionModificador: {},
  Producto:        {},
  Categoria:       {},
  UbicacionMesa:   {},
  AlertaMesero:    {},
  SolicitudPago:   { findAll: jest.fn() },
  EstadoSolicitud: { findOne: jest.fn() },
  MetodoPago:      {},
  ModalidadIngreso: {},
  TipoDescuento:   {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
  },
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const { Mesa, SesionCliente, SolicitudPago, EstadoSolicitud } = require('../src/models');
const fixture = require('../../__fixtures__/mesero_mapa_detalle.json');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 1, rol: 'mesero' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMesa({ id = 1, numero = 1, estado = 'libre' } = {}) {
  return { id, numero_mesa: numero, estado, pin_actual: null, nota_cierre: '' };
}

function makeDetalle({ nombre = 'MATCHA', cantidad = 1, subtotal = 50, notas = '', mods = [] } = {}) {
  return {
    subtotal_calculado: subtotal, cantidad, notas,
    producto: { nombre },
    modificadores: mods,
  };
}

function makePedido({ id = 1, estado = 'recibido', detalles = [] } = {}) {
  return {
    id, estado,
    fecha_hora_ingreso: new Date('2024-03-15T10:30:00Z'),
    detalles,
  };
}

function makeSesion({ id = 1, alias = 'TEST', pedidos = [] } = {}) {
  return { id, alias, pedidos, fecha_inicio: new Date('2024-03-15T10:00:00Z') };
}

function makeSolicitud({ id = 1, tipo = 'individual', sesion = null, id_sesion = null, total_mesa = 100, total_individual = null, detalle_pago = 'EFECTIVO' } = {}) {
  return {
    id, tipo, sesion, id_sesion,
    total_mesa, total_individual,
    detalle_pago,
    fecha_hora: new Date('2024-03-15T11:00:00Z'),
  };
}

function get(mesaId = 1) {
  return request(app)
    .get(`/api/mesero/mapa/${mesaId}`)
    .set('Authorization', `Bearer ${tokenMesero}`);
}

beforeEach(() => {
  Mesa.findByPk.mockReset();
  SesionCliente.findAll.mockReset().mockResolvedValue([]);
  EstadoSolicitud.findOne.mockReset().mockResolvedValue({ id: 1 });
  SolicitudPago.findAll.mockReset().mockResolvedValue([]);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('mesa libre sin sesiones → mesa_libre:true, sesiones:[], solicitudes:[]', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'libre' }));

  const res = await get(1);

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.mesa_libre).toBe(true);
  expect(res.body.sesiones).toHaveLength(0);
  expect(res.body.solicitudes).toHaveLength(0);
  expect(res.body.total_mesa).toBe(0);
});

test('mesa con 2 sesiones activas → ambas en sesiones, total_mesa = suma', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'ocupada' }));
  SesionCliente.findAll.mockResolvedValue([
    makeSesion({ id: 10, alias: 'ANA', pedidos: [makePedido({ detalles: [makeDetalle({ subtotal: 80 })] })] }),
    makeSesion({ id: 11, alias: 'BOB', pedidos: [makePedido({ detalles: [makeDetalle({ subtotal: 120 })] })] }),
  ]);

  const res = await get(1);

  expect(res.status).toBe(200);
  expect(res.body.sesiones).toHaveLength(2);
  expect(res.body.total_mesa).toBeCloseTo(200);
  const aliasses = res.body.sesiones.map((s) => s.alias);
  expect(aliasses).toContain('ANA');
  expect(aliasses).toContain('BOB');
});

test('solicitud grupal pendiente → alias:"Toda la mesa", sesion_id:null', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'ocupada' }));
  SolicitudPago.findAll.mockResolvedValue([
    makeSolicitud({ tipo: 'grupal', sesion: null, id_sesion: null, total_mesa: 300 }),
  ]);

  const res = await get(1);

  expect(res.body.solicitudes).toHaveLength(1);
  const sol = res.body.solicitudes[0];
  expect(sol.alias).toBe('Toda la mesa');
  expect(sol.sesion_id).toBeNull();
  expect(sol.tipo).toBe('grupal');
  expect(sol.tipo_display).toBe('Grupal');
  expect(sol.total).toBeCloseTo(300);
});

test('pedido cancelado → no aparece en items ni en total', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'ocupada' }));
  // Sequelize where excludes cancelado — simulate by returning only non-cancelled
  SesionCliente.findAll.mockResolvedValue([
    makeSesion({ pedidos: [makePedido({ estado: 'recibido', detalles: [makeDetalle({ subtotal: 50 })] })] }),
  ]);

  const res = await get(1);

  expect(res.body.sesiones[0].pedidos).toHaveLength(1);
  expect(res.body.sesiones[0].pedidos[0].estado).toBe('recibido');
  expect(res.body.sesiones[0].total).toBeCloseTo(50);
});

test('404 mesa inexistente', async () => {
  Mesa.findByPk.mockResolvedValue(null);

  const res = await get(9999);

  expect(res.status).toBe(404);
  expect(res.body.ok).toBe(false);
});

test('fecha de pedido devuelta en formato HH:MM', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'ocupada' }));
  SesionCliente.findAll.mockResolvedValue([
    makeSesion({ pedidos: [makePedido({ detalles: [makeDetalle()] })] }),
  ]);

  const res = await get(1);

  const fecha = res.body.sesiones[0].pedidos[0].fecha;
  expect(fecha).toMatch(/^\d{2}:\d{2}$/);
});

test('keys de la respuesta coinciden con fixture', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'libre' }));

  const res = await get(1);

  expect(res.status).toBe(200);
  expect(Object.keys(res.body).sort()).toEqual(Object.keys(fixture).sort());
});
