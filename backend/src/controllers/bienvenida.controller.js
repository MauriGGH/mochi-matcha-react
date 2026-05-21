'use strict';
/**
 * Bienvenida controller: maneja el flujo público de ingreso del cliente vía QR.
 * Crea SesionCliente y devuelve cookie mm_session (httpOnly, 2h). El primer
 * cliente de la mesa genera un PIN de 4 dígitos compartido con sus acompañantes.
 *
 * Exporta: estadoMesa, crearSesion, recuperarSesion.
 */
const { randomInt } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Mesa, SesionCliente, ModalidadIngreso, sequelize } = require('../models');

/**
 * GET /api/bienvenida/estado/:mesaId
 * Público. Devuelve el estado de la mesa y los alias de sesiones activas
 * (para que la UI pueda mostrar "Únete a la mesa de FULANO").
 * @returns { ok, numero_mesa, estado, sesiones_activas: [alias...], count }
 */
exports.estadoMesa = async (req, res, next) => {
  try {
    const mesa = await Mesa.findByPk(req.params.mesaId);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const sesiones = await SesionCliente.findAll({
      where: { id_mesa: mesa.id, estado: 'activa' },
      attributes: ['alias'],
    });
    const aliases = sesiones.map(s => s.alias);

    return res.json({
      ok: true,
      numero_mesa: mesa.numero_mesa,
      estado: mesa.estado,
      sesiones_activas: aliases,
      count: aliases.length,
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/bienvenida/crear/:mesaId
 * Público. Crea una nueva SesionCliente para la mesa.
 * Body: { alias, modalidad? }  (alias forzado a UPPER, 50 chars, modalidad por defecto 'qr')
 *
 * Reglas:
 *   - Si la mesa tiene sesiones 'pagada' (cobro en curso) → 409 step=mesa_cerrando.
 *   - Alias duplicado en sesiones activas → 400.
 *   - Primer cliente genera PIN de 4 dígitos (1000-9999); resto comparte el PIN existente.
 *   - Setea cookie mm_session (httpOnly, sameSite=lax, 2h).
 *
 * Transacción + SELECT FOR UPDATE sobre Mesa para evitar carrera de dos
 * clientes creando la primera sesión a la vez (cada uno generaría su PIN).
 *
 * @returns { ok, sesion_id: <token>, requires_pin_screen, pin? }
 *          (pin solo si es el primer cliente)
 */
exports.crearSesion = async (req, res, next) => {
  try {
    const { mesaId } = req.params;
    const alias = (req.body.alias || '').trim().slice(0, 50).toUpperCase();
    const modalidadStr = (req.body.modalidad || 'qr').toString();

    if (!alias) {
      return res.status(400).json({ ok: false, error: 'alias requerido' });
    }

    const mesa = await Mesa.findByPk(mesaId);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    if (mesa.estado !== 'libre') {
      const pagadas = await SesionCliente.count({
        where: { id_mesa: mesa.id, estado: 'pagada' },
      });
      if (pagadas > 0) {
        return res.status(409).json({ ok: false, step: 'mesa_cerrando' });
      }
    }

    const aliasExiste = await SesionCliente.findOne({
      where: { id_mesa: mesa.id, alias, estado: 'activa' },
    });
    if (aliasExiste) {
      return res.status(400).json({ ok: false, error: 'Ese alias ya está en uso en esta mesa' });
    }

    const [modalidad] = await ModalidadIngreso.findOrCreate({
      where: { descripcion: modalidadStr },
    });

    const token = uuidv4().replace(/-/g, '');
    let esPrimerCliente;
    let pinActual;

    await sequelize.transaction(async (t) => {
      const mesaLocked = await Mesa.findByPk(mesaId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      // Re-verificar dentro del lock
      if (mesaLocked.estado !== 'libre') {
        const pagadasLocked = await SesionCliente.count({
          where: { id_mesa: mesaLocked.id, estado: 'pagada' },
          transaction: t,
        });
        if (pagadasLocked > 0) {
          const err = new Error('mesa_cerrando');
          err.code = 'MESA_CERRANDO';
          throw err;
        }
      }

      const activasCount = await SesionCliente.count({
        where: { id_mesa: mesaLocked.id, estado: 'activa' },
        transaction: t,
      });
      esPrimerCliente = activasCount === 0;

      if (esPrimerCliente || !mesaLocked.pin_actual) {
        mesaLocked.pin_actual = String(randomInt(1000, 10000));
        mesaLocked.estado = 'ocupada';
        await mesaLocked.save({ fields: ['pin_actual', 'estado'], transaction: t });
      } else if (mesaLocked.estado === 'libre') {
        mesaLocked.estado = 'ocupada';
        await mesaLocked.save({ fields: ['estado'], transaction: t });
      }

      pinActual = mesaLocked.pin_actual;

      await SesionCliente.create({
        alias,
        token_cookie: token,
        estado: 'activa',
        id_mesa: mesaLocked.id,
        id_modalidad: modalidad.id,
      }, { transaction: t });
    });

    res.cookie('mm_session', token, {
      maxAge: 7200 * 1000,
      httpOnly: true,
      sameSite: 'lax',
    });

    const body = { ok: true, sesion_id: token, requires_pin_screen: esPrimerCliente };
    if (esPrimerCliente) body.pin = pinActual;

    return res.json(body);
  } catch (err) {
    if (err.code === 'MESA_CERRANDO') {
      return res.status(409).json({ ok: false, step: 'mesa_cerrando' });
    }
    next(err);
  }
};

/**
 * POST /api/bienvenida/recuperar/:mesaId
 * Público. Recupera una sesión existente con alias+PIN (caso: el cliente cerró
 * el navegador y quiere volver a su carrito).
 * Body: { alias, pin }
 * @returns { ok, sesion_id } y setea cookie mm_session.
 *          400 si PIN incorrecto o alias no existe en la mesa.
 */
exports.recuperarSesion = async (req, res, next) => {
  try {
    const { mesaId } = req.params;
    const alias = (req.body.alias || '').trim().toUpperCase();
    const pin   = (req.body.pin   || '').trim();

    const mesa = await Mesa.findByPk(mesaId);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    if (mesa.pin_actual !== pin) {
      return res.status(400).json({ ok: false, error: 'PIN incorrecto' });
    }

    const sesion = await SesionCliente.findOne({
      where: { id_mesa: mesa.id, alias, estado: 'activa' },
    });
    if (!sesion) {
      return res.status(400).json({ ok: false, error: 'No encontramos ese alias en esta mesa' });
    }

    res.cookie('mm_session', sesion.token_cookie, {
      maxAge: 7200 * 1000,
      httpOnly: true,
      sameSite: 'lax',
    });

    return res.json({ ok: true, sesion_id: sesion.token_cookie });
  } catch (err) { next(err); }
};
