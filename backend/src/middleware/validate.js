/**
 * Middleware ligero de validación.
 * Espejo del comportamiento de validators de Django.
 *
 * Uso:
 *   router.post('/x', validate({ body: { campo: 'required|string:1,100' } }), ctrl);
 *
 * Reglas soportadas (separadas por |):
 *   required           — campo obligatorio (no null/undefined/'')
 *   string             — string
 *   string:min,max     — string con longitud
 *   int                — entero
 *   int:min,max        — entero en rango
 *   number             — número
 *   number:min,max     — número en rango
 *   bool               — boolean
 *   email              — email válido
 *   enum:a,b,c         — valor dentro de la lista
 *   array              — array
 *   array:min,max      — array con tamaño
 */

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Aplica una sola regla "name[:args]" sobre un valor.
 * @param {*} value valor del campo
 * @param {string} rule expresión, ej. 'string:1,100' o 'enum:a,b'
 * @returns {string|null} mensaje de error o null si pasa
 */
function checkRule(value, rule) {
  const [name, params = ''] = rule.split(':');
  const args = params.split(',').filter(Boolean);

  if (name === 'required') {
    if (value === undefined || value === null || value === '') return 'es obligatorio';
    return null;
  }
  if (value === undefined || value === null || value === '') return null; // resto solo si hay valor

  switch (name) {
    case 'string':
      if (typeof value !== 'string') return 'debe ser texto';
      if (args.length === 2) {
        const [min, max] = args.map((x) => parseInt(x, 10));
        if (value.length < min) return `mínimo ${min} caracteres`;
        if (value.length > max) return `máximo ${max} caracteres`;
      }
      return null;
    case 'int': {
      const n = parseInt(value, 10);
      if (isNaN(n) || String(n) !== String(value).trim()) return 'debe ser entero';
      if (args.length === 2) {
        const [min, max] = args.map((x) => parseInt(x, 10));
        if (n < min) return `mínimo ${min}`;
        if (n > max) return `máximo ${max}`;
      }
      return null;
    }
    case 'number': {
      const n = parseFloat(value);
      if (isNaN(n)) return 'debe ser número';
      if (args.length === 2) {
        const [min, max] = args.map((x) => parseFloat(x));
        if (n < min) return `mínimo ${min}`;
        if (n > max) return `máximo ${max}`;
      }
      return null;
    }
    case 'bool':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false' && value !== 1 && value !== 0) {
        return 'debe ser true/false';
      }
      return null;
    case 'email':
      if (!EMAIL_RE.test(String(value))) return 'email inválido';
      return null;
    case 'enum':
      if (!args.includes(String(value))) return `debe ser uno de: ${args.join(', ')}`;
      return null;
    case 'array':
      if (!Array.isArray(value)) return 'debe ser array';
      if (args.length === 2) {
        const [min, max] = args.map((x) => parseInt(x, 10));
        if (value.length < min) return `mínimo ${min} elementos`;
        if (value.length > max) return `máximo ${max} elementos`;
      }
      return null;
    default:
      return null;
  }
}

/**
 * Valida un objeto (típicamente req.body/query/params) contra un mapa
 * { campo: 'regla1|regla2' }. Devuelve { 'prefix.campo': msg } con el
 * primer error encontrado por campo. Vacío = todo OK.
 * @param {object} obj
 * @param {Record<string,string>} schema
 * @param {string} [prefix]
 * @returns {Record<string,string>}
 */
function validateObject(obj, schema, prefix = '') {
  const errors = {};
  for (const [field, rules] of Object.entries(schema)) {
    const value = obj?.[field];
    const ruleList = rules.split('|');
    for (const rule of ruleList) {
      const err = checkRule(value, rule.trim());
      if (err) {
        errors[prefix + field] = err;
        break; // solo el primer error por campo
      }
    }
  }
  return errors;
}

/**
 * Factory de middleware: dado un mapa `{ body?, query?, params? }` con
 * schemas, devuelve un middleware Express que valida los tres y, si
 * hay errores, responde 400 con `{ error, details }`. Si pasa, llama next().
 * @param {{body?:object, query?:object, params?:object}} schemas
 * @returns {import('express').RequestHandler}
 */
function validate(schemas) {
  return (req, res, next) => {
    let errors = {};
    if (schemas.body)   errors = { ...errors, ...validateObject(req.body, schemas.body, 'body.') };
    if (schemas.query)  errors = { ...errors, ...validateObject(req.query, schemas.query, 'query.') };
    if (schemas.params) errors = { ...errors, ...validateObject(req.params, schemas.params, 'params.') };

    if (Object.keys(errors).length) {
      return res.status(400).json({
        error: 'Validación falló',
        details: errors,
      });
    }
    next();
  };
}

module.exports = validate;
