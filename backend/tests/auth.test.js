'use strict';

// Mock de modelos antes de cualquier require que cargue app/models
jest.mock('../src/models', () => ({
  Empleado: { findOne: jest.fn() },
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync: jest.fn().mockResolvedValue(),
  },
}));

const request  = require('supertest');
const app      = require('../src/app');
const { Empleado } = require('../src/models');
const { requireMesero } = require('../src/middleware/authorize');

function makeEmpleado(overrides = {}) {
  return {
    id_empleado: 1,
    usuario:  'maria',
    nombre:   'MARÍA LÓPEZ',
    rol:      'mesero',
    activo:   true,
    is_active: true,
    is_staff:  false,
    verificarPassword: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => Empleado.findOne.mockReset());

describe('POST /api/auth/login', () => {
  test('credenciales correctas + rol válido → 200 + token', async () => {
    Empleado.findOne.mockResolvedValue(makeEmpleado());

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', password: 'mesero123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.empleado).toMatchObject({ nombre: 'MARÍA LÓPEZ', rol: 'mesero' });
  });

  test('password incorrecto → 401', async () => {
    Empleado.findOne.mockResolvedValue(
      makeEmpleado({ verificarPassword: jest.fn().mockResolvedValue(false) })
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', password: 'mala_clave' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('activo=false → 401 (sin llegar a verificar password)', async () => {
    const emp = makeEmpleado({ activo: false });
    Empleado.findOne.mockResolvedValue(emp);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', password: 'mesero123' });

    expect(res.status).toBe(401);
    expect(emp.verificarPassword).not.toHaveBeenCalled();
  });

  test('is_active=false (activo=true) → 401', async () => {
    const emp = makeEmpleado({ activo: true, is_active: false });
    Empleado.findOne.mockResolvedValue(emp);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', password: 'mesero123' });

    expect(res.status).toBe(401);
    expect(emp.verificarPassword).not.toHaveBeenCalled();
  });
});

describe('requireMesero', () => {
  test('rechaza rol=cocina → 403', () => {
    const req  = { user: { rol: 'cocina' } };
    const res  = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    requireMesero(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('permite rol=mesero → next()', () => {
    const req  = { user: { rol: 'mesero' } };
    const res  = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    requireMesero(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
