'use strict';

jest.mock('../src/models', () => ({
  Producto:         { findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn(), count: jest.fn() },
  Categoria:        { findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  GrupoModificador: { findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  OpcionModificador:{ findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn(), bulkCreate: jest.fn(), update: jest.fn(), destroy: jest.fn() },
  Promocion:        { findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn(), findOne: jest.fn() },
  TipoDescuento:    { findByPk: jest.fn(), findAll: jest.fn() },
  Mesa:             { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  UbicacionMesa:    {},
  Empleado:         { findByPk: jest.fn() },
  SesionCliente:    { findAll: jest.fn() },
  Pedido:           { findAll: jest.fn() },
  DetallePedido:    {},
  SolicitudPago:    { findAll: jest.fn() },
  AlertaMesero:     { findAll: jest.fn() },
  MetodoPago:       {},
  EstadoSolicitud:  { findOne: jest.fn() },
  Auditoria:        { create: jest.fn() },
  ModalidadIngreso: {},
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
  Producto, Categoria, GrupoModificador, OpcionModificador,
  Promocion, TipoDescuento, Auditoria,
} = require('../src/models');

const SECRET       = process.env.JWT_SECRET;
const tokenGerente = jwt.sign({ id: 1, rol: 'gerente' }, SECRET);

function authPost(url, body) {
  return request(app).post(url).set('Authorization', `Bearer ${tokenGerente}`).send(body);
}
function authPut(url, body) {
  return request(app).put(url).set('Authorization', `Bearer ${tokenGerente}`).send(body);
}
function authDelete(url) {
  return request(app).delete(url).set('Authorization', `Bearer ${tokenGerente}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProducto(overrides = {}) {
  return {
    id: 1, nombre: 'MATCHA LATTE', precio: '65.00', disponible: true,
    update: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

function makeCategoria(overrides = {}) {
  return {
    id: 1, nombre: 'BEBIDAS', orden: 0,
    update: jest.fn().mockResolvedValue(),
    destroy: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

function makeGrupo(overrides = {}) {
  return {
    id: 1, nombre_grupo: 'TAMAÑO', tipo: 'única', es_obligatorio: false, max_selecciones: null, es_plantilla: false,
    setProductos: jest.fn().mockResolvedValue(),
    addProductos: jest.fn().mockResolvedValue(),
    getProductos: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(),
    destroy: jest.fn().mockResolvedValue(),
    productos: [],
    ...overrides,
  };
}

function makePromo(overrides = {}) {
  const base = {
    id: 1, titulo: 'PROMO TEST', fecha_inicio: new Date('2026-01-01'), fecha_fin: new Date('2026-12-31'),
    valor_descuento: 10, cantidad_minima: null, id_tipo_descuento: null, codigo_cupon: null,
    activa: true, diasSemana: '', requiere_todos_productos: false,
    update: jest.fn().mockResolvedValue(),
    destroy: jest.fn().mockResolvedValue(),
    setProductos_aplicables: jest.fn().mockResolvedValue(),
    setProductos_beneficiados: jest.fn().mockResolvedValue(),
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  Producto.findByPk.mockReset();
  Producto.findAll.mockReset();
  Producto.create.mockReset();
  Producto.count.mockReset();
  Categoria.findByPk.mockReset();
  Categoria.findAll.mockReset();
  Categoria.create.mockReset();
  GrupoModificador.findByPk.mockReset();
  GrupoModificador.findAll.mockReset();
  GrupoModificador.create.mockReset();
  OpcionModificador.bulkCreate.mockReset().mockResolvedValue([]);
  OpcionModificador.create.mockReset().mockResolvedValue({});
  OpcionModificador.update.mockReset().mockResolvedValue([1]);
  Promocion.findByPk.mockReset();
  Promocion.findAll.mockReset();
  Promocion.create.mockReset();
  Promocion.findOne.mockReset().mockResolvedValue(null);
  TipoDescuento.findByPk.mockReset();
  Auditoria.create.mockReset().mockResolvedValue({});
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('crear producto: nombre en UPPER y precio > 0', async () => {
  const prod = makeProducto({ nombre: 'MATCHA LATTE' });
  Producto.create.mockResolvedValue(prod);

  const res = await authPost('/api/gerente/productos', {
    nombre: 'matcha latte', precio: 65, id_categoria: 2,
  });

  expect(res.status).toBe(201);
  expect(res.body.ok).toBe(true);
  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({ accion: 'Producto creado' }));
});

test('crear producto con precio <= 0 → 400', async () => {
  const res = await authPost('/api/gerente/productos', { nombre: 'Test', precio: 0 });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/precio/i);
});

test('eliminar producto = SOFT-DELETE (disponible=false)', async () => {
  const prod = makeProducto();
  Producto.findByPk.mockResolvedValue(prod);

  const res = await authDelete('/api/gerente/productos/1');

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(prod.update).toHaveBeenCalledWith({ disponible: false });
  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({ accion: 'Producto deshabilitado' }));
});

test('eliminar categoría con productos → 400', async () => {
  Categoria.findByPk.mockResolvedValue(makeCategoria());
  Producto.count.mockResolvedValue(3);

  const res = await authDelete('/api/gerente/categorias/1');

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/producto/i);
});

test('crear grupo modificador + opciones inline + M2M', async () => {
  const grupo = makeGrupo();
  GrupoModificador.create.mockResolvedValue(grupo);

  const res = await authPost('/api/gerente/modificadores', {
    nombre_grupo: 'Tamaño',
    tipo: 'única',
    es_obligatorio: true,
    opciones: [
      { nombre_opcion: 'chico', precio_extra: 0 },
      { nombre_opcion: 'grande', precio_extra: 20 },
    ],
    productos: [1, 2],
  });

  expect(res.status).toBe(201);
  expect(res.body.ok).toBe(true);
  expect(res.body.grupo_id).toBe(1);
  expect(OpcionModificador.bulkCreate).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ nombre_opcion: 'CHICO', precio_extra: 0, activo: true }),
    expect.objectContaining({ nombre_opcion: 'GRANDE', precio_extra: 20, activo: true }),
  ]));
  expect(grupo.setProductos).toHaveBeenCalledWith([1, 2]);
  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({ accion: 'Modificador creado' }));
});

test('editar grupo: nueva opción se crea; opción con activo=false se SOFT-elimina', async () => {
  const grupo = makeGrupo({ id: 5 });
  GrupoModificador.findByPk.mockResolvedValue(grupo);

  const res = await authPut('/api/gerente/modificadores/5', {
    nombre_grupo: 'TAMAÑO',
    opciones: [
      { id: 10, nombre_opcion: 'CHICO', precio_extra: 0, activo: true },
      { id: 11, nombre_opcion: 'GRANDE', precio_extra: 20, activo: false },  // SOFT-DELETE
      { nombre_opcion: 'EXTRA GRANDE', precio_extra: 30 },                   // nueva
    ],
  });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  // Opción existente activo=false → SOFT-DELETE vía update
  expect(OpcionModificador.update).toHaveBeenCalledWith(
    expect.objectContaining({ activo: false }),
    expect.objectContaining({ where: { id: 11, id_grupo: 5 } })
  );
  // Nueva opción → create
  expect(OpcionModificador.create).toHaveBeenCalledWith(expect.objectContaining({ nombre_opcion: 'EXTRA GRANDE', id_grupo: 5 }));
  expect(Auditoria.create).toHaveBeenCalledWith(expect.objectContaining({ accion: 'Modificador actualizado' }));
});

test('promo Porcentaje con valor=150 → 400', async () => {
  TipoDescuento.findByPk.mockResolvedValue({ id: 1, descripcion: 'Porcentaje' });

  const res = await authPost('/api/gerente/promociones', {
    titulo: 'PROMO PORCEN',
    fecha_inicio: '2026-01-01',
    fecha_fin: '2026-12-31',
    id_tipo_descuento: 1,
    valor_descuento: 150,
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/porcentaje|100/i);
});

test('promo Lleva X paga Y con X=2, Y=1 → OK; con X=2, Y=2 → 400', async () => {
  TipoDescuento.findByPk.mockResolvedValue({ id: 2, descripcion: 'Lleva X paga Y' });
  Promocion.create.mockResolvedValue(makePromo({ id: 99 }));

  const resOk = await authPost('/api/gerente/promociones', {
    titulo: 'LLEVA 2 PAGA 1',
    fecha_inicio: '2026-01-01',
    fecha_fin: '2026-12-31',
    id_tipo_descuento: 2,
    cantidad_minima: 2,
    valor_descuento: 1,
  });
  expect(resOk.status).toBe(201);

  const resBad = await authPost('/api/gerente/promociones', {
    titulo: 'LLEVA 2 PAGA 2',
    fecha_inicio: '2026-01-01',
    fecha_fin: '2026-12-31',
    id_tipo_descuento: 2,
    cantidad_minima: 2,
    valor_descuento: 2,
  });
  expect(resBad.status).toBe(400);
  expect(resBad.body.error).toMatch(/menor/i);
});

test('promo con fecha_fin < fecha_inicio → 400', async () => {
  const res = await authPost('/api/gerente/promociones', {
    titulo: 'PROMO MAL FECHA',
    fecha_inicio: '2026-12-31',
    fecha_fin: '2026-01-01',
    valor_descuento: 10,
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/fecha/i);
});

test('Auditoria registrada en crear y eliminar producto', async () => {
  const prod = makeProducto();
  Producto.create.mockResolvedValue(prod);
  Producto.findByPk.mockResolvedValue(prod);

  await authPost('/api/gerente/productos', { nombre: 'TEST', precio: 50 });
  await authDelete('/api/gerente/productos/1');

  const acciones = Auditoria.create.mock.calls.map((c) => c[0].accion);
  expect(acciones).toContain('Producto creado');
  expect(acciones).toContain('Producto deshabilitado');
});
