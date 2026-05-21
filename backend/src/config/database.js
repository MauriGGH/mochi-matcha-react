/**
 * Configuración de la conexión Sequelize (MySQL).
 * Lee credenciales de env (DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT).
 * `define.timestamps: false` y `underscored: false` aplican por defecto a
 * todos los modelos (espejo del proyecto Django original que no usa
 * created_at/updated_at automáticos).
 */
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    define: {
      timestamps: false,
      underscored: false,
    },
  }
);

module.exports = sequelize;
