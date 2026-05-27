'use strict';

jest.mock('../src/models', () => ({
  Pedido:          { findAll: jest.fn(), findByPk: jest.fn() },
  DetallePedido:   { findByPk: jest.fn(), update: jest.fn() },
  DetalleModificador: {},
  OpcionModificador: {},
  Producto:        {},
  Categoria:       {},
  SesionCliente:   {},
  Mesa:            {},
  TipoDescuento:   {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
  },
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const { Pedido } = require('../src/models');
const fixtureC = require('../../__fixtures__/cocina_pedidos_area_cocina.json');

const SECRET = process.env.JWT_SECRET; // set in tests/setup.js
const tokenCocina = jwt.sign({ id: 1, rol: 'cocina' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDetalle({ nombre = 'MATCHA', area = 'cocina', listo = false, cantidad = 1, notas = '' } = {}) {
  return {
    id: Math.floor(Math.random() * 10000),
    cantidad, notas, listo,
    producto: { nombre, categoria: { area } },
    modificadores: [],
  };
}

function makePedido({ id = 1, estado = 'recibido', mesa = 3, alias = 'TEST', detalles = [] } = {}) {
  return {
    id, estado,
    fecha_hora_ingreso: new Date('2024-03-15T12:00:00Z'),
    sesion: { alias, mesa: { numero_mesa: mesa } },
    detalles,
  };
}

beforeEach(() => {
  Pedido.findAll.mockReset().mockResolvedValue([]);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('pedido con items cocina+bar → aparece en área cocina Y en área bar', async () => {
  Pedido.findAll.mockResolvedValue([
    makePedido({
      detalles: [
        makeDetalle({ nombre: 'MATCHA',  area: 'cocina', listo: false }),
        makeDetalle({ nombre: 'CERVEZA', area: 'bar',    listo: false }),
      ],
    }),
  ]);

  const rCocina = await request(app)
    .get('/api/cocina/pedidos-json?area=cocina')
    .set('Authorization', `Bearer ${tokenCocina}`);
  const rBar = await request(app)
    .get('/api/cocina/pedidos-json?area=bar')
    .set('Authorization', `Bearer ${tokenCocina}`);

  expect(rCocina.status).toBe(200);
  expect(rCocina.body.pendientes).toHaveLength(1);
  expect(rCocina.body.pendientes[0].items).toHaveLength(1);
  expect(rCocina.body.pendientes[0].items[0].nombre).toBe('MATCHA');

  expect(rBar.body.pendientes).toHaveLength(1);
  expect(rBar.body.pendientes[0].items).toHaveLength(1);
  expect(rBar.body.pendientes[0].items[0].nombre).toBe('CERVEZA');
});

test('pedido con solo items cocina, area=bar → NO aparece en pendientes bar', async () => {
  Pedido.findAll.mockResolvedValue([
    makePedido({ detalles: [makeDetalle({ area: 'cocina', listo: false })] }),
  ]);

  const res = await request(app)
    .get('/api/cocina/pedidos-json?area=bar')
    .set('Authorization', `Bearer ${tokenCocina}`);

  expect(res.status).toBe(200);
  expect(res.body.pendientes).toHaveLength(0);
});

test('cocina items listos → sale de pendientes cocina pero NO de pendientes bar', async () => {
  const pedido = makePedido({
    detalles: [
      makeDetalle({ area: 'cocina', listo: true }),   // cocina terminó
      makeDetalle({ area: 'bar',    listo: false }),   // bar aún no
    ],
  });
  Pedido.findAll.mockResolvedValue([pedido]);

  const rCocina = await request(app)
    .get('/api/cocina/pedidos-json?area=cocina')
    .set('Authorization', `Bearer ${tokenCocina}`);

  const rBar = await request(app)
    .get('/api/cocina/pedidos-json?area=bar')
    .set('Authorization', `Bearer ${tokenCocina}`);

  // Cocina: todos sus items están listos → no aparece en pendientes
  expect(rCocina.body.pendientes).toHaveLength(0);

  // Bar: tiene item no listo → sigue en pendientes
  expect(rBar.body.pendientes).toHaveLength(1);
});

test('columna listos muestra TODOS los items (cocina+bar), no solo los del área', async () => {
  Pedido.findAll.mockResolvedValue([
    makePedido({
      estado: 'listo',
      detalles: [
        makeDetalle({ area: 'cocina', listo: true }),
        makeDetalle({ nombre: 'CERVEZA', area: 'bar', listo: true }),
      ],
    }),
  ]);

  const res = await request(app)
    .get('/api/cocina/pedidos-json?area=cocina')
    .set('Authorization', `Bearer ${tokenCocina}`);

  expect(res.body.listos).toHaveLength(1);
  // Listos devuelve TODOS los items, no solo los de cocina
  expect(res.body.listos[0].items).toHaveLength(2);
});

test('mesa es number, fecha es ISO 8601', async () => {
  Pedido.findAll.mockResolvedValue([
    makePedido({ mesa: 7, detalles: [makeDetalle({ listo: false })] }),
  ]);

  const res = await request(app)
    .get('/api/cocina/pedidos-json?area=cocina')
    .set('Authorization', `Bearer ${tokenCocina}`);

  const p = res.body.pendientes[0];
  expect(typeof p.mesa).toBe('number');
  expect(p.mesa).toBe(7);
  expect(p.fecha).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('keys coinciden con fixture cocina', async () => {
  const res = await request(app)
    .get('/api/cocina/pedidos-json?area=cocina')
    .set('Authorization', `Bearer ${tokenCocina}`);

  expect(res.status).toBe(200);
  expect(Object.keys(res.body).sort()).toEqual(Object.keys(fixtureC).sort());
});
