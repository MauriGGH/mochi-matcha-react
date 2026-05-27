'use strict';

jest.mock('../src/models', () => ({
  Producto:         { findAll: jest.fn() },
  GrupoModificador: {},
  OpcionModificador: {},
  SesionCliente:    {},
  Mesa:             {},
  Pedido:           {},
  DetallePedido:    {},
  DetalleModificador: {},
  SolicitudPago:    {},
  MetodoPago:       {},
  EstadoSolicitud:  {},
  AlertaMesero:     {},
  Auditoria:        {},
  ModalidadIngreso: {},
  UbicacionMesa:    {},
  TipoDescuento:    {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
    transaction:  jest.fn(),
  },
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/app');
const { Producto } = require('../src/models');
const fixture = require('../../__fixtures__/mesero_productos.json');

const SECRET      = process.env.JWT_SECRET;
const tokenMesero = jwt.sign({ id: 7, rol: 'mesero' }, SECRET);

function get() {
  return request(app)
    .get('/api/mesero/productos/json')
    .set('Authorization', `Bearer ${tokenMesero}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProducto({ id, nombre, precio, disponible = true, grupos = [] }) {
  return { id, nombre, precio, disponible, grupos_modificadores: grupos };
}

function makeGrupo({ id, nombre_grupo, tipo = 'única', es_obligatorio = false, max_selecciones = null, opciones = [] }) {
  return { id, nombre_grupo, tipo, es_obligatorio, max_selecciones, opciones };
}

function makeOpcion({ id, nombre_opcion, precio_extra = 0, activo = true }) {
  return { id, nombre_opcion, precio_extra, activo };
}

beforeEach(() => {
  Producto.findAll.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('devuelve 200 con ok:true y array productos', async () => {
  Producto.findAll.mockResolvedValue([
    makeProducto({ id: 1, nombre: 'MATCHA LATTE', precio: 65 }),
  ]);

  const res = await get();

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(Array.isArray(res.body.productos)).toBe(true);
});

test('devuelve solo productos disponible=true (query tiene where.disponible:true)', async () => {
  Producto.findAll.mockResolvedValue([]);

  await get();

  const [callArgs] = Producto.findAll.mock.calls[0];
  expect(callArgs.where).toMatchObject({ disponible: true });
});

test('producto sin grupos → grupos_modificadores: []', async () => {
  Producto.findAll.mockResolvedValue([
    makeProducto({ id: 13, nombre: 'BROWNIE', precio: 50, grupos: [] }),
  ]);

  const res = await get();

  expect(res.status).toBe(200);
  const brownie = res.body.productos[0];
  expect(brownie.grupos_modificadores).toEqual([]);
});

test('grupo obligatorio → es_obligatorio: true en respuesta', async () => {
  const grupo = makeGrupo({ id: 1, nombre_grupo: 'TAMAÑO', tipo: 'única', es_obligatorio: true, max_selecciones: null });
  Producto.findAll.mockResolvedValue([
    makeProducto({ id: 1, nombre: 'MATCHA LATTE', precio: 65, grupos: [grupo] }),
  ]);

  const res = await get();

  const g = res.body.productos[0].grupos_modificadores[0];
  expect(g.es_obligatorio).toBe(true);
  expect(g.nombre).toBe('TAMAÑO');
  expect(g.tipo).toBe('única');
});

test('precio como float y precio_extra como float', async () => {
  const opcion = makeOpcion({ id: 2, nombre_opcion: 'MEDIANO', precio_extra: '10.00' });
  const grupo  = makeGrupo({ id: 1, nombre_grupo: 'TAMAÑO', opciones: [opcion] });
  Producto.findAll.mockResolvedValue([
    makeProducto({ id: 1, nombre: 'MATCHA LATTE', precio: '65.00', grupos: [grupo] }),
  ]);

  const res = await get();

  const p = res.body.productos[0];
  expect(typeof p.precio).toBe('number');
  expect(p.precio).toBe(65);
  expect(typeof p.grupos_modificadores[0].opciones[0].precio_extra).toBe('number');
  expect(p.grupos_modificadores[0].opciones[0].precio_extra).toBe(10);
});

test('keys de respuesta coinciden con fixture', async () => {
  Producto.findAll.mockResolvedValue([]);

  const res = await get();

  expect(Object.keys(res.body).sort()).toEqual(Object.keys(fixture).sort());
});

test('query tiene ORDER BY nombre ASC', async () => {
  Producto.findAll.mockResolvedValue([]);

  await get();

  const [callArgs] = Producto.findAll.mock.calls[0];
  expect(callArgs.order).toEqual([['nombre', 'ASC']]);
});
