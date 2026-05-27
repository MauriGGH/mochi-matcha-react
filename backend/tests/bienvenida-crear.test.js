'use strict';

jest.mock('../src/models', () => ({
  Mesa:             { findByPk: jest.fn() },
  SesionCliente:    { findOne: jest.fn(), count: jest.fn(), create: jest.fn() },
  ModalidadIngreso: { findOrCreate: jest.fn() },
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request  = require('supertest');
const app      = require('../src/app');
const { Mesa, SesionCliente, ModalidadIngreso, sequelize } = require('../src/models');
const fixture  = require('../../__fixtures__/bienvenida_crear.json');

const fixtureKeys = Object.keys(fixture).sort();

const MODALIDAD = [{ id: 1, descripcion: 'qr' }];

beforeEach(() => {
  Mesa.findByPk.mockReset();
  SesionCliente.findOne.mockReset();
  SesionCliente.count.mockReset();
  SesionCliente.create.mockReset();
  ModalidadIngreso.findOrCreate.mockReset();
  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => {
    const t = { LOCK: { UPDATE: 'UPDATE' } };
    return fn(t);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mesaLibre(overrides = {}) {
  return {
    id: 1, numero_mesa: 1, estado: 'libre', pin_actual: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('POST /crear/:mesaId — mesa libre + alias nuevo → 200, cookie, PIN 4 dígitos (shape = fixture)', async () => {
  const mesa = mesaLibre();
  Mesa.findByPk
    .mockResolvedValueOnce(mesa)   // fuera de tx
    .mockResolvedValueOnce(mesa);  // dentro de tx (locked)

  SesionCliente.count.mockResolvedValue(0);    // 0 activas → primer cliente
  SesionCliente.findOne.mockResolvedValue(null);
  SesionCliente.create.mockResolvedValue({});
  ModalidadIngreso.findOrCreate.mockResolvedValue(MODALIDAD);

  const res = await request(app)
    .post('/api/bienvenida/crear/1')
    .send({ alias: 'SOFIA', modalidad: 'qr' });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.requires_pin_screen).toBe(true);
  expect(res.body.pin).toMatch(/^\d{4}$/);
  expect(res.body.sesion_id).toMatch(/^[0-9a-f]{32}$/);
  expect(mesa.estado).toBe('ocupada');
  expect(mesa.save).toHaveBeenCalled();
  expect(res.headers['set-cookie']).toBeDefined();
  expect(res.headers['set-cookie'][0]).toMatch(/mm_session=/);
  expect(Object.keys(res.body).sort()).toEqual(fixtureKeys);
});

test('POST /crear/:mesaId — alias duplicado activo → 400', async () => {
  Mesa.findByPk.mockResolvedValue(mesaLibre());
  SesionCliente.findOne.mockResolvedValue({ id: 2, alias: 'SOFIA' });

  const res = await request(app)
    .post('/api/bienvenida/crear/1')
    .send({ alias: 'SOFIA' });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(typeof res.body.error).toBe('string');
});

test('POST /crear/:mesaId — 2 POSTs simultáneos → ambos 200, txn llamada 2 veces, PIN generado en primer cliente', async () => {
  // Cada findByPk retorna un objeto fresco para evitar que la mutación del
  // primer POST (estado='ocupada') contamine el segundo POST.
  Mesa.findByPk.mockImplementation(() =>
    Promise.resolve({ id: 1, numero_mesa: 1, estado: 'libre', pin_actual: null,
      save: jest.fn().mockResolvedValue(undefined) }));
  SesionCliente.findOne.mockResolvedValue(null);
  // Primer POST entra al tx con 0 activas → primer cliente.
  // Segundo POST entra al tx con 1 activa → no es primer cliente.
  SesionCliente.count
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(1);
  SesionCliente.create.mockResolvedValue({});
  ModalidadIngreso.findOrCreate.mockResolvedValue(MODALIDAD);

  const [r1, r2] = await Promise.all([
    request(app).post('/api/bienvenida/crear/1').send({ alias: 'ALICE' }),
    request(app).post('/api/bienvenida/crear/1').send({ alias: 'BOB' }),
  ]);

  expect(r1.status).toBe(200);
  expect(r2.status).toBe(200);
  expect(sequelize.transaction).toHaveBeenCalledTimes(2);

  const primerCliente = [r1.body, r2.body].find(b => b.requires_pin_screen === true);
  expect(primerCliente).toBeDefined();
  expect(primerCliente.pin).toMatch(/^\d{4}$/);
});

test('POST /crear/:mesaId — mesa con sesión pagada → 409 step=mesa_cerrando', async () => {
  Mesa.findByPk.mockResolvedValue({ id: 1, estado: 'ocupada', pin_actual: '5678', save: jest.fn() });
  SesionCliente.count.mockResolvedValue(1);  // 1 sesión pagada

  const res = await request(app)
    .post('/api/bienvenida/crear/1')
    .send({ alias: 'CARLOS' });

  expect(res.status).toBe(409);
  expect(res.body.ok).toBe(false);
  expect(res.body.step).toBe('mesa_cerrando');
});

test('POST /recuperar/:mesaId — PIN correcto → 200 + cookie', async () => {
  const TOKEN = 'abcdef1234567890abcdef1234567890';
  Mesa.findByPk.mockResolvedValue({ id: 1, estado: 'ocupada', pin_actual: '1234' });
  SesionCliente.findOne.mockResolvedValue({ id: 10, alias: 'SOFIA', token_cookie: TOKEN });

  const res = await request(app)
    .post('/api/bienvenida/recuperar/1')
    .send({ alias: 'SOFIA', pin: '1234' });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.sesion_id).toBe(TOKEN);
  expect(res.headers['set-cookie']).toBeDefined();
  expect(res.headers['set-cookie'][0]).toMatch(new RegExp(`mm_session=${TOKEN}`));
});

test('POST /recuperar/:mesaId — PIN incorrecto → 400', async () => {
  Mesa.findByPk.mockResolvedValue({ id: 1, estado: 'ocupada', pin_actual: '1234' });

  const res = await request(app)
    .post('/api/bienvenida/recuperar/1')
    .send({ alias: 'SOFIA', pin: '9999' });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
});
