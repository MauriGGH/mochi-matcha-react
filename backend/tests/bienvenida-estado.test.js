'use strict';

jest.mock('../src/models', () => ({
  Empleado:      { findOne: jest.fn() },
  Mesa:          { findByPk: jest.fn() },
  SesionCliente: { findAll: jest.fn() },
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
  },
}));

const request  = require('supertest');
const app      = require('../src/app');
const { Mesa, SesionCliente } = require('../src/models');
const fixture  = require('../../__fixtures__/cliente_estado_mesa.json');

const fixtureKeys = Object.keys(fixture).sort();

beforeEach(() => {
  Mesa.findByPk.mockReset();
  SesionCliente.findAll.mockReset();
});

test('GET /api/bienvenida/estado/:mesaId — mesa existente → 200 + shape = fixture', async () => {
  Mesa.findByPk.mockResolvedValue({ id: 3, numero_mesa: 3, estado: 'libre' });
  SesionCliente.findAll.mockResolvedValue([]);

  const res = await request(app).get('/api/bienvenida/estado/3');

  expect(res.status).toBe(200);
  expect(Object.keys(res.body).sort()).toEqual(fixtureKeys);
  expect(res.body.ok).toBe(true);
  expect(Array.isArray(res.body.sesiones_activas)).toBe(true);
  expect(typeof res.body.count).toBe('number');
});

test('GET /api/bienvenida/estado/:mesaId — mesa inexistente → 404', async () => {
  Mesa.findByPk.mockResolvedValue(null);

  const res = await request(app).get('/api/bienvenida/estado/9999');

  expect(res.status).toBe(404);
});

test('GET /api/bienvenida/estado/:mesaId — respuesta NO incluye pin ni pin_actual', async () => {
  Mesa.findByPk.mockResolvedValue({ id: 1, numero_mesa: 1, estado: 'ocupada' });
  SesionCliente.findAll.mockResolvedValue([{ alias: 'SOFÍA' }, { alias: 'DIEGO' }]);

  const res = await request(app).get('/api/bienvenida/estado/1');

  expect(res.status).toBe(200);
  expect(res.body).not.toHaveProperty('pin');
  expect(res.body).not.toHaveProperty('pin_actual');
  expect(res.body.sesiones_activas).toEqual(['SOFÍA', 'DIEGO']);
  expect(res.body.count).toBe(2);
});
