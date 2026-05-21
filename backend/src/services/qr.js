'use strict';

/**
 * Generador de QR para mesas.
 * Devuelve un dataURL PNG embebible (base64). La URL apunta a
 * /bienvenida/?mesa=<id> en el frontend, que arranca la sesión cliente.
 */
const QRCode = require('qrcode');

/**
 * @param {{id:number}} mesa fila de Mesa (sólo se usa id)
 * @param {string} baseUrl URL pública del frontend (sin slash final)
 * @returns {Promise<string>} dataURL `data:image/png;base64,...`
 */
async function generateQrBase64(mesa, baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/bienvenida/?mesa=${mesa.id}`;
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'L', margin: 2, scale: 10 });
}

module.exports = { generateQrBase64 };
