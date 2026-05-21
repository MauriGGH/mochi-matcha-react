/**
 * Inicializa la app Express del backend de Mochi Matcha.
 * Monta middlewares globales (CORS, JSON, static media) y registra los
 * routers de cada feature bajo el prefijo /api/*. Cierra con un handler 404
 * y un handler de errores genérico.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes       = require('./routes/auth.routes');
const bienvenidaRoutes = require('./routes/bienvenida.routes');
const mesasRoutes    = require('./routes/mesas.routes');
const menuRoutes     = require('./routes/menu.routes');
const pedidosRoutes  = require('./routes/pedidos.routes');
const cocinaRoutes   = require('./routes/cocina.routes');
const gerenteRoutes  = require('./routes/gerente.routes');
const clienteRoutes  = require('./routes/cliente.routes');
const meseroRoutes   = require('./routes/mesero.routes');
const catalogoRoutes = require('./routes/catalogo.routes');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve product images (mirrors Django's /media/ path)
app.use('/media', express.static(path.join(__dirname, '../public/media')));

app.use('/api/auth',        authRoutes);
app.use('/api/bienvenida', bienvenidaRoutes);
app.use('/api/mesas',    mesasRoutes);
app.use('/api/menu',     menuRoutes);
app.use('/api/pedidos',  pedidosRoutes);
app.use('/api/cocina',   cocinaRoutes);
app.use('/api/gerente',  gerenteRoutes);
app.use('/api/cliente',  clienteRoutes);
app.use('/api/mesero',   meseroRoutes);
app.use('/api/catalogo', catalogoRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
