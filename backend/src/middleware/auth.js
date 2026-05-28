/**
 * Middleware de autenticación JWT para staff (mesero/cocina/gerente/admin).
 * Lee el header `Authorization: Bearer <token>`, verifica con JWT_SECRET
 * y adjunta el payload decodificado en `req.user`. Si no hay token o es
 * inválido responde 401. NO autentica clientes (esos usan mmSession).
 */
const jwt = require('jsonwebtoken');

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
