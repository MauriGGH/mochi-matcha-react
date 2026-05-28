/**
 * AsistidoModal.jsx — modal "pedido asistido" para el mesero.
 * Se usa desde MeseroPanel/MapaMesas cuando el mesero registra un pedido por
 * teléfono o presencialmente en nombre de un cliente. Recibe la sesión y al
 * confirmar llama POST /api/mesero/asistido con token de idempotencia.
 *
 * Exporta: default AsistidoModal({ sesion, onClose, onSuccess }).
 */
import { useEffect, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';
import CharCounter from '../../components/forms/CharCounter';
import { upperOnChange } from '../../hooks/useUpperInput';

/**
 * Pedido asistido — el mesero arma un pedido en nombre de una sesión existente.
 *
 * Flujo (igual que mochi-matcha-production):
 *   1) Selector de productos (grid por categoría)
 *   2) Detalle del producto: modificadores, notas, cantidad
 *   3) Carrito acumulado + selector de promoción + total
 *   4) Confirmar → POST /api/mesero/asistido
 *
 * @param {object}   props
 * @param {object}   props.sesion    Sesión destino (id, alias, …).
 * @param {Function} props.onClose   Cerrar modal (cancelar).
 * @param {Function} props.onSuccess Pedido enviado OK (refrescar lista del panel).
 */
export default function AsistidoModal({ sesion, onClose, onSuccess }) {
  const toast = useToast();
  const [categorias, setCategorias] = useState([]);
  const [catActiva, setCatActiva] = useState(null);
  const [productoSel, setProductoSel] = useState(null);
  const [qty, setQty] = useState(1);
  const [notas, setNotas] = useState('');
  const [mods, setMods] = useState({});
  const [carrito, setCarrito] = useState([]);
  const [calc, setCalc] = useState({ subtotal: 0, descuento: 0, total: 0, promociones_elegibles: [], requiere_seleccion: false });
  const [promoSel, setPromoSel] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [menuError, setMenuError] = useState(false);

  // Carga inicial del catálogo. Selecciona la primera categoría por defecto.
  useEffect(() => {
    api.get('/menu').then(({ data }) => {
      setCategorias(data);
      if (data.length) setCatActiva(data[0].id);
    }).catch(() => setMenuError(true));
  }, []);

  // Recalcular descuentos en vivo (fix#4: debounce 200ms para no spamear).
  useEffect(() => {
    if (!carrito.length) {
      setCalc({ subtotal: 0, descuento: 0, total: 0, promociones_elegibles: [], requiere_seleccion: false });
      return;
    }
    const items = carrito.map((c) => ({
      producto_id: c.id_producto, cantidad: c.cantidad, subtotal: c.subtotal,
    }));
    const tid = setTimeout(() => {
      api.post('/cliente/calcular-descuentos', { items, promocion_id: promoSel })
        .then(({ data }) => setCalc(data))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(tid);
  }, [carrito, promoSel]);

  // Abre la vista de detalle del producto en la columna izquierda (resetea estado).
  const abrirProducto = (p) => {
    setProductoSel(p); setQty(1); setNotas(''); setMods({});
  };

  // Toggle de opción dentro de un grupo de modificadores. Reemplaza si el grupo es 'única'.
  const toggleMod = (gid, oid, tipo) => {
    setMods((prev) => {
      const grupo = prev[gid] || [];
      if (tipo === 'única') return { ...prev, [gid]: [oid] };
      if (grupo.includes(oid)) return { ...prev, [gid]: grupo.filter((x) => x !== oid) };
      return { ...prev, [gid]: [...grupo, oid] };
    });
  };

  // Suma de precio_extra de todas las opciones seleccionadas en el detalle actual.
  const precioExtra = () => {
    if (!productoSel) return 0;
    let extra = 0;
    for (const g of productoSel.grupos_modificadores || []) {
      const sel = mods[g.id] || [];
      for (const op of g.opciones || []) {
        if (sel.includes(op.id)) extra += parseFloat(op.precio_extra || 0);
      }
    }
    return extra;
  };

  // Valida los grupos obligatorios y empuja el item al carrito local (no llama al backend).
  const agregarAlCarrito = () => {
    if (!productoSel) return;
    // Validar grupos obligatorios sin selección
    for (const g of productoSel.grupos_modificadores || []) {
      if (g.es_obligatorio && !(mods[g.id]?.length)) {
        toast.warning(`Debes seleccionar una opción en "${g.nombre_grupo}"`);
        return;
      }
    }
    const precio = parseFloat(productoSel.precio) + precioExtra();
    const modsList = [];
    for (const g of productoSel.grupos_modificadores || []) {
      const sel = mods[g.id] || [];
      for (const op of g.opciones || []) {
        if (sel.includes(op.id)) {
          modsList.push({
            id_opcion: op.id, nombre: op.nombre_opcion,
            precio_extra: parseFloat(op.precio_extra || 0),
          });
        }
      }
    }
    setCarrito((prev) => [...prev, {
      id_producto: productoSel.id,
      nombre: productoSel.nombre,
      cantidad: qty,
      notas: notas.trim() || '',
      modificadores: modsList,
      subtotal: precio * qty,
    }]);
    toast.info(`${productoSel.nombre} agregado al carrito`);
    setProductoSel(null);
  };

  // Quita un item del carrito por índice (no recalcula descuentos: useEffect lo hace).
  const eliminarDelCarrito = (idx) => {
    setCarrito((prev) => prev.filter((_, i) => i !== idx));
  };

  // Submit final: POST a /mesero/asistido con token de idempotencia para evitar
  // duplicados por doble-click. Sigue el mismo contrato que /cliente/pedidos.
  const confirmarPedido = async () => {
    if (!carrito.length) return;
    if (calc.requiere_seleccion && !promoSel) {
      toast.warning('Hay varias promociones aplicables. Elige una antes de continuar.');
      return;
    }
    setEnviando(true);
    try {
      await api.post('/mesero/asistido', {
        sesion_id: sesion.id,
        items: carrito,
        promocion_id: promoSel,
        token_idempotencia: `mesero-${sesion.id}-${Date.now()}`,
      });
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al enviar el pedido');
    } finally { setEnviando(false); }
  };

  const catActual = categorias.find((c) => c.id === catActiva);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h5 className="fw-bold mb-0">Pedido asistido</h5>
            <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', margin: 0 }}>
              Para <strong>{sesion.alias}</strong>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Columna izquierda: catálogo o detalle */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', borderRight: '1px solid var(--mm-border)' }}>
            {menuError && (
              <div className="alert alert-danger d-flex align-items-center gap-2" role="alert">
                <i className="bi bi-exclamation-circle-fill" />
                No se pudo cargar el menú.
                <button className="btn btn-sm btn-outline-danger ms-auto"
                  onClick={() => { setMenuError(false); api.get('/menu').then(({ data }) => { setCategorias(data); if (data.length) setCatActiva(data[0].id); }).catch(() => setMenuError(true)); }}>
                  Reintentar
                </button>
              </div>
            )}
            {productoSel ? (
              // Detalle producto
              <>
                <button onClick={() => setProductoSel(null)} className="btn btn-sm mb-3" style={{ background: 'var(--mm-cream-dark)' }}>
                  <i className="bi bi-arrow-left me-1" />Volver al catálogo
                </button>
                <div className="d-flex align-items-start gap-3 mb-3">
                  <div style={{ flex: 1 }}>
                    <h6 className="fw-bold mb-1">{productoSel.nombre}</h6>
                    <div style={{ color: 'var(--mm-green)', fontWeight: 700, fontSize: '1.1rem' }}>
                      ${parseFloat(productoSel.precio).toFixed(2)}
                    </div>
                    {productoSel.descripcion && (
                      <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginTop: '.4rem' }}>{productoSel.descripcion}</p>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="btn btn-sm rounded-circle" style={{ background: 'var(--mm-cream-dark)', width: 32, height: 32, padding: 0 }}>−</button>
                    <span style={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{qty}</span>
                    <button onClick={() => setQty((q) => q + 1)} className="btn btn-sm rounded-circle" style={{ background: 'var(--mm-green)', color: '#fff', width: 32, height: 32, padding: 0 }}>+</button>
                  </div>
                </div>

                {(productoSel.grupos_modificadores || []).map((g) => (
                  <div key={g.id} className="mb-3">
                    <div style={{ fontWeight: 600, fontSize: '.85rem', marginBottom: '.4rem' }}>
                      {g.nombre_grupo}
                      {g.es_obligatorio && <span style={{ color: 'var(--mm-danger)', marginLeft: '.3rem' }}>*</span>}
                    </div>
                    {(g.opciones || []).map((op) => {
                      const sel = (mods[g.id] || []).includes(op.id);
                      return (
                        <label key={op.id} onClick={() => toggleMod(g.id, op.id, g.tipo)} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '.5rem .75rem',
                          border: `1px solid ${sel ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                          background: sel ? 'var(--mm-green-pale)' : '#fff',
                          borderRadius: 6, marginBottom: '.3rem', cursor: 'pointer',
                        }}>
                          <span style={{ fontSize: '.85rem' }}>
                            <input type={g.tipo === 'única' ? 'radio' : 'checkbox'} checked={sel} readOnly style={{ marginRight: '.5rem' }} />
                            {op.nombre_opcion}
                          </span>
                          <span style={{ fontSize: '.78rem', color: parseFloat(op.precio_extra) > 0 ? 'var(--mm-gold)' : 'var(--mm-success)', fontWeight: 600 }}>
                            {parseFloat(op.precio_extra) > 0 ? `+$${parseFloat(op.precio_extra).toFixed(2)}` : 'Gratis'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}

                <div className="mb-3">
                  <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Notas especiales</label>
                  <input type="text" className="form-control" maxLength={100}
                    placeholder="SIN CEBOLLA, EXTRA PICANTE…"
                    style={{ textTransform: 'uppercase' }}
                    value={notas} onChange={upperOnChange(setNotas, 100)} />
                  <CharCounter value={notas} max={100} />
                </div>

                <div className="d-flex align-items-center justify-content-between p-3" style={{ background: 'var(--mm-cream)', borderRadius: 6, marginBottom: '1rem' }}>
                  <span className="fw-semibold">Subtotal</span>
                  <span className="fw-bold" style={{ fontSize: '1.1rem', color: 'var(--mm-green)' }}>
                    ${((parseFloat(productoSel.precio) + precioExtra()) * qty).toFixed(2)}
                  </span>
                </div>

                <button className="btn btn-primary w-100 py-2 fw-bold" onClick={agregarAlCarrito}>
                  <i className="bi bi-plus-circle me-2" />Agregar al pedido
                </button>
              </>
            ) : (
              // Catálogo
              <>
                <div style={{ display: 'flex', gap: '.4rem', overflowX: 'auto', marginBottom: '1rem' }}>
                  {categorias.map((cat) => (
                    <button key={cat.id} onClick={() => setCatActiva(cat.id)}
                      style={{
                        padding: '.4rem .85rem', whiteSpace: 'nowrap',
                        background: catActiva === cat.id ? 'var(--mm-green)' : 'var(--mm-cream-dark)',
                        color: catActiva === cat.id ? '#fff' : 'var(--mm-text)',
                        border: 'none', borderRadius: 99, fontSize: '.78rem', fontWeight: 600,
                        cursor: 'pointer',
                      }}>{cat.nombre}</button>
                  ))}
                </div>
                <div className="row g-2">
                  {(catActual?.productos || []).map((p) => (
                    <div key={p.id} className="col-6">
                      <div onClick={() => p.disponible && abrirProducto(p)}
                        style={{
                          border: '1px solid var(--mm-border)', borderRadius: 8, padding: '.6rem',
                          cursor: p.disponible ? 'pointer' : 'not-allowed',
                          opacity: p.disponible ? 1 : 0.5,
                          transition: 'all .15s',
                        }}>
                        {p.imagen_url && (
                          <img src={p.imagen_url} alt={p.nombre}
                            style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, marginBottom: '.4rem' }} />
                        )}
                        <div style={{ fontSize: '.82rem', fontWeight: 600, lineHeight: 1.2 }}>{p.nombre}</div>
                        <div style={{ fontSize: '.78rem', color: 'var(--mm-green)', fontWeight: 700, marginTop: '.2rem' }}>
                          ${parseFloat(p.precio).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Columna derecha: carrito */}
          <div style={{ width: 320, overflowY: 'auto', padding: '1rem 1.25rem', background: 'var(--mm-cream)' }}>
            <h6 className="fw-bold mb-2">Pedido actual</h6>
            {carrito.length === 0 ? (
              <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)' }}>Aún no hay productos</p>
            ) : (
              <>
                {carrito.map((item, idx) => {
                  const precioConDesc = calc.precios_map?.[item.id_producto] ?? item.subtotal;
                  const tienePromo = precioConDesc < item.subtotal;
                  return (
                    <div key={idx} style={{ background: '#fff', padding: '.5rem .65rem', borderRadius: 6, marginBottom: '.4rem', fontSize: '.82rem' }}>
                      <div className="d-flex justify-content-between">
                        <span><strong>{item.cantidad}×</strong> {item.nombre}</span>
                        <button onClick={() => eliminarDelCarrito(idx)} style={{ background: 'none', border: 'none', color: 'var(--mm-danger)', cursor: 'pointer', padding: 0 }}>
                          <i className="bi bi-trash3" />
                        </button>
                      </div>
                      {item.modificadores?.length > 0 && (
                        <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)' }}>
                          {item.modificadores.map((m) => m.nombre).join(' · ')}
                        </div>
                      )}
                      {item.notas && (
                        <div style={{ fontSize: '.7rem', color: 'var(--mm-danger)' }}>📝 {item.notas}</div>
                      )}
                      <div style={{ textAlign: 'right', marginTop: '.2rem' }}>
                        {tienePromo ? (
                          <>
                            <span style={{ textDecoration: 'line-through', color: 'var(--mm-text-muted)', fontSize: '.72rem', marginRight: '.3rem' }}>
                              ${item.subtotal.toFixed(2)}
                            </span>
                            <strong style={{ color: 'var(--mm-green)' }}>${precioConDesc.toFixed(2)}</strong>
                          </>
                        ) : (
                          <strong>${item.subtotal.toFixed(2)}</strong>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* fix#4: picker alineado con el del cliente (recuadro verde,
                    radio buttons, descripción visible). */}
                {calc.promociones_elegibles?.length > 1 && (
                  <div
                    id="promoPickerAsistido"
                    style={{
                      background: 'var(--mm-cream)',
                      border: '1.5px solid var(--mm-green)',
                      borderRadius: 'var(--radius-md)',
                      padding: '.7rem .85rem',
                      marginTop: '.6rem',
                    }}
                  >
                    <div style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--mm-green)', marginBottom: '.3rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                      <i className="bi bi-tag-fill" /> ELIGE UNA PROMOCIÓN
                    </div>
                    <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)', marginBottom: '.55rem' }}>
                      Solo se puede aplicar una promoción por pedido.
                    </div>
                    {calc.promociones_elegibles.map((p) => {
                      const sel = promoSel === p.id;
                      return (
                        <label
                          key={p.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '.5rem',
                            padding: '.45rem .65rem',
                            border: `1.5px solid ${sel ? 'var(--mm-green)' : 'var(--mm-border)'}`,
                            background: sel ? 'var(--mm-green-pale)' : '#fff',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            marginBottom: '.3rem',
                          }}
                        >
                          <input
                            type="radio"
                            name="promo-asistido"
                            value={p.id}
                            checked={sel}
                            onChange={() => setPromoSel(p.id)}
                            style={{ accentColor: 'var(--mm-green)' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: '.8rem', color: 'var(--mm-text)' }}>{p.titulo}</div>
                            {p.descripcion && (
                              <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)' }}>{p.descripcion}</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                    {promoSel && (
                      <button
                        type="button"
                        onClick={() => setPromoSel(null)}
                        style={{ background: 'none', border: 'none', color: 'var(--mm-text-muted)', fontSize: '.7rem', textDecoration: 'underline', cursor: 'pointer', padding: 0, marginTop: '.2rem' }}
                      >
                        Quitar promoción seleccionada
                      </button>
                    )}
                  </div>
                )}

                {/* Totales */}
                <div style={{ marginTop: '.75rem', paddingTop: '.5rem', borderTop: '1px solid var(--mm-border)' }}>
                  <div className="d-flex justify-content-between" style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
                    <span>Subtotal</span><span>${calc.subtotal.toFixed(2)}</span>
                  </div>
                  {calc.descuento > 0 && (
                    <div className="d-flex justify-content-between" style={{ fontSize: '.78rem', color: 'var(--mm-success)' }}>
                      <span>Descuento</span><span>−${calc.descuento.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="d-flex justify-content-between fw-bold mt-1 pt-1" style={{ borderTop: '1px solid var(--mm-border)', fontSize: '.95rem' }}>
                    <span>Total</span>
                    <span style={{ color: 'var(--mm-green)' }}>${calc.total.toFixed(2)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--mm-border)', display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
          <button onClick={onClose} className="btn" style={{ background: 'var(--mm-cream-dark)' }}>Cancelar</button>
          <button className="btn btn-primary px-4 fw-bold" onClick={confirmarPedido}
            disabled={!carrito.length || enviando}>
            {enviando ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-send me-2" />}
            Enviar a cocina
          </button>
        </div>
      </div>
    </div>
  );
}
