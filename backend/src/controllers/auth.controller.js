/**
 * Auth controller: login de staff y endpoint /me para consultar el payload JWT.
 * Emite JWT firmado con HS256 (JWT_SECRET) y expiración JWT_EXPIRES_IN.
 * Exporta: login, me.
 */
const jwt = require('jsonwebtoken');
const { Empleado } = require('../models');

// Roles válidos del staff. Rechaza login si el rol no está en esta lista
// (defensa adicional por si la BD tiene un rol legacy).
const VALID_ROLES = ['mesero', 'cocina', 'gerente', 'admin'];

/**
 * POST /api/auth/login
 * Público. Recibe { usuario, password }, valida activo/credenciales, emite JWT.
 * @returns { token, empleado: { id, nombre, rol } }
 *          401 si credenciales incorrectas, empleado inactivo o rol inválido.
 *          400 si faltan campos.
 */
exports.login = async (req, res, next) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const empleado = await Empleado.findOne({ where: { usuario } });

    if (!empleado || !empleado.activo || !empleado.is_active) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const valido = await empleado.verificarPassword(password);
    if (!valido) return res.status(401).json({ error: 'Credenciales incorrectas' });

    if (!VALID_ROLES.includes(empleado.rol)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      {
        id: empleado.id_empleado,          // compat: req.user.id usado en pedidos.controller
        id_empleado: empleado.id_empleado,
        usuario:  empleado.usuario,
        nombre:   empleado.nombre,
        rol:      empleado.rol,
        is_staff: empleado.is_staff,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      empleado: { id: empleado.id_empleado, nombre: empleado.nombre, rol: empleado.rol },
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/auth/me
 * Autorización: cualquier staff con JWT válido (middleware auth).
 * Devuelve el payload del JWT tal cual lo decodificó el middleware.
 * @returns el contenido de req.user (id, id_empleado, usuario, nombre, rol, is_staff)
 */
exports.me = (req, res) => res.json(req.user);
