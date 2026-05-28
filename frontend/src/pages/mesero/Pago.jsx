/**
 * Pago.jsx — pantalla de cobro presencial del mesero.
 * Soporta cobro grupal o individual (por sesión), métodos Efectivo / Tarjeta /
 * Mixto (excluye PayPal — ese flujo lo paga el cliente), propina configurable
 * por %/manual y cálculo de cambio. Al confirmar emite ticket y redirige a
 * /mesero/ticket.
 *
 * Ruta: /mesero/pago?mesa_id=...&sol_id=...
 * Exporta: default Pago().
 */
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { numberInputHandlers } from '../../utils/numberInput';
import StaffLayout from '../../components/StaffLayout';

/** Pantalla de cobro del mesero. Sin props (toma mesa_id y sol_id de la query). */
export default function Pago() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mesaId = params.get('mesa_id');
  const solId  = params.get('sol_id');

  const [mesa, setMesa]               = useState(null);
  const [detalle, setDetalle]         = useState(null);
  const [metodos, setMetodos]         = useState([]);
  const [metodoSel, setMetodoSel]     = useState(null);
  const [propinaPct, setPropinaPct]   = useState(10);
  const [propinaCustom, setPropinaCustom] = useState('');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [montoEfectivo, setMontoEfectivo] = useState('');
  const [montoTarjeta, setMontoTarjeta]   = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(true);
  const [procesando, setProcesando]   = useState(false);
  const [tipoCobro, setTipoCobro]     = useState('grupal'); // 'grupal' | 'individual'
  const [sesionSel, setSesionSel]     = useState(null);

  // Carga inicial paralela: detalle de la mesa + catálogo de métodos de pago.
  // Si llegamos con sol_id (desde Alertas o MapaMesas), pre-selecciona tipo
  // y sesión correspondientes a esa solicitud.
  useEffect(() => {
    if (!mesaId) return;
    Promise.all([
      api.get(`/mesas/${mesaId}`),
      api.get('/catalogo/metodos-pago'),
    ]).then(([rm, rmet]) => {
      setMesa(rm.data);
      setDetalle(rm.data);
      // fix#2 Bug A: el mesero cobra presencial (Efectivo/Tarjeta/Mixto). PayPal
      // es un flujo del cliente (paga desde su móvil), no debe aparecer aquí.
      // Espejo de apps/mesero/views.py:816 (Django excluye descripcion__iexact='PayPal').
      const metodosFiltrados = (rmet.data || []).filter(
        (m) => (m.descripcion || '').toUpperCase() !== 'PAYPAL'
      );
      setMetodos(metodosFiltrados);
      if (metodosFiltrados.length) setMetodoSel(metodosFiltrados[0]);

      // Si vino con sol_id, pre-seleccionar sesión y método de pago del cliente
      if (solId && rm.data?.solicitudes) {
        const sol = rm.data.solicitudes.find((s) => String(s.id) === String(solId));
        if (sol) {
          if (sol.tipo === 'individual' && sol.sesion_id) {
            setTipoCobro('individual');
            setSesionSel(sol.sesion_id);
          } else {
            setTipoCobro('grupal');
          }
          // Pre-seleccionar el método que eligió el cliente (metodo_pref viene en MAYÚSCULAS)
          if (sol.metodo_pref) {
            const match = metodosFiltrados.find(
              (m) => (m.descripcion || '').toUpperCase() === sol.metodo_pref.toUpperCase()
            );
            if (match) setMetodoSel(match);
          }
        }
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [mesaId, solId]);

  // Subtotal según selección (grupal: total mesa · individual: total de la sesión elegida).
  const subtotal = (() => {
    if (!detalle) return 0;
    if (tipoCobro === 'individual' && sesionSel) {
      const s = (detalle.sesiones || []).find((x) => String(x.id) === String(sesionSel));
      return s ? s.total : 0;
    }
    return detalle.total_mesa || 0;
  })();

  const propinaMonto = (() => {
    if (propinaCustom !== '') return Math.max(0, parseFloat(propinaCustom) || 0);
    return parseFloat((subtotal * propinaPct / 100).toFixed(2));
  })();
  const total = subtotal + propinaMonto;

  const isMixto    = metodoSel?.descripcion?.toUpperCase().includes('MIXTO');
  const isEfectivo = metodoSel?.descripcion?.toUpperCase().includes('EFECTIVO') && !isMixto;
  const isPaypal   = metodoSel?.descripcion?.toUpperCase().includes('PAYPAL');

  const cambio = isEfectivo ? Math.max(0, parseFloat(montoRecibido || 0) - total) : 0;

  // Submit del cobro: valida monto recibido (efectivo) o sumatoria (mixto),
  // rechaza PayPal porque ese método se cobra desde el dispositivo del cliente,
  // y al éxito navega al ticket impreso.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (tipoCobro === 'individual' && !sesionSel) { setError('Selecciona la sesión a cobrar'); return; }
    if (isEfectivo) {
      const rec = parseFloat(montoRecibido || 0);
      if (rec > 0 && rec < total) { setError(`Monto insuficiente — faltan $${(total - rec).toFixed(2)}`); return; }
    }
    if (isMixto) {
      const ef = parseFloat(montoEfectivo || 0);
      const ta = parseFloat(montoTarjeta || 0);
      if (ef + ta < total) { setError(`Suma insuficiente — faltan $${(total - ef - ta).toFixed(2)}`); return; }
    }
    if (isPaypal) {
      setError('Para PayPal el cliente debe iniciar el pago desde su dispositivo (escaneando el QR). Usa otro método para cobro en persona.');
      return;
    }
    setProcesando(true);
    try {
      const { data } = await api.post('/mesero/pago', {
        mesa_id: parseInt(mesaId, 10),
        sesion_id: tipoCobro === 'individual' ? parseInt(sesionSel, 10) : null,
        metodo_pago_id: metodoSel?.id,
        propina: propinaMonto.toFixed(2),
        monto_recibido: isEfectivo ? montoRecibido : undefined,
        monto_efectivo: isMixto ? montoEfectivo : undefined,
        monto_tarjeta: isMixto ? montoTarjeta : undefined,
      });
      navigate(`/mesero/ticket?mesa_id=${mesaId}&sol_id=${data.sol_id || ''}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al procesar pago');
    } finally { setProcesando(false); }
  };

  const sidebarNav = (
    <a onClick={() => navigate('/mesero')} style={{ cursor: 'pointer' }}><i className="bi bi-arrow-left" /> Volver a mesas</a>
  );

  if (!mesaId) {
    return (
      <StaffLayout title="Pago" sidebarNav={sidebarNav}>
        <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
          <i className="bi bi-search" style={{ fontSize: '2.5rem', display: 'block', marginBottom: '1rem' }} />
          <h6 className="fw-bold">No se especificó una mesa</h6>
          <button className="btn btn-primary mt-3" onClick={() => navigate('/mesero')}>Ir al mapa de mesas</button>
        </div>
      </StaffLayout>
    );
  }

  const sesiones = detalle?.sesiones || [];
  const multiplesSesiones = sesiones.length > 1;

  return (
    <StaffLayout title="Pago" sidebarNav={sidebarNav}>
      {loading ? (
        <div className="text-center py-5"><div className="spinner-border" /></div>
      ) : (
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          {/* Header mesa */}
          <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.25rem' }} className="d-flex align-items-center justify-content-between">
            <div>
              <h5 className="fw-bold mb-0">Mesa {detalle?.numero_mesa}</h5>
              <div style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
                {sesiones.length} {sesiones.length === 1 ? 'cliente' : 'clientes'} · Total mesa: ${parseFloat(detalle?.total_mesa || 0).toFixed(2)}
              </div>
            </div>
            {detalle?.pin && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, letterSpacing: '.2em', color: 'var(--mm-green)', background: 'var(--mm-green-pale)', padding: '.4rem .9rem', borderRadius: 'var(--radius-sm)' }}>
                {detalle.pin}
              </div>
            )}
          </div>

          {/* Tipo de cobro: grupal o individual */}
          <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h6 className="fw-bold mb-3"><i className="bi bi-people me-1" />¿Quién paga?</h6>
            <div className="d-flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setTipoCobro('grupal')}
                style={{
                  flex: 1,
                  padding: '.85rem',
                  border: `2px solid ${tipoCobro === 'grupal' ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                  background: tipoCobro === 'grupal' ? 'var(--mm-green-pale)' : 'var(--mm-white)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                <i className="bi bi-people-fill me-1" />Toda la mesa
                <div style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)', fontWeight: 400, marginTop: '.2rem' }}>
                  ${parseFloat(detalle?.total_mesa || 0).toFixed(2)}
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setTipoCobro('individual'); if (!sesionSel && sesiones.length) setSesionSel(sesiones[0].id); }}
                disabled={!sesiones.length}
                style={{
                  flex: 1,
                  padding: '.85rem',
                  border: `2px solid ${tipoCobro === 'individual' ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                  background: tipoCobro === 'individual' ? 'var(--mm-green-pale)' : 'var(--mm-white)',
                  borderRadius: 'var(--radius-md)',
                  cursor: sesiones.length ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                  opacity: sesiones.length ? 1 : 0.5,
                }}
              >
                <i className="bi bi-person-fill me-1" />Una sesión
                <div style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)', fontWeight: 400, marginTop: '.2rem' }}>
                  Cobro individual
                </div>
              </button>
            </div>

            {tipoCobro === 'individual' && multiplesSesiones && (
              <div>
                <label className="form-label fw-semibold" style={{ fontSize: '.82rem' }}>Selecciona la sesión</label>
                <div className="d-flex flex-column gap-2">
                  {sesiones.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setSesionSel(s.id)}
                      style={{
                        border: `2px solid ${String(sesionSel) === String(s.id) ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                        background: String(sesionSel) === String(s.id) ? 'var(--mm-green-pale)' : 'var(--mm-white)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '.7rem .9rem',
                        cursor: 'pointer',
                      }}
                      className="d-flex align-items-center justify-content-between"
                    >
                      <span><i className="bi bi-person me-2" />{s.alias}</span>
                      <span style={{ fontWeight: 700, color: 'var(--mm-green)' }}>${parseFloat(s.total).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Resumen consumo */}
          {sesiones.length > 0 && (
            <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.25rem' }}>
              <h6 className="fw-bold mb-3"><i className="bi bi-list-ul me-1" />Consumo</h6>
              {(tipoCobro === 'individual'
                ? sesiones.filter((s) => String(s.id) === String(sesionSel))
                : sesiones
              ).map((s) => (
                <div key={s.id} className="mb-3" style={{ paddingBottom: '.5rem', borderBottom: '1px solid var(--mm-border)' }}>
                  <div className="d-flex justify-content-between mb-1" style={{ fontSize: '.82rem', color: 'var(--mm-text-muted)', fontWeight: 600 }}>
                    <span><i className="bi bi-person me-1" />{s.alias}</span>
                    <span>${parseFloat(s.total).toFixed(2)}</span>
                  </div>
                  {(s.pedidos || []).map((p) => (
                    <div key={p.id} style={{ fontSize: '.78rem', color: '#666', paddingLeft: '.5rem' }}>
                      <strong>Pedido #{p.id}:</strong> {(p.items || []).map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')}
                    </div>
                  ))}
                </div>
              ))}
              <div className="d-flex justify-content-between mt-2" style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
                <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="d-flex justify-content-between" style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
                <span>Propina ({propinaCustom !== '' ? 'manual' : `${propinaPct}%`})</span><span>${propinaMonto.toFixed(2)}</span>
              </div>
              <div className="d-flex justify-content-between fw-bold mt-2 pt-2" style={{ fontSize: '1.2rem', borderTop: '2px solid var(--mm-border)' }}>
                <span>Total a pagar</span>
                <span style={{ color: 'var(--mm-green)' }}>${total.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Formulario */}
          <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.5rem', marginBottom: '1.25rem' }}>
            <form onSubmit={handleSubmit}>
              {/* Métodos de pago */}
              <h6 className="fw-bold mb-3">Método de pago</h6>
              <div className="row g-2 mb-4">
                {metodos.map((m) => {
                  const sel = metodoSel?.id === m.id;
                  const icon = m.descripcion.toUpperCase().includes('EFECTIVO') ? 'bi-cash'
                    : m.descripcion.toUpperCase().includes('TARJETA') ? 'bi-credit-card'
                    : m.descripcion.toUpperCase().includes('PAYPAL') ? 'bi-paypal'
                    : 'bi-shuffle';
                  return (
                    <div key={m.id} className="col-6 col-md-3">
                      <div
                        className={`metodo-option${sel ? ' selected' : ''}`}
                        onClick={() => setMetodoSel(m)}
                        style={{
                          padding: '.7rem .85rem',
                          border: `2px solid ${sel ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                          background: sel ? 'var(--mm-green-pale)' : 'var(--mm-white)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        <i className={`bi ${icon}`} style={{ fontSize: '1.4rem', color: sel ? 'var(--mm-green)' : 'var(--mm-text)' }} />
                        <div style={{ fontWeight: 600, fontSize: '.78rem', marginTop: '.2rem' }}>{m.descripcion}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Propina universal */}
              <h6 className="fw-bold mb-2">Propina</h6>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.4rem', marginBottom: '.5rem' }}>
                {[0, 10, 15, 20].map((pct) => (
                  <button
                    key={pct} type="button"
                    onClick={() => { setPropinaPct(pct); setPropinaCustom(''); }}
                    style={{
                      padding: '.45rem .25rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `2px solid ${propinaCustom === '' && propinaPct === pct ? 'var(--mm-gold)' : 'var(--mm-border)'}`,
                      background: propinaCustom === '' && propinaPct === pct ? 'var(--mm-gold-pale)' : 'var(--mm-cream-dark)',
                      cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
                    }}
                  >
                    {pct === 0 ? 'Sin' : `${pct}%`}
                  </button>
                ))}
              </div>
              <div className="input-group input-group-sm mb-4">
                <span className="input-group-text" style={{ background: 'var(--mm-cream-dark)' }}>$</span>
                <input type="number" min="0" step="0.01" placeholder="manual" {...numberInputHandlers()}
                  value={propinaCustom} onChange={(e) => setPropinaCustom(e.target.value)} className="form-control" />
              </div>

              {/* Monto recibido (Efectivo) */}
              {isEfectivo && (
                <div className="mb-4">
                  <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Monto recibido</label>
                  <div className="input-group">
                    <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)', fontWeight: 700 }}>$</span>
                    <input type="number" className="form-control" placeholder="0.00" step="0.01" min="0" value={montoRecibido} onChange={(e) => setMontoRecibido(e.target.value)} style={{ fontSize: '1.1rem', fontWeight: 600 }} {...numberInputHandlers()} />
                  </div>
                  {(() => {
                    const rec = parseFloat(montoRecibido || 0);
                    if (!montoRecibido) return null;
                    if (rec < total) {
                      const falta = total - rec;
                      return (
                        <div style={{ marginTop: '.5rem', padding: '.65rem 1rem', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 'var(--radius-sm)' }}>
                          <div className="d-flex justify-content-between">
                            <span style={{ color: '#856404', fontWeight: 600, fontSize: '.875rem' }}><i className="bi bi-exclamation-triangle me-1" />Falta por pagar</span>
                            <span style={{ color: '#856404', fontWeight: 700, fontSize: '1rem' }}>${falta.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div style={{ marginTop: '.5rem', padding: '.65rem 1rem', background: 'var(--mm-green-pale)', borderRadius: 'var(--radius-sm)' }}>
                        <div className="d-flex justify-content-between">
                          <span style={{ color: 'var(--mm-green)', fontWeight: 600, fontSize: '.875rem' }}><i className="bi bi-cash-coin me-1" />Cambio</span>
                          <span style={{ color: 'var(--mm-green)', fontWeight: 700, fontSize: '1rem' }}>${cambio.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Mixto */}
              {isMixto && (
                <div className="mb-4">
                  <div className="row g-2 mb-2">
                    <div className="col-6">
                      <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}><i className="bi bi-cash me-1" />Efectivo</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input type="number" className="form-control" placeholder="0.00" value={montoEfectivo} onChange={(e) => setMontoEfectivo(e.target.value)} {...numberInputHandlers()} />
                      </div>
                    </div>
                    <div className="col-6">
                      <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}><i className="bi bi-credit-card me-1" />Tarjeta</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input type="number" className="form-control" placeholder="0.00" value={montoTarjeta} onChange={(e) => setMontoTarjeta(e.target.value)} {...numberInputHandlers()} />
                      </div>
                    </div>
                  </div>
                  {(montoEfectivo || montoTarjeta) && (() => {
                    const suma = parseFloat(montoEfectivo || 0) + parseFloat(montoTarjeta || 0);
                    if (suma < total) {
                      const falta = total - suma;
                      return (
                        <div style={{ padding: '.65rem 1rem', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 'var(--radius-sm)' }}>
                          <div className="d-flex justify-content-between">
                            <span style={{ color: '#856404', fontWeight: 600, fontSize: '.875rem' }}><i className="bi bi-exclamation-triangle me-1" />Falta por pagar</span>
                            <span style={{ color: '#856404', fontWeight: 700, fontSize: '1rem' }}>${falta.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div style={{ padding: '.65rem 1rem', background: 'var(--mm-green-pale)', borderRadius: 'var(--radius-sm)' }}>
                        <div className="d-flex justify-content-between">
                          <span style={{ color: 'var(--mm-green)', fontWeight: 600, fontSize: '.875rem' }}><i className="bi bi-check-circle me-1" />Total cubierto</span>
                          <span style={{ color: 'var(--mm-green)', fontWeight: 700, fontSize: '1rem' }}>${suma.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* PayPal warning */}
              {isPaypal && (
                <div className="alert alert-info py-2 px-3 mb-3" style={{ fontSize: '.85rem' }}>
                  <i className="bi bi-info-circle me-1" />
                  PayPal: el cliente debe pagar desde su dispositivo (escaneando QR de la mesa).
                </div>
              )}

              {error && <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '.875rem' }}>{error}</div>}

              <button type="submit" disabled={procesando || isPaypal} className="btn btn-primary w-100 py-3 fw-bold" style={{ fontSize: '1.05rem' }}>
                {procesando ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-cash-coin me-2" />}
                Confirmar pago — ${total.toFixed(2)}
              </button>
            </form>
          </div>

          <button className="btn w-100 py-2" style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text-muted)' }} onClick={() => navigate('/mesero')}>
            <i className="bi bi-arrow-left me-1" />Cancelar y volver
          </button>
        </div>
      )}
    </StaffLayout>
  );
}
