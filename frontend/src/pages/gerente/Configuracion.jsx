/**
 * Página de Configuración del gerente.
 * Permite editar settings globales (servidor + KDS) desde la UI:
 *   - Modo mantenimiento + mensaje (bloquea al cliente, ver middleware/mantenimiento.js)
 *   - Horarios de atención (gating del cliente, ver services/horarios.js)
 *   - Sliders del semáforo KDS (umbrales amarillo/rojo en minutos)
 *   - Credenciales PayPal
 *   - Datos del restaurante (impresión de tickets)
 *
 * Los settings KDS se guardan tanto en localStorage (para el navegador
 * del gerente) como en /gerente/config (para que el KDS del staff los lea).
 *
 * Export único: <Configuracion /> — montado en /gerente/configuracion.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import CharCounter from '../../components/forms/CharCounter';
import { useToast } from '../../components/Toast';
import { usePageTitle } from '../../hooks/usePageTitle';

const DIAS_NOMBRES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function Section({ children, style }) {
  return (
    <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.5rem', marginBottom: '1.5rem', ...style }}>
      {children}
    </div>
  );
}

/**
 * Página principal de configuración del gerente.
 * No recibe props; carga todo el estado desde GET /gerente/config y
 * /gerente/horarios al montar. Cada sección tiene su propio botón Guardar
 * que hace PATCH/POST específico (no hay "Guardar todo").
 *
 * @returns {JSX.Element}
 */
export default function Configuracion() {
  usePageTitle('Configuración');
  const navigate = useNavigate();
  const toast = useToast();

  // ── Mantenimiento ──
  const [modoMant, setModoMant]     = useState(false);
  const [msgMant, setMsgMant]       = useState('Estamos realizando mejoras. Volvemos en breve.');

  // ── Horarios ──
  const [horariosActivos, setHorariosActivos] = useState(false);
  const [horarios, setHorarios]   = useState([]);
  const [nuevoHorarioDia, setNuevoHorarioDia]   = useState(0);
  const [nuevoHorarioAbre, setNuevoHorarioAbre]  = useState('08:00');
  const [nuevoHorarioCierra, setNuevoHorarioCierra] = useState('22:00');
  const [savingHorario, setSavingHorario] = useState(false);

  // ── KDS sliders ──
  const [yellow, setYellow] = useState(8);
  const [red, setRed]       = useState(15);

  // ── PayPal ──
  const [paypalCid, setPaypalCid]   = useState('');
  const [paypalSec, setPaypalSec]   = useState('');
  const [paypalModo, setPaypalModo] = useState('sandbox');

  // ── Restaurante ──
  const [restNombre,    setRestNombre]    = useState('');
  const [restRfc,       setRestRfc]       = useState('');
  const [restDireccion, setRestDireccion] = useState('');
  const [restTelefono,  setRestTelefono]  = useState('');

  // Carga inicial: lee KDS sliders de localStorage (preferencia local del
  // navegador del gerente) y el resto de settings desde el backend.
  // Si /gerente/config trae semaforo_yellow/red sobreescribe el local.
  useEffect(() => {
    try {
      const kds = JSON.parse(localStorage.getItem('kds_settings') || '{}');
      if (kds.yellow) setYellow(kds.yellow);
      if (kds.red)    setRed(kds.red);
    } catch { /* ignore */ }

    api.get('/gerente/config').then(({ data }) => {
      if (data.modo_mantenimiento != null) setModoMant(data.modo_mantenimiento === 'true');
      if (data.mensaje_mantenimiento) setMsgMant(data.mensaje_mantenimiento);
      if (data.horarios_activos != null) setHorariosActivos(data.horarios_activos === 'true');
      if (data.paypal_client_id) setPaypalCid(data.paypal_client_id);
      if (data.paypal_secret)    setPaypalSec(data.paypal_secret);
      if (data.paypal_modo)      setPaypalModo(data.paypal_modo);
      if (data.restaurante_nombre)    setRestNombre(data.restaurante_nombre);
      if (data.restaurante_rfc)       setRestRfc(data.restaurante_rfc);
      if (data.restaurante_direccion) setRestDireccion(data.restaurante_direccion);
      if (data.restaurante_telefono)  setRestTelefono(data.restaurante_telefono);
      if (data.semaforo_yellow) setYellow(parseInt(data.semaforo_yellow, 10));
      if (data.semaforo_red)    setRed(parseInt(data.semaforo_red, 10));
    }).catch(() => {});
  }, []);

  // Cargar horarios
  const cargarHorarios = async () => {
    try {
      const { data } = await api.get('/gerente/horarios');
      setHorarios(data || []);
    } catch { /* sin endpoint, no crash */ }
  };
  useEffect(() => { cargarHorarios(); }, []);

  const agregarHorario = async () => {
    if (!nuevoHorarioAbre || !nuevoHorarioCierra) { toast.error('Indica abre y cierra.'); return; }
    if (nuevoHorarioAbre === nuevoHorarioCierra) { toast.error('Abre y cierra no pueden ser iguales.'); return; }
    setSavingHorario(true);
    const nuevo = { dia_semana: nuevoHorarioDia, abre: nuevoHorarioAbre, cierra: nuevoHorarioCierra, activo: true };
    const nuevos = [...horarios, nuevo];
    try {
      await api.put('/gerente/horarios', { horarios: nuevos });
      await cargarHorarios();
      toast.success('Horario agregado');
    } catch { toast.error('No se pudo crear el horario'); }
    setSavingHorario(false);
  };

  const toggleHorario = async (idx, activo) => {
    const nuevos = horarios.map((h, i) => (i === idx || h.id === idx ? { ...h, activo } : h));
    try {
      await api.put('/gerente/horarios', { horarios: nuevos });
      setHorarios(nuevos);
    } catch { toast.error('Error al actualizar'); }
  };

  const eliminarHorario = async (idx) => {
    const nuevos = horarios.filter((h, i) => i !== idx && h.id !== idx);
    try {
      await api.put('/gerente/horarios', { horarios: nuevos });
      setHorarios(nuevos);
      toast.success('Horario eliminado');
    } catch { toast.error('Error al eliminar'); }
  };

  const guardarConfig = async () => {
    if (yellow >= red) {
      toast.error('El tiempo de advertencia (ámbar) debe ser menor al tiempo crítico (rojo)');
      return;
    }
    // Persist a localStorage para KDS (cliente offline-first)
    localStorage.setItem('kds_settings', JSON.stringify({ yellow, red }));

    // Persist al backend
    try {
      await api.put('/gerente/config', {
        modo_mantenimiento: String(modoMant),
        mensaje_mantenimiento: msgMant,
        horarios_activos: String(horariosActivos),
        paypal_client_id: paypalCid,
        paypal_secret: paypalSec,
        paypal_modo: paypalModo,
        restaurante_nombre: restNombre,
        restaurante_rfc: restRfc,
        restaurante_direccion: restDireccion,
        restaurante_telefono: restTelefono,
        semaforo_yellow: String(yellow),
        semaforo_red: String(red),
      });
      toast.success('Configuración guardada');
    } catch {
      toast.error('Error guardando configuración');
    }
  };

  const sidebarNav = (
    <>
      <a onClick={() => navigate('/gerente')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Floor Plan</a>
      <div className="nav-section-label">Gestión</div>
      <a onClick={() => navigate('/gerente/menu')} style={{ cursor: 'pointer' }}><i className="bi bi-basket-fill" /> Gestión de Menú</a>
      <div className="nav-section-label">Reportes</div>
      <a onClick={() => navigate('/gerente/reportes')} style={{ cursor: 'pointer' }}><i className="bi bi-bar-chart-fill" /> Reportes</a>
      <div className="nav-section-label">Admin</div>
      <a onClick={() => navigate('/gerente/empleados')} style={{ cursor: 'pointer' }}><i className="bi bi-people-fill" /> Empleados</a>
      <a className="active"><i className="bi bi-gear-fill" /> Configuración</a>
    </>
  );

  return (
    <StaffLayout title="Configuración" sidebarNav={sidebarNav}>
      <div style={{ maxWidth: 680 }}>

        {/* ── Mantenimiento ── */}
        <div className="mb-4">
          <h6 className="fw-bold mb-3"><i className="bi bi-cone-striped me-1" />Modo mantenimiento</h6>
          <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
            Activa una pantalla informativa para los clientes mientras realizas actualizaciones.
          </p>

          <div style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)', padding: '1rem', marginBottom: '1.25rem' }}
            className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-3">
              <div style={{ width: 40, height: 40, background: 'var(--mm-cream-dark)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                <i className="bi bi-pause-circle" />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '.9rem' }}>Modo mantenimiento</div>
                <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
                  {modoMant ? 'Activo — los clientes ven la pantalla de mantenimiento' : 'Inactivo — restaurante operando con normalidad'}
                </div>
              </div>
            </div>
            <div className="form-check form-switch mb-0">
              <input className="form-check-input" type="checkbox" checked={modoMant} onChange={e => setModoMant(e.target.checked)}
                style={{ cursor: 'pointer', width: '2.75em', height: '1.35em', accentColor: 'var(--mm-green)' }} />
            </div>
          </div>

          <div>
            <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Mensaje personalizado</label>
            <textarea maxLength={500} className="form-control" rows={3}
              style={{ borderColor: 'var(--mm-border)', resize: 'none', fontSize: '.875rem' }}
              value={msgMant} onChange={e => setMsgMant(e.target.value)} />
            <CharCounter value={msgMant} max={500} />
            <p style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.35rem' }}>
              Este mensaje se mostrará a los clientes cuando intenten acceder.
            </p>
          </div>
        </div>

        {/* ── Horarios ── */}
        <Section>
          <h6 className="fw-bold mb-1"><i className="bi bi-clock me-1" />Horarios de atención</h6>
          <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
            Cuando está activo y la hora actual queda fuera de los rangos, los clientes ven "Cerrado".
            El staff sigue teniendo acceso normal.
          </p>

          <div style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)', padding: '1rem', marginBottom: '1rem' }}
            className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-3">
              <div style={{ width: 40, height: 40, background: 'var(--mm-cream-dark)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                <i className="bi bi-clock-fill" />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '.9rem' }}>Aplicar horarios al cliente</div>
                <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
                  {horariosActivos ? 'Activo — fuera de horario los clientes ven "Cerrado"' : 'Inactivo — la app del cliente está disponible 24/7'}
                </div>
              </div>
            </div>
            <div className="form-check form-switch mb-0">
              <input className="form-check-input" type="checkbox" checked={horariosActivos} onChange={e => setHorariosActivos(e.target.checked)}
                style={{ cursor: 'pointer', width: '2.75em', height: '1.35em', accentColor: 'var(--mm-green)' }} />
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Rangos configurados</label>
            <div style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)' }}>
              {horarios.length === 0 && (
                <div className="px-3 py-3 text-center" style={{ color: 'var(--mm-text-muted)', fontSize: '.85rem' }}>
                  No hay horarios configurados. Agrega uno abajo.
                </div>
              )}
              {horarios.map(h => (
                <div key={h.id} className="d-flex align-items-center justify-content-between px-3 py-2"
                  style={{ borderBottom: '1px solid var(--mm-border)', opacity: h.activo ? 1 : .55 }}>
                  <div style={{ fontSize: '.875rem' }}>
                    <span className="fw-semibold">{DIAS_NOMBRES[h.dia_semana] || `Día ${h.dia_semana}`}</span>
                    <span className="mx-2 text-muted">·</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{h.abre} → {h.cierra}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" checked={!!h.activo}
                        onChange={e => toggleHorario(h.id, e.target.checked)}
                        style={{ cursor: 'pointer', accentColor: 'var(--mm-green)' }} />
                    </div>
                    <button className="btn btn-link btn-sm p-0" onClick={() => eliminarHorario(h.id)}>
                      <i className="bi bi-trash3" style={{ color: 'var(--mm-danger)' }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="row g-2 align-items-end">
            <div className="col-md-4">
              <label className="form-label fw-semibold" style={{ fontSize: '.78rem' }}>Día</label>
              <select className="form-select form-select-sm" style={{ borderColor: 'var(--mm-border)' }}
                value={nuevoHorarioDia} onChange={e => setNuevoHorarioDia(+e.target.value)}>
                {DIAS_NOMBRES.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.78rem' }}>Abre</label>
              <input type="time" className="form-control form-control-sm" style={{ borderColor: 'var(--mm-border)' }}
                value={nuevoHorarioAbre} onChange={e => setNuevoHorarioAbre(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.78rem' }}>Cierra</label>
              <input type="time" className="form-control form-control-sm" style={{ borderColor: 'var(--mm-border)' }}
                value={nuevoHorarioCierra} onChange={e => setNuevoHorarioCierra(e.target.value)} />
            </div>
            <div className="col-md-2">
              <button className="btn btn-primary w-100 btn-sm" onClick={agregarHorario} disabled={savingHorario}>
                <i className="bi bi-plus-lg" /> Agregar
              </button>
            </div>
          </div>
          <div className="form-text mt-2" style={{ fontSize: '.72rem' }}>
            Tip: puedes agregar varios rangos por día (horario partido). Si <em>cierra</em> es antes que <em>abre</em>, se entiende que cruza medianoche (ej. 18:00 → 02:00).
          </div>
        </Section>

        {/* ── KDS Semáforo ── */}
        <Section>
          <h6 className="fw-bold mb-1">Umbrales del semáforo (KDS)</h6>
          <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1.5rem' }}>
            Configura los tiempos de advertencia y crítico para el sistema de display de cocina.
          </p>

          <div className="row g-4 mb-3">
            <div className="col-md-6">
              <label className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: '.875rem', fontWeight: 600 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#F39C12', display: 'inline-block' }} />
                Tiempo de advertencia
              </label>
              <div className="d-flex align-items-center gap-3">
                <input type="range" min={1} max={30} value={yellow} onChange={e => setYellow(+e.target.value)}
                  className="form-range flex-grow-1" style={{ accentColor: '#F39C12' }} />
                <div style={{ minWidth: 56, textAlign: 'center', fontWeight: 700, background: 'var(--mm-cream-dark)', borderRadius: 'var(--radius-sm)', padding: '.3rem .5rem' }}>
                  {yellow} <span style={{ fontSize: '.7rem', fontWeight: 400 }}>min</span>
                </div>
              </div>
              <p style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.3rem' }}>
                Ticket se vuelve ámbar después de {yellow} minutos
              </p>
            </div>
            <div className="col-md-6">
              <label className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: '.875rem', fontWeight: 600 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#E74C3C', display: 'inline-block' }} />
                Tiempo crítico
              </label>
              <div className="d-flex align-items-center gap-3">
                <input type="range" min={1} max={60} value={red} onChange={e => setRed(+e.target.value)}
                  className="form-range flex-grow-1" style={{ accentColor: '#E74C3C' }} />
                <div style={{ minWidth: 56, textAlign: 'center', fontWeight: 700, background: 'var(--mm-cream-dark)', borderRadius: 'var(--radius-sm)', padding: '.3rem .5rem' }}>
                  {red} <span style={{ fontSize: '.7rem', fontWeight: 400 }}>min</span>
                </div>
              </div>
              <p style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.3rem' }}>
                Ticket se vuelve rojo después de {red} minutos
              </p>
            </div>
          </div>

          {/* Vista previa */}
          <div style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)', padding: '1.25rem', background: 'var(--mm-cream)' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>
              Vista previa del semáforo
            </div>
            <div className="d-flex align-items-center justify-content-between">
              <div className="text-center" style={{ flex: '0 0 auto' }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#27AE60', margin: '0 auto .5rem' }} />
                <div style={{ fontSize: '.75rem', fontWeight: 600, color: '#27AE60' }}>Normal</div>
                <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)' }}>&lt;{yellow}m</div>
              </div>
              <div style={{ flex: 1, height: 3, background: 'linear-gradient(to right,#27AE60,#F39C12)', margin: '0 .75rem', borderRadius: 99 }} />
              <div className="text-center" style={{ flex: '0 0 auto' }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#F39C12', margin: '0 auto .5rem' }} />
                <div style={{ fontSize: '.75rem', fontWeight: 600, color: '#F39C12' }}>Alerta</div>
                <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)' }}>{yellow}–{red}m</div>
              </div>
              <div style={{ flex: 1, height: 3, background: 'linear-gradient(to right,#F39C12,#E74C3C)', margin: '0 .75rem', borderRadius: 99 }} />
              <div className="text-center" style={{ flex: '0 0 auto' }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#E74C3C', margin: '0 auto .5rem' }} />
                <div style={{ fontSize: '.75rem', fontWeight: 600, color: '#E74C3C' }}>Crítico</div>
                <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)' }}>&gt;{red}m</div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── PayPal ── */}
        <Section>
          <h6 className="fw-bold mb-1">
            <i className="bi bi-paypal me-1" />Integración PayPal{' '}
            <span style={{ fontSize: '.72rem', fontWeight: 400, color: 'var(--mm-text-muted)' }}>(pasarela de pago en línea)</span>
          </h6>
          <p style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>
            Obtén tus credenciales en <a href="https://developer.paypal.com/dashboard/" target="_blank" rel="noreferrer" style={{ color: 'var(--mm-green)' }}>developer.paypal.com</a> → My Apps &amp; Credentials
          </p>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Client ID</label>
              <input type="text" maxLength={200} className="form-control" style={{ borderColor: 'var(--mm-border)', fontFamily: 'var(--font-mono)', fontSize: '.8rem' }}
                value={paypalCid} onChange={e => setPaypalCid(e.target.value)} placeholder="AaBb..." />
              <CharCounter value={paypalCid} max={200} />
            </div>
            <div className="col-md-6">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Secret</label>
              <input type="password" maxLength={200} className="form-control" style={{ borderColor: 'var(--mm-border)', fontFamily: 'var(--font-mono)', fontSize: '.8rem' }}
                value={paypalSec} onChange={e => setPaypalSec(e.target.value)} placeholder="EFgh..." />
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Modo</label>
              <select className="form-select" style={{ borderColor: 'var(--mm-border)' }} value={paypalModo} onChange={e => setPaypalModo(e.target.value)}>
                <option value="sandbox">Sandbox (pruebas)</option>
                <option value="production">Producción</option>
              </select>
              <div className="form-text">Usa Sandbox para probar antes de lanzar.</div>
            </div>
          </div>
        </Section>

        {/* ── Restaurante ── */}
        <Section>
          <h6 className="fw-bold mb-3">
            Datos del Restaurante{' '}
            <span style={{ fontSize: '.72rem', fontWeight: 400, color: 'var(--mm-text-muted)' }}>(aparecen en el ticket de cobro)</span>
          </h6>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Nombre del restaurante</label>
              <input type="text" maxLength={200} className="form-control" style={{ borderColor: 'var(--mm-border)' }}
                value={restNombre} onChange={e => setRestNombre(e.target.value.toUpperCase())} placeholder="Mochi Matcha" />
              <CharCounter value={restNombre} max={200} />
            </div>
            <div className="col-md-6">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>RFC</label>
              <input type="text" maxLength={20} className="form-control" style={{ borderColor: 'var(--mm-border)' }}
                value={restRfc} onChange={e => setRestRfc(e.target.value.toUpperCase())} placeholder="MMT123456ABC" />
              <CharCounter value={restRfc} max={20} />
            </div>
            <div className="col-md-6">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Dirección</label>
              <input type="text" maxLength={300} className="form-control" style={{ borderColor: 'var(--mm-border)' }}
                value={restDireccion} onChange={e => setRestDireccion(e.target.value.toUpperCase())} placeholder="Calle, Colonia, Ciudad" />
              <CharCounter value={restDireccion} max={300} />
            </div>
            <div className="col-md-6">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Teléfono</label>
              <input type="text" maxLength={20} className="form-control" style={{ borderColor: 'var(--mm-border)' }}
                value={restTelefono} onChange={e => setRestTelefono(e.target.value.toUpperCase())} placeholder="312 123 4567" />
              <CharCounter value={restTelefono} max={20} />
            </div>
          </div>
        </Section>

        {/* ── Save ── */}
        <button className="btn btn-primary w-100 py-3 fw-bold" style={{ fontSize: '1rem' }} onClick={guardarConfig}>
          <i className="bi bi-floppy2 me-2" />Guardar configuración
        </button>

      </div>
    </StaffLayout>
  );
}
