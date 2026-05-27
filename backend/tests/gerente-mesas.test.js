'use strict';

jest.mock('../src/models', () => ({
  Mesa:          { findByPk: jest.fn(), findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  UbicacionMesa: { findByPk: jest.fn(), findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  SesionCliente: { findAll: jest.fn(), findOne: jest.fn(), count: jest.fn() },
  Empleado:      { findByPk: jest.fn(), findAll: jest.fn() },
  Auditoria:     { create: jest.fn() },
  Producto:      { findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn() },
  Categoria:     { findAll: jest.fn() },
  GrupoModificador:  {},
  OpcionModificador: {},
  Promocion:     {},
  TipoDescuento: { findAll: jest.fn() },
  Pedido:        { findAll: jest.fn() },
  DetallePedido: {},
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

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE'),
  toBuffer:  jest.fn().mockResolvedValue(Buffer.from('PNG')),
  toString:  jest.fn().mockResolvedValue('<svg/>'),
}));

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../src/app');
const { Mesa, UbicacionMesa, SesionCliente, Empleado, Auditoria } = require('../src/models');
const QRCode   = require('qrcode');
const { generateQrBase64 } = require('../src/services/qr');

const SECRET       = process.env.JWT_SECRET;
const tokenGerente = jwt.sign({ id: 1, rol: 'gerente' }, SECRET);

function authPost(url, body) {
  return request(app).post(url).set('Authorization', `Bearer ${tokenGerente}`).send(body);
}
function authDelete(url) {
  return request(app).delete(url).set('Authorization', `Bearer ${tokenGerente}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMesa(overrides = {}) {
  return {
    id: 1, numero_mesa: 5, capacidad: 4, estado: 'libre',
    codigo_qr: 'mesa-5-abcd1234',
    update: jest.fn().mockResolvedValue(),
    destroy: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

function makeUbicacion(overrides = {}) {
  return {
    id: 1, nombre: 'TERRAZA',
    update: jest.fn().mockResolvedValue(),
    destroy: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

beforeEach(() => {
  Mesa.findByPk.mockReset();
  Mesa.findAll.mockReset();
  Mesa.findOne.mockReset().mockResolvedValue(null);
  Mesa.create.mockReset();
  UbicacionMesa.findByPk.mockReset();
  UbicacionMesa.findAll.mockReset();
  UbicacionMesa.findOne.mockReset().mockResolvedValue(null);
  UbicacionMesa.create.mockReset();
  SesionCliente.count.mockReset().mockResolvedValue(0);
  Empleado.findByPk.mockReset();
  Auditoria.create.mockReset().mockResolvedValue({});
  QRCode.toDataURL.mockClear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('crear mesa: ok=true, id presente, Auditoria registrada', async () => {
  const mesa = makeMesa({ id: 3, numero_mesa: 7 });
  Mesa.create.mockResolvedValue(mesa);

  const res = await authPost('/api/gerente/mesas', { numero_mesa: 7, capacidad: 4 });

  expect(res.status).toBe(201);
  expect(res.body.ok).toBe(true);
  expect(res.body.id).toBe(3);
  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({ accion: 'Mesa creada' }));
});

test('crear mesa con numero existente → 400', async () => {
  Mesa.findOne.mockResolvedValue(makeMesa({ numero_mesa: 5 }));

  const res = await authPost('/api/gerente/mesas', { numero_mesa: 5, capacidad: 4 });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/ya existe/i);
});

test('eliminar mesa libre sin histórico → 200', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'libre' }));
  SesionCliente.count.mockResolvedValue(0);

  const res = await authDelete('/api/gerente/mesas/1');

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({ accion: 'Mesa eliminada' }));
});

test('eliminar mesa ocupada → 400', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'ocupada' }));

  const res = await authDelete('/api/gerente/mesas/1');

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/libre/i);
});

test('eliminar mesa libre con sesiones históricas → 400', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa({ estado: 'libre' }));
  SesionCliente.count.mockResolvedValue(5);

  const res = await authDelete('/api/gerente/mesas/1');

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/histórico/i);
});

test('asignar empleado con rol=cocina → 400', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa());
  Empleado.findByPk.mockResolvedValue({ id_empleado: 2, rol: 'cocina', nombre: 'JUAN' });

  const res = await authPost('/api/gerente/mesas/1/asignar', { empleado_id: 2 });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/mesero/i);
});

test('crear ubicación con nombre existente → 400', async () => {
  UbicacionMesa.findOne.mockResolvedValue(makeUbicacion({ nombre: 'TERRAZA' }));

  const res = await authPost('/api/gerente/ubicaciones', { nombre: 'TERRAZA' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/existe/i);
});

test('eliminar ubicación con mesas → 200 (SET_NULL comportamiento)', async () => {
  const ub = makeUbicacion();
  UbicacionMesa.findByPk.mockResolvedValue(ub);

  const res = await authDelete('/api/gerente/ubicaciones/1');

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(ub.destroy).toHaveBeenCalled();
});

test('generateQrBase64: URL contiene /bienvenida/?mesa=<id> con el host correcto', async () => {
  const mesa     = { id: 42 };
  const baseUrl  = 'https://mochi.local';

  await generateQrBase64(mesa, baseUrl);

  const [urlArg] = QRCode.toDataURL.mock.calls[0];
  expect(urlArg).toBe('https://mochi.local/bienvenida/?mesa=42');
});
