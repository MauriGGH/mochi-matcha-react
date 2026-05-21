'use strict';

/**
 * Helpers de password con bcrypt (cost 10).
 * Pensado para reutilizar fuera del modelo Empleado (que tiene su propio
 * hook beforeCreate). Cost 10 = ~10 hashes/s, balance OK para POS.
 */
const bcrypt = require('bcryptjs');

/**
 * Hashea un password en texto plano.
 * @param {string} plain
 * @returns {Promise<string>} hash bcrypt
 */
async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

/**
 * Verifica un password contra su hash bcrypt.
 * @param {string} plain
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
