'use strict';

jest.mock('../src/models', () => ({
  SesionCliente:   { findOne: jest.fn() },
  Pedido:          { findAll: jest.fn() },
  DetallePedido:   {},
  Producto:        {},
  SolicitudPago:   { findOne: jest.fn() },
  Mesa:            { findOne: jest.fn() },
  MetodoPago:      {},
  EstadoSolicitud: {},
  TipoDescuento:   {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
  },
}));

const request = require('supertest');
const app     = require('../src/app');
const { SesionCliente, Pedido, SolicitudPago, Mesa } = require('../src/models');
const fixture = require('../../__fixtures__/cliente_sesion_estado.json');

const fixtureKeys = Object.keys(fixture).sort();

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tokenSeq = 5000;
function freshToken() { return `ses-token-${++tokenSeq}`; }

function sesionActiva(token, id = 700) {
  return { id, estado: 'activa', token_cookie: token, id_mesa: 15, alias: 'ARTEMIS' };
}
function sesionPagada(token, id = 701) {
  return {
    id, estado: 'pagada', token_cookie: token, id_mesa: 15, alias: 'ARTEMIS',
    update: jest.fn().mockResolvedValue(),
  };
}

function makePedido({ detalles = [] } = {}) {
  return { estado: 'entregado', detalles };
}

function makeDetalle({ nombre = 'MATCHA', cantidad = 1, subtotal = '60.00' } = {}) {
  return { subtotal_calculado: subtotal, cantidad, producto: { nombre } };
}

beforeEach(() => {
  SesionCliente.findOne.mockReset();
  Pedido.findAll.mockReset().mockResolvedValue([]);
  SolicitudPago.findOne.mockReset().mockResolvedValue(null);
  Mesa.findOne.mockReset().mockResolvedValue({ numero_mesa: 5 });
});

// ─── Tests: GET /sesion/estado ────────────────────────────────────────────────

test('GET /sesion/estado — sesión activa → pagada:false, sin ticket', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));

  const res = await request(app)
    .get('/api/cliente/sesion/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.pagada).toBe(false);
  expect(res.body.ticket).toBeUndefined();
});

test('GET /sesion/estado — sesión pagada con SolicitudPago individual → ticket completo', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionPagada(token));
  Pedido.findAll.mockResolvedValue([
    makePedido({ detalles: [makeDetalle({ nombre: 'MATCHA', cantidad: 1, subtotal: '60.00' })] }),
  ]);
  // Individual procesada
  SolicitudPago.findOne.mockResolvedValueOnce({
    id: 10, tipo: 'individual', total_individual: '60.00', total_mesa: null,
    detalle_pago: 'EFECTIVO', metodo_pago: null,
  });

  const res = await request(app)
    .get('/api/cliente/sesion/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(res.body.pagada).toBe(true);
  expect(res.body.ticket).toBeDefined();
  expect(res.body.ticket.tipo).toBe('individual');
  expect(res.body.ticket.total_pagado).toBe(60);
  expect(res.body.ticket.items).toHaveLength(1);
  expect(res.body.ticket.items[0].nombre).toBe('MATCHA');
  expect(res.body.ticket.sol_id).toBe(10);
});

test('GET /sesion/estado — sesión pagada sin individual → ticket usa grupal', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionPagada(token));
  Pedido.findAll.mockResolvedValue([
    makePedido({ detalles: [makeDetalle({ subtotal: '80.00' })] }),
  ]);
  // Individual → null; grupal → encontrada
  SolicitudPago.findOne
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      id: 20, tipo: 'grupal', total_mesa: '200.00', total_individual: null,
      detalle_pago: 'TARJETA', metodo_pago: { descripcion: 'Tarjeta' },
    });

  const res = await request(app)
    .get('/api/cliente/sesion/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(res.body.ticket.tipo).toBe('grupal');
  expect(res.body.ticket.total_pagado).toBe(200);
  expect(res.body.ticket.metodo).toBe('Tarjeta');
  expect(res.body.ticket.sol_id).toBe(20);
});

test('GET /sesion/estado — mesa en ticket es string', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionPagada(token));
  Pedido.findAll.mockResolvedValue([]);
  Mesa.findOne.mockResolvedValue({ numero_mesa: 7 }); // número

  const res = await request(app)
    .get('/api/cliente/sesion/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.body.ticket.mesa).toBe('7');
  expect(typeof res.body.ticket.mesa).toBe('string');
});

test('GET /sesion/estado — keys coinciden con fixture (caso activa)', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));

  const res = await request(app)
    .get('/api/cliente/sesion/estado')
    .set('Cookie', `mm_session=${token}`);

  expect(res.status).toBe(200);
  expect(Object.keys(res.body).sort()).toEqual(fixtureKeys);
});

// ─── Tests: POST /sesion/cerrar ───────────────────────────────────────────────

test('POST /sesion/cerrar — sesión activa → 409', async () => {
  const token = freshToken();
  SesionCliente.findOne.mockResolvedValue(sesionActiva(token));

  const res = await request(app)
    .post('/api/cliente/sesion/cerrar')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(409);
  expect(res.body.ok).toBe(false);
});

test('POST /sesion/cerrar — sesión pagada → 200, sesión marcada cerrada, cookie borrada', async () => {
  const token = freshToken();
  const mockSesion = sesionPagada(token);
  SesionCliente.findOne.mockResolvedValue(mockSesion);

  const res = await request(app)
    .post('/api/cliente/sesion/cerrar')
    .set('Cookie', `mm_session=${token}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.redirect).toBe('/bienvenida/');
  expect(mockSesion.update).toHaveBeenCalledWith({ estado: 'cerrada' });
  // Cookie debe quedar borrada
  const setCookie = res.headers['set-cookie'] || [];
  const cleared = setCookie.some((c) => c.includes('mm_session=;') || c.includes('mm_session='));
  expect(cleared).toBe(true);
});
