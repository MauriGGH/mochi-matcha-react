'use strict';

jest.mock('../src/models', () => ({
  Promocion:     { findAll: jest.fn() },
  Producto:      {},
  TipoDescuento: {},
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
    sync:         jest.fn().mockResolvedValue(),
  },
}));

const request  = require('supertest');
const app      = require('../src/app');
const { Promocion } = require('../src/models');
const { aplicarPromociones, aplicaHoy } = require('../src/utils/promociones');
const fixture  = require('../../__fixtures__/cliente_carrito_calcular.json');

const fixtureKeys = Object.keys(fixture).sort();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePromo({
  id = 1, titulo = 'PROMO', valor_descuento = '15', cantidad_minima = null,
  aplicacion = 'item', requiere_todos_productos = false, dias_semana = '',
  tipo = 'Porcentaje', aplicables = [], beneficiados = [],
} = {}) {
  return {
    id, titulo, descripcion_corta: '',
    valor_descuento, cantidad_minima, aplicacion,
    requiere_todos_productos, dias_semana, activa: true,
    tipo_descuento: { descripcion: tipo },
    productos_aplicables:  aplicables.map((pid) => ({ id: pid })),
    productos_beneficiados: beneficiados.map((pid) => ({ id: pid })),
  };
}

beforeEach(() => {
  Promocion.findAll.mockReset();
});

// ─── Motor: algoritmos ───────────────────────────────────────────────────────

test('motor — Porcentaje 15% sobre 1 item (subtotal 100 → 85)', async () => {
  Promocion.findAll.mockResolvedValue([
    makePromo({ id: 1, valor_descuento: '15', tipo: 'Porcentaje', aplicables: [10] }),
  ]);

  const { carrito, aplicadas, elegibles } = await aplicarPromociones(
    [{ producto_id: 10, cantidad: 1, subtotal: 100 }]
  );

  expect(elegibles).toHaveLength(1);
  expect(aplicadas).toHaveLength(1);
  expect(carrito[0].subtotal).toBe(85);
  expect(carrito[0].promocion_id).toBe(1);
});

test('motor — 2x1 con cantidad=3 → 1 par gratis (subtotal 30 → 20)', async () => {
  Promocion.findAll.mockResolvedValue([
    makePromo({ id: 2, valor_descuento: '0', tipo: '2x1', aplicables: [10] }),
  ]);

  const { carrito } = await aplicarPromociones(
    [{ producto_id: 10, cantidad: 3, subtotal: 30 }]
  );

  // pares = floor(3/2) = 1. precio_unit = 30/3 = 10. descuento = 10. subtotal = 20.
  expect(carrito[0].subtotal).toBe(20);
});

test('motor — Lleva 3 paga 2 con cantidad=6 → 2 unidades gratis (subtotal 60 → 40)', async () => {
  Promocion.findAll.mockResolvedValue([
    makePromo({
      id: 3, cantidad_minima: 3, valor_descuento: '2',
      tipo: 'Lleva X paga Y', aplicables: [10],
    }),
  ]);

  const { carrito } = await aplicarPromociones(
    [{ producto_id: 10, cantidad: 6, subtotal: 60 }]
  );

  // grupos = 6/3 = 2. unidades_gratis = 2*(3-2) = 2. precio_unit = 60/6 = 10.
  // descuento = 10*2 = 20. subtotal = 40.
  expect(carrito[0].subtotal).toBe(40);
});

test('motor — Combo precio fijo necesita TODOS los productos en carrito', async () => {
  const promo = makePromo({
    id: 4, valor_descuento: '50', tipo: 'Combo precio fijo',
    aplicacion: 'combo', aplicables: [10, 11],
  });
  Promocion.findAll.mockResolvedValue([promo]);

  // Carrito incompleto: solo producto 10 → no elegible
  const r1 = await aplicarPromociones([{ producto_id: 10, cantidad: 1, subtotal: 60 }]);
  expect(r1.elegibles).toHaveLength(0);
  expect(r1.aplicadas).toHaveLength(0);

  // Carrito completo: ambos productos → elegible, combo aplica
  Promocion.findAll.mockResolvedValue([promo]);
  const r2 = await aplicarPromociones([
    { producto_id: 10, cantidad: 1, subtotal: 60 },
    { producto_id: 11, cantidad: 1, subtotal: 40 },
  ]);
  expect(r2.elegibles).toHaveLength(1);
  expect(r2.aplicadas).toHaveLength(1);
  // factor = 50/100 = 0.5
  expect(r2.carrito[0].subtotal).toBe(30); // 60 * 0.5
  expect(r2.carrito[1].subtotal).toBe(20); // 40 * 0.5
});

// ─── Motor: selección con múltiples elegibles ────────────────────────────────

test('motor — 2 elegibles sin promocion_id → ninguna aplicada (espera elección)', async () => {
  Promocion.findAll.mockResolvedValue([
    makePromo({ id: 1, valor_descuento: '10', tipo: 'Porcentaje', aplicables: [10] }),
    makePromo({ id: 2, valor_descuento: '20', tipo: 'Porcentaje', aplicables: [10] }),
  ]);

  const r = await aplicarPromociones([{ producto_id: 10, cantidad: 1, subtotal: 100 }]);
  expect(r.elegibles).toHaveLength(2);
  expect(r.aplicadas).toHaveLength(0);
  expect(r.carrito[0].subtotal).toBe(100); // sin descuento
});

test('motor — 2 elegibles + promocion_id=2 → aplica la 2 (20% off)', async () => {
  Promocion.findAll.mockResolvedValue([
    makePromo({ id: 1, valor_descuento: '10', tipo: 'Porcentaje', aplicables: [10] }),
    makePromo({ id: 2, valor_descuento: '20', tipo: 'Porcentaje', aplicables: [10] }),
  ]);

  const r = await aplicarPromociones([{ producto_id: 10, cantidad: 1, subtotal: 100 }], 2);
  expect(r.aplicadas).toHaveLength(1);
  expect(r.aplicadas[0].id).toBe(2);
  expect(r.carrito[0].subtotal).toBe(80); // 100 * 0.8
});

// ─── Motor: aplicaHoy ────────────────────────────────────────────────────────

test('aplicaHoy — dias_semana vacío → siempre true', () => {
  expect(aplicaHoy({ dias_semana: '' })).toBe(true);
  expect(aplicaHoy({ dias_semana: null })).toBe(true);
});

test('aplicaHoy — dias_semana="0,1" (Lunes/Martes django) → Lun sí, Dom no', () => {
  // 2026-01-04 (Domingo, jsDay=0, django=6)
  // 2026-01-05 (Lunes,   jsDay=1, django=0)
  // 2026-01-06 (Martes,  jsDay=2, django=1)
  const promo = { dias_semana: '0,1' };
  expect(aplicaHoy(promo, new Date(2026, 0, 5))).toBe(true);  // Lun
  expect(aplicaHoy(promo, new Date(2026, 0, 6))).toBe(true);  // Mar
  expect(aplicaHoy(promo, new Date(2026, 0, 4))).toBe(false); // Dom
});

// ─── Handler — shape vs fixture ──────────────────────────────────────────────

test('POST /carrito/calcular — items=[] → 200 + shape = fixture', async () => {
  Promocion.findAll.mockResolvedValue([]);

  const res = await request(app)
    .post('/api/cliente/carrito/calcular')
    .send({ items: [] });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(Object.keys(res.body).sort()).toEqual(fixtureKeys);
  expect(res.body.subtotal).toBe(0);
  expect(res.body.descuento).toBe(0);
  expect(res.body.total).toBe(0);
  expect(res.body.requiere_seleccion).toBe(false);
  expect(res.body.promocion_seleccionada).toBeNull();
});
