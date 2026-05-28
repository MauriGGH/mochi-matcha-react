/**
 * Middleware de autorización por rol.
 * Se aplica DESPUÉS de auth.js (que poblá req.user). Si el rol del usuario
 * no está en la whitelist responde 403. Expone shortcuts para los roles
 * comunes de la app (mesero/cocina/gerente, todos incluyen admin).
 */

/**
 * Crea un middleware que sólo permite pasar a los roles indicados.
 * @param {...string} roles roles permitidos (ej. 'gerente', 'admin')
 * @returns {import('express').RequestHandler}
 */
// authorize(…roles): verifica req.user.rol (requiere auth.js antes en la cadena)
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  if (!roles.includes(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  next();
};

const requireRol     = authorize;
const requireMesero  = authorize('mesero', 'gerente', 'admin');
const requireCocina  = authorize('cocina', 'gerente', 'admin');
const requireGerente = authorize('gerente', 'admin');

module.exports = Object.assign(authorize, { requireRol, requireMesero, requireCocina, requireGerente });
