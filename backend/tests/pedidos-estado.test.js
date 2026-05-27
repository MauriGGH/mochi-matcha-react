'use strict';

jest.mock('../src/models', () => ({
  SesionCliente: { findOne: jest.fn() },
  Pedido:        { findAll: jest.fn() },
  DetallePedido: {},
  Producto:      {},
  TipoDescuento: {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
  },
}));

const request = require('supertest');
const app     = require('../src/app');
const { SesionCliente, Pedido } = require('../src/models');
const fixture = require('../../__fixtures__/cliente_pedidos_estado.json');

const fixtureKeys = Object.keys(fixture).sort();

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tokenSeq = 3000;
function freshToken() { return `est-token-${++tokenSeq}`; }

function sesion(token, estado = 'activa', id = 400) {
  return { id, estado, token_cookie: token };
}

function makePedido({ id = 1, estado = 'recibido', fecha = new Date('2024-03-15T14:30:00'), detalles = [] } = {}) {
  return { id, estado, fecha_hora_ingreso: fecha, detalles };
}

beforeEach(() => {
  SesionCliente.findOne.mockReset();
  Pedido.findAll.mockReset();
  Pedido.findAll.mockResolvedValue([]);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('GET /pedidos/estado — sesión sin pedidos → pedidos=[], ts presente', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesion(token));

  const res = await request(app)
    .get('/api/cliente/pedidos/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.pedidos).toEqual([]);
  expect(typeof res.body.ts).toBe('number');
  expect(res.body.ts).toBeGreaterThan(0);
});

test('GET /pedidos/estado — sesion_estado refleja el estado real de la sesión', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesion(token, 'pagada'));

  const res = await request(app)
    .get('/api/cliente/pedidos/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(res.body.sesion_estado).toBe('pagada');
});

test('GET /pedidos/estado — pedidos ordenados desc, items con nombre+cantidad', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesion(token));

  Pedido.findAll.mockResolvedValue([
    // findAll devuelve DESC (más reciente primero — el mock ya simula el ORDER BY)
    makePedido({
      id: 11, estado: 'recibido',
      fecha: new Date('2024-03-15T14:45:00'),
      detalles: [{ producto: { nombre: 'AMERICANO' }, cantidad: 1 }],
    }),
    makePedido({
      id: 10, estado: 'listo',
      fecha: new Date('2024-03-15T14:30:00'),
      detalles: [{ producto: { nombre: 'MATCHA' }, cantidad: 2 }],
    }),
  ]);

  const res = await request(app)
    .get('/api/cliente/pedidos/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(res.body.pedidos).toHaveLength(2);
  expect(res.body.pedidos[0].id).toBe(11); // más reciente primero
  expect(res.body.pedidos[1].id).toBe(10);
  expect(res.body.pedidos[1].items[0]).toEqual({ nombre: 'MATCHA', cantidad: 2 });
});

test('GET /pedidos/estado — estado_display mapeado para todos los estados', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesion(token));

  Pedido.findAll.mockResolvedValue([
    makePedido({ id: 1, estado: 'recibido' }),
    makePedido({ id: 2, estado: 'preparando' }),
    makePedido({ id: 3, estado: 'listo' }),
    makePedido({ id: 4, estado: 'entregado' }),
    makePedido({ id: 5, estado: 'cancelado' }),
  ]);

  const res = await request(app)
    .get('/api/cliente/pedidos/estado')
    .set('Cookie', `mm_session=${token}`);

  const displays = res.body.pedidos.map((p) => p.estado_display);
  expect(displays).toEqual(['Recibido', 'Preparando', 'Listo', 'Entregado', 'Cancelado']);
});

test('GET /pedidos/estado — fecha formateada como HH:MM', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesion(token));

  Pedido.findAll.mockResolvedValue([
    makePedido({ fecha: new Date('2024-03-15T09:05:00') }),
  ]);

  const res = await request(app)
    .get('/api/cliente/pedidos/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.body.pedidos[0].fecha).toMatch(/^\d{2}:\d{2}$/);
});

test('GET /pedidos/estado — keys coinciden con fixture', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesion(token));

  const res = await request(app)
    .get('/api/cliente/pedidos/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(Object.keys(res.body).sort()).toEqual(fixtureKeys);
});
