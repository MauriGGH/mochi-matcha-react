'use strict';

jest.mock('../src/models', () => ({
  Mesa:            {},
  SesionCliente:   {},
  Pedido:          { findByPk: jest.fn(), findOne: jest.fn() },
  DetallePedido:   { findOne: jest.fn() },
  DetalleModificador: {},
  OpcionModificador: {},
  Producto:        {},
  Categoria:       {},
  UbicacionMesa:   {},
  AlertaMesero:    {},
  SolicitudPago:   {},
  EstadoSolicitud: {},
  MetodoPago:      {},
  ModalidadIngreso: {},
  Auditoria:       { create: jest.fn() },
  TipoDescuento:   {},
  sequelize: {
    authenticate:  jest.fn().mockResolvedValue(),
    sync:          jest.fn().mockResolvedValue(),
    transaction:   jest.fn(),
  },
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const { Pedido, DetallePedido, Auditoria, sequelize } = require('../src/models');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 7, rol: 'mesero' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePedido({ id = 1, estado = 'recibido', idMesa = 10 } = {}) {
  return {
    id, estado,
    sesion: { id_mesa: idMesa },
    update: jest.fn().mockResolvedValue(),
  };
}

function makeDetalle({ id = 1, pedidoId = 1, cantidad = 2, subtotal = 100, notas = '' } = {}) {
  return {
    id, id_pedido: pedidoId, cantidad,
    subtotal_calculado: subtotal,
    notas,
    producto: { nombre: 'MATCHA' },
    update: jest.fn().mockResolvedValue(),
  };
}

function post(path, body) {
  return request(app)
    .post(path)
    .set('Authorization', `Bearer ${tokenMesero}`)
    .send(body);
}

beforeEach(() => {
  Pedido.findByPk.mockReset();
  Pedido.findOne.mockReset();
  DetallePedido.findOne.mockReset();
  Auditoria.create.mockReset().mockResolvedValue({});
  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => {
    const t = { LOCK: { UPDATE: 'UPDATE' } };
    return fn(t);
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('entregar pedido listo → 200, update con entregado y fecha_hora_entrega', async () => {
  const pedido = makePedido({ estado: 'listo' });
  Pedido.findByPk.mockResolvedValue(pedido);

  const res = await post('/api/mesero/pedidos/entregar', { pedido_id: 1 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(pedido.update).toHaveBeenCalledWith(
    expect.objectContaining({ estado: 'entregado', id_empleado_entrega: 7 }),
  );
  const [updateArgs] = pedido.update.mock.calls[0];
  expect(updateArgs.fecha_hora_entrega).toBeInstanceOf(Date);
});

test('cancelar sin motivo → 400', async () => {
  const res = await post('/api/mesero/pedidos/cancelar', { pedido_id: 1, motivo: '   ' });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
});

test('cancelar pedido entregado → 400 "no se puede cancelar"', async () => {
  Pedido.findByPk.mockResolvedValue(makePedido({ estado: 'entregado' }));

  const res = await post('/api/mesero/pedidos/cancelar', { pedido_id: 1, motivo: 'error' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/cancelar/i);
});

test('cancelar recibido → 200, motivo en UPPER, Auditoria creada', async () => {
  const pedido = makePedido({ estado: 'recibido' });
  Pedido.findByPk.mockResolvedValue(pedido);

  const res = await post('/api/mesero/pedidos/cancelar', { pedido_id: 1, motivo: 'cliente se fue' });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  const [updateArgs] = pedido.update.mock.calls[0];
  expect(updateArgs.motivo_cancelacion).toBe('CLIENTE SE FUE');
  expect(Auditoria.create).toHaveBeenCalledWith(
    expect.objectContaining({ accion: 'Pedido cancelado por mesero', id_empleado: 7 }),
    expect.anything(),
  );
});

test('editar pedido preparando → 400', async () => {
  Pedido.findByPk.mockResolvedValue(makePedido({ estado: 'preparando' }));

  const res = await request(app)
    .post('/api/mesero/pedidos/1/editar')
    .set('Authorization', `Bearer ${tokenMesero}`)
    .send({ cambios: [{ detalle_id: 1, cantidad: 2, notas: '' }] });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
});

test('editar recibido: cantidad 2→3, subtotal escala con precio unitario histórico', async () => {
  const pedido = makePedido({ estado: 'recibido' });
  Pedido.findByPk.mockResolvedValue(pedido);
  // Inside transaction mock, findOne returns locked pedido
  Pedido.findOne.mockResolvedValue({ ...pedido, estado: 'recibido' });

  const detalle = makeDetalle({ id: 5, cantidad: 2, subtotal: 100 }); // precio_unitario = 50
  DetallePedido.findOne.mockResolvedValue(detalle);

  const res = await request(app)
    .post('/api/mesero/pedidos/1/editar')
    .set('Authorization', `Bearer ${tokenMesero}`)
    .send({ cambios: [{ detalle_id: 5, cantidad: 3, notas: '' }] });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  // subtotal_calculado = precio_unitario (50) * nueva_cantidad (3) = 150
  const [updateArgs] = detalle.update.mock.calls[0];
  expect(updateArgs.cantidad).toBe(3);
  expect(updateArgs.subtotal_calculado).toBeCloseTo(150);
  expect(Auditoria.create).toHaveBeenCalled();
});

test('editar con cantidad=0 → 400', async () => {
  const pedido = makePedido({ estado: 'recibido' });
  Pedido.findByPk.mockResolvedValue(pedido);
  Pedido.findOne.mockResolvedValue({ ...pedido, estado: 'recibido' });
  DetallePedido.findOne.mockResolvedValue(makeDetalle({ cantidad: 2, subtotal: 100 }));

  const res = await request(app)
    .post('/api/mesero/pedidos/1/editar')
    .set('Authorization', `Bearer ${tokenMesero}`)
    .send({ cambios: [{ detalle_id: 1, cantidad: 0, notas: '' }] });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
});
