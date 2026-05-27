'use strict';

jest.mock('../src/models', () => ({
  Pedido:          { findOne: jest.fn(), findByPk: jest.fn() },
  DetallePedido:   { findByPk: jest.fn(), update: jest.fn() },
  DetalleModificador: {},
  OpcionModificador:  {},
  Producto:        {},
  Categoria:       {},
  SesionCliente:   {},
  Mesa:            {},
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
const { Pedido, DetallePedido, sequelize } = require('../src/models');

const SECRET      = process.env.JWT_SECRET;
const tokenCocina = jwt.sign({ id: 1, rol: 'cocina' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDetalle({ id = 1, area = 'cocina', listo = false } = {}) {
  return {
    id, listo,
    producto: { nombre: 'ITEM', categoria: { area } },
  };
}

function makePedido({ id = 1, estado = 'recibido', detalles = [] } = {}) {
  return { id, estado, detalles, update: jest.fn().mockResolvedValue() };
}

function send(body) {
  return request(app)
    .post('/api/cocina/marcar-listo')
    .set('Authorization', `Bearer ${tokenCocina}`)
    .send(body);
}

beforeEach(() => {
  Pedido.findOne.mockReset();
  DetallePedido.update.mockReset().mockResolvedValue([1]);
  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => {
    const t = { LOCK: { UPDATE: 'UPDATE' } };
    return fn(t);
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('pedido recibido + click → preparando, items NO marcados', async () => {
  const pedido = makePedido({
    estado: 'recibido',
    detalles: [makeDetalle({ id: 10, area: 'cocina', listo: false })],
  });
  Pedido.findOne.mockResolvedValue(pedido);

  const res = await send({ pedido_id: 1, area: 'cocina' });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.nuevo_estado).toBe('preparando');
  // pedido.update llamado con preparando
  expect(pedido.update).toHaveBeenCalledWith({ estado: 'preparando' }, expect.anything());
  // DetallePedido.update NO llamado (primer click solo arranca)
  expect(DetallePedido.update).not.toHaveBeenCalled();
});

test('pedido preparando solo cocina + click area=cocina → listo, items.listo=true', async () => {
  const d = makeDetalle({ id: 20, area: 'cocina', listo: false });
  const pedido = makePedido({ estado: 'preparando', detalles: [d] });
  Pedido.findOne.mockResolvedValue(pedido);

  const res = await send({ pedido_id: 1, area: 'cocina' });

  expect(res.status).toBe(200);
  expect(res.body.nuevo_estado).toBe('listo');
  expect(res.body.area_completa).toBe(true);
  // DetallePedido.update llamado con listo:true
  expect(DetallePedido.update).toHaveBeenCalledTimes(1);
  const [updateData] = DetallePedido.update.mock.calls[0];
  expect(updateData.listo).toBe(true);
  expect(pedido.update).toHaveBeenCalledWith({ estado: 'listo' }, expect.anything());
});

test('pedido preparando cocina+bar + click area=cocina → estado preparando, area_completa:true', async () => {
  const dCocina = makeDetalle({ id: 30, area: 'cocina', listo: false });
  const dBar    = makeDetalle({ id: 31, area: 'bar',    listo: false });
  const pedido  = makePedido({ estado: 'preparando', detalles: [dCocina, dBar] });
  Pedido.findOne.mockResolvedValue(pedido);

  const res = await send({ pedido_id: 1, area: 'cocina' });

  expect(res.status).toBe(200);
  expect(res.body.nuevo_estado).toBe('preparando'); // bar aún no terminó
  expect(res.body.area_completa).toBe(true);         // cocina sí terminó
  // pedido.update NO llamado (estado no cambió)
  expect(pedido.update).not.toHaveBeenCalled();
});

test('click area=bar después → estado pasa a listo', async () => {
  // Cocina ya terminó (listo=true), bar aún no
  const dCocina = makeDetalle({ id: 40, area: 'cocina', listo: true });
  const dBar    = makeDetalle({ id: 41, area: 'bar',    listo: false });
  const pedido  = makePedido({ estado: 'preparando', detalles: [dCocina, dBar] });
  Pedido.findOne.mockResolvedValue(pedido);

  const res = await send({ pedido_id: 1, area: 'bar' });

  expect(res.status).toBe(200);
  expect(res.body.nuevo_estado).toBe('listo');
  expect(res.body.area_completa).toBe(true);
  expect(pedido.update).toHaveBeenCalledWith({ estado: 'listo' }, expect.anything());
});

test('pedido listo + click → idempotente, devuelve mismo estado', async () => {
  const pedido = makePedido({ estado: 'listo', detalles: [] });
  Pedido.findOne.mockResolvedValue(pedido);

  const res = await send({ pedido_id: 1 });

  expect(res.status).toBe(200);
  expect(res.body.nuevo_estado).toBe('listo');
  expect(res.body.area_completa).toBe(true);
  expect(pedido.update).not.toHaveBeenCalled();
  expect(DetallePedido.update).not.toHaveBeenCalled();
});

test('pedido inexistente → 404', async () => {
  Pedido.findOne.mockResolvedValue(null);

  const res = await send({ pedido_id: 9999 });

  expect(res.status).toBe(404);
  expect(res.body.ok).toBe(false);
});

test('2 requests concurrentes → DetallePedido.update llamado al menos 1 vez, ambas 200', async () => {
  const d      = makeDetalle({ id: 50, area: 'cocina', listo: false });
  const pedido = makePedido({ estado: 'preparando', detalles: [d] });
  Pedido.findOne.mockResolvedValue(pedido);

  const [r1, r2] = await Promise.all([
    send({ pedido_id: 1, area: 'cocina' }),
    send({ pedido_id: 1, area: 'cocina' }),
  ]);

  expect(r1.status).toBe(200);
  expect(r2.status).toBe(200);
  expect(DetallePedido.update).toHaveBeenCalled();
  // Ambas deben dar ok:true
  expect(r1.body.ok).toBe(true);
  expect(r2.body.ok).toBe(true);
});
