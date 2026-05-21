/**
 * Punto de entrada del backend.
 * Conecta a MySQL via Sequelize, sincroniza el schema con alter:true
 * y arranca
 * el servidor HTTP de Express en process.env.PORT (default 3001).
 */
require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./models');

const PORT = process.env.PORT || 3001;

sequelize.authenticate()
  .then(() => {
    console.log('Conexión a la base de datos establecida.');
    // alter:true en dev para que las nuevas columnas/tablas se apliquen sin migración manual
    return sequelize.sync({ alter: true });
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('No se pudo conectar a la base de datos:', err);
    process.exit(1);
  });
