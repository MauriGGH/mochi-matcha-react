'use strict';

jest.mock('../src/models', () => ({
  Mesa:            {},
  SesionCliente:   { findOne: jest.fn() },
  Pedido:          { findOne: jest.fn(), create: jest.fn() },
  DetallePedido:   { create: jest.fn() },
  DetalleModificador: { create: jest.fn() },
  OpcionModificador: { findAll: jest.fn() },
  Producto:        { findOne: jest.fn() },
  Categoria:       {},
  UbicacionMesa:   {},
  AlertaMesero:    {},
  SolicitudPago:   {},
  EstadoSolicitud: {},
  MetodoPago:      {},
  ModalidadIngreso: { findOne: jest.fn(), findOrCreate: jest.fn() },
  Auditoria:       {},
  TipoDescuento:   {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

jest.mock('../src/utils/promociones', () => ({
  aplicarPromociones: jest.fn(),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const {
  SesionCliente, Pedido, DetallePedido, DetalleModificador, OpcionModificador,
  Producto, ModalidadIngreso, sequelize,
} = require('../src/models');
const { aplicarPromociones } = require('../src/utils/promociones');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 9, rol: 'mesero' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProducto({ id = 1, precio = '50.00', disponible = true } = {}) {
  return { id, precio, disponible };
}

function makeSesion({ id = 100, estado = 'activa' } = {}) {
  return { id, estado };
}

const defaultItems = [{ producto_id: 1, cantidad: 2, modificadores: [], notas: '' }];

function post(body) {
  return request(app)
    .post('/api/mesero/asistido/confirmar')
    .set('Authorization', `Bearer ${tokenMesero}`)
    .send(body);
}

function setupHappyPath({ pedidoId = 42, detalleId = 10 } = {}) {
  SesionCliente.findOne.mockResolvedValue(makeSesion());
  Producto.findOne.mockResolvedValue(makeProducto());
  OpcionModificador.findAll.mockResolvedValue([]);
  ModalidadIngreso.findOne.mockResolvedValue({ id: 3 });
  aplicarPromociones.mockResolvedValue({
    carrito: [{ producto_id: 1, cantidad: 2, subtotal: 100, promocion_id: null }],
    aplicadas: [],
    elegibles: [],
  });
  Pedido.create.mockResolvedValue({ id: pedidoId });
  DetallePedido.create.mockResolvedValue({ id: detalleId });
  DetalleModificador.create.mockResolvedValue({});
}

beforeEach(() => {
  SesionCliente.findOne.mockReset();
  Pedido.findOne.mockReset().mockResolvedValue(null);
  Pedido.create.mockReset();
  DetallePedido.create.mockReset();
  DetalleModificador.create.mockReset();
  OpcionModificador.findAll.mockReset().mockResolvedValue([]);
  Producto.findOne.mockReset();
  ModalidadIngreso.findOne.mockReset().mockResolvedValue({ id: 3 });
  aplicarPromociones.mockReset();
  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('pedido válido → 201 con pedido_id, empleado_entrega=mesero', async () => {
  setupHappyPath({ pedidoId: 55 });

  const res = await post({ sesion_id: 100, items: defaultItems });

  expect(res.status).toBe(201);
  expect(res.body.ok).toBe(true);
  expect(res.body.pedido_id).toBe(55);
  expect(Pedido.create).toHaveBeenCalledWith(
    expect.objectContaining({ id_empleado_entrega: 9 }),
    expect.anything(),
  );
});

test('mismo idempotency_key 2 veces → segundo devuelve duplicado:true', async () => {
  setupHappyPath({ pedidoId: 77 });
  // First call: no existing pedido (pre-check)
  Pedido.findOne
    .mockResolvedValueOnce(null)   // pre-check outside tx
    .mockResolvedValueOnce(null)   // re-check inside tx
    .mockResolvedValueOnce({ id: 77 }); // second call pre-check finds it

  const r1 = await post({ sesion_id: 100, items: defaultItems, idempotency_key: 'KEY-ABC' });
  expect(r1.status).toBe(201);
  expect(r1.body.duplicado).toBeUndefined();

  const r2 = await post({ sesion_id: 100, items: defaultItems, idempotency_key: 'KEY-ABC' });
  expect(r2.status).toBe(200);
  expect(r2.body.duplicado).toBe(true);
  expect(r2.body.pedido_id).toBe(77);
});

test('sesión no activa → 404', async () => {
  SesionCliente.findOne.mockResolvedValue(null);

  const res = await post({ sesion_id: 999, items: defaultItems });

  expect(res.status).toBe(404);
  expect(res.body.ok).toBe(false);
});

test('producto no disponible → 404', async () => {
  SesionCliente.findOne.mockResolvedValue(makeSesion());
  Producto.findOne.mockResolvedValue(null); // not found / not disponible

  const res = await post({ sesion_id: 100, items: defaultItems });

  expect(res.status).toBe(404);
  expect(res.body.ok).toBe(false);
});

test('promocion_id enviado cuando hay >1 elegibles → aplicarPromociones recibe el id', async () => {
  setupHappyPath();

  await post({ sesion_id: 100, items: defaultItems, promocion_id: 7 });

  expect(aplicarPromociones).toHaveBeenCalledWith(
    expect.any(Array),
    7,
  );
});

test('sin promocion_id con 2 elegibles → aplicarPromociones recibe null, no aplica ninguna', async () => {
  setupHappyPath();
  aplicarPromociones.mockResolvedValue({
    carrito: [{ producto_id: 1, cantidad: 2, subtotal: 100, promocion_id: null }],
    aplicadas: [],
    elegibles: [{ id: 1 }, { id: 2 }],
  });

  const res = await post({ sesion_id: 100, items: defaultItems });

  expect(aplicarPromociones).toHaveBeenCalledWith(expect.any(Array), null);
  expect(res.body.ok).toBe(true);
  // DetallePedido created without promocion_id
  const [detalleArgs] = DetallePedido.create.mock.calls[0];
  expect(detalleArgs.id_promocion).toBeNull();
});

test('DetalleModificador guarda snapshots históricos correctos', async () => {
  SesionCliente.findOne.mockResolvedValue(makeSesion());
  Producto.findOne.mockResolvedValue(makeProducto({ id: 3, precio: '80.00' }));
  const opcion = { id: 10, nombre_opcion: 'EXTRA SHOT', precio_extra: '5.00' };
  OpcionModificador.findAll.mockResolvedValue([opcion]);
  ModalidadIngreso.findOne.mockResolvedValue({ id: 3 });
  aplicarPromociones.mockResolvedValue({
    carrito: [{ producto_id: 3, cantidad: 1, subtotal: 85, promocion_id: null }],
    aplicadas: [],
    elegibles: [],
  });
  Pedido.create.mockResolvedValue({ id: 88 });
  DetallePedido.create.mockResolvedValue({ id: 20 });

  await post({ sesion_id: 100, items: [{ producto_id: 3, cantidad: 1, modificadores: [10] }] });

  expect(DetalleModificador.create).toHaveBeenCalledWith(
    expect.objectContaining({
      id_opcion: 10,
      precio_extra_aplicado: 5,
      nombre_opcion_historico: 'EXTRA SHOT',
    }),
    expect.anything(),
  );
});
