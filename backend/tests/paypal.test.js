'use strict';

// ─── Mock del SDK de PayPal ──────────────────────────────────────────────────
const mockExecute = jest.fn();
const mockOrdersCreate = jest.fn();
const mockOrdersCapture = jest.fn();

jest.mock('@paypal/checkout-server-sdk', () => ({
  core: {
    SandboxEnvironment: jest.fn(),
    LiveEnvironment:    jest.fn(),
    PayPalHttpClient:   jest.fn().mockImplementation(() => ({ execute: mockExecute })),
  },
  orders: {
    OrdersCreateRequest:  jest.fn().mockImplementation(function () {
      mockOrdersCreate(this);
      this.prefer      = jest.fn();
      this.requestBody = jest.fn((body) => { this._body = body; });
    }),
    OrdersCaptureRequest: jest.fn().mockImplementation(function (orderId) {
      mockOrdersCapture(orderId);
      this.requestBody = jest.fn();
      this._orderId = orderId;
    }),
  },
}));

jest.mock('../src/models', () => ({
  Mesa:            { findByPk: jest.fn(), update: jest.fn() },
  SesionCliente:   { findOne: jest.fn(), findAll: jest.fn(), count: jest.fn() },
  Pedido:          { findAll: jest.fn() },
  DetallePedido:   {},
  DetalleModificador: {},
  OpcionModificador: {},
  Producto:        {},
  Categoria:       {},
  UbicacionMesa:   {},
  AlertaMesero:    { create: jest.fn() },
  SolicitudPago:   { findOne: jest.fn(), create: jest.fn(), update: jest.fn() },
  EstadoSolicitud: { findOne: jest.fn() },
  MetodoPago:      { findOne: jest.fn() },
  ModalidadIngreso: {},
  Auditoria:       { create: jest.fn() },
  TipoDescuento:   {},
  Configuracion:   { findOne: jest.fn() },
  HorarioAtencion: {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

jest.mock('../src/utils/configuracion', () => ({
  getConfig: jest.fn(),
  setConfig: jest.fn(),
  getConfigBool: jest.fn(),
  getConfigInt: jest.fn(),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const {
  Mesa, SesionCliente, Pedido, MetodoPago, EstadoSolicitud, SolicitudPago,
  AlertaMesero, Auditoria,
} = require('../src/models');
const { getConfig } = require('../src/utils/configuracion');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 5, rol: 'mesero' }, SECRET);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMesa({ id = 1, numero = 3, estado = 'ocupada', pin = '1234' } = {}) {
  return {
    id, numero_mesa: numero, estado,
    pin_actual: pin, nota_cierre: '',
    update: jest.fn().mockResolvedValue(),
  };
}

function makeSesion({ id = 100, idMesa = 1, estado = 'activa', alias = 'ANA', token = 'TOK-1' } = {}) {
  return {
    id, id_mesa: idMesa, estado, alias, token_cookie: token,
    update: jest.fn().mockResolvedValue(),
  };
}

function makeSolicitud({ id = 500 } = {}) {
  return {
    id,
    update: jest.fn().mockResolvedValue(),
    setSesiones_cubiertas: jest.fn().mockResolvedValue(),
  };
}

function makePedidoConDetalles(subtotales) {
  return {
    estado: 'recibido',
    detalles: subtotales.map((s) => ({ subtotal_calculado: s })),
  };
}

function setCreds(opts = {}) {
  const cid = opts.client_id ?? 'SANDBOX_CID';
  const sec = opts.secret    ?? 'SANDBOX_SECRET';
  const mod = opts.modo      ?? 'sandbox';
  getConfig.mockImplementation((clave, fallback = '') => {
    if (clave === 'paypal_client_id') return Promise.resolve(cid);
    if (clave === 'paypal_secret')    return Promise.resolve(sec);
    if (clave === 'paypal_modo')      return Promise.resolve(mod);
    return Promise.resolve(fallback);
  });
}

beforeEach(() => {
  mockExecute.mockReset();
  mockOrdersCreate.mockReset();
  mockOrdersCapture.mockReset();

  Mesa.findByPk.mockReset();
  Mesa.update.mockReset();
  SesionCliente.findOne.mockReset();
  SesionCliente.findAll.mockReset().mockResolvedValue([]);
  SesionCliente.count.mockReset().mockResolvedValue(1);
  Pedido.findAll.mockReset().mockResolvedValue([]);
  MetodoPago.findOne.mockReset().mockResolvedValue({ id: 9, descripcion: 'PayPal' });
  EstadoSolicitud.findOne.mockReset().mockImplementation(({ where }) => {
    if (where?.descripcion === 'pendiente') return Promise.resolve({ id: 1 });
    if (where?.descripcion === 'procesada') return Promise.resolve({ id: 2 });
    return Promise.resolve(null);
  });
  SolicitudPago.findOne.mockReset().mockResolvedValue(null);
  SolicitudPago.create.mockReset();
  SolicitudPago.update.mockReset().mockResolvedValue([1]);
  AlertaMesero.create.mockReset().mockResolvedValue({});
  Auditoria.create.mockReset().mockResolvedValue({});
  getConfig.mockReset();
  setCreds();

  const { sequelize } = require('../src/models');
  sequelize.transaction.mockReset();
  // Default: simulate a real transaction object with .commit/.rollback
  sequelize.transaction.mockImplementation(() => ({
    LOCK: { UPDATE: 'UPDATE' },
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
  }));
});

// ─── Tests cliente — crear orden ─────────────────────────────────────────────

describe('POST /api/cliente/paypal/orden', () => {
  test('crear orden individual con propina → llama PayPal con breakdown correcto', async () => {
    SesionCliente.findOne.mockResolvedValue(makeSesion({ id: 100, alias: 'ANA' }));
    Pedido.findAll.mockResolvedValue([makePedidoConDetalles([100])]);
    mockExecute.mockResolvedValue({
      result: {
        id: 'PAYPAL-ORD-1',
        links: [{ rel: 'approve', href: 'https://paypal.com/checkout/PAYPAL-ORD-1' }],
      },
    });

    const res = await request(app)
      .post('/api/cliente/paypal/orden')
      .send({ token_sesion: 'TOK-1', tipo: 'individual', propina: 15 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.order_id).toBe('PAYPAL-ORD-1');
    expect(res.body.approve_url).toMatch(/PAYPAL-ORD-1/);
    expect(res.body.subtotal).toBe(100);
    expect(res.body.propina).toBe(15);
    expect(res.body.total).toBe(115);

    // Verificar breakdown enviado a PayPal
    const createReq = mockOrdersCreate.mock.calls[0][0];
    expect(createReq._body.purchase_units[0].amount.breakdown.item_total.value).toBe('100.00');
    expect(createReq._body.purchase_units[0].amount.breakdown.handling.value).toBe('15.00');
    expect(createReq._body.purchase_units[0].amount.value).toBe('115.00');
  });

  test('crear orden sin credenciales → 503', async () => {
    setCreds({ client_id: '', secret: '' });
    SesionCliente.findOne.mockResolvedValue(makeSesion());
    Pedido.findAll.mockResolvedValue([makePedidoConDetalles([100])]);

    const res = await request(app)
      .post('/api/cliente/paypal/orden')
      .send({ token_sesion: 'TOK-1', tipo: 'individual', propina: 0 });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no disponible/i);
  });

  test('Decimal precision: subtotal 33.33 + propina 4.50 → total 37.83 exacto', async () => {
    SesionCliente.findOne.mockResolvedValue(makeSesion());
    Pedido.findAll.mockResolvedValue([makePedidoConDetalles([33.33])]);
    mockExecute.mockResolvedValue({
      result: { id: 'X', links: [{ rel: 'approve', href: 'https://paypal/X' }] },
    });

    const res = await request(app)
      .post('/api/cliente/paypal/orden')
      .send({ token_sesion: 'TOK-1', tipo: 'individual', propina: 4.50 });

    expect(res.status).toBe(200);
    expect(res.body.subtotal).toBe(33.33);
    expect(res.body.propina).toBe(4.5);
    expect(res.body.total).toBe(37.83);
    const createReq = mockOrdersCreate.mock.calls[0][0];
    expect(createReq._body.purchase_units[0].amount.value).toBe('37.83');
  });
});

// ─── Tests cliente — capturar ────────────────────────────────────────────────

describe('POST /api/cliente/paypal/capturar', () => {
  test('captura exitosa COMPLETED → 200, sesión pasa a pagada, M2M setea sesiones_cubiertas', async () => {
    const sesion = makeSesion({ id: 100 });
    SesionCliente.findOne
      .mockResolvedValueOnce(sesion)  // initial lookup (no lock)
      .mockResolvedValueOnce(sesion); // lock inside tx
    SesionCliente.count.mockResolvedValue(1); // post-pago has 1 active (won't free)
    Pedido.findAll.mockResolvedValue([makePedidoConDetalles([50])]);
    const sol = makeSolicitud({ id: 777 });
    SolicitudPago.create.mockResolvedValue(sol);
    mockExecute.mockResolvedValue({ result: { status: 'COMPLETED' } });

    const res = await request(app)
      .post('/api/cliente/paypal/capturar')
      .send({ token_sesion: 'TOK-1', order_id: 'ORDX', tipo: 'individual', propina: 0 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(sesion.update).toHaveBeenCalledWith({ estado: 'pagada' }, expect.anything());
    expect(sol.setSesiones_cubiertas).toHaveBeenCalledWith([sesion], expect.anything());
  });

  test('PayPal devuelve status=PENDING → 402, NO procesa pago en BD', async () => {
    SesionCliente.findOne.mockResolvedValue(makeSesion());
    mockExecute.mockResolvedValue({ result: { status: 'PENDING' } });

    const res = await request(app)
      .post('/api/cliente/paypal/capturar')
      .send({ token_sesion: 'TOK-1', order_id: 'ORDX', tipo: 'individual', propina: 0 });

    expect(res.status).toBe(402);
    expect(SolicitudPago.create).not.toHaveBeenCalled();
    expect(AlertaMesero.create).not.toHaveBeenCalled();
  });

  test('Sesión ya "pagada" antes de capturar → NO se llama a PayPal /capture (test crucial)', async () => {
    SesionCliente.findOne.mockResolvedValue(makeSesion({ estado: 'pagada' }));

    const res = await request(app)
      .post('/api/cliente/paypal/capturar')
      .send({ token_sesion: 'TOK-1', order_id: 'ORDX', tipo: 'individual', propina: 0 });

    expect(res.status).toBe(409);
    // Crítico: NO se llamó a PayPal — si se llamara, cobraríamos sin aplicar
    expect(mockOrdersCapture).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('Mesa grupal — todas las sesiones se marcan pagadas', async () => {
    const sesion = makeSesion({ id: 100 });
    const otras = [makeSesion({ id: 100 }), makeSesion({ id: 101 })];
    SesionCliente.findOne.mockResolvedValue(sesion);
    SesionCliente.count.mockResolvedValue(2); // pre-check grupal: 2 active
    SesionCliente.findAll.mockResolvedValue(otras); // inside tx
    Pedido.findAll.mockResolvedValue([makePedidoConDetalles([200])]);
    SolicitudPago.findOne.mockResolvedValue(null);
    const sol = makeSolicitud({ id: 888 });
    SolicitudPago.create.mockResolvedValue(sol);
    mockExecute.mockResolvedValue({ result: { status: 'COMPLETED' } });

    const res = await request(app)
      .post('/api/cliente/paypal/capturar')
      .send({ token_sesion: 'TOK-1', order_id: 'ORDX', tipo: 'grupal', propina: 0 });

    expect(res.status).toBe(200);
    expect(otras[0].update).toHaveBeenCalledWith({ estado: 'pagada' }, expect.anything());
    expect(otras[1].update).toHaveBeenCalledWith({ estado: 'pagada' }, expect.anything());
    expect(sol.setSesiones_cubiertas).toHaveBeenCalledWith(otras, expect.anything());
  });
});

// ─── Tests mesero ────────────────────────────────────────────────────────────

describe('POST /api/mesero/paypal/crear-orden', () => {
  test('crear orden mesero individual → llama PayPal y devuelve approve_url', async () => {
    Mesa.findByPk.mockResolvedValue(makeMesa({ id: 1, numero: 5 }));
    SesionCliente.findOne.mockResolvedValue(makeSesion({ id: 100, alias: 'BOB' }));
    Pedido.findAll.mockResolvedValue([makePedidoConDetalles([80])]);
    mockExecute.mockResolvedValue({
      result: {
        id: 'PAYPAL-M-1',
        links: [{ rel: 'approve', href: 'https://paypal/M1' }],
      },
    });

    const res = await request(app)
      .post('/api/mesero/paypal/crear-orden')
      .set('Authorization', `Bearer ${tokenMesero}`)
      .send({ mesa_id: 1, sesion_id: 100, propina: 10 });

    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('PAYPAL-M-1');
    expect(res.body.total).toBe(90);
  });

  test('crear orden mesero con sesión ya pagada → 409', async () => {
    Mesa.findByPk.mockResolvedValue(makeMesa());
    SesionCliente.findOne.mockResolvedValue(makeSesion({ estado: 'pagada' }));

    const res = await request(app)
      .post('/api/mesero/paypal/crear-orden')
      .set('Authorization', `Bearer ${tokenMesero}`)
      .send({ mesa_id: 1, sesion_id: 100, propina: 0 });

    expect(res.status).toBe(409);
    expect(mockExecute).not.toHaveBeenCalled(); // crítico: no se llama PayPal
  });
});

describe('POST /api/mesero/paypal/capturar', () => {
  test('captura mesero exitosa → solicitud creada, sesión pagada, Auditoria, AlertaMesero', async () => {
    const mesa = makeMesa({ id: 1, numero: 5 });
    const sesion = makeSesion({ id: 100, idMesa: 1 });
    Mesa.findByPk.mockResolvedValue(mesa);
    SesionCliente.findOne
      .mockResolvedValueOnce(sesion)  // pre-check
      .mockResolvedValueOnce(sesion); // lock inside tx
    SesionCliente.count.mockResolvedValue(0); // post-pago no active
    Pedido.findAll.mockResolvedValue([makePedidoConDetalles([100])]);
    const sol = makeSolicitud({ id: 999 });
    SolicitudPago.create.mockResolvedValue(sol);
    mockExecute.mockResolvedValue({ result: { status: 'COMPLETED' } });

    const res = await request(app)
      .post('/api/mesero/paypal/capturar')
      .set('Authorization', `Bearer ${tokenMesero}`)
      .send({ order_id: 'ORDM', mesa_id: 1, sesion_id: 100, propina: 0 });

    expect(res.status).toBe(200);
    expect(res.body.solicitud_id).toBe(999);
    expect(res.body.ticket_url).toBe('/mesero/ticket/999/');
    expect(sesion.update).toHaveBeenCalledWith({ estado: 'pagada' }, expect.anything());
    expect(AlertaMesero.create).toHaveBeenCalled();
    expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'Pago PayPal procesado por mesero',
      id_empleado: 5,
      id_mesa: 1,
    }));
  });

  test('captura mesero — sesión ya pagada → 409 ANTES de llamar PayPal', async () => {
    Mesa.findByPk.mockResolvedValue(makeMesa());
    SesionCliente.findOne.mockResolvedValue(makeSesion({ estado: 'pagada' }));

    const res = await request(app)
      .post('/api/mesero/paypal/capturar')
      .set('Authorization', `Bearer ${tokenMesero}`)
      .send({ order_id: 'ORDM', mesa_id: 1, sesion_id: 100, propina: 0 });

    expect(res.status).toBe(409);
    expect(mockOrdersCapture).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('captura mesero — PayPal devuelve PENDING → 402, no procesa', async () => {
    Mesa.findByPk.mockResolvedValue(makeMesa());
    SesionCliente.findOne.mockResolvedValue(makeSesion());
    mockExecute.mockResolvedValue({ result: { status: 'PENDING' } });

    const res = await request(app)
      .post('/api/mesero/paypal/capturar')
      .set('Authorization', `Bearer ${tokenMesero}`)
      .send({ order_id: 'ORDM', mesa_id: 1, sesion_id: 100, propina: 0 });

    expect(res.status).toBe(402);
    expect(SolicitudPago.create).not.toHaveBeenCalled();
  });
});
