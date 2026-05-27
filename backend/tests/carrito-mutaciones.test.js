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
const { SesionCliente } = require('../src/models');
const { _carritos } = require('../src/controllers/carrito.controller');
const fixtureLimpiar = require('../../__fixtures__/cliente_carrito_limpiar.json');

const limpiarKeys = Object.keys(fixtureLimpiar).sort();

let tokenSeq = 1000; // offset separado del test de agregar
function freshToken() { return `mut-token-${++tokenSeq}`; }

function sesionActiva(token) { return { id: 10, estado: 'activa', token_cookie: token }; }
function sesionPagada(token) { return { id: 11, estado: 'pagada', token_cookie: token }; }

// Inserta items directamente en el Map para no depender del endpoint agregar
function seedCarrito(token, items) { _carritos.set(token, items); }

function itemBase(overrides = {}) {
  return {
    producto_id: 1, nombre: 'MATCHA', precio_unitario: 60,
    cantidad: 1, modificadores: [], notas: '', subtotal: 60,
    ...overrides,
  };
}

beforeEach(() => {
  SesionCliente.findOne.mockReset();
});

// ─── actualizar ───────────────────────────────────────────────────────────────

test('actualizar — cantidad=3 → subtotal *= 3, total correcto', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  seedCarrito(token, [itemBase({ precio_unitario: 50, subtotal: 50 })]);

  const res = await request(app)
    .post('/api/cliente/carrito/actualizar')
    .set('Cookie', `mm_session=${token}`)
    .send({ index: 0, cantidad: 3 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.carrito_count).toBe(1);
  expect(res.body.total).toBe(150);
  expect(_carritos.get(token)[0].cantidad).toBe(3);
  expect(_carritos.get(token)[0].subtotal).toBe(150);
});

test('actualizar — cantidad=0 → ítem desaparece, carrito_count=0', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  seedCarrito(token, [itemBase(), itemBase({ producto_id: 2, nombre: 'CAFÉ', subtotal: 40 })]);

  const res = await request(app)
    .post('/api/cliente/carrito/actualizar')
    .set('Cookie', `mm_session=${token}`)
    .send({ index: 0, cantidad: 0 });

  expect(res.status).toBe(200);
  expect(res.body.carrito_count).toBe(1);
  expect(_carritos.get(token)).toHaveLength(1);
});

test('actualizar — índice fuera de rango → 400', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  seedCarrito(token, [itemBase()]);

  const res = await request(app)
    .post('/api/cliente/carrito/actualizar')
    .set('Cookie', `mm_session=${token}`)
    .send({ index: 5, cantidad: 2 });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(/ndice/i);
});

test('actualizar — sesión pagada → 409 con sesion_pagada:true', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionPagada(token));
  seedCarrito(token, [itemBase()]);

  const res = await request(app)
    .post('/api/cliente/carrito/actualizar')
    .set('Cookie', `mm_session=${token}`)
    .send({ index: 0, cantidad: 2 });

  expect(res.status).toBe(409);
  expect(res.body.ok).toBe(false);
  expect(res.body.sesion_pagada).toBe(true);
});

// ─── eliminar ────────────────────────────────────────────────────────────────

test('eliminar — sesión pagada → 200 (NO bloquea)', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionPagada(token));
  seedCarrito(token, [itemBase(), itemBase({ producto_id: 2, nombre: 'CAFÉ', subtotal: 30 })]);

  const res = await request(app)
    .post('/api/cliente/carrito/eliminar')
    .set('Cookie', `mm_session=${token}`)
    .send({ index: 0 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.carrito_count).toBe(1);
});

// ─── limpiar ─────────────────────────────────────────────────────────────────

test('limpiar — vacía el carrito, respuesta shape = fixture', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  seedCarrito(token, [itemBase(), itemBase()]);

  const res = await request(app)
    .post('/api/cliente/carrito/limpiar')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(_carritos.get(token)).toHaveLength(0);
  expect(Object.keys(res.body).sort()).toEqual(limpiarKeys);
});
