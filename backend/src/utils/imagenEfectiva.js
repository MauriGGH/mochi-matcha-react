/**
 * Devuelve la URL de imagen efectiva de una promoción.
 * Prioridad:
 *   1) promo.imagen_url (banner propio subido por el gerente)
 *   2) imagen del primer producto aplicable
 *   3) imagen del primer producto beneficiado (combos)
 *   4) null
 */
/**
 * @param {object} promo Promoción con asociaciones cargadas (productos_aplicables, productos_beneficiados)
 * @returns {string|null} URL de imagen efectiva, o null si no hay ninguna
 */
function imagenEfectiva(promo) {
  if (promo.imagen_url) return promo.imagen_url;
  const aplic = promo.productos_aplicables || [];
  if (aplic.length && aplic[0].imagen_url) return aplic[0].imagen_url;
  const benef = promo.productos_beneficiados || [];
  if (benef.length && benef[0].imagen_url) return benef[0].imagen_url;
  return null;
}

module.exports = { imagenEfectiva };
