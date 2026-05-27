'use strict';

jest.mock('../src/models', () => ({
  SesionCliente:      { findOne: jest.fn() },
  Pedido:             { create: jest.fn(), findOne: jest.fn() },
  DetallePedido:      { create: jest.fn() },
  DetalleModificador: { create: jest.fn() },
  Producto:           { findByPk: jest.fn() },
  OpcionModificador:  { findByPk: jest.fn() },
  Promocion:          { findAll: jest.fn() },
  TipoDescuento:      {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request = require('supertest');
const app     = require('../src/app');
const {
  SesionCliente, Pedido, DetallePedido, DetalleModificador,
  Producto, OpcionModificador, Promocion, sequelize,
} = require('../src/models');
const { _carritos } = require('../src/controllers/carrito.controller');
const { _stamps } = require('../src/middleware/rateLimit');

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tokenSeq = 2000;
function freshToken() { return `cnf-token-${++tokenSeq}`; }

function sesionActiva(token, id = 100) {
  return { id, estado: 'activa', token_cookie: token, id_modalidad: 1 };
}
function sesionPagada(token, id = 101) {
  return { id, estado: 'pagada', token_cookie: token, id_modalidad: 1 };
}
function item(overrides = {}) {
  return {
    producto_id: 1, nombre: 'MATCHA', precio_unitario: 60,
    cantidad: 1, modificadores: [], notas: '', subtotal: 60,
    ...overrides,
  };
}

beforeEach(() => {
  SesionCliente.findOne.mockReset();
  Pedido.create.mockReset();
  Pedido.findOne.mockReset();
  DetallePedido.create.mockReset();
  DetalleModificador.create.mockReset();
  Producto.findByPk.mockReset();
  OpcionModificador.findByPk.mockReset();
  Promocion.findAll.mockReset();
  Promocion.findAll.mockResolvedValue([]); // sin promos por defecto

  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => {
    const t = { LOCK: { UPDATE: 'UPDATE' } };
    return fn(t);
  });

  _stamps.clear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('confirmar — carrito con 2 ítems + idempotency_key → pedido creado, carrito vacío', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  _carritos.set(token, [item({ producto_id: 1, subtotal: 60 }), item({ producto_id: 2, subtotal: 40 })]);

  Pedido.findOne.mockResolvedValue(null);
  Pedido.create.mockResolvedValue({ id: 500 });
  Producto.findByPk.mockImplementation(async (id) => ({ id }));
  DetallePedido.create.mockImplementation(async (data) => ({ id: 1000 + data.id_producto, ...data }));

  const res = await request(app)
    .post('/api/cliente/carrito/confirmar')
    .set('Cookie', `mm_session=${token}`)
    .send({ idempotency_key: 'KEY-A' });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.pedido_id).toBe(500);
  expect(res.body.duplicado).toBeUndefined();
  expect(_carritos.get(token)).toEqual([]);
  expect(Pedido.create).toHaveBeenCalledTimes(1);
  expect(DetallePedido.create).toHaveBeenCalledTimes(2);
});

test('confirmar — segundo POST con mismo idempotency_key → mismo pedido_id + duplicado:true', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  _carritos.set(token, [item()]);

  // El Pedido ya existe en BD por este token
  Pedido.findOne.mockResolvedValue({ id: 777, token_idempotencia: 'KEY-B' });

  const res = await request(app)
    .post('/api/cliente/carrito/confirmar')
    .set('Cookie', `mm_session=${token}`)
    .send({ idempotency_key: 'KEY-B' });

  expect(res.status).toBe(200);
  expect(res.body.pedido_id).toBe(777);
  expect(res.body.duplicado).toBe(true);
  expect(Pedido.create).not.toHaveBeenCalled();
  expect(_carritos.get(token)).toEqual([]); // carrito limpio igual que en flujo normal
});

test('confirmar — carrito vacío → 400', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  _carritos.set(token, []);

  const res = await request(app)
    .post('/api/cliente/carrito/confirmar')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(/vac/i);
});

test('confirmar — sesión pagada → 409 sesion_pagada:true (re-validación dentro del lock)', async () => {
  const token = freshToken();
  // Middleware mmSession ve la sesión como activa, pero el lock dentro de la tx
  // la encuentra ya pagada (otra request la cobró entre medias).
  SesionCliente.findOne
    .mockResolvedValueOnce(sesionActiva(token))    // middleware
    .mockResolvedValueOnce(sesionPagada(token));   // dentro de la tx (locked)
  _carritos.set(token, [item()]);

  const res = await request(app)
    .post('/api/cliente/carrito/confirmar')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(409);
  expect(res.body.ok).toBe(false);
  expect(res.body.sesion_pagada).toBe(true);
  expect(Pedido.create).not.toHaveBeenCalled();
});

test('confirmar — 6 POSTs en <60s → el 6º recibe 429 con retry_after', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token, 200));
  Pedido.findOne.mockResolvedValue(null);
  Pedido.create.mockImplementation(async () => ({ id: Math.floor(Math.random() * 1e6) }));
  Producto.findByPk.mockImplementation(async (id) => ({ id }));
  DetallePedido.create.mockImplementation(async (d) => ({ id: 9000, ...d }));

  const send = () => {
    _carritos.set(token, [item()]); // re-seed después de cada confirmación (el handler vacía)
    return request(app)
      .post('/api/cliente/carrito/confirmar')
      .set('Cookie', `mm_session=${token}`)
      .send({});
  };

  for (let i = 0; i < 5; i++) {
    const r = await send();
    expect(r.status).toBe(200);
  }

  const r6 = await send();
  expect(r6.status).toBe(429);
  expect(r6.body.ok).toBe(false);
  expect(r6.body.rate_limited).toBe(true);
  expect(typeof r6.body.retry_after).toBe('number');
  expect(r6.body.retry_after).toBeGreaterThan(0);
  expect(r6.headers['retry-after']).toBeDefined();
});

test('confirmar — DetalleModificador guarda nombre_opcion_historico + precio_extra_aplicado', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));
  _carritos.set(token, [item({
    producto_id: 5,
    cantidad: 1,
    subtotal: 65,
    modificadores: [{ id: 11, nombre: 'EXTRA SHOT', extra: 5 }],
  })]);

  Pedido.findOne.mockResolvedValue(null);
  Pedido.create.mockResolvedValue({ id: 600 });
  Producto.findByPk.mockResolvedValue({ id: 5 });
  DetallePedido.create.mockResolvedValue({ id: 6000 });
  OpcionModificador.findByPk.mockResolvedValue({ id: 11, nombre_opcion: 'EXTRA SHOT' });
  DetalleModificador.create.mockResolvedValue({ id: 99 });

  const res = await request(app)
    .post('/api/cliente/carrito/confirmar')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(200);
  expect(DetalleModificador.create).toHaveBeenCalledTimes(1);
  const arg = DetalleModificador.create.mock.calls[0][0];
  expect(arg.nombre_opcion_historico).toBe('EXTRA SHOT');
  expect(arg.precio_extra_aplicado).toBe(5);
  expect(arg.id_opcion).toBe(11);
  expect(arg.id_detalle).toBe(6000);
});

test('confirmar — 2 requests concurrentes con mismo idempotency_key → solo 1 Pedido.create efectivo', async () => {
  const tokenA = freshToken();
  const tokenB = freshToken();
  // Misma sesion_id en ambos (dos pestañas del mismo cliente, por ejemplo)
  const SID = 300;
  SesionCliente.findOne.mockResolvedValue({ id: SID, estado: 'activa', token_cookie: 'x', id_modalidad: 1 });
  _carritos.set(tokenA, [item()]);
  _carritos.set(tokenB, [item()]);

  // Primer findOne(token=KEY-C) → null (race: ambas pasan la idempotency check inicial)
  // Segundo findOne (recovery tras UNIQUE) → devuelve el existente
  Pedido.findOne
    .mockResolvedValueOnce(null)   // request 1, in-tx check
    .mockResolvedValueOnce(null)   // request 2, in-tx check
    .mockResolvedValue({ id: 888, token_idempotencia: 'KEY-C' }); // recovery

  let createCalls = 0;
  Pedido.create.mockImplementation(async () => {
    createCalls++;
    if (createCalls === 1) return { id: 888 };
    const e = new Error('Validation error');
    e.name = 'SequelizeUniqueConstraintError';
    throw e;
  });
  Producto.findByPk.mockImplementation(async (id) => ({ id }));
  DetallePedido.create.mockResolvedValue({ id: 8800 });

  const [r1, r2] = await Promise.all([
    request(app).post('/api/cliente/carrito/confirmar')
      .set('Cookie', `mm_session=${tokenA}`).send({ idempotency_key: 'KEY-C' }),
    request(app).post('/api/cliente/carrito/confirmar')
      .set('Cookie', `mm_session=${tokenB}`).send({ idempotency_key: 'KEY-C' }),
  ]);

  expect(r1.status).toBe(200);
  expect(r2.status).toBe(200);
  expect(r1.body.pedido_id).toBe(888);
  expect(r2.body.pedido_id).toBe(888);
  // Solo 1 Pedido creado efectivamente (el segundo create lanzó UNIQUE)
  // pero ambas responses traen pedido_id=888
  const duplicadas = [r1.body, r2.body].filter((b) => b.duplicado === true);
  expect(duplicadas.length).toBeGreaterThanOrEqual(1);
});
