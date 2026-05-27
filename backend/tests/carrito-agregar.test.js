'use strict';

jest.mock('../src/models', () => ({
  SesionCliente:     { findOne: jest.fn() },
  Producto:          { findOne: jest.fn() },
  OpcionModificador: { findAll: jest.fn() },
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
  },
}));

const request  = require('supertest');
const app      = require('../src/app');
const { SesionCliente, Producto, OpcionModificador } = require('../src/models');
const { _carritos } = require('../src/controllers/carrito.controller');
const fixture  = require('../../__fixtures__/cliente_carrito_agregar.json');

const fixtureKeys = Object.keys(fixture).sort();

// Cada test usa un token único para que los carritos no se crucen
let tokenSeq = 0;
function freshToken() { return `test-token-${++tokenSeq}`; }

function sesionActiva(token) {
  return { id: 1, estado: 'activa', token_cookie: token };
}

const PRODUCTO = { id: 10, nombre: 'MATCHA LATTE', precio: '65.00', disponible: true };

beforeEach(() => {
  SesionCliente.findOne.mockReset();
  Producto.findOne.mockReset();
  OpcionModificador.findAll.mockReset();
  OpcionModificador.findAll.mockResolvedValue([]); // default: sin mods
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('POST /carrito/agregar — producto válido sin modificadores → 200, carrito_count=1 (shape=fixture)', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  Producto.findOne.mockResolvedValue(PRODUCTO);

  const res = await request(app)
    .post('/api/cliente/carrito/agregar')
    .set('Cookie', `mm_session=${token}`)
    .send({ producto_id: 10, cantidad: 1 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.carrito_count).toBe(1);
  expect(Object.keys(res.body).sort()).toEqual(fixtureKeys);
});

test('POST /carrito/agregar — producto con modificadores → subtotal incluye precio_extra × cantidad', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  Producto.findOne.mockResolvedValue({ ...PRODUCTO, precio: '60.00' });
  OpcionModificador.findAll.mockResolvedValue([
    { id: 1, nombre_opcion: 'SIN AZÚCAR', precio_extra: '5.00', activo: true },
  ]);

  const res = await request(app)
    .post('/api/cliente/carrito/agregar')
    .set('Cookie', `mm_session=${token}`)
    .send({ producto_id: 10, cantidad: 2, modificadores: [1] });

  expect(res.status).toBe(200);
  // subtotal = (60 + 5) * 2 = 130
  const items = _carritos.get(token);
  expect(items).toHaveLength(1);
  expect(items[0].subtotal).toBe(130);
  expect(items[0].modificadores).toHaveLength(1);
});

test('POST /carrito/agregar — producto.disponible=false → 404', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  Producto.findOne.mockResolvedValue(null); // findOne con disponible:true no lo encuentra

  const res = await request(app)
    .post('/api/cliente/carrito/agregar')
    .set('Cookie', `mm_session=${token}`)
    .send({ producto_id: 99 });

  expect(res.status).toBe(404);
  expect(res.body.ok).toBe(false);
});

test('POST /carrito/agregar — sesión pagada → 409 con sesion_pagada:true', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue({ id: 2, estado: 'pagada', token_cookie: token });

  const res = await request(app)
    .post('/api/cliente/carrito/agregar')
    .set('Cookie', `mm_session=${token}`)
    .send({ producto_id: 10 });

  expect(res.status).toBe(409);
  expect(res.body.ok).toBe(false);
  expect(res.body.sesion_pagada).toBe(true);
});

test('POST /carrito/agregar — cantidad=0 → 400', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));

  const res = await request(app)
    .post('/api/cliente/carrito/agregar')
    .set('Cookie', `mm_session=${token}`)
    .send({ producto_id: 10, cantidad: 0 });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
});

test('POST /carrito/agregar — cantidad negativa → 400', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));

  const res = await request(app)
    .post('/api/cliente/carrito/agregar')
    .set('Cookie', `mm_session=${token}`)
    .send({ producto_id: 10, cantidad: -3 });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
});
