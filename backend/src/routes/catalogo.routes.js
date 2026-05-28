/**
 * Routes de catálogo público (sin auth). Datos de referencia que cliente y
 * staff consumen libremente (métodos de pago, etc).
 *
 * Endpoints:
 *   GET /api/catalogo/metodos-pago    → lista MetodoPago (público, ordenado por id)
 */
const router = require('express').Router();
const { MetodoPago } = require('../models');

// GET /api/catalogo/metodos-pago  → lista de métodos de pago (público)
router.get('/metodos-pago', async (req, res, next) => {
  try {
    res.json(await MetodoPago.findAll({ order: [['id', 'ASC']] }));
  } catch (err) { next(err); }
});

module.exports = router;
