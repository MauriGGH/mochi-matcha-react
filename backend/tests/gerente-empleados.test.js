'use strict';

jest.mock('../src/models', () => ({
  Empleado:      { findByPk: jest.fn(), findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  Auditoria:     { create: jest.fn() },
  Mesa:          { findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn() },
  UbicacionMesa: {},
  Producto:      { findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn() },
  Categoria:     { findAll: jest.fn() },
  GrupoModificador:  {},
  OpcionModificador: {},
  Promocion:     {},
  TipoDescuento: { findAll: jest.fn() },
  Pedido:        { findAll: jest.fn() },
  DetallePedido: {},
  SesionCliente: { findAll: jest.fn(), count: jest.fn() },
  SolicitudPago: { findAll: jest.fn() },
  AlertaMesero:  { findAll: jest.fn() },
  MetodoPago:    {},
  EstadoSolicitud: { findOne: jest.fn() },
  ModalidadIngreso: {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const app      = require('../src/app');
const { Empleado, Auditoria } = require('../src/models');

const SECRET       = process.env.JWT_SECRET;
// Gerente con id=1
const tokenGerente = jwt.sign({ id: 1, rol: 'gerente' }, SECRET);

function authPost(url, body) {
  return request(app).post(url).set('Authorization', `Bearer ${tokenGerente}`).send(body);
}
function authPut(url, body) {
  return request(app).put(url).set('Authorization', `Bearer ${tokenGerente}`).send(body);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEmpleado({ id_empleado = 2, nombre = 'JUAN', usuario = 'juan', rol = 'mesero', activo = true } = {}) {
  const obj = { id_empleado, nombre, usuario, rol, activo, is_active: activo, password: '$2b$10$fakehash' };
  return {
    ...obj,
    update: jest.fn().mockResolvedValue(),
    toJSON: jest.fn().mockReturnValue(obj),
  };
}

beforeEach(() => {
  Empleado.findByPk.mockReset();
  Empleado.findAll.mockReset();
  Empleado.findOne.mockReset().mockResolvedValue(null);
  Empleado.create.mockReset();
  Auditoria.create.mockReset().mockResolvedValue({});
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('crear con usuario duplicado → 400', async () => {
  Empleado.findOne.mockResolvedValue(makeEmpleado({ usuario: 'juan' }));

  const res = await authPost('/api/gerente/empleados', {
    nombre: 'Juan', usuario: 'juan', password: 'pass1234', rol: 'mesero',
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/usuario ya existe/i);
});

test('crear con rol inválido → 400', async () => {
  const res = await authPost('/api/gerente/empleados', {
    nombre: 'Juan', usuario: 'jnuevo', password: 'pass1234', rol: 'supervisor',
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/rol inválido/i);
});

test('crear gerente → is_staff=true; crear mesero → is_staff=false', async () => {
  Empleado.create.mockImplementation(async (data) => ({ ...data, id_empleado: 99 }));

  await authPost('/api/gerente/empleados', {
    nombre: 'Gerente', usuario: 'ger1', password: 'pass1234', rol: 'gerente',
  });
  const [gerenteArgs] = Empleado.create.mock.calls[0];
  expect(gerenteArgs.is_staff).toBe(true);

  Empleado.create.mockClear();
  await authPost('/api/gerente/empleados', {
    nombre: 'Mesero', usuario: 'mes1', password: 'pass1234', rol: 'mesero',
  });
  const [meseroArgs] = Empleado.create.mock.calls[0];
  expect(meseroArgs.is_staff).toBe(false);
});

test('toggle empleado → flip activo; Auditoria registrada', async () => {
  const e = makeEmpleado({ id_empleado: 2, activo: true });
  Empleado.findByPk.mockResolvedValue(e);

  const res = await authPut('/api/gerente/empleados/2/toggle', {});

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.activo).toBe(false);
  expect(e.update).toHaveBeenCalledWith({ activo: false, is_active: false });
  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({ accion: 'Empleado desactivado' }));
});

test('toggle propio user (id=1) → 400', async () => {
  // req.user.id = 1 (from tokenGerente)
  const e = makeEmpleado({ id_empleado: 1 });
  Empleado.findByPk.mockResolvedValue(e);

  const res = await authPut('/api/gerente/empleados/1/toggle', {});

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/ti mismo/i);
});

test('editar password: hash bcrypt válido (verify funciona)', async () => {
  const e = makeEmpleado({ id_empleado: 2 });
  Empleado.findByPk.mockResolvedValue(e);

  await authPut('/api/gerente/empleados/2', { password: 'NuevaPass1' });

  const [updates] = e.update.mock.calls[0];
  expect(updates.password).toBeDefined();
  expect(updates.password).not.toBe('NuevaPass1');
  const valid = await bcrypt.compare('NuevaPass1', updates.password);
  expect(valid).toBe(true);
});

test('editar sin password: campo password no incluido en update', async () => {
  const e = makeEmpleado({ id_empleado: 2 });
  Empleado.findByPk.mockResolvedValue(e);

  await authPut('/api/gerente/empleados/2', { nombre: 'NUEVO NOMBRE' });

  const [updates] = e.update.mock.calls[0];
  expect(updates.password).toBeUndefined();
});

test('Auditoria registrada al crear y al toggle', async () => {
  Empleado.create.mockResolvedValue(makeEmpleado({ id_empleado: 5, usuario: 'nuevo' }));

  await authPost('/api/gerente/empleados', {
    nombre: 'Nuevo', usuario: 'nuevo', password: 'pass1234', rol: 'mesero',
  });

  const e = makeEmpleado({ id_empleado: 2 });
  Empleado.findByPk.mockResolvedValue(e);
  await authPut('/api/gerente/empleados/2/toggle', {});

  const acciones = Auditoria.create.mock.calls.map((c) => c[0].accion);
  expect(acciones).toContain('Empleado creado');
  expect(acciones.some((a) => a.includes('Empleado'))).toBe(true);
});
