'use strict';

jest.mock('../src/models', () => ({
  Mesa:            { findByPk: jest.fn() },
  SesionCliente:   { findOne: jest.fn(), count: jest.fn(), update: jest.fn(), create: jest.fn() },
  Pedido:          {},
  DetallePedido:   {},
  DetalleModificador: {},
  OpcionModificador: {},
  Producto:        {},
  Categoria:       {},
  UbicacionMesa:   {},
  AlertaMesero:    {},
  SolicitudPago:   {},
  EstadoSolicitud: {},
  MetodoPago:      {},
  ModalidadIngreso: { findOne: jest.fn(), findOrCreate: jest.fn() },
  Auditoria:       { create: jest.fn() },
  TipoDescuento:   {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const { Mesa, SesionCliente, ModalidadIngreso, Auditoria, sequelize } = require('../src/models');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 5, rol: 'mesero' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMesa({ id = 1, numero = 3, estado = 'ocupada', pin = '1234' } = {}) {
  return {
    id, numero_mesa: numero, estado,
    pin_actual: pin,
    nota_cierre: '',
    update: jest.fn().mockResolvedValue(),
  };
}

function makeSesion({ id = 1, idMesa = 1, estado = 'activa' } = {}) {
  return { id, id_mesa: idMesa, estado, update: jest.fn().mockResolvedValue() };
}

function post(path, body) {
  return request(app)
    .post(path)
    .set('Authorization', `Bearer ${tokenMesero}`)
    .send(body);
}

beforeEach(() => {
  Mesa.findByPk.mockReset();
  SesionCliente.findOne.mockReset();
  SesionCliente.count.mockReset().mockResolvedValue(0);
  SesionCliente.update.mockReset().mockResolvedValue([1]);
  SesionCliente.create.mockReset();
  ModalidadIngreso.findOne.mockReset();
  ModalidadIngreso.findOrCreate.mockReset();
  Auditoria.create.mockReset().mockResolvedValue({});
  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }));
});

// ─── cerrar_sesion ────────────────────────────────────────────────────────────

test('cerrar_sesion última activa → mesa pasa a libre', async () => {
  const mesa = makeMesa({ estado: 'ocupada' });
  const sesion = makeSesion({ id: 10, idMesa: 1 });
  SesionCliente.findOne.mockResolvedValue(sesion);
  SesionCliente.count.mockResolvedValue(0); // ninguna activa queda tras cierre
  Mesa.findByPk.mockResolvedValue(mesa);  // used inside the handler for cerrarMesa; for cerrarSesion uses findOne
  // cerrarSesion uses Mesa.findOne internally
  const { Mesa: MesaMock } = require('../src/models');
  // The handler calls Mesa.findOne, but Mesa only has findByPk in mock — add findOne:
  MesaMock.findOne = jest.fn().mockResolvedValue(mesa);

  const res = await post('/api/mesero/sesion/cerrar', { sesion_id: 10 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(sesion.update).toHaveBeenCalledWith({ estado: 'cerrada' }, expect.anything());
  expect(mesa.update).toHaveBeenCalledWith({ estado: 'libre', pin_actual: null }, expect.anything());
});

test('cerrar_sesion una de varias → mesa sigue ocupada', async () => {
  const mesa = makeMesa({ estado: 'ocupada' });
  const sesion = makeSesion({ id: 11, idMesa: 1 });
  SesionCliente.findOne.mockResolvedValue(sesion);
  SesionCliente.count.mockResolvedValue(1); // queda 1 activa
  const { Mesa: MesaMock } = require('../src/models');
  MesaMock.findOne = jest.fn().mockResolvedValue(mesa);

  const res = await post('/api/mesero/sesion/cerrar', { sesion_id: 11 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  // mesa.update NOT called (still has active sessions)
  expect(mesa.update).not.toHaveBeenCalled();
});

test('cerrar_sesion ya cerrada → 200 con ya_cerrada:true', async () => {
  const sesion = makeSesion({ id: 12, estado: 'cerrada' });
  SesionCliente.findOne.mockResolvedValue(sesion);

  const res = await post('/api/mesero/sesion/cerrar', { sesion_id: 12 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.ya_cerrada).toBe(true);
});

// ─── cerrar_mesa ─────────────────────────────────────────────────────────────

test('cerrar_mesa → todas las sesiones a cerrada, estado=libre, Auditoria creada', async () => {
  const mesa = makeMesa({ id: 2, numero: 5, estado: 'ocupada' });
  Mesa.findByPk.mockResolvedValue(mesa);

  const res = await post('/api/mesero/mesa/cerrar', { mesa_id: 2 });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(SesionCliente.update).toHaveBeenCalledWith(
    { estado: 'cerrada' },
    expect.objectContaining({ where: { id_mesa: 2, estado: ['activa', 'pagada'] } })
  );
  expect(mesa.update).toHaveBeenCalledWith(
    { estado: 'libre', pin_actual: null, nota_cierre: '' },
    expect.anything()
  );
  expect(Auditoria.create).toHaveBeenCalledWith(
    expect.objectContaining({ accion: 'Mesa cerrada', id_mesa: 2, id_empleado: 5 }),
    expect.anything()
  );
});

// ─── agregar_sesion_asistida ─────────────────────────────────────────────────

test('agregar primera asistida → mesa=ocupada con PIN nuevo', async () => {
  const mesa = makeMesa({ id: 3, estado: 'libre', pin: null });
  Mesa.findByPk.mockResolvedValue(mesa);
  ModalidadIngreso.findOne.mockResolvedValue({ id: 2 });
  SesionCliente.count.mockResolvedValue(0); // primera sesión
  SesionCliente.create.mockResolvedValue({ id: 20, alias: 'JUAN' });

  const res = await post('/api/mesero/sesion/agregar', { mesa_id: 3, alias: 'juan' });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.sesion_id).toBe(20);
  expect(mesa.update).toHaveBeenCalledWith(
    expect.objectContaining({ estado: 'ocupada' }),
    expect.anything()
  );
  // pin generado es 4 dígitos
  expect(String(mesa.update.mock.calls[0][0].pin_actual)).toMatch(/^\d{4}$/);
});

test('agregar segunda asistida → reusa el PIN existente, mesa.update NO llamado', async () => {
  const mesa = makeMesa({ id: 4, estado: 'ocupada', pin: '5678' });
  Mesa.findByPk.mockResolvedValue(mesa);
  ModalidadIngreso.findOne.mockResolvedValue({ id: 2 });
  SesionCliente.count.mockResolvedValue(1); // ya hay una sesión activa
  SesionCliente.create.mockResolvedValue({ id: 21, alias: 'PEDRO' });

  const res = await post('/api/mesero/sesion/agregar', { mesa_id: 4, alias: 'pedro' });

  expect(res.status).toBe(200);
  expect(res.body.pin).toBe('5678');
  // mesa.update NOT called since not primera_session
  expect(mesa.update).not.toHaveBeenCalled();
});

test('alias persistido en MAYÚSCULAS (model hook)', async () => {
  const mesa = makeMesa({ id: 5, estado: 'ocupada' });
  Mesa.findByPk.mockResolvedValue(mesa);
  ModalidadIngreso.findOne.mockResolvedValue({ id: 2 });
  SesionCliente.count.mockResolvedValue(1);
  SesionCliente.create.mockResolvedValue({ id: 22, alias: 'ANA GARCIA' });

  const res = await post('/api/mesero/sesion/agregar', { mesa_id: 5, alias: 'ana garcia' });

  expect(res.status).toBe(200);
  expect(res.body.alias).toBe('ANA GARCIA');
});
