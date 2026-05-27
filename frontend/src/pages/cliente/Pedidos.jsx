/**
 * Pedidos.jsx — pantalla "Mis pedidos" del cliente.
 * Lista los pedidos activos de la sesión con stepper visual de estado
 * (recibido → preparando → listo), polling cada 5s y modal "Pedir la cuenta"
 * con soporte para PayPal (orden + redirect + captura al volver).
 *
 * Ruta: /menu/:id_sesion/pedidos. Exporta: default Pedidos().
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import ClienteLayout from '../../components/ClienteLayout';
import { useToast } from '../../components/Toast';
import { numberInputHandlers } from '../../utils/numberInput';

// Estados visibles en el stepper (los otros — entregado, cancelado — solo se muestran como badge).
const STEP_ESTADOS = ['recibido', 'preparando', 'listo'];
const STEP_ICONS   = ['bi-check', 'bi-fire', 'bi-check'];
const STEP_LABELS  = ['Recibido', 'Preparando', 'Listo'];

const ESTADO_BADGE = {
  recibido:  'Recibido',
  preparando: 'Preparando',
  listo:     'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Badge de estado con clase CSS contextual (status-recibido, status-listo, …). */
function StatusBadge({ estado }) {
  return <span className={`order-status-badge status-${estado}`}>{ESTADO_BADGE[estado] || estado}</span>;
}

/** Stepper visual con 3 nodos para los estados pre-entrega. Si el estado no
 *  está en STEP_ESTADOS (ej. 'entregado' o 'cancelado') no se renderiza. */
function Stepper({ estado }) {
  const idx = STEP_ESTADOS.indexOf(estado);
  if (!STEP_ESTADOS.includes(estado)) return null;
  return (
    <>
      <div className="order-steps mb-2">
        {STEP_ESTADOS.map((s, i) => (
          <span key={s} style={{ display: 'contents' }}>
            <div className={`step-dot${i < idx ? ' done' : i === idx ? ' current' : ''}`}>
              <i className={`bi ${STEP_ICONS[i]}`} style={{ fontSize: '.6rem' }} />
            </div>
            {i < STEP_ESTADOS.length - 1 && (
              <div className={`step-line${i < idx ? ' done' : ''}`} />
            )}
          </span>
        ))}
      </div>
      <div className="d-flex justify-content-between mb-2" style={{ fontSize: '.68rem', color: 'var(--mm-text-muted)', padding: '0 2px' }}>
        {STEP_LABELS.map(l => <span key={l}>{l}</span>)}
      </div>
    </>
  );
}

/** Pantalla "Mis pedidos" del cliente. Sin props (toma id_sesion de la URL). */
export default function Pedidos() {
  const { id_sesion } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token_sesion = sessionStorage.getItem('token_sesion');
  const toast = useToast();

  const [pedidos, setPedidos]             = useState([]);
  const [sesion, setSesion]               = useState(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [tipoCobro, setTipoCobro]         = useState('grupal');
  const [metodoPago, setMetodoPago]       = useState('EFECTIVO');
  const [propinaPct, setPropinaPct]       = useState(10); // %
  const [propinaCustom, setPropinaCustom] = useState(''); // monto manual
  const [solicitando, setSolicitando]     = useState(false);
  const [cuentaPagada, setCuentaPagada]   = useState(false);
  const [showPaidModal, setShowPaidModal] = useState(false);
  const [paypalCfg, setPaypalCfg]         = useState({ enabled: false });
  const [paypalStatus, setPaypalStatus]   = useState(''); // ok / cancelado / capturando
  const [paypalError, setPaypalError]     = useState('');
  const shownPaid = useRef(false);

  const total = pedidos.reduce(
    (acc, p) => acc + (p.detalles || []).reduce((s, d) => s + parseFloat(d.subtotal_calculado || 0), 0),
    0
  );

  const propinaMonto = (() => {
    if (propinaCustom !== '') return Math.max(0, parseFloat(propinaCustom) || 0);
    return parseFloat((total * propinaPct / 100).toFixed(2));
  })();

  // Poll de pedidos + estado de sesión. Salta cuando la pestaña está oculta
  // (`visibilityState`) para ahorrar requests. Detecta transición a 'pagada'/'cerrada'
  // y dispara el modal "Cuenta pagada" una sola vez (shownPaid ref).
  const cargarPedidos = useCallback(async () => {
    if (!token_sesion) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      const { data } = await api.get(`/cliente/pedidos?token_sesion=${token_sesion}`);
      setPedidos(data.pedidos || []);
      setSesion(data.sesion || null);
      if (!shownPaid.current && (data.sesion?.estado === 'pagada' || data.sesion?.estado === 'cerrada')) {
        shownPaid.current = true;
        setCuentaPagada(true);
        setShowPaidModal(true);
      }
    } catch { /* sesión cerrada o token inválido — silencioso */ }
  }, [token_sesion]);

  // Polling cada 5s + refresh inmediato al recuperar el foco (visibilitychange).
  useEffect(() => {
    cargarPedidos();
    const id = setInterval(cargarPedidos, 5000);
    const onVis = () => { if (document.visibilityState === 'visible') cargarPedidos(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [cargarPedidos]);

  // Inicialización PayPal: lee config (enabled/disabled) y procesa la URL de
  // retorno desde PayPal (?paypal_ok=1 → capturar, ?paypal_cancelado=1 → banner).
  useEffect(() => {
    api.get('/cliente/paypal/config').then(({ data }) => setPaypalCfg(data)).catch(() => {});

    const paypal_ok = searchParams.get('paypal_ok');
    const paypal_cancelado = searchParams.get('paypal_cancelado');
    if (paypal_cancelado === '1') {
      setPaypalStatus('cancelado');
      setPaypalError('Pago cancelado en PayPal.');
      // limpia search params
      setSearchParams({}, { replace: true });
    } else if (paypal_ok === '1') {
      const token = searchParams.get('token') || searchParams.get('order_id');
      const pendiente = sessionStorage.getItem('paypal_pendiente');
      if (token && pendiente) {
        const { tipo, propina } = JSON.parse(pendiente);
        setPaypalStatus('capturando');
        capturarPaypal(token, tipo, propina);
      }
      setSearchParams({}, { replace: true });
    }
  }, []);

  // Captura de orden PayPal post-redirect (server-side llama a /v2/checkout/orders/:id/capture).
  const capturarPaypal = async (order_id, tipo, propina) => {
    try {
      const { data } = await api.post('/cliente/paypal/capturar', {
        token_sesion, order_id, tipo, propina,
      });
      sessionStorage.removeItem('paypal_pendiente');
      setPaypalStatus('ok');
      setShowBillModal(false);
      // El polling de cargarPedidos detectará el cambio a "pagada".
    } catch (err) {
      setPaypalStatus('error');
      setPaypalError(err.response?.data?.error || 'Error al capturar el pago de PayPal.');
    }
  };

  // Submit del modal "Pedir la cuenta". Para PayPal crea la orden, guarda
  // contexto en sessionStorage y redirige; para otros métodos solo notifica al
  // mesero (propina la cobra él en persona, ver fix#2 Bug C).
  const pedirCuenta = async () => {
    setSolicitando(true);
    setPaypalError('');
    try {
      if (metodoPago === 'PAYPAL') {
        if (!paypalCfg.enabled) {
          setPaypalError('PayPal no está disponible en este momento. Usa otro método.');
          setSolicitando(false);
          return;
        }
        const { data } = await api.post('/cliente/paypal/orden', {
          token_sesion, tipo: tipoCobro, propina: propinaMonto,
        });
        if (!data.ok) {
          setPaypalError(data.error || 'No se pudo iniciar el pago en PayPal.');
          setSolicitando(false);
          return;
        }
        sessionStorage.setItem('paypal_pendiente', JSON.stringify({
          tipo: tipoCobro,
          propina: propinaMonto,
          order_id: data.order_id,
        }));
        // Redirige a PayPal para aprobar
        window.location.href = data.approve_url;
        return;
      }

      // Efectivo / Tarjeta / Mixto → notificar mesero (fix#2 Bug C: el mesero
      // gestiona la propina presencial, el cliente NO la envía).
      await api.post('/cliente/pago', {
        token_sesion,
        tipo: tipoCobro,
        metodo_preferido: metodoPago,
        propina: 0,
      });
      setShowBillModal(false);
    } catch (err) {
      setPaypalError(err.response?.data?.error || 'Error al solicitar la cuenta');
    } finally { setSolicitando(false); }
  };

  // Envía alerta 'ayuda' al mesero con rate-limit de 30s por sesión.
  const llamarMesero = async () => {
    // Cooldown 30s (toast.canSend) para evitar spam al mesero.
    if (!toast.canSend(`alerta:${token_sesion}`, 30000)) {
      toast.warning('Ya enviaste una alerta hace poco. Espera unos segundos antes de enviar otra.');
      return;
    }
    try {
      await api.post('/cliente/alerta', { token_sesion, tipo: 'ayuda', mensaje: '' });
      toast.success('Mesero notificado. Te atenderá en breve.');
    } catch {
      toast.error('No se pudo notificar al mesero. Intenta de nuevo.');
    }
  };

  // Cierra la sesión de cliente: borra todo el sessionStorage y vuelve a la raíz.
  const salirSesion = () => {
    sessionStorage.clear();
    navigate('/');
  };

  const carrito = JSON.parse(sessionStorage.getItem('carrito') || '[]');
  const countCarrito = carrito.reduce((s, i) => s + i.cantidad, 0);

  const METODOS = [
    { val: 'EFECTIVO', icon: 'bi-cash',        label: 'Efectivo' },
    { val: 'TARJETA',  icon: 'bi-credit-card', label: 'Tarjeta'  },
    { val: 'PAYPAL',   icon: 'bi-paypal',      label: 'PayPal'   },
    { val: 'MIXTO',    icon: 'bi-shuffle',     label: 'Mixto'    },
  ];

  return (
    <ClienteLayout idSesion={id_sesion} carritoCount={countCarrito}>
      {/* Header */}
      <div style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="d-flex align-items-center gap-2">
          <button onClick={() => navigate(`/menu/${id_sesion}`)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--mm-text)' }}>
            <i className="bi bi-arrow-left" />
          </button>
          <span className="fw-bold" style={{ fontSize: '1rem' }}>Mis pedidos</span>
        </div>
        {sesion && (
          <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
            Mesa {sesion.numero_mesa}
            {sesion.pin_mesa && (
              <> · <span className="fw-bold" style={{ fontFamily: 'var(--font-mono)', color: 'var(--mm-text)' }}>PIN: {sesion.pin_mesa}</span></>
            )}
          </span>
        )}
      </div>

      <div style={{ padding: '1rem' }}>

        {/* Cuenta pagada banner */}
        {cuentaPagada && (
          <div style={{ background: '#EAFAF1', border: '1px solid #2ECC71', color: '#1E8449', borderRadius: 'var(--radius-sm)', padding: '.7rem .85rem', marginBottom: '.85rem', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <i className="bi bi-check-circle-fill" style={{ fontSize: '1.1rem' }} />
            <div style={{ flex: 1, fontSize: '.82rem', lineHeight: 1.25 }}>
              <strong>Cuenta pagada.</strong> Puedes seguir viendo tus pedidos aquí.
            </div>
            <button className="btn btn-sm rounded-3 fw-semibold" style={{ background: '#1E8449', color: '#fff', fontSize: '.75rem' }} onClick={salirSesion}>
              <i className="bi bi-box-arrow-right me-1" />Salir
            </button>
          </div>
        )}

        {paypalStatus === 'cancelado' && (
          <div className="alert alert-warning py-2 px-3 mb-3" style={{ fontSize: '.85rem' }}>
            <i className="bi bi-x-circle me-2" />Pago cancelado.
          </div>
        )}
        {paypalStatus === 'capturando' && (
          <div className="alert alert-info py-2 px-3 mb-3" style={{ fontSize: '.85rem' }}>
            <span className="spinner-border spinner-border-sm me-2" />
            Capturando pago de PayPal…
          </div>
        )}
        {paypalError && paypalStatus !== 'capturando' && (
          <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '.85rem' }}>
            <i className="bi bi-exclamation-triangle me-2" />{paypalError}
          </div>
        )}

        {pedidos.length === 0 ? (
          <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
            <i className="bi bi-clipboard" style={{ fontSize: '3rem', color: 'var(--mm-border)', display: 'block', marginBottom: '1rem' }} />
            <h6 className="fw-bold mb-1">Aún no tienes pedidos</h6>
            <p style={{ fontSize: '.875rem' }}>Explora el menú y haz tu primer pedido</p>
            <button className="btn btn-primary mt-2" onClick={() => navigate(`/menu/${id_sesion}`)}>
              <i className="bi bi-grid-fill me-2" />Ver el menú
            </button>
          </div>
        ) : (
          <>
            {pedidos.map(pedido => (
              <div key={pedido.id} className="order-card mb-3">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-bold" style={{ fontSize: '.875rem' }}>Pedido #{pedido.id}</span>
                  <StatusBadge estado={pedido.estado} />
                </div>

                <Stepper estado={pedido.estado} />

                <div style={{ marginTop: '.5rem' }}>
                  {(pedido.detalles || []).map(d => (
                    <div key={d.id} style={{ fontSize: '.85rem', padding: '.25rem 0', borderBottom: '1px solid var(--mm-border)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        {d.cantidad}× {d.producto?.nombre}
                        {d.listo && pedido.estado !== 'listo' && (
                          <i className="bi bi-check-circle-fill ms-2" style={{ color: 'var(--mm-success)', fontSize: '.8rem' }} title="Listo" />
                        )}
                      </span>
                      <span style={{ color: 'var(--mm-text-muted)' }}>${parseFloat(d.subtotal_calculado || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {pedido.estado === 'preparando' && (
                  <div className="mt-2 d-flex align-items-center gap-2" style={{ fontSize: '.8rem', color: 'var(--mm-warning)' }}>
                    <span className="spinner-grow spinner-grow-sm" role="status" style={{ width: '.5rem', height: '.5rem', background: 'var(--mm-warning)' }} />
                    En preparación…
                  </div>
                )}
                {pedido.estado === 'listo' && (
                  <div className="mt-2 d-flex align-items-center gap-2" style={{ fontSize: '.8rem', color: 'var(--mm-success)' }}>
                    <i className="bi bi-check-circle-fill" /> ¡Listo! Tu mesero lo llevará pronto
                  </div>
                )}
              </div>
            ))}

            {/* Total */}
            <div className="cart-total-bar mt-2 mb-4">
              <div className="d-flex justify-content-between fw-bold">
                <span>Total consumido</span>
                <span style={{ color: 'var(--mm-green)' }}>${total.toFixed(2)}</span>
              </div>
            </div>

            {!cuentaPagada && (
              <>
                <button className="btn btn-primary w-100 py-3 mb-2" onClick={() => setShowBillModal(true)}>
                  <i className="bi bi-receipt me-2" />Pedir la cuenta
                </button>
                <button className="btn w-100 py-2 mb-3" style={{ background: 'var(--mm-cream-dark)' }} onClick={llamarMesero}>
                  <i className="bi bi-bell me-2" />Llamar al mesero
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* ── MODAL: Pedir la cuenta ─── */}
      {showBillModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'var(--mm-white)', width: '100%', maxWidth: 430, borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0', padding: '2rem 1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ width: 40, height: 4, background: 'var(--mm-border)', borderRadius: 99, margin: '-1rem auto 1.5rem' }} />
            <h5 className="fw-bold mb-1">Pedir la cuenta</h5>
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
              Elige quién paga, cómo y agrega propina si gustas
            </p>

            {/* Quién paga */}
            <p className="fw-semibold mb-2" style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mm-text-muted)' }}>Quién paga</p>
            <div className="d-flex flex-column gap-2 mb-3">
              {[
                { val: 'grupal',     icon: 'bi-people-fill',  label: 'Toda la mesa',    desc: 'El grupo paga junto'   },
                { val: 'individual', icon: 'bi-person-fill',  label: 'Solo mi consumo', desc: 'Pago solo lo mío'      },
              ].map(o => (
                <div
                  key={o.val}
                  onClick={() => setTipoCobro(o.val)}
                  style={{ border: `2px solid ${tipoCobro === o.val ? 'var(--mm-green)' : 'var(--mm-border)'}`, background: tipoCobro === o.val ? 'var(--mm-green-pale)' : 'var(--mm-white)', borderRadius: 'var(--radius-md)', padding: '.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.75rem' }}
                >
                  <i className={`bi ${o.icon}`} style={{ fontSize: '1.5rem', color: 'var(--mm-green)' }} />
                  <div>
                    <div className="fw-bold" style={{ fontSize: '.83rem' }}>{o.label}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)' }}>{o.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Cómo pagar */}
            <p className="fw-semibold mb-2" style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mm-text-muted)' }}>Cómo pagar</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '1rem' }}>
              {METODOS.map(m => {
                const disabled = m.val === 'PAYPAL' && !paypalCfg.enabled;
                const sel = metodoPago === m.val;
                return (
                  <button
                    key={m.val}
                    type="button"
                    // fix#2 Bug B: añadir className 'metodo-option.selected'
                    // (alineado con apps/mesero/pago.html). Al cambiar de método,
                    // resetear propina porque solo PayPal la cobra desde el cliente.
                    className={`metodo-option${sel ? ' selected' : ''}`}
                    onClick={() => {
                      if (disabled) return;
                      setMetodoPago(m.val);
                      if (m.val !== 'PAYPAL') { setPropinaPct(0); setPropinaCustom(''); }
                    }}
                    disabled={disabled}
                    title={disabled ? 'PayPal no está configurado' : ''}
                    style={{
                      padding: '.65rem .4rem', fontSize: '.8rem', fontWeight: 600,
                      borderRadius: 'var(--radius-sm)', cursor: disabled ? 'not-allowed' : 'pointer',
                      border: `2px solid ${sel ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                      background: sel ? 'var(--mm-green-pale)' : 'var(--mm-cream-dark)',
                      color: sel ? 'var(--mm-green)' : 'inherit',
                      opacity: disabled ? 0.5 : 1,
                    }}
                  >
                    <i className={`bi ${m.icon} me-1`} />{m.label}
                  </button>
                );
              })}
            </div>

            {/* fix#2 Bug C: la propina del cliente solo aplica al flujo PayPal.
                Para Efectivo/Tarjeta/Mixto el mesero gestiona la propina al cobrar. */}
            {metodoPago === 'PAYPAL' && (
              <div className="propina-section">
                <p className="fw-semibold mb-2" style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mm-text-muted)' }}>Propina (opcional)</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.4rem', marginBottom: '.5rem' }}>
                  {[0, 10, 15, 20].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => { setPropinaPct(pct); setPropinaCustom(''); }}
                      style={{
                        padding: '.45rem .25rem', fontSize: '.78rem', fontWeight: 600,
                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        border: `2px solid ${propinaCustom === '' && propinaPct === pct ? 'var(--mm-gold)' : 'var(--mm-border)'}`,
                        background: propinaCustom === '' && propinaPct === pct ? 'var(--mm-gold-pale)' : 'var(--mm-cream-dark)',
                      }}
                    >
                      {pct === 0 ? 'Sin' : `${pct}%`}
                    </button>
                  ))}
                </div>
                <div className="input-group input-group-sm mb-3">
                  <span className="input-group-text" style={{ background: 'var(--mm-cream-dark)', border: '1px solid var(--mm-border)' }}>$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="o monto manual"
                    value={propinaCustom}
                    onChange={(e) => setPropinaCustom(e.target.value)}
                    {...numberInputHandlers()}
                    className="form-control"
                    style={{ border: '1px solid var(--mm-border)' }}
                  />
                </div>
              </div>
            )}

            {/* Resumen */}
            <div style={{ background: 'var(--mm-cream-dark)', borderRadius: 'var(--radius-sm)', padding: '.65rem .85rem', fontSize: '.82rem', marginBottom: '1rem' }}>
              <div className="d-flex justify-content-between"><span>Subtotal</span><span>${total.toFixed(2)}</span></div>
              {metodoPago === 'PAYPAL' && (
                <div className="d-flex justify-content-between"><span>Propina</span><span>${propinaMonto.toFixed(2)}</span></div>
              )}
              <div className="d-flex justify-content-between fw-bold" style={{ borderTop: '1px dashed var(--mm-border)', paddingTop: '.35rem', marginTop: '.35rem' }}>
                <span>Total a pagar</span><span style={{ color: 'var(--mm-green)' }}>${(total + (metodoPago === 'PAYPAL' ? propinaMonto : 0)).toFixed(2)}</span>
              </div>
            </div>

            {paypalError && (
              <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '.82rem' }}>{paypalError}</div>
            )}

            <button className="btn btn-primary w-100 py-3 fw-bold mb-2" onClick={pedirCuenta} disabled={solicitando}>
              {solicitando ? (
                <><span className="spinner-border spinner-border-sm me-2" />{metodoPago === 'PAYPAL' ? 'Redirigiendo a PayPal…' : 'Procesando…'}</>
              ) : (
                <>
                  {metodoPago === 'PAYPAL'
                    ? <><i className="bi bi-paypal me-2" />Pagar con PayPal</>
                    : <><i className="bi bi-bell me-2" />Notificar al mesero</>}
                </>
              )}
            </button>
            {metodoPago !== 'PAYPAL' && (
              <p style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', textAlign: 'center', marginBottom: '1rem' }}>El mesero se acercará a cobrar</p>
            )}
            <button className="btn w-100 py-2" style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text-muted)' }} onClick={() => setShowBillModal(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: Cuenta pagada ─── */}
      {showPaidModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--mm-white)', width: '100%', maxWidth: 390, borderRadius: 'var(--radius-xl)', padding: '2rem 1.5rem' }}>
            <div className="text-center mb-3">
              <i className="bi bi-receipt" style={{ fontSize: '3.5rem', lineHeight: 1, color: 'var(--mm-green)', display: 'block' }} />
              <h5 className="fw-bold mt-2 mb-1">¡Cuenta pagada!</h5>
              <p style={{ fontSize: '.82rem', color: 'var(--mm-text-muted)', margin: 0 }}>
                Tu cuenta ya fue saldada. ¡Gracias por tu visita!
              </p>
            </div>

            <div style={{ background: 'var(--mm-cream)', borderRadius: 'var(--radius-sm)', padding: '.75rem 1rem', fontSize: '.82rem', marginBottom: '1rem' }}>
              {sesion?.numero_mesa && (
                <div className="d-flex justify-content-between py-1">
                  <span style={{ color: 'var(--mm-text-muted)' }}>Mesa</span>
                  <span className="fw-semibold">{sesion.numero_mesa}</span>
                </div>
              )}
              {sesion?.alias && (
                <div className="d-flex justify-content-between py-1">
                  <span style={{ color: 'var(--mm-text-muted)' }}>Cliente</span>
                  <span className="fw-semibold">{sesion.alias}</span>
                </div>
              )}
              <div className="d-flex justify-content-between fw-bold py-1" style={{ fontSize: '.9rem', borderTop: '1px dashed var(--mm-border)', marginTop: '.5rem', paddingTop: '.5rem' }}>
                <span>Total consumido</span>
                <span style={{ color: 'var(--mm-green)' }}>${total.toFixed(2)}</span>
              </div>
            </div>

            <button className="btn btn-primary w-100 py-3 fw-bold rounded-3 mb-2" onClick={() => navigate(`/menu/${id_sesion}/ticket`)}>
              <i className="bi bi-receipt me-2" />Ver mi ticket
            </button>
            <button className="btn w-100 py-2 rounded-3 mb-2" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => setShowPaidModal(false)}>
              <i className="bi bi-eye me-2" />Seguir viendo mis pedidos
            </button>
            <button className="btn w-100 py-2 rounded-3" style={{ color: 'var(--mm-text-muted)', fontSize: '.8rem' }} onClick={salirSesion}>
              <i className="bi bi-box-arrow-right me-1" />Salir
            </button>
          </div>
        </div>
      )}
    </ClienteLayout>
  );
}
