'use strict';

jest.mock('../src/models', () => ({
  Configuracion:   { findAll: jest.fn(), findOne: jest.fn(), findOrCreate: jest.fn() },
  HorarioAtencion: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn(), destroy: jest.fn(), bulkCreate: jest.fn() },
  Auditoria:       { create: jest.fn() },
  Mesa:            { findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn() },
  UbicacionMesa:   {},
  Producto:        { findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn() },
  Categoria:       { findAll: jest.fn() },
  GrupoModificador:  {},
  OpcionModificador: {},
  Promocion:       {},
  TipoDescuento:   { findAll: jest.fn() },
  Pedido:          { findAll: jest.fn(), count: jest.fn() },
  DetallePedido:   {},
  SesionCliente:   { findAll: jest.fn(), count: jest.fn() },
  SolicitudPago:   { findAll: jest.fn(), count: jest.fn() },
  AlertaMesero:    { findAll: jest.fn(), count: jest.fn() },
  MetodoPago:      {},
  EstadoSolicitud: { findOne: jest.fn() },
  Empleado:        { findAll: jest.fn() },
  ModalidadIngreso: {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const fs       = require('fs');
const app      = require('../src/app');
const { Configuracion, HorarioAtencion } = require('../src/models');
const mantenimientoMw = require('../src/middleware/mantenimiento');
const horarioMw       = require('../src/middleware/horario');
const { enHorario }   = require('../src/services/horarios');

const SECRET       = process.env.JWT_SECRET;
const tokenGerente = jwt.sign({ id: 1, rol: 'gerente' }, SECRET);

function authPost(url, body) {
  return request(app).post(url).set('Authorization', `Bearer ${tokenGerente}`).send(body);
}
function authDelete(url) {
  return request(app).delete(url).set('Authorization', `Bearer ${tokenGerente}`);
}

beforeEach(() => {
  mantenimientoMw.invalidate();
  horarioMw.invalidate();
  Configuracion.findOne.mockReset().mockResolvedValue(null);
  Configuracion.findAll.mockReset().mockResolvedValue([]);
  Configuracion.findOrCreate.mockReset();
  HorarioAtencion.findAll.mockReset().mockResolvedValue([]);
  HorarioAtencion.findByPk.mockReset();
  HorarioAtencion.create.mockReset();
});

// ─── Mantenimiento middleware (unit tests) ────────────────────────────────────

test('mantenimiento ON: sin staff token → 503', async () => {
  Configuracion.findOne.mockImplementation(({ where }) => {
    if (where.clave === 'modo_mantenimiento') return Promise.resolve({ valor: 'true' });
    if (where.clave === 'mensaje_mantenimiento') return Promise.resolve({ valor: 'Cerrado.' });
    return Promise.resolve(null);
  });

  const req  = { headers: {} };
  const res  = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await mantenimientoMw(req, res, next);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
});

test('mantenimiento ON: staff gerente con token válido → next()', async () => {
  Configuracion.findOne.mockImplementation(({ where }) => {
    if (where.clave === 'modo_mantenimiento') return Promise.resolve({ valor: 'true' });
    return Promise.resolve(null);
  });
  mantenimientoMw.invalidate();

  const token = jwt.sign({ id: 1, rol: 'gerente' }, SECRET);
  const req  = { headers: { authorization: `Bearer ${token}` } };
  const res  = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await mantenimientoMw(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
});

// ─── Horario service (pure unit tests) ───────────────────────────────────────

test('enHorario: lunes 8-20, request en domingo → false', () => {
  const horarios = [{ dia_semana: 0, abre: '08:00', cierra: '20:00', activo: true }];
  // 2026-01-04 = Sunday (JS day 0, Django day 6)
  const now = new Date(2026, 0, 4, 12, 0, 0);
  expect(enHorario(horarios, now)).toBe(false);
});

test('enHorario: cruce medianoche (22-02), sábado 23:00 → true', () => {
  // Horario sábado Django=5, JS=6
  const horarios = [{ dia_semana: 5, abre: '22:00', cierra: '02:00', activo: true }];
  // 2026-01-03 = Saturday (JS day 6)
  const now = new Date(2026, 0, 3, 23, 0, 0);
  expect(enHorario(horarios, now)).toBe(true);
});

test('enHorario: cruce medianoche (22-02), domingo 01:00 → true', () => {
  const horarios = [{ dia_semana: 5, abre: '22:00', cierra: '02:00', activo: true }];
  // 2026-01-04 = Sunday (JS day 0, Django day 6)
  const now = new Date(2026, 0, 4, 1, 0, 0);
  expect(enHorario(horarios, now)).toBe(true);
});

test('enHorario: cruce medianoche (22-02), domingo 03:00 → false (cerrado)', () => {
  const horarios = [{ dia_semana: 5, abre: '22:00', cierra: '02:00', activo: true }];
  const now = new Date(2026, 0, 4, 3, 0, 0);
  expect(enHorario(horarios, now)).toBe(false);
});

// ─── Image upload (HTTP tests) ────────────────────────────────────────────────

test('upload imagen con extensión .exe → 400', async () => {
  const res = await request(app)
    .post('/api/gerente/upload-imagen')
    .set('Authorization', `Bearer ${tokenGerente}`)
    .attach('file', Buffer.from('MZ fakeexe'), { filename: 'virus.exe', contentType: 'image/png' });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(/formato|soportado/i);
});

test('upload imagen sin archivo → 400', async () => {
  const res = await request(app)
    .post('/api/gerente/upload-imagen')
    .set('Authorization', `Bearer ${tokenGerente}`)
    .set('Content-Type', 'multipart/form-data');

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
});

test('delete imagen con path traversal ../etc/passwd → 400', async () => {
  const res = await authPost('/api/gerente/imagenes/eliminar', { path: '../etc/passwd' });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(/inválido/i);
});

test('delete imagen con path absoluto → 400', async () => {
  const res = await authPost('/api/gerente/imagenes/eliminar', { path: '/etc/passwd' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/inválido/i);
});

test('upload imagen válida → 200 + url /media/uploads/...', async () => {
  // Minimal valid PNG (1×1 pixel)
  const pngBuf = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c49444154789c6260f8cf0000000200015e221bc30000000049454e44ae426082',
    'hex'
  );
  // Spy on fs to avoid real disk write
  const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
  const renameSpy = jest.spyOn(fs, 'renameSync').mockReturnValue(undefined);

  const res = await request(app)
    .post('/api/gerente/upload-imagen')
    .set('Authorization', `Bearer ${tokenGerente}`)
    .attach('file', pngBuf, { filename: 'test.png', contentType: 'image/png' });

  mkdirSpy.mockRestore();
  renameSpy.mockRestore();

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.url).toMatch(/^\/media\/uploads\/.+\.png$/);
});
