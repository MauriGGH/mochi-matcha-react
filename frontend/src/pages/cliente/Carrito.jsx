/**
 * Carrito.jsx — pantalla del carrito del cliente.
 * Persiste items en sessionStorage['carrito'], permite +/- cantidad, eliminar,
 * elegir entre promociones aplicables (recalcula vía /cliente/calcular-descuentos)
 * y enviar el pedido a cocina con token de idempotencia.
 *
 * Ruta: /menu/:id_sesion/carrito. Exporta: default Carrito().
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import ClienteLayout from '../../components/ClienteLayout';
import { useToast } from '../../components/Toast';

/** Carrito + selector de promo + envío a cocina del flujo cliente. Sin props. */
export default function Carrito() {
  const { id_sesion } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token_sesion = sessionStorage.getItem('token_sesion');

  const [carrito, setCarrito] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('carrito') || '[]'); } catch { return []; }
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  // ─── Promociones aplicadas en vivo ────────────────────────────────────────
  const [calc, setCalc] = useState({
    subtotal: 0, descuento: 0, total: 0,
    promociones: [], promociones_elegibles: [],
    requiere_seleccion: false, promocion_seleccionada: null,
    precios_map: {},
  });
  const [promoSel, setPromoSel] = useState(null);
  const [calculando, setCalculando] = useState(false);

  // fix#4: debounce 200ms al recalcular para no spamear al backend cuando el
  // usuario cambia de promo varias veces seguidas o edita cantidades.
  useEffect(() => {
    if (!carrito.length) {
      setCalc({
        subtotal: 0, descuento: 0, total: 0,
        promociones: [], promociones_elegibles: [],
        requiere_seleccion: false, promocion_seleccionada: null, precios_map: {},
      });
      return;
    }
    setCalculando(true);
    const items = carrito.map((c) => ({
      producto_id: c.id_producto,
      cantidad: c.cantidad,
      subtotal: c.subtotal,
    }));
    const tid = setTimeout(() => {
      api.post('/cliente/calcular-descuentos', { items, promocion_id: promoSel })
        .then(({ data }) => setCalc(data))
        .catch(() => {})
        .finally(() => setCalculando(false));
    }, 200);
    return () => clearTimeout(tid);
  }, [carrito, promoSel]);

  // Elimina ítem por índice y sincroniza con sessionStorage (compartido con MenuCliente).
  const eliminar = (idx) => {
    const nuevo = carrito.filter((_, i) => i !== idx);
    setCarrito(nuevo);
    sessionStorage.setItem('carrito', JSON.stringify(nuevo));
  };

  // Ajusta cantidad recalculando subtotal a partir del precio unitario derivado.
  const cambiarCantidad = (idx, delta) => {
    const nuevo = [...carrito];
    const item = { ...nuevo[idx] };
    const nuevaCant = Math.max(1, item.cantidad + delta);
    const unit = item.cantidad > 0 ? item.subtotal / item.cantidad : item.precio || 0;
    item.cantidad = nuevaCant;
    item.subtotal = unit * nuevaCant;
    nuevo[idx] = item;
    setCarrito(nuevo);
    sessionStorage.setItem('carrito', JSON.stringify(nuevo));
  };

  const countCarrito = carrito.reduce((s, i) => s + i.cantidad, 0);

  // Envío final a cocina. Bloquea si requiere elegir promo y no hay selección.
  // Idempotency key = token_sesion + timestamp (evita duplicados por doble-tap).
  const enviarPedido = async () => {
    if (!carrito.length || !token_sesion) return;
    if (calc.requiere_seleccion && !promoSel) {
      const msg = 'Tienes varias promociones aplicables. Elige una antes de continuar.';
      setError(msg);
      toast.warning(msg);
      return;
    }
    setEnviando(true); setError('');
    try {
      await api.post('/cliente/pedidos', {
        token_sesion,
        items: carrito,
        promocion_id: promoSel,
        token_idempotencia: `${token_sesion}-${Date.now()}`,
      });
      setCarrito([]);
      sessionStorage.setItem('carrito', '[]');
      toast.success('Pedido enviado a cocina');
      navigate(`/menu/${id_sesion}/pedidos`);
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al enviar el pedido';
      setError(msg);
      toast.error(msg);
    } finally { setEnviando(false); }
  };

  const numero_mesa = sessionStorage.getItem('numero_mesa') || '';
  const pin_mesa    = sessionStorage.getItem('pin_mesa') || '';

  return (
    <ClienteLayout idSesion={id_sesion} carritoCount={countCarrito}>
      {/* Header */}
      <header className="px-3 py-3 d-flex align-items-center justify-content-between"
        style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div className="d-flex align-items-center gap-2">
          <a onClick={() => navigate(`/menu/${id_sesion}`)} style={{ color: 'var(--mm-text)', cursor: 'pointer', textDecoration: 'none' }}>
            <i className="bi bi-arrow-left" style={{ fontSize: '1.25rem' }} />
          </a>
          <span className="fw-bold" style={{ fontSize: '1rem' }}>Tu pedido</span>
        </div>
        <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
          Mesa {numero_mesa} · <span className="fw-bold" style={{ fontFamily: 'var(--font-mono)' }}>PIN: {pin_mesa}</span>
        </span>
      </header>

      <div style={{ padding: '1rem' }}>
        {carrito.length === 0 ? (
          <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
            <i className="bi bi-cart3" style={{ fontSize: '3rem', color: 'var(--mm-border)', display: 'block', marginBottom: '1rem' }} />
            <h6 className="fw-bold mb-1" style={{ color: 'var(--mm-text-muted)' }}>Tu carrito está vacío</h6>
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>Agrega productos desde el menú</p>
            <button className="btn btn-primary mt-2" onClick={() => navigate(`/menu/${id_sesion}`)}>
              <i className="bi bi-grid-fill me-2" />Ver menú
            </button>
          </div>
        ) : (
          <>
            {carrito.map((item, idx) => {
              const precioConDesc = calc.precios_map[item.id_producto] ?? item.subtotal;
              const tienePromo = precioConDesc < item.subtotal;
              return (
                <div key={idx} className="cart-item">
                  <div className="d-flex align-items-start justify-content-between">
                    <div style={{ flex: 1 }}>
                      <div className="cart-item-name">
                        <span style={{ color: 'var(--mm-gold)', fontWeight: 700, marginRight: '.4rem' }}>{item.cantidad}×</span>
                        {item.nombre}
                      </div>
                      {item.modificadores?.length > 0 && (
                        <div className="cart-item-mods">
                          {item.modificadores.map(m => m.nombre).join(' · ')}
                        </div>
                      )}
                      {item.notas && (
                        <div style={{ fontSize: '.75rem', color: 'var(--mm-danger)', marginTop: '.25rem' }}>
                          <i className="bi bi-pencil me-1" />{item.notas}
                        </div>
                      )}
                      {/* Cantidad +/- */}
                      <div className="qty-control mt-2" style={{ width: 'fit-content' }}>
                        <button className="qty-btn" onClick={() => cambiarCantidad(idx, -1)}>−</button>
                        <span className="qty-value">{item.cantidad}</span>
                        <button className="qty-btn" onClick={() => cambiarCantidad(idx, 1)}>+</button>
                      </div>
                    </div>
                    <div className="d-flex flex-column align-items-end gap-1 ms-2">
                      {tienePromo ? (
                        <>
                          <span style={{ textDecoration: 'line-through', color: 'var(--mm-text-muted)', fontSize: '.78rem' }}>
                            ${item.subtotal.toFixed(2)}
                          </span>
                          <span className="cart-item-price" style={{ color: 'var(--mm-green)' }}>
                            ${precioConDesc.toFixed(2)}
                          </span>
                        </>
                      ) : (
                        <span className="cart-item-price">${item.subtotal.toFixed(2)}</span>
                      )}
                      <button
                        onClick={() => eliminar(idx)}
                        style={{ background: 'none', border: 'none', color: 'var(--mm-text-muted)', cursor: 'pointer', padding: '.2rem' }}
                      >
                        <i className="bi bi-trash3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* fix#4: Picker de promociones con radio buttons reales (espejo de
                apps/cliente/templates/cliente/carrito.html, función JS
                _renderOpcionesPromo). Solo se muestra si hay >1 elegible. */}
            {calc.promociones_elegibles?.length > 1 && (
              <div
                id="promoPicker"
                className="mt-3"
                style={{
                  background: 'var(--mm-cream)',
                  border: '1.5px solid var(--mm-green)',
                  borderRadius: 'var(--radius-md)',
                  padding: '.85rem 1rem',
                }}
              >
                <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--mm-green)', marginBottom: '.35rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <i className="bi bi-tag-fill" /> ELIGE UNA PROMOCIÓN
                </div>
                <div style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)', marginBottom: '.65rem' }}>
                  Solo se puede aplicar una promoción por pedido.
                </div>

                {calc.promociones_elegibles.map((p) => {
                  const sel = promoSel === p.id;
                  return (
                    <label
                      key={p.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '.6rem',
                        padding: '.55rem .75rem',
                        border: `1.5px solid ${sel ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                        background: sel ? 'var(--mm-green-pale)' : '#fff',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        marginBottom: '.4rem',
                      }}
                    >
                      <input
                        type="radio"
                        name="promo_elegida"
                        value={p.id}
                        checked={sel}
                        onChange={() => setPromoSel(p.id)}
                        style={{ accentColor: 'var(--mm-green)' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--mm-text)' }}>{p.titulo}</div>
                        {p.descripcion && (
                          <div style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)' }}>{p.descripcion}</div>
                        )}
                      </div>
                    </label>
                  );
                })}

                {promoSel && (
                  <button
                    type="button"
                    onClick={() => setPromoSel(null)}
                    style={{
                      background: 'none', border: 'none', color: 'var(--mm-text-muted)',
                      fontSize: '.7rem', textDecoration: 'underline',
                      cursor: 'pointer', padding: 0, marginTop: '.2rem',
                    }}
                  >
                    Quitar promoción seleccionada
                  </button>
                )}
              </div>
            )}

            {error && <div className="alert alert-danger py-2 px-3 mb-3 mt-3" style={{ fontSize: '.875rem' }}>{error}</div>}

            {/* Total bar con desglose */}
            <div className="cart-total-bar mt-3 mb-3">
              <div className="d-flex justify-content-between mb-1" style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
                <span>Subtotal ({countCarrito} {countCarrito === 1 ? 'artículo' : 'artículos'})</span>
                <span>${calc.subtotal.toFixed(2)}</span>
              </div>
              {calc.descuento > 0 && (
                <div className="d-flex justify-content-between mb-1" style={{ fontSize: '.875rem', color: 'var(--mm-success)' }}>
                  <span>
                    <i className="bi bi-tag-fill me-1" />
                    Promoción
                    {calc.promociones?.[0] && ` · ${calc.promociones[0].titulo}`}
                  </span>
                  <span>−${calc.descuento.toFixed(2)}</span>
                </div>
              )}
              <div className="d-flex justify-content-between fw-bold" style={{ fontSize: '1.1rem', borderTop: '1px solid var(--mm-border)', paddingTop: '.75rem', marginTop: '.5rem' }}>
                <span>Total</span>
                <span style={{ color: 'var(--mm-green)' }}>
                  ${calc.total.toFixed(2)}
                  {calculando && <span className="spinner-border spinner-border-sm ms-2" style={{ width: 12, height: 12 }} />}
                </span>
              </div>
            </div>

            <button
              className="btn btn-primary w-100 py-3 fw-bold mb-2"
              onClick={enviarPedido}
              disabled={enviando || calculando}
            >
              {enviando ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-send-fill me-2" />}
              {enviando ? 'Enviando…' : 'Enviar a cocina'}
            </button>

            <button
              className="btn w-100 py-2"
              style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text)', fontSize: '.9rem' }}
              onClick={() => navigate(`/menu/${id_sesion}`)}
            >
              Seguir agregando
            </button>
          </>
        )}
      </div>
    </ClienteLayout>
  );
}
