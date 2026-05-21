'use strict';

/**
 * Servicio puro de horarios de atención.
 * Evalúa si una hora cae dentro de los rangos guardados en HorarioAtencion
 * y calcula el siguiente horario disponible. Stateless: recibe los rows
 * (no hace queries). Lo usa el middleware `horario.js`.
 *
 * Convención de días: Django (0=Lun..6=Dom). JS getDay() es 0=Dom..6=Sáb,
 * por eso normalizamos con _jsToDjango.
 */

// dias: Django convention — 0=Lun, 1=Mar, 2=Mié, 3=Jue, 4=Vie, 5=Sáb, 6=Dom
const DIAS_NOMBRES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Convierte "HH:MM(:SS)?" a minutos desde medianoche.
 * @param {string} str
 * @returns {number}
 */
function _parseTime(str) {
  const parts = String(str || '00:00').split(':');
  return parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0);
}

function _jsToDjango(jsDay) {
  // JS: 0=Dom..6=Sáb  →  Django: 0=Lun..6=Dom
  return (jsDay + 6) % 7;
}

/**
 * ¿La hora `now` cae dentro de algún rango activo del set de horarios?
 * Soporta rangos que cruzan medianoche (ej. abre 22:00, cierra 02:00).
 * @param {Array<{dia_semana:number, abre:string, cierra:string, activo:boolean}>} horarios
 * @param {Date} now
 * @returns {boolean}
 */
function enHorario(horarios, now) {
  if (!horarios || horarios.length === 0) return false;
  const djangoDay = _jsToDjango(now.getDay());
  const minActual = now.getHours() * 60 + now.getMinutes();

  for (const h of horarios) {
    if (!h.activo) continue;
    const abre = _parseTime(h.abre);
    const cierra = _parseTime(h.cierra);

    if (abre < cierra) {
      // Normal same-day range
      if (h.dia_semana === djangoDay && minActual >= abre && minActual < cierra) return true;
    } else {
      // Midnight-crossing range: starts on dia_semana, ends on next day
      const diaSiguiente = (h.dia_semana + 1) % 7;
      if (h.dia_semana === djangoDay && minActual >= abre) return true;
      if (diaSiguiente === djangoDay && minActual < cierra) return true;
    }
  }
  return false;
}

/**
 * Calcula el próximo horario en que abrirá el local (mira hasta 7 días
 * adelante). Útil para mostrar "Cerrado — abre el Mar 09:00".
 * @param {Array<object>} horarios
 * @param {Date} now
 * @returns {null|{dia:string, dia_semana:number, abre:string}}
 */
function proximoHorario(horarios, now) {
  if (!horarios || horarios.length === 0) return null;
  const activos = horarios.filter((h) => h.activo);
  if (activos.length === 0) return null;

  const djangoDay = _jsToDjango(now.getDay());
  const minActual = now.getHours() * 60 + now.getMinutes();

  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const targetDay = (djangoDay + daysAhead) % 7;
    const candidatos = activos
      .filter((h) => h.dia_semana === targetDay)
      .sort((a, b) => _parseTime(a.abre) - _parseTime(b.abre));

    for (const h of candidatos) {
      const abre = _parseTime(h.abre);
      if (daysAhead > 0 || abre > minActual) {
        return { dia: DIAS_NOMBRES[targetDay], dia_semana: targetDay, abre: h.abre };
      }
    }
  }
  return null;
}

module.exports = { enHorario, proximoHorario };
