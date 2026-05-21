/**
 * Seed completo — espejo exacto de los datos del proyecto Django Mochi Matcha.
 * Pobla catálogos (modalidades, métodos de pago, estados, tipos de descuento),
 * empleados, ubicaciones, mesas con QR, categorías, productos, grupos de
 * modificadores con opciones y promociones de ejemplo. Usa findOrCreate
 * en todos lados para ser idempotente (se puede correr varias veces).
 *
 * Con `--historico` o SEED_HISTORICO=1 además genera 30 días de pedidos
 * cerrados para que los reportes tengan datos. Limpia el histórico previo
 * pero mantiene el catálogo.
 *
 * Ejecutar: docker compose exec backend node src/seed.js
 * O localmente: node src/seed.js (requiere .env en la raíz del proyecto)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const {
  sequelize,
  ModalidadIngreso, MetodoPago, EstadoSolicitud, TipoDescuento,
  Empleado, UbicacionMesa, Mesa,
  Categoria, Producto, GrupoModificador, OpcionModificador, Promocion,
} = require('./models');

async function seed() {
  await sequelize.sync();
  console.log('── Catálogos ──────────────────────────────────────');

  // ── Modalidades de ingreso ──────────────────────────────────────────────────
  const [qr]       = await ModalidadIngreso.findOrCreate({ where: { descripcion: 'QR' } });
  const [asistido] = await ModalidadIngreso.findOrCreate({ where: { descripcion: 'asistido' } });
  console.log('  Modalidades:', qr.id, asistido.id);

  // ── Métodos de pago (igual que Django: PayPal, Efectivo, Tarjeta, Mixto) ────
  const [paypal]  = await MetodoPago.findOrCreate({ where: { descripcion: 'PayPal' } });
  const [efectivo]= await MetodoPago.findOrCreate({ where: { descripcion: 'Efectivo' } });
  const [tarjeta] = await MetodoPago.findOrCreate({ where: { descripcion: 'Tarjeta' } });
  const [mixto]   = await MetodoPago.findOrCreate({ where: { descripcion: 'Mixto' } });
  console.log('  Métodos de pago:', paypal.id, efectivo.id, tarjeta.id, mixto.id);

  // ── Estados de solicitud ────────────────────────────────────────────────────
  await EstadoSolicitud.findOrCreate({ where: { descripcion: 'pendiente' } });
  await EstadoSolicitud.findOrCreate({ where: { descripcion: 'procesada' } });
  await EstadoSolicitud.findOrCreate({ where: { descripcion: 'cancelada' } });
  console.log('  Estados de solicitud OK');

  // ── Tipos de descuento ──────────────────────────────────────────────────────
  const [tdPorcentaje]    = await TipoDescuento.findOrCreate({ where: { descripcion: 'Porcentaje' } });
  const [tdMontoFijo]     = await TipoDescuento.findOrCreate({ where: { descripcion: 'Monto fijo' } });
  const [td2x1]           = await TipoDescuento.findOrCreate({ where: { descripcion: '2x1' } });
  const [tdComboPrecio]   = await TipoDescuento.findOrCreate({ where: { descripcion: 'Combo precio fijo' } });
  const [tdLlevaXPagaY]  = await TipoDescuento.findOrCreate({ where: { descripcion: 'Lleva X paga Y' } });
  console.log('  Tipos de descuento OK');

  // ── Empleados ────────────────────────────────────────────────────────────────
  console.log('\n── Empleados ──────────────────────────────────────');
  const empleados = [
    { usuario: 'admin',    nombre: 'ADMINISTRADOR',  rol: 'admin',   password: 'admin123',   activo: true, is_active: true, is_staff: true  },
    { usuario: 'maria',    nombre: 'MARÍA LÓPEZ',    rol: 'mesero',  password: 'mesero123',  activo: true, is_active: true, is_staff: false },
    { usuario: 'carlos',   nombre: 'CARLOS RUIZ',    rol: 'mesero',  password: 'mesero123',  activo: true, is_active: true, is_staff: false },
    { usuario: 'lucia',    nombre: 'LUCÍA MENDOZA',  rol: 'cocina',  password: 'cocina123',  activo: true, is_active: true, is_staff: false },
    { usuario: 'roberto',  nombre: 'ROBERTO SOTO',   rol: 'cocina',  password: 'cocina123',  activo: true, is_active: true, is_staff: false },
    { usuario: 'gerente1', nombre: 'ANA MARTÍNEZ',   rol: 'gerente', password: 'gerente123', activo: true, is_active: true, is_staff: false },
  ];
  for (const e of empleados) {
    const [emp, created] = await Empleado.findOrCreate({ where: { usuario: e.usuario }, defaults: e });
    console.log(`  ${created ? 'Creado' : 'Existe'}: ${e.usuario} (${e.rol})`);
  }

  // ── Ubicaciones y mesas ──────────────────────────────────────────────────────
  console.log('\n── Ubicaciones y Mesas ─────────────────────────────');
  const [terraza]   = await UbicacionMesa.findOrCreate({ where: { nombre: 'TERRAZA' } });
  const [interior]  = await UbicacionMesa.findOrCreate({ where: { nombre: 'INTERIOR' } });
  const [barra]     = await UbicacionMesa.findOrCreate({ where: { nombre: 'BARRA' } });
  const [salon]     = await UbicacionMesa.findOrCreate({ where: { nombre: 'SALÓN PRIVADO' } });
  console.log('  Ubicaciones: TERRAZA, INTERIOR, BARRA, SALÓN PRIVADO');

  const mesasData = [
    { numero_mesa: 1, capacidad: 4, id_ubicacion: terraza.id,  codigo_qr: 'QR-MESA-001' },
    { numero_mesa: 2, capacidad: 2, id_ubicacion: terraza.id,  codigo_qr: 'QR-MESA-002' },
    { numero_mesa: 3, capacidad: 6, id_ubicacion: interior.id, codigo_qr: 'QR-MESA-003' },
    { numero_mesa: 4, capacidad: 4, id_ubicacion: interior.id, codigo_qr: 'QR-MESA-004' },
    { numero_mesa: 5, capacidad: 2, id_ubicacion: barra.id,    codigo_qr: 'QR-MESA-005' },
    { numero_mesa: 6, capacidad: 4, id_ubicacion: barra.id,    codigo_qr: 'QR-MESA-006' },
    { numero_mesa: 7, capacidad: 8, id_ubicacion: salon.id,    codigo_qr: 'QR-MESA-007' },
    { numero_mesa: 8, capacidad: 4, id_ubicacion: interior.id, codigo_qr: 'QR-MESA-008' },
  ];
  for (const m of mesasData) {
    const [mesa, created] = await Mesa.findOrCreate({
      where: { numero_mesa: m.numero_mesa },
      defaults: { ...m, estado: 'libre' },
    });
    if (!mesa.codigo_qr) await mesa.update({ codigo_qr: m.codigo_qr });
    console.log(`  Mesa ${m.numero_mesa}: QR=${m.codigo_qr} [${created ? 'nueva' : 'existe'}]`);
  }

  // ── Categorías ───────────────────────────────────────────────────────────────
  console.log('\n── Categorías ──────────────────────────────────────');
  const [catMatcha]    = await Categoria.findOrCreate({ where: { nombre: 'MATCHA' },    defaults: { orden: 1, area: 'bar' } });
  const [catCafe]      = await Categoria.findOrCreate({ where: { nombre: 'CAFÉ' },      defaults: { orden: 2, area: 'bar' } });
  const [catMochi]     = await Categoria.findOrCreate({ where: { nombre: 'MOCHI' },     defaults: { orden: 3, area: 'cocina' } });
  const [catPostres]   = await Categoria.findOrCreate({ where: { nombre: 'POSTRES' },   defaults: { orden: 4, area: 'cocina' } });
  const [catSnacks]    = await Categoria.findOrCreate({ where: { nombre: 'SNACKS' },    defaults: { orden: 5, area: 'cocina' } });
  const [catEspeciales]= await Categoria.findOrCreate({ where: { nombre: 'ESPECIALES'},  defaults: { orden: 6, area: 'ambos' } });
  console.log('  6 categorías OK');

  // ── Productos ────────────────────────────────────────────────────────────────
  console.log('\n── Productos ───────────────────────────────────────');
  const productosData = [
    // MATCHA
    { nombre: 'MATCHA LATTE',    descripcion: 'MATCHA CEREMONIAL CON LECHE DE AVENA',    precio: 65,  id_categoria: catMatcha.id,     imagen_url: '/media/images/matchalatte.jpg',         disponible: true },
    { nombre: 'MATCHA FRÍO',     descripcion: 'MATCHA CON LECHE FRÍA Y HIELO',           precio: 70,  id_categoria: catMatcha.id,     imagen_url: '/media/images/matchafrio.png',           disponible: true },
    { nombre: 'MATCHA PURO',     descripcion: 'MATCHA CEREMONIAL SIN AZÚCAR',            precio: 55,  id_categoria: catMatcha.id,     imagen_url: '/media/images/matchaceremonial.png',     disponible: true },
    { nombre: 'HOCHICHA',        descripcion: 'TÉ TOSTADO JAPONÉS CON LECHE',            precio: 60,  id_categoria: catMatcha.id,     imagen_url: '/media/images/hochija.png',              disponible: true },
    // CAFÉ
    { nombre: 'CAFÉ AMERICANO',  descripcion: 'ESPRESSO DOBLE CON AGUA CALIENTE',        precio: 45,  id_categoria: catCafe.id,       imagen_url: '/media/images/americano.png',            disponible: true },
    { nombre: 'CAPPUCCINO',      descripcion: 'ESPRESSO CON LECHE VAPORIZADA',           precio: 55,  id_categoria: catCafe.id,       imagen_url: '/media/images/capuccinoexpresso.png',    disponible: true },
    { nombre: 'LATTE DE VAINILLA',descripcion: 'ESPRESSO, LECHE Y VAINILLA NATURAL',    precio: 60,  id_categoria: catCafe.id,       imagen_url: '/media/images/latevainilla.jpeg',         disponible: true },
    { nombre: 'COLD BREW',       descripcion: 'CAFÉ EN FRÍO 12 HORAS',                  precio: 65,  id_categoria: catCafe.id,       imagen_url: '/media/images/coldbrew.png',              disponible: true },
    // MOCHI
    { nombre: 'MOCHI DE FRESA',  descripcion: 'MOCHI RELLENO DE HELADO DE FRESA',       precio: 45,  id_categoria: catMochi.id,      imagen_url: '/media/images/mochifresa.jpeg',           disponible: true },
    { nombre: 'MOCHI DE MATCHA', descripcion: 'MOCHI RELLENO DE CREMA DE MATCHA',       precio: 45,  id_categoria: catMochi.id,      imagen_url: '/media/images/mochimatcha.jpeg',          disponible: true },
    { nombre: 'MOCHI DE MANGO',  descripcion: 'MOCHI RELLENO DE HELADO DE MANGO',       precio: 45,  id_categoria: catMochi.id,      imagen_url: '/media/images/mochi-helado-de-mango.jpg', disponible: true },
    { nombre: 'MOCHI TRIO',      descripcion: '3 MOCHIS A ELECCIÓN',                    precio: 120, id_categoria: catMochi.id,      imagen_url: '/media/images/3mochi.jpeg',               disponible: true },
    // POSTRES
    { nombre: 'BROWNIE',         descripcion: 'BROWNIE DE CHOCOLATE BELGA CON NUEZ',    precio: 50,  id_categoria: catPostres.id,    imagen_url: '/media/images/brownie.jpg',               disponible: true },
    { nombre: 'CHOCOLATE ABUELITA',descripcion:'CHOCOLATE ESPESO ESTILO TRADICIONAL',   precio: 55,  id_categoria: catPostres.id,    imagen_url: '/media/images/chocolateabuelita.jpeg',   disponible: true },
    { nombre: 'WAFFLE JAPONÉS',  descripcion: 'WAFFLE ESTILO MOCHI CON FRUTOS ROJOS',   precio: 80,  id_categoria: catPostres.id,    imagen_url: '/media/images/wafflejapones.jpg',         disponible: true },
    { nombre: 'PAY DE MATCHA',   descripcion: 'PAY HORNEADO CON MATCHA PREMIUM',        precio: 75,  id_categoria: catPostres.id,    imagen_url: '/media/images/pay matcha.png',            disponible: true },
    // SNACKS
    { nombre: 'EDAMAME',         descripcion: 'EDAMAME AL VAPOR CON SAL DE MAR',        precio: 40,  id_categoria: catSnacks.id,     imagen_url: '/media/images/onigiri.jpeg',              disponible: true },
    { nombre: 'ONIGIRI ATÚN',    descripcion: 'ARROZ JAPONÉS RELLENO DE ATÚN',          precio: 55,  id_categoria: catSnacks.id,     imagen_url: '/media/images/onigiri.jpeg',              disponible: true },
    // ESPECIALES
    { nombre: 'COMBO MATCHA+MOCHI',descripcion:'MATCHA LATTE + MOCHI A ELECCIÓN',       precio: 100, id_categoria: catEspeciales.id, imagen_url: '/media/images/mochimatcha.jpeg',          disponible: true },
  ];

  const productoMap = {};
  for (const p of productosData) {
    const [prod, created] = await Producto.findOrCreate({
      where: { nombre: p.nombre },
      defaults: p,
    });
    if (!created && prod.imagen_url !== p.imagen_url) {
      await prod.update({ imagen_url: p.imagen_url, descripcion: p.descripcion, precio: p.precio });
    }
    productoMap[p.nombre] = prod;
    console.log(`  ${created ? '✓' : '~'} ${p.nombre} ($${p.precio})`);
  }

  // ── Grupos de modificadores ──────────────────────────────────────────────────
  console.log('\n── Grupos de Modificadores ─────────────────────────');

  // Grupo 1: TAMAÑO (obligatorio, única selección)
  const [grpTamano, tCreated] = await GrupoModificador.findOrCreate({
    where: { nombre_grupo: 'TAMAÑO' },
    defaults: { tipo: 'única', es_obligatorio: true },
  });
  if (tCreated) {
    await OpcionModificador.bulkCreate([
      { id_grupo: grpTamano.id, nombre_opcion: 'CHICO (250ML)',  precio_extra: 0 },
      { id_grupo: grpTamano.id, nombre_opcion: 'MEDIANO (350ML)',precio_extra: 10 },
      { id_grupo: grpTamano.id, nombre_opcion: 'GRANDE (450ML)', precio_extra: 20 },
    ]);
  }
  console.log(`  ${tCreated ? 'Creado' : 'Existe'}: TAMAÑO`);

  // Grupo 2: TIPO DE LECHE (opcional, única selección)
  const [grpLeche, lCreated] = await GrupoModificador.findOrCreate({
    where: { nombre_grupo: 'TIPO DE LECHE' },
    defaults: { tipo: 'única', es_obligatorio: false },
  });
  if (lCreated) {
    await OpcionModificador.bulkCreate([
      { id_grupo: grpLeche.id, nombre_opcion: 'ENTERA',       precio_extra: 0 },
      { id_grupo: grpLeche.id, nombre_opcion: 'AVENA',        precio_extra: 10 },
      { id_grupo: grpLeche.id, nombre_opcion: 'ALMENDRA',     precio_extra: 10 },
      { id_grupo: grpLeche.id, nombre_opcion: 'DESLACTOSADA', precio_extra: 0 },
    ]);
  }
  console.log(`  ${lCreated ? 'Creado' : 'Existe'}: TIPO DE LECHE`);

  // Grupo 3: TEMPERATURA (obligatorio, única selección)
  const [grpTemp, tempCreated] = await GrupoModificador.findOrCreate({
    where: { nombre_grupo: 'TEMPERATURA' },
    defaults: { tipo: 'única', es_obligatorio: true },
  });
  if (tempCreated) {
    await OpcionModificador.bulkCreate([
      { id_grupo: grpTemp.id, nombre_opcion: 'CALIENTE', precio_extra: 0 },
      { id_grupo: grpTemp.id, nombre_opcion: 'FRÍO',     precio_extra: 0 },
    ]);
  }
  console.log(`  ${tempCreated ? 'Creado' : 'Existe'}: TEMPERATURA`);

  // Asociar grupos a productos (igual que Django)
  // TAMAÑO → todas las bebidas (matcha + café)
  const productosConTamano = [
    'MATCHA LATTE', 'MATCHA FRÍO', 'MATCHA PURO', 'HOCHICHA',
    'CAFÉ AMERICANO', 'CAPPUCCINO', 'LATTE DE VAINILLA', 'COLD BREW',
  ];
  await grpTamano.setProductos(
    productosConTamano.map(n => productoMap[n]).filter(Boolean)
  );

  // TIPO DE LECHE → matchas y cafés con leche
  const productosConLeche = [
    'MATCHA LATTE', 'MATCHA FRÍO', 'HOCHICHA',
    'CAPPUCCINO', 'LATTE DE VAINILLA',
  ];
  await grpLeche.setProductos(
    productosConLeche.map(n => productoMap[n]).filter(Boolean)
  );

  // TEMPERATURA → bebidas que pueden servirse frío o caliente
  const productosConTemp = [
    'MATCHA LATTE', 'MATCHA FRÍO', 'HOCHICHA',
    'CAPPUCCINO', 'LATTE DE VAINILLA',
  ];
  await grpTemp.setProductos(
    productosConTemp.map(n => productoMap[n]).filter(Boolean)
  );
  console.log('  Asociaciones de modificadores OK');

  // ── Promociones ──────────────────────────────────────────────────────────────
  console.log('\n── Promociones ─────────────────────────────────────');
  const fechaInicio = new Date('2025-04-11');
  const fechaFin    = new Date('2027-05-16');

  const promoData = [
    {
      titulo: 'MATCHA LOVER 10%',
      descripcion_corta: '10% DE DESCUENTO EN MATCHAS',
      id_tipo_descuento: tdPorcentaje.id,
      valor_descuento: 10.00,
      aplicacion: 'item',
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      activa: true,
      imagen_url: null,
      dias_semana: '',
      orden: 1,
      productos: ['MATCHA LATTE', 'MATCHA FRÍO', 'MATCHA PURO', 'HOCHICHA'],
    },
    {
      titulo: '2×1 EN MOCHIS',
      descripcion_corta: 'COMPRA 2 MOCHIS Y PAGA 1',
      id_tipo_descuento: td2x1.id,
      valor_descuento: 0.00,
      aplicacion: 'item',
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      activa: true,
      imagen_url: null,
      dias_semana: '',
      orden: 2,
      productos: ['MOCHI DE FRESA', 'MOCHI DE MATCHA', 'MOCHI DE MANGO', 'MOCHI TRIO'],
    },
    {
      titulo: 'COMBO MATCHA+POSTRE 15%',
      descripcion_corta: 'MATCHA + POSTRE CON 15% DESCUENTO',
      id_tipo_descuento: tdPorcentaje.id,
      valor_descuento: 15.00,
      aplicacion: 'item',
      fecha_inicio: new Date('2025-04-11T07:47:00'),
      fecha_fin: fechaFin,
      activa: true,
      imagen_url: '/media/images/bc35d6a90bdf.jpg',
      dias_semana: '',
      orden: 3,
      productos: ['MATCHA LATTE', 'BROWNIE', 'WAFFLE JAPONÉS', 'PAY DE MATCHA'],
    },
    {
      titulo: 'DESCUENTO CAFÉ 20%',
      descripcion_corta: '20% OFF EN CAFÉS PREMIUM',
      id_tipo_descuento: tdPorcentaje.id,
      valor_descuento: 20.00,
      aplicacion: 'item',
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      activa: true,
      imagen_url: null,
      dias_semana: '',
      orden: 4,
      productos: ['CAFÉ AMERICANO', 'CAPPUCCINO', 'LATTE DE VAINILLA', 'COLD BREW'],
    },
  ];

  for (const pd of promoData) {
    const { productos: prodsNombres, ...promoFields } = pd;
    const [promo, pCreated] = await Promocion.findOrCreate({
      where: { titulo: pd.titulo },
      defaults: promoFields,
    });
    if (!pCreated) {
      await promo.update(promoFields);
    }
    // Asociar productos aplicables
    const prodsIds = prodsNombres.map(n => productoMap[n]).filter(Boolean);
    await promo.setProductos_aplicables(prodsIds);
    console.log(`  ${pCreated ? '✓' : '~'} ${pd.titulo}`);
  }

  // ── Histórico de pedidos (últimos 30 días) ─────────────────────────────────
  // Pobla la BD con pedidos cerrados realistas para que los reportes tengan datos.
  // Toda la actividad queda en estado terminal (entregado/cancelado) con fechas coherentes,
  // por lo que ninguna mesa queda ocupada ni hay pedidos vivos en el KDS tras el seed.
  if (process.argv.includes('--historico') || process.env.SEED_HISTORICO === '1') {
    console.log('\n── Generando histórico de pedidos (últimos 30 días) ──');

    const { Pedido, DetallePedido, DetalleModificador, SesionCliente, SolicitudPago, AlertaMesero } = require('./models');
    const { v4: uuidv4 } = require('uuid');

    // Limpia histórico previo (mantiene catálogo)
    await SolicitudPago.destroy({ where: {} });
    await DetalleModificador.destroy({ where: {} });
    await DetallePedido.destroy({ where: {} });
    await Pedido.destroy({ where: {} });
    await AlertaMesero.destroy({ where: {} });
    await SesionCliente.destroy({ where: {} });
    await Mesa.update({ estado: 'libre', pin_actual: null, nota_cierre: '' }, { where: {} });
    console.log('  Histórico previo eliminado');

    const empleadosArr = await require('./models').Empleado.findAll({ where: { rol: 'mesero', activo: true } });
    const productosArr = await require('./models').Producto.findAll();
    const mesasArr = await Mesa.findAll();
    const estPend = await require('./models').EstadoSolicitud.findOne({ where: { descripcion: 'pendiente' } });
    const estProc = await require('./models').EstadoSolicitud.findOne({ where: { descripcion: 'procesada' } });
    const modQR = await require('./models').ModalidadIngreso.findOne({ where: { descripcion: 'QR' } });
    const metEfe = await require('./models').MetodoPago.findOne({ where: { descripcion: 'Efectivo' } });
    const metTar = await require('./models').MetodoPago.findOne({ where: { descripcion: 'Tarjeta' } });
    const metMix = await require('./models').MetodoPago.findOne({ where: { descripcion: 'Mixto' } });

    const ALIAS = ['SOFÍA', 'DIEGO', 'VALERIA', 'MATEO', 'EMILIO', 'LUNA', 'JOAQUÍN', 'RENATA', 'GAEL', 'CAMILA',
                   'IKER', 'NAOMI', 'LUKA', 'ZOE', 'MAX', 'MÍA', 'ANA', 'CARLOS', 'MIGUEL', 'DANIELA'];
    const NOTAS = ['SIN AZÚCAR', 'EXTRA CALIENTE', 'SIN HIELO', 'POCO AZÚCAR', 'SIN LACTOSA'];
    const MOTIVOS = ['CLIENTE CANCELÓ', 'PRODUCTO AGOTADO', 'ERROR EN LA COMANDA'];
    const METODOS = [{ obj: metEfe, peso: 0.55 }, { obj: metTar, peso: 0.35 }, { obj: metMix, peso: 0.10 }];

    const rnd = (a, b) => a + Math.random() * (b - a);
    const rndi = (a, b) => Math.floor(rnd(a, b + 1));
    const sample = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const sampleN = (arr, n) => {
      const copy = [...arr]; const out = [];
      for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
      return out;
    };
    const pickMetodo = () => {
      const r = Math.random(); let acc = 0;
      for (const m of METODOS) { acc += m.peso; if (r < acc) return m.obj; }
      return metEfe;
    };

    const hoy = new Date();
    const totalDias = 30;
    let pedidosCreados = 0;
    let ventasTotales = 0;

    for (let d = 0; d < totalDias; d++) {
      const dia = new Date(hoy);
      dia.setDate(hoy.getDate() - d);
      const esFinde = dia.getDay() === 0 || dia.getDay() === 5 || dia.getDay() === 6;
      const numPedidos = esFinde ? rndi(8, 16) : rndi(4, 10);

      for (let i = 0; i < numPedidos; i++) {
        const fecha = new Date(dia);
        fecha.setHours(rndi(8, 21), rndi(0, 59), rndi(0, 59));
        if (fecha > hoy) continue; // no en el futuro

        const cancelado = Math.random() < 0.06;
        const estadoPedido = cancelado ? 'cancelado' : 'entregado';
        const mesa = sample(mesasArr);
        const mesero = empleadosArr.length ? sample(empleadosArr) : null;

        const sesion = await SesionCliente.create({
          alias: sample(ALIAS),
          token_cookie: uuidv4(),
          id_mesa: mesa.id,
          id_modalidad: modQR.id,
          fecha_inicio: fecha,
          estado: cancelado ? 'cerrada' : 'pagada',
        });

        const pedido = await Pedido.create({
          id_sesion: sesion.id,
          id_modalidad: modQR.id,
          id_empleado_entrega: mesero?.id_empleado || null,
          estado: estadoPedido,
          fecha_hora_ingreso: fecha,
          fecha_hora_entrega: !cancelado ? new Date(fecha.getTime() + rndi(4, 22) * 60000) : null,
          motivo_cancelacion: cancelado ? sample(MOTIVOS) : '',
        });

        const items = sampleN(productosArr, rndi(1, 4));
        let totalPedido = 0;
        for (const prod of items) {
          const cant = rndi(1, 3);
          const subtotal = parseFloat(prod.precio) * cant;
          totalPedido += subtotal;
          await DetallePedido.create({
            id_pedido: pedido.id,
            id_producto: prod.id,
            cantidad: cant,
            subtotal_calculado: subtotal,
            notas: Math.random() < 0.22 ? sample(NOTAS) : '',
            listo: !cancelado,
            fecha_listo: !cancelado ? new Date(fecha.getTime() + rndi(2, 18) * 60000) : null,
          });
        }

        if (!cancelado) {
          const metodo = pickMetodo();
          const propina = parseFloat((totalPedido * 0.10).toFixed(2));
          await SolicitudPago.create({
            id_sesion: sesion.id,
            id_mesa: mesa.id,
            tipo: 'individual',
            total_individual: totalPedido,
            total_mesa: totalPedido,
            propina_sugerida: propina,
            id_metodo_pago: metodo?.id,
            id_estado_solicitud: estProc?.id,
            detalle_pago: metodo?.descripcion?.toUpperCase() || 'EFECTIVO',
            fecha_hora: new Date(fecha.getTime() + rndi(10, 30) * 60000),
            monto_recibido: metodo === metEfe ? totalPedido + sample([0, 5, 10, 20]) : null,
          });
          ventasTotales += totalPedido;
        }
        pedidosCreados++;
      }
      if (d % 5 === 0) console.log(`  Día -${d}: ${pedidosCreados} pedidos acumulados`);
    }

    // Cerrar todas las mesas tras el seed (todo queda en estado terminal)
    await Mesa.update({ estado: 'libre', pin_actual: null, nota_cierre: '' }, { where: {} });
    console.log(`  ✓ ${pedidosCreados} pedidos generados · $${ventasTotales.toFixed(2)} ventas históricas`);
  }

  console.log('\n✅ Seed completado exitosamente.');
  console.log('\nResumen:');
  console.log('  • 6 empleados (admin, 2 meseros, 2 cocina, 1 gerente)');
  console.log('  • 8 mesas con códigos QR (QR-MESA-001 … QR-MESA-008)');
  console.log('  • 4 ubicaciones (TERRAZA, INTERIOR, BARRA, SALÓN PRIVADO)');
  console.log('  • 19 productos en 6 categorías');
  console.log('  • 3 grupos de modificadores con opciones');
  console.log('  • 4 promociones activas');
  console.log('  • 4 métodos de pago (PayPal, Efectivo, Tarjeta, Mixto)');
  console.log('  • Para histórico de 30 días: node src/seed.js --historico');
  console.log('\nQR para pruebas:');
  console.log('  http://localhost:5173/bienvenida/QR-MESA-001  → Mesa 1 (TERRAZA)');
  console.log('  http://localhost:5173/bienvenida/QR-MESA-003  → Mesa 3 (INTERIOR)');

  await sequelize.close();
}

seed().catch((e) => {
  console.error('❌ Error en seed:', e.message);
  console.error(e);
  process.exit(1);
});
