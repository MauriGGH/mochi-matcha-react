'use strict';

jest.mock('../src/models', () => ({
  SesionCliente:   { findOne: jest.fn(), findAll: jest.fn() },
  AlertaMesero:    { count: jest.fn(), create: jest.fn() },
  Pedido:          { findAll: jest.fn() },
  DetallePedido:   {},
  SolicitudPago:   { findOrCreate: jest.fn() },
  Mesa:            { findOne: jest.fn() },
  EstadoSolicitud: { findOne: jest.fn() },
  TipoDescuento:   {},
  Producto:        {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request = require('supertest');
const app     = require('../src/app');
const {
  SesionCliente, AlertaMesero, Pedido, SolicitudPago, Mesa, EstadoSolicitud, sequelize,
} = require('../src/models');
const { _stamps } = require('../src/middleware/rateLimit');

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tokenSeq = 4000;
function freshToken() { return `ayc-token-${++tokenSeq}`; }

function sesionActiva(token, id = 500, id_mesa = 10) {
  return { id, estado: 'activa', token_cookie: token, id_mesa };
}
function sesionPagada(token, id = 501) {
  return { id, estado: 'pagada', token_cookie: token, id_mesa: 10 };
}

beforeEach(() => {
  SesionCliente.findOne.mockReset();
  SesionCliente.findAll.mockReset().mockResolvedValue([]);
  AlertaMesero.count.mockReset().mockResolvedValue(0);
  AlertaMesero.create.mockReset().mockResolvedValue({ id: 1 });
  Pedido.findAll.mockReset().mockResolvedValue([]);
  SolicitudPago.findOrCreate.mockReset().mockResolvedValue([{ id: 1 }, true]);
  Mesa.findOne.mockReset().mockResolvedValue({ id: 10 });
  EstadoSolicitud.findOne.mockReset().mockResolvedValue({ id: 1 });

  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => {
    const t = { LOCK: { UPDATE: 'UPDATE' } };
    return fn(t);
  });

  _stamps.clear();
});

// ─── Tests: solicitarAyuda ────────────────────────────────────────────────────

test('ayuda OK → AlertaMesero.create llamado con tipo=ayuda', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));

  const res = await request(app)
    .post('/api/cliente/pedidos/ayuda')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(AlertaMesero.create).toHaveBeenCalledTimes(1);
  expect(AlertaMesero.create.mock.calls[0][0].tipo).toBe('ayuda');
});

test('ayuda — 2da llamada en <30s → 429 rate_limited', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token, 550));

  const send = () =>
    request(app).post('/api/cliente/pedidos/ayuda').set('Cookie', `mm_session=${token}`).send({});

  const r1 = await send();
  expect(r1.status).toBe(200);

  const r2 = await send();
  expect(r2.status).toBe(429);
  expect(r2.body.rate_limited).toBe(true);
  expect(typeof r2.body.retry_after).toBe('number');
  expect(r2.headers['retry-after']).toBeDefined();
});

test('ayuda — 3 alertas vivas → 429 sin importar tiempo', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token, 560));
  AlertaMesero.count.mockResolvedValue(3); // alertasVivas >= 3

  const res = await request(app)
    .post('/api/cliente/pedidos/ayuda')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(429);
  expect(res.body.rate_limited).toBe(true);
  // AlertaMesero.create no debe haberse llamado
  expect(AlertaMesero.create).not.toHaveBeenCalled();
});

test('ayuda — sesión pagada → 409 sesion_pagada:true', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionPagada(token));

  const res = await request(app)
    .post('/api/cliente/pedidos/ayuda')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(409);
  expect(res.body.sesion_pagada).toBe(true);
});

// ─── Tests: solicitarCuenta ───────────────────────────────────────────────────

test('cuenta individual sin pedidos pendientes → SolicitudPago creada, propina=10%', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token, 600));
  Pedido.findAll.mockResolvedValue([
    { id: 1, estado: 'entregado', detalles: [{ subtotal_calculado: '100.00' }] },
  ]);
  SolicitudPago.findOrCreate.mockResolvedValue([{ id: 55 }, true]);

  const res = await request(app)
    .post('/api/cliente/pedidos/cuenta')
    .set('Cookie', `mm_session=${token}`)
    .send({ tipo: 'individual', confirmar_sin_entrega: true });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  // Verificar que findOrCreate recibió propina = 10% del total
  const defaults = SolicitudPago.findOrCreate.mock.calls[0][0].defaults;
  expect(defaults.propina_sugerida).toBeCloseTo(10, 2); // 10% de 100
  expect(defaults.total_individual).toBe(100);
});

test('cuenta grupal → SolicitudPago con id_sesion=null y total_mesa', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token, 610, 20));
  // Pedido.findAll para total_individual de esta sesión
  Pedido.findAll.mockResolvedValue([]);
  // SesionCliente.findAll para sesiones de la mesa con sus pedidos
  SesionCliente.findAll.mockResolvedValue([
    {
      id: 610,
      pedidos: [
        { id: 1, estado: 'entregado', detalles: [{ subtotal_calculado: '200.00' }] },
      ],
    },
  ]);
  SolicitudPago.findOrCreate.mockResolvedValue([{ id: 77 }, true]);

  const res = await request(app)
    .post('/api/cliente/pedidos/cuenta')
    .set('Cookie', `mm_session=${token}`)
    .send({ tipo: 'grupal', confirmar_sin_entrega: true });

  expect(res.status).toBe(200);
  const whereArg = SolicitudPago.findOrCreate.mock.calls[0][0].where;
  expect(whereArg.id_sesion).toBeNull();
  expect(whereArg.tipo).toBe('grupal');
  const defaults = SolicitudPago.findOrCreate.mock.calls[0][0].defaults;
  expect(defaults.total_mesa).toBe(200);
  expect(defaults.propina_sugerida).toBeCloseTo(20, 2); // 10% de 200
});

test('cuenta con pedidos pendientes y sin confirmar_sin_entrega → 200 requiere_confirmacion', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token, 620));
  Pedido.findAll.mockResolvedValue([
    { id: 1, estado: 'preparando', detalles: [{ subtotal_calculado: '60.00' }] },
  ]);

  const res = await request(app)
    .post('/api/cliente/pedidos/cuenta')
    .set('Cookie', `mm_session=${token}`)
    .send({ tipo: 'individual' }); // confirmar_sin_entrega omitido → false

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(false);
  expect(res.body.requiere_confirmacion).toBe(true);
  expect(res.body.pedidos_pendientes).toBeGreaterThan(0);
  expect(SolicitudPago.findOrCreate).not.toHaveBeenCalled();
});

test('2 cuentas grupales concurrentes → solo 1 SolicitudPago creada', async () => {
  const tokenA = freshToken();
  const tokenB = freshToken();
  // Misma mesa (30), sesiones distintas (630 y 631) — así el rate limit no los bloquea entre sí
  SesionCliente.findOne.mockImplementation(async ({ where }) => {
    const t = where.token_cookie;
    return t === tokenA
      ? { id: 630, estado: 'activa', token_cookie: tokenA, id_mesa: 30 }
      : { id: 631, estado: 'activa', token_cookie: tokenB, id_mesa: 30 };
  });
  Pedido.findAll.mockResolvedValue([]);
  SesionCliente.findAll.mockResolvedValue([]);

  let findOrCreateCalls = 0;
  SolicitudPago.findOrCreate.mockImplementation(async () => {
    findOrCreateCalls++;
    return findOrCreateCalls === 1 ? [{ id: 99 }, true] : [{ id: 99 }, false];
  });

  const send = (token) =>
    request(app)
      .post('/api/cliente/pedidos/cuenta')
      .set('Cookie', `mm_session=${token}`)
      .send({ tipo: 'grupal', confirmar_sin_entrega: true });

  const [r1, r2] = await Promise.all([send(tokenA), send(tokenB)]);

  expect(r1.status).toBe(200);
  expect(r2.status).toBe(200);
  expect(SolicitudPago.findOrCreate).toHaveBeenCalledTimes(2);
  // Solo 1 AlertaMesero de tipo cuenta creada (solo cuando created=true)
  const cuentaAlertas = AlertaMesero.create.mock.calls.filter((c) => c[0].tipo === 'cuenta');
  expect(cuentaAlertas).toHaveLength(1);
});

test('cuenta — sesión pagada → 409 sesion_pagada:true', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionPagada(token));

  const res = await request(app)
    .post('/api/cliente/pedidos/cuenta')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(409);
  expect(res.body.sesion_pagada).toBe(true);
  expect(SolicitudPago.findOrCreate).not.toHaveBeenCalled();
});
