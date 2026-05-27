'use strict';

jest.mock('../src/models', () => ({
  Mesa:            { findAll: jest.fn() },
  SesionCliente:   {},
  Pedido:          { count: jest.fn() },
  DetallePedido:   {},
  DetalleModificador: {},
  OpcionModificador: {},
  Producto:        {},
  Categoria:       {},
  UbicacionMesa:   {},
  AlertaMesero:    { count: jest.fn() },
  SolicitudPago:   { count: jest.fn(), findAll: jest.fn() },
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
const { Mesa, Pedido, AlertaMesero, SolicitudPago, EstadoSolicitud } = require('../src/models');
const fixture = require('../../__fixtures__/mesero_mapa_estado.json');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 1, rol: 'mesero' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMesa({ id = 1, numero = 1, estado = 'libre', ubicacion = 'TERRAZA', capacidad = 4, sesiones = [], alertas = [] } = {}) {
  return {
    id, numero_mesa: numero, estado, capacidad,
    pin_actual: null, nota_cierre: '',
    ubicacion: { descripcion: ubicacion },
    sesiones,
    alertas,
  };
}

function makeSesion({ estado = 'activa', pedidos = [] } = {}) {
  return { estado, pedidos };
}

function makePedido({ estado = 'recibido' } = {}) {
  return { estado };
}

function makeAlerta({ tipo = 'ayuda', atendida = false } = {}) {
  return { tipo, atendida };
}

function get() {
  return request(app)
    .get('/api/mesero/mapa/estado')
    .set('Authorization', `Bearer ${tokenMesero}`);
}

beforeEach(() => {
  EstadoSolicitud.findOne.mockResolvedValue({ id: 1 });
  Mesa.findAll.mockResolvedValue([]);
  Pedido.count.mockResolvedValue(0);
  AlertaMesero.count.mockResolvedValue(0);
  SolicitudPago.count.mockResolvedValue(0);
  SolicitudPago.findAll.mockResolvedValue([]);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('sin mesas → respuesta vacía con contadores en 0', async () => {
  const res = await get();

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.mesas).toHaveLength(0);
  expect(res.body.listos_count).toBe(0);
  expect(res.body.solicitudes_count).toBe(0);
  expect(res.body.alertas_count).toBe(0);
});

test('mesa libre → estado_visual=libre', async () => {
  Mesa.findAll.mockResolvedValue([makeMesa({ estado: 'libre' })]);

  const res = await get();

  expect(res.status).toBe(200);
  expect(res.body.mesas[0].estado_visual).toBe('libre');
});

test('mesa ocupada con alerta ayuda viva → estado_visual=alerta', async () => {
  const mesa = makeMesa({
    estado: 'ocupada',
    sesiones: [makeSesion()],
    alertas: [makeAlerta({ tipo: 'ayuda', atendida: false })],
  });
  Mesa.findAll.mockResolvedValue([mesa]);

  const res = await get();

  expect(res.body.mesas[0].estado_visual).toBe('alerta');
  expect(res.body.mesas[0].tiene_alerta_ayuda).toBe(true);
});

test('mesa ocupada con solicitud pendiente, sin alerta → estado_visual=cobrando', async () => {
  const mesa = makeMesa({ id: 5, estado: 'ocupada', sesiones: [makeSesion()] });
  Mesa.findAll.mockResolvedValue([mesa]);
  SolicitudPago.findAll.mockResolvedValue([{ id_mesa: 5 }]);

  const res = await get();

  expect(res.body.mesas[0].estado_visual).toBe('cobrando');
  expect(res.body.mesas[0].tiene_solicitud).toBe(true);
});

test('mesa ocupada con pedido listo, sin solicitud → estado_visual=listo', async () => {
  const mesa = makeMesa({
    estado: 'ocupada',
    sesiones: [makeSesion({ pedidos: [makePedido({ estado: 'listo' })] })],
  });
  Mesa.findAll.mockResolvedValue([mesa]);

  const res = await get();

  expect(res.body.mesas[0].estado_visual).toBe('listo');
  expect(res.body.mesas[0].pedidos_listos).toBe(1);
});

test('mesa ocupada con pedido en cocina, sin listo → estado_visual=cocina', async () => {
  const mesa = makeMesa({
    estado: 'ocupada',
    sesiones: [makeSesion({ pedidos: [makePedido({ estado: 'preparando' })] })],
  });
  Mesa.findAll.mockResolvedValue([mesa]);

  const res = await get();

  expect(res.body.mesas[0].estado_visual).toBe('cocina');
  expect(res.body.mesas[0].pedidos_cocina).toBe(1);
});

test('mesa ocupada sin pedidos activos → estado_visual=ocupada', async () => {
  const mesa = makeMesa({ estado: 'ocupada', sesiones: [makeSesion()] });
  Mesa.findAll.mockResolvedValue([mesa]);

  const res = await get();

  expect(res.body.mesas[0].estado_visual).toBe('ocupada');
});

test('contadores globales reflejan los valores de count()', async () => {
  Pedido.count.mockResolvedValue(3);
  SolicitudPago.count.mockResolvedValue(2);
  AlertaMesero.count.mockResolvedValue(1);

  const res = await get();

  expect(res.body.listos_count).toBe(3);
  expect(res.body.solicitudes_count).toBe(2);
  expect(res.body.alertas_count).toBe(1);
});

test('alerta atendida NO activa estado=alerta', async () => {
  const mesa = makeMesa({
    estado: 'ocupada',
    sesiones: [makeSesion()],
    alertas: [makeAlerta({ tipo: 'ayuda', atendida: true })],
  });
  Mesa.findAll.mockResolvedValue([mesa]);

  const res = await get();

  expect(res.body.mesas[0].estado_visual).not.toBe('alerta');
  expect(res.body.mesas[0].tiene_alerta_ayuda).toBe(false);
});

test('keys de la respuesta coinciden con fixture', async () => {
  const res = await get();

  expect(res.status).toBe(200);
  expect(Object.keys(res.body).sort()).toEqual(Object.keys(fixture).sort());
});
