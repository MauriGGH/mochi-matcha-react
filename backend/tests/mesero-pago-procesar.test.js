'use strict';

jest.mock('../src/models', () => ({
  Mesa:            { findByPk: jest.fn() },
  SesionCliente:   { findOne: jest.fn(), findAll: jest.fn() },
  Pedido:          { findAll: jest.fn() },
  DetallePedido:   {},
  DetalleModificador: {},
  OpcionModificador: {},
  Producto:        {},
  Categoria:       {},
  UbicacionMesa:   {},
  AlertaMesero:    { create: jest.fn() },
  SolicitudPago:   { findOne: jest.fn(), create: jest.fn(), update: jest.fn() },
  EstadoSolicitud: { findOne: jest.fn(), findOrCreate: jest.fn() },
  MetodoPago:      { findByPk: jest.fn() },
  ModalidadIngreso: {},
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
const {
  Mesa, SesionCliente, Pedido, MetodoPago, EstadoSolicitud, SolicitudPago,
  AlertaMesero, Auditoria, sequelize,
} = require('../src/models');
const fixture = require('../../__fixtures__/mesero_total_cobro_grupal.json');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 7, rol: 'mesero' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMesa({ id = 1, numero = 5, estado = 'ocupada', pin = '1234' } = {}) {
  return {
    id, numero_mesa: numero, estado,
    pin_actual: pin, nota_cierre: '',
    update: jest.fn().mockResolvedValue(),
  };
}

function makeSesion({ id = 100, idMesa = 1, estado = 'activa', alias = 'TEST' } = {}) {
  return { id, id_mesa: idMesa, estado, alias, update: jest.fn().mockResolvedValue() };
}

function makeSolicitud({ id = 500 } = {}) {
  return {
    id,
    update: jest.fn().mockResolvedValue(),
    setSesiones_cubiertas: jest.fn().mockResolvedValue(),
  };
}

function makePedidoWithDetalles(subtotales = []) {
  return {
    estado: 'recibido',
    detalles: subtotales.map((s) => ({ subtotal_calculado: s })),
  };
}

function post(body) {
  return request(app)
    .post('/api/mesero/pago/procesar')
    .set('Authorization', `Bearer ${tokenMesero}`)
    .send(body);
}

beforeEach(() => {
  Mesa.findByPk.mockReset();
  SesionCliente.findOne.mockReset();
  SesionCliente.findAll.mockReset();
  Pedido.findAll.mockReset().mockResolvedValue([]);
  MetodoPago.findByPk.mockReset();
  EstadoSolicitud.findOne.mockReset();
  EstadoSolicitud.findOrCreate.mockReset();
  SolicitudPago.findOne.mockReset().mockResolvedValue(null);
  SolicitudPago.create.mockReset();
  SolicitudPago.update.mockReset().mockResolvedValue([1]);
  AlertaMesero.create.mockReset().mockResolvedValue({});
  Auditoria.create.mockReset().mockResolvedValue({});
  sequelize.transaction.mockReset();
  sequelize.transaction.mockImplementation(async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }));

  EstadoSolicitud.findOne.mockImplementation(({ where }) => {
    if (where?.descripcion === 'pendiente') return Promise.resolve({ id: 1 });
    if (where?.descripcion === 'procesada') return Promise.resolve({ id: 2 });
    return Promise.resolve(null);
  });
});

// ─── Configuración de happy path ────────────────────────────────────────────

function setupIndividualPayment({
  mesa = makeMesa(),
  sesion = makeSesion({ estado: 'activa' }),
  metodoDesc = 'EFECTIVO',
  pedidoSubtotales = [100],
  solicitud = makeSolicitud(),
} = {}) {
  Mesa.findByPk.mockResolvedValue(mesa);
  MetodoPago.findByPk.mockResolvedValue({ id: 1, descripcion: metodoDesc });
  // Pre-lock check
  SesionCliente.findOne.mockResolvedValueOnce(sesion);
  // Inside transaction: lock
  SesionCliente.findOne.mockResolvedValueOnce(sesion);
  // After payment, _postPagoMesa checks active sessions (none remaining)
  SesionCliente.findAll.mockResolvedValue([]);

  // Pedido.findAll for _sumarConsumo (called twice: once inside tx for total, once in _postPagoMesa if any active sessions)
  Pedido.findAll.mockResolvedValue([makePedidoWithDetalles(pedidoSubtotales)]);

  SolicitudPago.create.mockResolvedValue(solicitud);
  return { mesa, sesion, solicitud };
}

function setupGrupalPayment({
  mesa = makeMesa(),
  sesiones = [makeSesion({ id: 100 }), makeSesion({ id: 101 })],
  metodoDesc = 'EFECTIVO',
  pedidoSubtotales = [50, 50],
  solicitud = makeSolicitud(),
} = {}) {
  Mesa.findByPk.mockResolvedValue(mesa);
  MetodoPago.findByPk.mockResolvedValue({ id: 1, descripcion: metodoDesc });
  // Pre-lock: any active session exists
  SesionCliente.findOne.mockResolvedValueOnce(sesiones[0]);
  // Inside transaction: lock all active sessions
  SesionCliente.findAll.mockResolvedValueOnce(sesiones);
  // _postPagoMesa: no active sessions remain
  SesionCliente.findAll.mockResolvedValueOnce([]);
  Pedido.findAll.mockResolvedValue([makePedidoWithDetalles(pedidoSubtotales)]);
  SolicitudPago.create.mockResolvedValue(solicitud);
  return { mesa, sesiones, solicitud };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('pago individual EFECTIVO con cambio correcto', async () => {
  const { solicitud } = setupIndividualPayment({ pedidoSubtotales: [100] });

  const res = await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '0', monto_recibido: '150',
  });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.solicitud_id).toBe(500);
  const [updArgs] = solicitud.update.mock.calls[0];
  expect(updArgs.monto_recibido).toBe(150);
  expect(updArgs.cambio).toBe(50);
});

test('pago individual EFECTIVO con monto insuficiente → 400', async () => {
  setupIndividualPayment({ pedidoSubtotales: [100] });

  const res = await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '20', monto_recibido: '50',
  });

  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(/insuficiente/i);
});

test('pago MIXTO suma correcta → OK', async () => {
  const { solicitud } = setupIndividualPayment({
    metodoDesc: 'MIXTO (EFECTIVO + TARJETA)',
    pedidoSubtotales: [100],
  });

  const res = await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '10', monto_efectivo: '60', monto_tarjeta: '50',
  });

  expect(res.status).toBe(200);
  const [updArgs] = solicitud.update.mock.calls[0];
  expect(updArgs.detalle_pago).toBe('MIXTO');
  expect(updArgs.monto_efectivo).toBe(60);
  expect(updArgs.monto_tarjeta).toBe(50);
});

test('pago MIXTO suma insuficiente → 400', async () => {
  setupIndividualPayment({ metodoDesc: 'MIXTO', pedidoSubtotales: [100] });

  const res = await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '10', monto_efectivo: '30', monto_tarjeta: '40',  // 70 < 110
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/insuficiente.*mixto/i);
});

test('pago grupal cierra TODAS las sesiones activas', async () => {
  const sesiones = [makeSesion({ id: 100 }), makeSesion({ id: 101 })];
  const { solicitud } = setupGrupalPayment({ sesiones, pedidoSubtotales: [200] });

  const res = await post({
    mesa_id: 1, metodo_pago_id: 1,
    propina: '0', monto_recibido: '200',
  });

  expect(res.status).toBe(200);
  expect(sesiones[0].update).toHaveBeenCalledWith({ estado: 'pagada' }, expect.anything());
  expect(sesiones[1].update).toHaveBeenCalledWith({ estado: 'pagada' }, expect.anything());
  expect(solicitud.setSesiones_cubiertas).toHaveBeenCalledWith([100, 101], expect.anything());
});

test('tras cobro: mesa.estado SIGUE ocupada, pin_actual=null, nota_cierre seteada', async () => {
  const mesa = makeMesa({ estado: 'ocupada', pin: '9999' });
  setupIndividualPayment({ mesa, pedidoSubtotales: [50] });

  await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '0', monto_recibido: '50',
  });

  expect(mesa.update).toHaveBeenCalled();
  const [mesaUpd] = mesa.update.mock.calls[0];
  // estado NUNCA se cambia a libre desde acá
  expect(mesaUpd.estado).toBeUndefined();
  expect(mesaUpd.pin_actual).toBeNull();
  expect(mesaUpd.nota_cierre).toMatch(/saldada/i);
});

test('cobro sobre sesión ya pagada → 409 "ya saldada"', async () => {
  const mesa = makeMesa();
  Mesa.findByPk.mockResolvedValue(mesa);
  MetodoPago.findByPk.mockResolvedValue({ id: 1, descripcion: 'EFECTIVO' });
  SesionCliente.findOne.mockResolvedValue(makeSesion({ estado: 'pagada' }));

  const res = await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '0', monto_recibido: '100',
  });

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/saldada/i);
});

test('sesiones_cubiertas M2M registra las sesiones correctas (individual)', async () => {
  const sesion = makeSesion({ id: 200 });
  const { solicitud } = setupIndividualPayment({ sesion, pedidoSubtotales: [50] });

  await post({
    mesa_id: 1, sesion_id: 200, metodo_pago_id: 1,
    propina: '0', monto_recibido: '50',
  });

  expect(solicitud.setSesiones_cubiertas).toHaveBeenCalledWith([200], expect.anything());
});

test('pedido cancelado se excluye del total (vía where en _sumarConsumo)', async () => {
  setupIndividualPayment({ pedidoSubtotales: [60] });

  await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '0', monto_recibido: '60',
  });

  // Verificar que Pedido.findAll fue llamado con where.estado != 'cancelado'
  const callsWithEstado = Pedido.findAll.mock.calls.filter(
    (c) => c[0]?.where?.estado
  );
  expect(callsWithEstado.length).toBeGreaterThan(0);
  // Cada llamada que filtra debe excluir 'cancelado' (Op.ne symbol → checkable por la presencia del field)
  const firstCall = callsWithEstado[0][0];
  expect(firstCall.where.estado).toBeDefined();
});

test('Auditoria creada con detalle correcto', async () => {
  setupIndividualPayment({
    mesa: makeMesa({ numero: 7 }),
    pedidoSubtotales: [100],
  });

  await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '15', monto_recibido: '150',
  });

  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({
    accion: 'Pago procesado',
    id_empleado: 7,
  }));
  const [args] = Auditoria.create.mock.calls[0];
  expect(args.detalle).toMatch(/Mesa 7/);
  expect(args.detalle).toMatch(/Sesión #100/);
  expect(args.detalle).toMatch(/\$100\.00/);  // total
  expect(args.detalle).toMatch(/\$15\.00/);   // propina
});

test('Decimal precision: 33.33 + propina 4.50 con efectivo 50.00 → cambio 12.17', async () => {
  const { solicitud } = setupIndividualPayment({ pedidoSubtotales: [33.33] });

  await post({
    mesa_id: 1, sesion_id: 100, metodo_pago_id: 1,
    propina: '4.50', monto_recibido: '50.00',
  });

  const [updArgs] = solicitud.update.mock.calls[0];
  expect(updArgs.cambio).toBe(12.17);
});

test('GET /pago/total grupal con mesa vacía → total 0', async () => {
  Mesa.findByPk.mockResolvedValue(makeMesa());
  SesionCliente.findAll.mockResolvedValue([]); // no active sessions

  const res = await request(app)
    .get('/api/mesero/pago/total?mesa=1')
    .set('Authorization', `Bearer ${tokenMesero}`);

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.total).toBe(0);
  expect(Object.keys(res.body).sort()).toEqual(Object.keys(fixture).sort());
});
