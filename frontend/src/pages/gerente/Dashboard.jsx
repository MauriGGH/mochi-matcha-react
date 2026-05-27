/**
 * Dashboard / Floor Plan del gerente — vista en tiempo real de todas las mesas.
 *
 * - Polling cada POLL_MS (3 s) sobre /gerente/dashboard para refrescar
 *   estado por mesa: libre / ocupada / cocina / listo / cobrando / alerta.
 * - Permite al gerente cobrar (efectivo, tarjeta, mixto), cancelar pedidos
 *   y atender alertas sin pasar por el flujo de mesero.
 * - Estilos visuales (color y label de cada estado) viven en ESTADO_STYLES.
 *
 * Export único: <Dashboard /> — montado en /gerente.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useToast as useGlobalToast } from '../../components/Toast';
import { numberInputHandlers } from '../../utils/numberInput';

const POLL_MS = 3000;

const ESTADO_STYLES = {
  libre:    { cls: 'libre',   label: 'Libre',      dot: '#ccc' },
  ocupada:  { cls: 'ocupada', label: 'Ocupada',    dot: 'var(--mm-info)' },
  cocina:   { cls: 'pedidos', label: 'En cocina',  dot: 'var(--mm-gold)' },
  listo:    { cls: 'ocupada', label: 'Listo!',     dot: 'var(--mm-green)' },
  cobrando: { cls: 'pagando', label: 'Cobrando',   dot: 'var(--mm-green)' },
  alerta:   { cls: 'pedidos', label: 'Alerta',     dot: 'var(--mm-danger)' },
};

const STATUS_COLOR = {
  recibido:  '#2471A3', preparando: '#CA8A04', listo: '#1E8449',
  entregado: '#566573', cancelado: '#C0392B',
};
const STATUS_BG = {
  recibido:  '#EBF3FD', preparando: '#FEF9E7', listo: '#EAFAF1',
  entregado: '#F2F3F4', cancelado: '#FDEDEC',
};

const METODOS = [
  { id: 1, nombre: 'Efectivo', icon: 'bi-cash',        desc: 'EFECTIVO' },
  { id: 2, nombre: 'Tarjeta',  icon: 'bi-credit-card', desc: 'TARJETA'  },
  { id: 3, nombre: 'Mixto',    icon: 'bi-shuffle',     desc: 'MIXTO'    },
];


/* ── ConfirmModal ────────────────────────────────────────────────── */
function ConfirmModal({ msg, onConfirm, onCancel }) {
  if (!msg) return null;
  return (
    <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.4)' }} tabIndex="-1">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content" style={{ borderRadius: 'var(--radius-md)', border: 'none' }}>
          <div className="modal-body p-4">
            <h5 className="fw-bold mb-2">Confirmar acción</h5>
            <p className="text-muted mb-3" style={{ fontSize: '.9rem' }}>{msg}</p>
            <div className="d-flex gap-2">
              <button className="btn flex-grow-1 py-2 fw-semibold" style={{ background: 'var(--mm-danger)', color: '#fff' }} onClick={onConfirm}>
                Confirmar
              </button>
              <button className="btn flex-grow-1 py-2" style={{ background: 'var(--mm-cream-dark)' }} onClick={onCancel}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── CancelarModal ───────────────────────────────────────────────── */
function CancelarModal({ show, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const [err, setErr] = useState(false);

  useEffect(() => { if (show) { setMotivo(''); setErr(false); } }, [show]);

  if (!show) return null;
  return (
    <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.4)' }} tabIndex="-1">
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 380 }}>
        <div className="modal-content rounded-4 border-0">
          <div className="modal-body p-4">
            <h5 className="fw-bold mb-1 text-danger"><i className="bi bi-x-circle me-2" />Cancelar pedido</h5>
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>
              Esta acción no se puede deshacer. Ingresa el motivo de cancelación.
            </p>
            <div className="mb-4">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>
                Motivo <span className="text-danger">*</span>
              </label>
              <textarea
                className="form-control rounded-3"
                rows={3}
                placeholder="ej. Cliente cambió de opinión, producto agotado…"
                style={{ borderColor: err ? 'var(--mm-danger)' : 'var(--mm-border)', fontSize: '.875rem', resize: 'none' }}
                value={motivo}
                onChange={e => { setMotivo(e.target.value); setErr(false); }}
              />
            </div>
            <button className="btn btn-danger w-100 py-2 fw-bold" onClick={() => {
              if (!motivo.trim()) { setErr(true); return; }
              onConfirm(motivo.trim());
            }}>
              Confirmar cancelación
            </button>
            <button className="btn w-100 py-2 mt-2" style={{ background: 'var(--mm-cream-dark)' }} onClick={onClose}>
              Volver
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── CancelarSolicitudModal ──────────────────────────────────────── */
function CancelarSolicitudModal({ show, onClose, onConfirm }) {
  if (!show) return null;
  return (
    <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.4)' }} tabIndex="-1">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content" style={{ borderRadius: 'var(--radius-md)', border: 'none' }}>
          <div className="modal-body p-4">
            <h5 className="fw-bold mb-1 text-danger"><i className="bi bi-x-circle me-2" />Cancelar solicitud de pago</h5>
            <p className="text-muted mb-3" style={{ fontSize: '.9rem' }}>
              ¿Confirmas que deseas cancelar esta solicitud? La mesa permanecerá activa.
            </p>
            <div className="d-flex gap-2 mt-3">
              <button className="btn flex-grow-1 py-2 fw-semibold text-danger" style={{ background: '#FDEDEC' }} onClick={onConfirm}>
                <i className="bi bi-x-circle me-1" />Sí, cancelar
              </button>
              <button className="btn flex-grow-1 py-2" style={{ background: 'var(--mm-cream-dark)' }} onClick={onClose}>
                Volver
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── PagoModal ───────────────────────────────────────────────────── */
function PagoModal({ show, mesaId, subtotal, sesionId, metodoPref, onClose, onSuccess, showToast }) {
  const [metodo, setMetodo] = useState(METODOS[0]);
  const [propina, setPropina]   = useState(0);
  const [propinaInput, setPropinaInput] = useState('');
  const [montoRec, setMontoRec] = useState('');
  const [ef, setEf]   = useState('');
  const [ta, setTa]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show) return;
    const pref = (metodoPref || '').toUpperCase();
    const found = pref ? METODOS.find(m => m.desc === pref) : null;
    setMetodo(found || METODOS[0]);
    setPropina(0); setPropinaInput('');
    setMontoRec(''); setEf(''); setTa('');
    setLoading(false);
  }, [show, metodoPref]);

  if (!show) return null;

  const total = (subtotal || 0) + propina;

  const applyPropinaPct = pct => {
    const val = Math.round((subtotal || 0) * pct) / 100;
    setPropinaInput(val.toFixed(2));
    setPropina(val);
  };

  const cambio = parseFloat(montoRec) - total;
  const mixtoSum = (parseFloat(ef) || 0) + (parseFloat(ta) || 0);

  const handleSubmit = async () => {
    if (metodo.desc === 'EFECTIVO') {
      const m = parseFloat(montoRec) || 0;
      if (m > 0 && m < total) { showToast(`Faltan $${(total - m).toFixed(2)} para cubrir el total`, 'error'); return; }
    }
    if (metodo.desc === 'MIXTO') {
      if (mixtoSum < total) { showToast(`Faltan $${(total - mixtoSum).toFixed(2)} en pago mixto`, 'error'); return; }
    }
    setLoading(true);
    try {
      await api.post('/mesero/pago', {
        mesa_id: mesaId,
        metodo_pago_id: metodo.id,
        sesion_id: sesionId || undefined,
        propina: propina.toFixed(2),
        monto_recibido: metodo.desc === 'EFECTIVO' ? (parseFloat(montoRec) || 0).toFixed(2) : undefined,
        monto_efectivo: metodo.desc === 'MIXTO' ? (parseFloat(ef) || 0).toFixed(2) : undefined,
        monto_tarjeta:  metodo.desc === 'MIXTO' ? (parseFloat(ta) || 0).toFixed(2) : undefined,
      });
      onSuccess();
    } catch {
      showToast('Error al procesar el pago', 'error');
      setLoading(false);
    }
  };

  return (
    <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.4)' }} tabIndex="-1">
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 420 }}>
        <div className="modal-content rounded-4 border-0">
          <div className="modal-body p-4">
            <h5 className="fw-bold mb-1">Procesar pago</h5>
            <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)' }}>{sesionId ? 'Cobro individual' : 'Toda la mesa'}</p>

            {/* Desglose */}
            <div style={{ background: 'var(--mm-cream)', borderRadius: 'var(--radius-sm)', padding: '.75rem 1rem', marginBottom: '1rem' }}>
              <div className="d-flex justify-content-between" style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '.25rem' }}>
                <span>Subtotal</span><span>${(subtotal || 0).toFixed(2)}</span>
              </div>
              {propina > 0 && (
                <div className="d-flex justify-content-between" style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '.25rem' }}>
                  <span>Propina</span><span>${propina.toFixed(2)}</span>
                </div>
              )}
              <div className="d-flex justify-content-between fw-bold" style={{ fontSize: '1.2rem' }}>
                <span>Total</span><span style={{ color: 'var(--mm-green)' }}>${total.toFixed(2)}</span>
              </div>
            </div>

            {/* Métodos */}
            <p className="fw-semibold mb-2" style={{ fontSize: '.875rem' }}>Método de pago</p>
            <div className="mb-3">
              {METODOS.map(m => (
                <label key={m.id} onClick={() => setMetodo(m)}
                  style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.75rem 1rem',
                    border: `1.5px solid ${m.id === metodo.id ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                    borderRadius: 'var(--radius-sm)', marginBottom: '.4rem', cursor: 'pointer',
                    background: m.id === metodo.id ? 'var(--mm-green-pale)' : 'transparent' }}>
                  <i className={`bi ${m.icon}`} />
                  <span style={{ fontWeight: 600 }}>{m.nombre}</span>
                </label>
              ))}
            </div>

            {/* Propina */}
            <div className="mb-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>
                Propina <span style={{ color: 'var(--mm-text-muted)', fontWeight: 400, fontSize: '.78rem' }}>(opcional)</span>
              </label>
              <div className="d-flex gap-2 mb-2">
                {[10, 15, 20].map(pct => (
                  <button key={pct} type="button" className="btn btn-sm rounded-pill" style={{ background: 'var(--mm-cream-dark)', fontSize: '.78rem' }} onClick={() => applyPropinaPct(pct)}>{pct}%</button>
                ))}
                <button type="button" className="btn btn-sm rounded-pill" style={{ background: 'var(--mm-cream-dark)', fontSize: '.78rem' }} onClick={() => { setPropinaInput(''); setPropina(0); }}>Sin propina</button>
              </div>
              <div className="input-group">
                <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>$</span>
                <input type="number" className="form-control" placeholder="0.00" step="0.01" min="0"
                  value={propinaInput}
                  onChange={e => { setPropinaInput(e.target.value); setPropina(Math.max(0, parseFloat(e.target.value) || 0)); }}
                  {...numberInputHandlers()} />
              </div>
            </div>

            {/* Efectivo */}
            {metodo.desc === 'EFECTIVO' && (
              <div className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Monto recibido</label>
                <div className="input-group">
                  <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>$</span>
                  <input type="number" className="form-control" placeholder="0.00" step="0.01" min="0"
                    value={montoRec} onChange={e => setMontoRec(e.target.value)} {...numberInputHandlers()} />
                </div>
                {parseFloat(montoRec) >= total && total > 0 && (
                  <div style={{ fontSize: '.875rem', color: 'var(--mm-success)', marginTop: '.35rem' }}>
                    <i className="bi bi-cash-coin me-1" />Cambio: ${cambio.toFixed(2)}
                  </div>
                )}
                {parseFloat(montoRec) > 0 && parseFloat(montoRec) < total && (
                  <div style={{ fontSize: '.8rem', color: '#721c24', background: '#FDEDEC', borderRadius: 6, padding: '.5rem .75rem', marginTop: '.35rem' }}>
                    <i className="bi bi-exclamation-triangle-fill me-1" />Faltan ${(total - parseFloat(montoRec)).toFixed(2)} para cubrir el total
                  </div>
                )}
              </div>
            )}

            {/* Mixto */}
            {metodo.desc === 'MIXTO' && (
              <div className="mb-3">
                <div style={{ background: 'var(--mm-cream)', borderRadius: 'var(--radius-sm)', padding: '.6rem .9rem', fontSize: '.78rem', color: 'var(--mm-text-muted)', marginBottom: '.6rem' }}>
                  <i className="bi bi-shuffle me-1" />La suma debe cubrir el total a pagar
                </div>
                <div className="mb-2">
                  <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}><i className="bi bi-cash me-1" />Efectivo</label>
                  <div className="input-group">
                    <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>$</span>
                    <input type="number" className="form-control" placeholder="0.00" step="0.01" min="0" value={ef} onChange={e => setEf(e.target.value)} {...numberInputHandlers()} />
                  </div>
                </div>
                <div className="mb-1">
                  <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}><i className="bi bi-credit-card me-1" />Tarjeta</label>
                  <div className="input-group">
                    <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>$</span>
                    <input type="number" className="form-control" placeholder="0.00" step="0.01" min="0" value={ta} onChange={e => setTa(e.target.value)} {...numberInputHandlers()} />
                  </div>
                </div>
                {(parseFloat(ef) > 0 || parseFloat(ta) > 0) && (
                  <div style={{ fontSize: '.8rem', marginTop: '.35rem', padding: '.4rem .75rem', borderRadius: 6,
                    color: mixtoSum >= total ? 'var(--mm-green)' : '#721c24',
                    background: mixtoSum >= total ? 'var(--mm-green-pale)' : '#FDEDEC' }}>
                    <i className={`bi ${mixtoSum >= total ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-1`} />
                    {mixtoSum >= total ? `Correcto — $${mixtoSum.toFixed(2)}` : `Faltan $${(total - mixtoSum).toFixed(2)}`}
                  </div>
                )}
              </div>
            )}

            <button className="btn btn-primary w-100 py-3 fw-bold" onClick={handleSubmit} disabled={loading}>
              {loading ? <><span className="spinner-border spinner-border-sm me-2" />Procesando…</> : `Confirmar pago — $${total.toFixed(2)}`}
            </button>
            <button className="btn w-100 py-2 mt-2" style={{ background: 'var(--mm-cream-dark)' }} onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── SidePanel ───────────────────────────────────────────────────── */
function SidePanel({ mesaId, onClose, showToast, onMesaClosed }) {
  const [tab, setTab]       = useState('sesiones');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  // cancelar pedido modal
  const [cancelPedidoId, setCancelPedidoId] = useState(null);
  // cancelar solicitud modal
  const [cancelSolId, setCancelSolId] = useState(null);
  // confirm modal (cerrar sesion / cerrar mesa)
  const [confirmMsg, setConfirmMsg]   = useState('');
  const confirmCb = useRef(null);
  // pago modal
  const [pagoData, setPagoData] = useState(null);

  // Recarga el detalle de la mesa seleccionada. `silent=true` se usa tras
  // acciones (cancelar, entregar, pagar) para refrescar sin spinner.
  const cargar = useCallback(async (silent = false) => {
    if (!mesaId) return;
    if (!silent) setLoading(true);
    try {
      const { data: d } = await api.get(`/gerente/mesa/${mesaId}/detalle`);
      setData(d);
    } catch { /* ignore */ }
    if (!silent) setLoading(false);
  }, [mesaId]);

  useEffect(() => { setTab('sesiones'); setData(null); cargar(); }, [cargar]);

  const confirm = (msg, cb) => { setConfirmMsg(msg); confirmCb.current = cb; };

  const handleCancelPedido = async motivo => {
    try {
      await api.put(`/pedidos/${cancelPedidoId}/cancelar`, { motivo });
      setCancelPedidoId(null);
      showToast('Pedido cancelado', 'success');
      cargar(true);
    } catch { showToast('Error al cancelar', 'error'); }
  };

  const handleEntregar = async id => {
    try {
      await api.put(`/pedidos/${id}/entregar`);
      showToast('Pedido entregado', 'success');
      cargar(true);
    } catch { showToast('Error', 'error'); }
  };

  const handleCerrarSesion = (sid, alias) => {
    confirm(`¿Cerrar sesión de ${alias}?`, async () => {
      try {
        await api.post('/mesas/sesion/cerrar', { sesion_id: sid });
        showToast('Sesión cerrada', 'success');
        cargar(true);
      } catch { showToast('Error al cerrar sesión', 'error'); }
    });
  };

  const handleCerrarMesa = () => {
    confirm('¿Cerrar esta mesa? Todas las sesiones activas se cerrarán.', async () => {
      try {
        await api.post('/mesas/cerrar', { mesa_id: mesaId });
        showToast('Mesa cerrada', 'success');
        onMesaClosed();
      } catch { showToast('Error al cerrar mesa', 'error'); }
    });
  };

  const handleCancelSol = async () => {
    try {
      await api.post(`/gerente/solicitudes/${cancelSolId}/cancelar`);
      setCancelSolId(null);
      showToast('Solicitud cancelada', 'success');
      cargar(true);
    } catch { showToast('Error al cancelar solicitud', 'error'); }
  };

  const handlePagoSuccess = () => {
    setPagoData(null);
    showToast('Pago procesado correctamente', 'success');
    onMesaClosed();
  };

  const TABS = ['sesiones', 'pedidos', 'solicitudes', 'resumen'];
  const TAB_LABELS = { sesiones: 'Sesiones', pedidos: 'Pedidos', solicitudes: 'Solicitudes', resumen: 'Resumen' };

  const renderSesiones = () => {
    const sesiones = data?.sesiones || [];
    return (
      <>
        {sesiones.map(s => (
          <div key={s.id} style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)', padding: '.75rem', marginBottom: '.75rem' }}>
            <div className="d-flex align-items-center justify-content-between mb-2">
              <div className="d-flex gap-2 align-items-center">
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--mm-green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {s.alias?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{s.alias}</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>{s.pedidos.length} pedidos · ${(s.total || 0).toFixed(2)}</div>
                </div>
              </div>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-sm flex-grow-1 rounded-3" style={{ background: 'var(--mm-green)', color: '#fff', fontSize: '.78rem', border: 'none' }}>
                <i className="bi bi-plus-circle me-1" />+ Agregar pedido
              </button>
              <button className="btn btn-sm rounded-3" style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-danger)', fontSize: '.78rem', border: 'none' }} onClick={() => handleCerrarSesion(s.id, s.alias)}>
                <i className="bi bi-x-circle me-1" />Cerrar
              </button>
            </div>
          </div>
        ))}
        {sesiones.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--mm-text-muted)' }}>
            <div style={{ fontSize: '2rem' }}>🪑</div>
            <p style={{ fontSize: '.85rem', marginTop: '.5rem' }}>Sin sesiones activas</p>
          </div>
        )}
      </>
    );
  };

  const renderPedidos = () => {
    const todos = (data?.sesiones || []).flatMap(s => s.pedidos.map(p => ({ ...p, alias: s.alias })));
    if (!todos.length) return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--mm-text-muted)' }}>
        <i className="bi bi-clipboard" style={{ fontSize: '2rem' }} />
        <p style={{ fontSize: '.85rem', marginTop: '.5rem' }}>Sin pedidos</p>
      </div>
    );
    return todos.map(p => (
      <div key={p.id} style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)', padding: '.75rem', marginBottom: '.75rem' }}>
        <div className="d-flex align-items-center justify-content-between mb-1">
          <span style={{ fontWeight: 600, fontSize: '.875rem' }}>#{p.id} · {p.alias} · {p.fecha}</span>
          <span style={{ background: STATUS_BG[p.estado] || '#f5f5f5', color: STATUS_COLOR[p.estado] || '#333', borderRadius: 99, padding: '.2rem .6rem', fontSize: '.7rem', fontWeight: 700 }}>
            {p.estado_display}
          </span>
        </div>
        {(p.items || []).map((item, i) => (
          <div key={i} style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
            {item.cantidad}× {item.nombre}
            <span style={{ float: 'right' }}>${(item.subtotal || 0).toFixed(2)}</span>
            {item.notas && <div style={{ color: 'var(--mm-danger)', fontSize: '.72rem' }}><i className="bi bi-exclamation-triangle-fill me-1" />{item.notas}</div>}
          </div>
        ))}
        <div className="d-flex gap-2 mt-2">
          {p.estado === 'listo' && (
            <button className="btn btn-sm flex-grow-1 rounded-3" style={{ background: 'var(--mm-green)', color: '#fff', fontSize: '.78rem', border: 'none' }} onClick={() => handleEntregar(p.id)}>
              <i className="bi bi-check2 me-1" />Marcar entregado
            </button>
          )}
          {!['entregado', 'cancelado'].includes(p.estado) && (
            <button className="btn btn-sm rounded-3" style={{ background: '#FDEDEC', color: 'var(--mm-danger)', fontSize: '.78rem', border: 'none' }} onClick={() => setCancelPedidoId(p.id)}>
              <i className="bi bi-x-circle me-1" />Cancelar
            </button>
          )}
        </div>
      </div>
    ));
  };

  const renderSolicitudes = () => {
    const sols = data?.solicitudes || [];
    if (!sols.length) return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--mm-text-muted)' }}>
        <i className="bi bi-bell" style={{ fontSize: '2rem' }} />
        <p style={{ fontSize: '.85rem', marginTop: '.5rem' }}>Sin solicitudes</p>
      </div>
    );
    return sols.map(s => (
      <div key={s.id} style={{ border: '2px solid var(--mm-green)', background: 'var(--mm-green-pale)', borderRadius: 'var(--radius-sm)', padding: '.75rem', marginBottom: '.75rem' }}>
        <div className="d-flex justify-content-between mb-1">
          <div>
            <div style={{ fontWeight: 600, fontSize: '.875rem' }}>
              Solicitud de cuenta
              {s.metodo_pref && (
                <span style={{ fontSize: '.7rem', background: '#e8f5e9', color: '#2e7d32', borderRadius: 99, padding: '.15rem .5rem', marginLeft: '.4rem', fontWeight: 600 }}>
                  {s.metodo_pref}
                </span>
              )}
            </div>
            <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>{s.alias} · {s.tipo_display} · {s.fecha}</div>
          </div>
          <span style={{ fontWeight: 700, color: 'var(--mm-green)' }}>${(s.total || 0).toFixed(2)}</span>
        </div>
        <div className="d-flex gap-2 mt-2">
          <button className="btn btn-primary btn-sm flex-grow-1 rounded-3"
            onClick={() => setPagoData({ mesaId: data.mesa_id, subtotal: s.total, sesionId: s.sesion_id || null, metodoPref: s.metodo_pref || '' })}>
            <i className="bi bi-cash-coin me-1" />Procesar pago
          </button>
          <button className="btn btn-sm rounded-3" style={{ background: '#FDEDEC', color: 'var(--mm-danger)', border: 'none', whiteSpace: 'nowrap' }} onClick={() => setCancelSolId(s.id)}>
            <i className="bi bi-x-circle me-1" />Cancelar
          </button>
        </div>
      </div>
    ));
  };

  const renderResumen = () => {
    const total = data?.total_mesa || 0;
    const sesiones = data?.sesiones || [];
    const totalPedidos = sesiones.reduce((a, s) => a + s.pedidos.length, 0);
    return (
      <>
        <div style={{ background: 'var(--mm-green-pale)', borderRadius: 'var(--radius-sm)', padding: '1rem', textAlign: 'center', marginBottom: '1rem' }}>
          <div style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>Total consumido</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--mm-green)' }}>${total.toFixed(2)}</div>
        </div>
        <div style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)' }}>
          <div className="d-flex justify-content-between py-1" style={{ borderBottom: '1px solid var(--mm-border)' }}>
            <span>Sesiones activas</span><span>{sesiones.length}</span>
          </div>
          <div className="d-flex justify-content-between py-1">
            <span>Total pedidos</span><span>{totalPedidos}</span>
          </div>
        </div>
      </>
    );
  };

  const mesaLibre = data?.mesa_libre;
  const pin = data?.pin;

  return (
    <>
      <div style={{ width: 380, flexShrink: 0, background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--mm-border)' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <h6 className="fw-bold mb-0">Mesa {data?.numero_mesa || '—'}</h6>
              <span className="badge rounded-pill mt-1" style={{ fontSize: '.7rem', background: mesaLibre ? 'var(--mm-cream-dark)' : 'var(--mm-green-pale)', color: mesaLibre ? 'var(--mm-text-muted)' : 'var(--mm-green)' }}>
                {mesaLibre ? 'Libre' : 'Ocupada'}
              </span>
            </div>
            <button className="btn btn-link p-0" onClick={onClose} style={{ color: 'var(--mm-text-muted)' }}>
              <i className="bi bi-x-lg" />
            </button>
          </div>
          {pin && <div className="mesa-panel-pin mt-2">{pin}</div>}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--mm-border)' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '.6rem', fontSize: '.8rem', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: tab === t ? '2px solid var(--mm-green)' : '2px solid transparent',
                color: tab === t ? 'var(--mm-green)' : 'var(--mm-text-muted)' }}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {loading && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--mm-text-muted)' }}><span className="spinner-border spinner-border-sm" /></div>}
          {!loading && data && tab === 'sesiones'    && renderSesiones()}
          {!loading && data && tab === 'pedidos'     && renderPedidos()}
          {!loading && data && tab === 'solicitudes' && renderSolicitudes()}
          {!loading && data && tab === 'resumen'     && renderResumen()}
        </div>

        {/* Footer */}
        <div style={{ padding: '.75rem 1rem', borderTop: '1px solid var(--mm-border)' }}>
          {!mesaLibre && (
            <button className="btn btn-outline-danger w-100 btn-sm rounded-3" onClick={handleCerrarMesa}>
              <i className="bi bi-door-closed me-1" />Cerrar mesa
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      <CancelarModal
        show={cancelPedidoId !== null}
        onClose={() => setCancelPedidoId(null)}
        onConfirm={handleCancelPedido}
      />
      <CancelarSolicitudModal
        show={cancelSolId !== null}
        onClose={() => setCancelSolId(null)}
        onConfirm={handleCancelSol}
      />
      <PagoModal
        show={pagoData !== null}
        mesaId={pagoData?.mesaId}
        subtotal={pagoData?.subtotal}
        sesionId={pagoData?.sesionId}
        metodoPref={pagoData?.metodoPref}
        onClose={() => setPagoData(null)}
        onSuccess={handlePagoSuccess}
        showToast={showToast}
      />
      <ConfirmModal
        msg={confirmMsg}
        onConfirm={() => { const cb = confirmCb.current; setConfirmMsg(''); confirmCb.current = null; cb?.(); }}
        onCancel={() => { setConfirmMsg(''); confirmCb.current = null; }}
      />
    </>
  );
}

/* ── Dashboard (main) ────────────────────────────────────────────── */
/**
 * Vista principal del gerente: grid de mesas (floor plan) + side panel
 * de detalle al seleccionar. Se auto-refresca cada POLL_MS.
 * @returns {JSX.Element}
 */
export default function Dashboard() {
  usePageTitle('Floor Plan');
  const navigate = useNavigate();
  const _toast = useGlobalToast();
  const showToast = useCallback((msg, type = '') => {
    if (type === 'success') _toast.success(msg);
    else if (type === 'error') _toast.error(msg);
    else _toast.info(msg);
  }, [_toast]);

  const [mesas, setMesas]       = useState([]);
  const [summary, setSummary]   = useState('Cargando…');
  const [selectedId, setSelectedId] = useState(null);

  // pollRef evita disparar 2 GET en paralelo si la red está lenta y el
  // intervalo dispara antes de que termine la request anterior.
  const pollRef = useRef(false);

  // Refresca el estado de todas las mesas. Idempotente y reentrant-safe.
  const pollMesas = useCallback(async () => {
    if (pollRef.current) return;
    pollRef.current = true;
    try {
      const { data } = await api.get('/gerente/mesas-estado');
      if (!data.ok) return;
      setMesas(data.mesas);
      const ocupadas = data.mesas.filter(m => m.estado_visual !== 'libre').length;
      const libres   = data.mesas.filter(m => m.estado_visual === 'libre').length;
      setSummary(`${ocupadas} mesas activas · ${libres} libres`);
    } catch { /* ignore */ } finally {
      pollRef.current = false;
    }
  }, []);

  // Carga inicial + polling cada POLL_MS. Cleanup limpia el interval.
  useEffect(() => {
    pollMesas();
    const id = setInterval(pollMesas, POLL_MS);
    return () => clearInterval(id);
  }, [pollMesas]);

  const sidebarNav = (
    <>
      <a className="active"><i className="bi bi-grid-fill" /> Floor Plan</a>
      <div className="nav-section-label">Gestión</div>
      <a onClick={() => navigate('/gerente/menu')} style={{ cursor: 'pointer' }}><i className="bi bi-basket-fill" /> Gestión de Menú</a>
      <a onClick={() => navigate('/gerente/mesas')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-3x3-gap-fill" /> Mesas y QR</a>
      <div className="nav-section-label">Reportes</div>
      <a onClick={() => navigate('/gerente/reportes')} style={{ cursor: 'pointer' }}><i className="bi bi-bar-chart-fill" /> Reportes</a>
      <div className="nav-section-label">Admin</div>
      <a onClick={() => navigate('/gerente/empleados')} style={{ cursor: 'pointer' }}><i className="bi bi-people-fill" /> Empleados</a>
      <a onClick={() => navigate('/gerente/configuracion')} style={{ cursor: 'pointer' }}><i className="bi bi-gear-fill" /> Configuración</a>
    </>
  );

  return (
    <StaffLayout title="Floor Plan" sidebarNav={sidebarNav}>
      <div className="d-flex gap-3" style={{ height: 'calc(100vh - 56px - 3rem)', overflow: 'hidden' }}>

        {/* ── Left: mesa grid ── */}
        <div className="flex-grow-1 overflow-y-auto">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <div>
              <h5 className="fw-bold mb-0">Mesas <span style={{ fontSize: '.8rem', fontWeight: 400, color: 'var(--mm-text-muted)' }}>— Floor Plan</span></h5>
              <p style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', marginBottom: 0 }}>{summary}</p>
            </div>
          </div>

          {/* Legend */}
          <div className="d-flex gap-3 mb-3 flex-wrap">
            {[
              { dot: '#ccc',              label: 'Libre'      },
              { dot: 'var(--mm-info)',    label: 'Ocupada'    },
              { dot: 'var(--mm-gold)',    label: 'En cocina'  },
              { dot: 'var(--mm-green)',   label: 'Cobrando'   },
            ].map(l => (
              <span key={l.label} style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.dot, display: 'inline-block' }} />
                {l.label}
              </span>
            ))}
          </div>

          {/* Grid */}
          <div className="table-grid">
            {mesas.map(m => {
              const s = ESTADO_STYLES[m.estado_visual] || ESTADO_STYLES.libre;
              return (
                <div key={m.id} className={`mesa-tile ${s.cls}`} onClick={() => setSelectedId(m.id)} style={{ cursor: 'pointer' }}>
                  <div className="mesa-dot" style={{ background: s.dot }} />
                  <div className="mesa-num">{m.numero}</div>
                  <div className="mesa-label">{s.label}</div>
                  <div style={{ fontSize: '.65rem', color: 'var(--mm-text-muted)', marginTop: '.2rem' }}>
                    <i className="bi bi-people" style={{ fontSize: '.65rem' }} /> {m.clientes}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: side panel ── */}
        {selectedId && (
          <SidePanel
            key={selectedId}
            mesaId={selectedId}
            onClose={() => setSelectedId(null)}
            showToast={showToast}
            onMesaClosed={() => { setSelectedId(null); pollMesas(); }}
          />
        )}
      </div>

    </StaffLayout>
  );
}
