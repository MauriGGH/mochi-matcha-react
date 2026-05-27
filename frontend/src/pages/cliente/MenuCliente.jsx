/**
 * MenuCliente.jsx — vista principal del cliente con catálogo + promos.
 * Renderiza tabs por categoría, grilla de productos y un modal con
 * modificadores/notas/cantidad. Acumula items en sessionStorage['carrito'].
 *
 * Ruta: /menu/:id_sesion. Exporta: default MenuCliente().
 */
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import ClienteLayout from '../../components/ClienteLayout';
import PromoCarousel from '../../components/PromoCarousel';
import CharCounter from '../../components/forms/CharCounter';

/** Catálogo de productos + modal de selección. Sin props (toma id_sesion de la URL). */
export default function MenuCliente() {
  const { id_sesion } = useParams();
  const navigate = useNavigate();
  const token_sesion = sessionStorage.getItem('token_sesion');

  const [categorias, setCategorias] = useState([]);
  const [promos, setPromos]         = useState([]);
  const [catActiva, setCatActiva] = useState(null);
  const [carrito, setCarrito] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('carrito') || '[]'); } catch { return []; }
  });
  const [menuError, setMenuError] = useState(false);
  const [productoModal, setProductoModal] = useState(null);
  const [qty, setQty] = useState(1);
  const [notas, setNotas] = useState('');
  const [modsSeleccionados, setModsSeleccionados] = useState({});
  const [modError, setModError] = useState('');
  const modalRef = useRef(null);

  // Carga inicial: menú por categorías + promociones activas. Sin token → fuera.
  useEffect(() => {
    if (!token_sesion) { navigate(`/`); return; }
    api.get('/menu').then(({ data }) => {
      setCategorias(data);
      if (data.length) setCatActiva(data[0].id);
    }).catch(() => setMenuError(true));
    api.get('/menu/promociones').then(({ data }) => setPromos(data)).catch(() => {});
  }, []);

  // Sincroniza el carrito con sessionStorage en cada cambio (sobrevive a navegación).
  useEffect(() => {
    sessionStorage.setItem('carrito', JSON.stringify(carrito));
  }, [carrito]);

  // Abre el modal Bootstrap del producto y resetea estado local (cantidad/notas/mods).
  const abrirModal = (producto) => {
    setProductoModal(producto);
    setQty(1); setNotas(''); setModsSeleccionados({}); setModError('');
    if (modalRef.current) {
      const m = new window.bootstrap.Modal(modalRef.current);
      m.show();
    }
  };

  // Cierra el modal Bootstrap (usado por X custom y al confirmar).
  const cerrarModal = () => {
    if (modalRef.current) {
      const m = window.bootstrap.Modal.getInstance(modalRef.current);
      if (m) m.hide();
    }
  };

  // Toggle de opción de modificador. Si el grupo es 'única' reemplaza la selección;
  // en múltiple respeta `max_selecciones`.
  const toggleMod = (grupoId, opcionId, tipo, maxSel) => {
    setModError('');
    setModsSeleccionados(prev => {
      const grupo = prev[grupoId] || [];
      const esMultiple = tipo === 'múltiple' || tipo === 'multiple' || tipo === 'checkbox';
      if (!esMultiple) return { ...prev, [grupoId]: [opcionId] };
      if (grupo.includes(opcionId)) return { ...prev, [grupoId]: grupo.filter(id => id !== opcionId) };
      if (maxSel && grupo.length >= maxSel) return prev;
      return { ...prev, [grupoId]: [...grupo, opcionId] };
    });
  };

  // Suma el precio extra de todos los modificadores seleccionados en el modal.
  const precioExtra = () => {
    if (!productoModal) return 0;
    let extra = 0;
    for (const grupo of (productoModal.grupos_modificadores || [])) {
      const selIds = modsSeleccionados[grupo.id] || [];
      for (const op of grupo.opciones || []) {
        if (selIds.includes(op.id)) extra += parseFloat(op.precio_extra || 0);
      }
    }
    return extra;
  };

  const agregarAlCarrito = () => {
    if (!productoModal) return;
    // Validar grupos obligatorios sin selección
    for (const grupo of (productoModal.grupos_modificadores || [])) {
      const obligatorio = grupo.es_obligatorio ?? grupo.requerido;
      const sel = modsSeleccionados[grupo.id] || [];
      if (obligatorio && sel.length === 0) {
        setModError(`Selecciona una opción en "${grupo.nombre_grupo || grupo.nombre}"`);
        return;
      }
    }
    const precio = parseFloat(productoModal.precio) + precioExtra();
    const mods = [];
    for (const grupo of (productoModal.grupos_modificadores || [])) {
      const selIds = modsSeleccionados[grupo.id] || [];
      for (const op of grupo.opciones || []) {
        if (selIds.includes(op.id)) mods.push({ id_opcion: op.id, nombre: op.nombre_opcion, precio_extra: parseFloat(op.precio_extra || 0) });
      }
    }
    const item = {
      id_producto: productoModal.id,
      nombre: productoModal.nombre,
      cantidad: qty,
      notas,
      modificadores: mods,
      subtotal: precio * qty,
    };
    setCarrito(prev => [...prev, item]);
    cerrarModal();
  };

  const categoriaActual = categorias.find(c => c.id === catActiva);
  const totalCarrito = carrito.reduce((s, i) => s + i.subtotal, 0);
  const countCarrito = carrito.reduce((s, i) => s + i.cantidad, 0);

  const numero_mesa = sessionStorage.getItem('numero_mesa') || '';
  const pin_mesa    = sessionStorage.getItem('pin_mesa') || '';

  return (
    <ClienteLayout idSesion={id_sesion} carritoCount={countCarrito}>
      {/* Header */}
      <header className="px-3 py-2 d-flex align-items-center justify-content-between"
        style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', position: 'sticky', top: 0, zIndex: 50 }}>
        <span className="fw-semibold" style={{ fontSize: '1rem', color: 'var(--mm-green)', fontFamily: 'var(--font-display)' }}>
          <i className="bi bi-cup-hot-fill me-1" />Mochi Matcha
        </span>
        <div className="d-flex align-items-center gap-2">
          <span style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
            Mesa {numero_mesa} ·{' '}
            <span className="fw-bold" style={{ fontFamily: 'var(--font-mono)', color: 'var(--mm-text)' }}>PIN: {pin_mesa}</span>
          </span>
          <span
            className="position-relative"
            onClick={() => navigate(`/menu/${id_sesion}/carrito`)}
            style={{ color: 'var(--mm-text)', cursor: 'pointer' }}
          >
            <i className="bi bi-bag-fill" style={{ fontSize: '1.4rem' }} />
            {countCarrito > 0 && <span className="nav-badge">{countCarrito}</span>}
          </span>
        </div>
      </header>

      {menuError && (
        <div className="alert alert-danger d-flex align-items-center gap-2 m-3" role="alert">
          <i className="bi bi-exclamation-circle-fill" />
          No se pudo cargar el menú. Revisa tu conexión e intenta de nuevo.
          <button className="btn btn-sm btn-outline-danger ms-auto"
            onClick={() => { setMenuError(false); api.get('/menu').then(({ data }) => { setCategorias(data); if (data.length) setCatActiva(data[0].id); }).catch(() => setMenuError(true)); }}>
            Reintentar
          </button>
        </div>
      )}

      {/* Carrusel de promociones (igual que Django) */}
      <PromoCarousel promos={promos} />

      {/* Category tabs */}
      <div className="category-tabs" style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', position: 'sticky', top: 52, zIndex: 10 }}>
        <button
          className={`cat-tab${catActiva === null ? ' active' : ''}`}
          onClick={() => setCatActiva(null)}
        >
          Todo
        </button>
        {categorias.map(cat => (
          <button
            key={cat.id}
            className={`cat-tab${catActiva === cat.id ? ' active' : ''}`}
            onClick={() => setCatActiva(cat.id)}
          >
            {cat.nombre}
          </button>
        ))}
      </div>

      {/* Products */}
      <div style={{ padding: '1rem' }}>
        {(catActiva === null ? categorias : [categoriaActual].filter(Boolean)).map(cat => (
          <div key={cat.id} style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 700, fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--mm-text-muted)', marginBottom: '.75rem', paddingBottom: '.35rem', borderBottom: '1px solid var(--mm-border)' }}>
              {cat.nombre}
            </div>
            <div className="row g-2">
              {(cat.productos || []).map(p => (
                <div key={p.id} className="col-6">
                  <div
                    className={`product-card${!p.disponible ? ' unavailable' : ''}`}
                    onClick={() => p.disponible && abrirModal(p)}
                  >
                    <div className="product-img-placeholder">
                      {p.imagen_url
                        ? <img src={p.imagen_url} alt={p.nombre} className="product-img" />
                        : <i className="bi bi-cup-hot" />}
                    </div>
                    <div className="product-body">
                      <div className="product-name">{p.nombre}</div>
                      {p.descripcion && <div className="product-desc">{p.descripcion}</div>}
                      <div className="d-flex align-items-center justify-content-between mt-1">
                        <span className="product-price">${parseFloat(p.precio).toFixed(2)}</span>
                        {p.disponible
                          ? <button className="add-btn" onClick={ev => { ev.stopPropagation(); abrirModal(p); }}>+</button>
                          : <span style={{ fontSize: '.7rem', color: 'var(--mm-danger)', fontWeight: 600 }}>No disponible</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Cart bar (if items) */}
      {countCarrito > 0 && (
        <div
          onClick={() => navigate(`/menu/${id_sesion}/carrito`)}
          style={{ margin: '0 1rem 1.5rem', background: 'var(--mm-green)', color: '#fff', borderRadius: 'var(--radius-pill)', padding: '.9rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxShadow: 'var(--shadow-md)' }}
        >
          <span style={{ background: 'rgba(255,255,255,.2)', borderRadius: 'var(--radius-pill)', padding: '.1rem .6rem', fontWeight: 700, fontSize: '.85rem' }}>{countCarrito}</span>
          <span style={{ fontWeight: 700 }}>Ver carrito</span>
          <span style={{ fontWeight: 700 }}>${totalCarrito.toFixed(2)}</span>
        </div>
      )}

      {/* Product modal */}
      <div className="modal fade" ref={modalRef} tabIndex="-1">
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable" style={{ maxWidth: 420 }}>
          <div className="modal-content rounded-4 border-0" style={{ overflow: 'hidden' }}>
            {productoModal && (
              <>
                {/* fix#5 A: botón cerrar X siempre visible sobre la imagen o
                    el placeholder. Antes el cliente solo podía cerrar el modal
                    clickeando fuera. */}
                <div className="product-img-placeholder position-relative" style={{ height: 200, borderRadius: 0 }}>
                  {productoModal.imagen_url
                    ? <img src={productoModal.imagen_url} alt={productoModal.nombre} style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                    : <i className="bi bi-cup-hot" style={{ fontSize: '3rem' }} />}
                  <button
                    type="button"
                    aria-label="Cerrar"
                    onClick={cerrarModal}
                    style={{
                      position: 'absolute', top: '.75rem', right: '.75rem',
                      width: 36, height: 36, border: 'none', cursor: 'pointer',
                      background: 'rgba(255,255,255,.92)', borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(0,0,0,.15)',
                      color: 'var(--mm-text)',
                    }}
                  >
                    <i className="bi bi-x-lg" style={{ fontSize: '1rem' }} />
                  </button>
                </div>
                <div className="modal-body p-4">
                  <h5 className="fw-bold mb-1">{productoModal.nombre}</h5>
                  {productoModal.descripcion && <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>{productoModal.descripcion}</p>}
                  <div style={{ fontWeight: 700, color: 'var(--mm-green)', fontSize: '1.1rem', marginBottom: '1.25rem' }}>
                    ${parseFloat(productoModal.precio).toFixed(2)}
                  </div>

                  {/* Modifier groups */}
                  {(productoModal.grupos_modificadores || []).map(grupo => {
                    const esMultiple = grupo.tipo === 'múltiple' || grupo.tipo === 'multiple' || grupo.tipo === 'checkbox';
                    const obligatorio = grupo.es_obligatorio ?? grupo.requerido;
                    const hint = esMultiple && grupo.max_selecciones ? ` · máx. ${grupo.max_selecciones}` : '';
                    return (
                    <div key={grupo.id} className="modifier-group">
                      <div className="modifier-group-title">
                        {grupo.nombre_grupo || grupo.nombre}
                        {obligatorio && <span style={{ color: 'var(--mm-danger)', marginLeft: '.25rem' }}>*</span>}
                        {hint && <span style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)', marginLeft: '.4rem' }}>{hint}</span>}
                      </div>
                      {(grupo.opciones || []).map(op => {
                        const sel = (modsSeleccionados[grupo.id] || []).includes(op.id);
                        return (
                          <div key={op.id} className={`modifier-option${sel ? ' selected' : ''}`} onClick={() => toggleMod(grupo.id, op.id, grupo.tipo, grupo.max_selecciones)}>
                            <span style={{ fontSize: '.875rem' }}>{op.nombre_opcion}</span>
                            <div className="d-flex align-items-center gap-2">
                              {parseFloat(op.precio_extra || 0) > 0 && <span className="modifier-extra">+${parseFloat(op.precio_extra).toFixed(2)}</span>}
                              <div style={{ width: 18, height: 18, border: '2px solid ' + (sel ? 'var(--mm-green)' : 'var(--mm-border)'), borderRadius: esMultiple ? 4 : '50%', background: sel ? 'var(--mm-green)' : '#fff', flexShrink: 0 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    );
                  })}

                  {/* Notes */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ fontWeight: 600, fontSize: '.85rem', display: 'block', marginBottom: '.4rem' }}>Notas especiales</label>
                    <textarea
                      className="form-control"
                      rows={2} maxLength={100}
                      placeholder="SIN CEBOLLA, EXTRA SALSA… (OPCIONAL)"
                      value={notas}
                      onChange={e => setNotas(e.target.value.toUpperCase().slice(0, 100))}
                      style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)', resize: 'none', fontSize: '.875rem', textTransform: 'uppercase' }}
                    />
                    <CharCounter value={notas} max={100} />
                  </div>

                  {/* Quantity */}
                  <div className="d-flex align-items-center justify-content-between mb-4">
                    <span style={{ fontWeight: 600, fontSize: '.875rem' }}>Cantidad</span>
                    <div className="qty-control">
                      <button className="qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                      <span className="qty-value">{qty}</span>
                      <button className="qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
                    </div>
                  </div>

                  {modError && (
                    <p className="text-danger mb-2" style={{ fontSize: '.82rem' }}>
                      <i className="bi bi-exclamation-circle me-1" />{modError}
                    </p>
                  )}
                  <button
                    className="btn btn-primary w-100 py-3 fw-bold"
                    onClick={agregarAlCarrito}
                  >
                    <i className="bi bi-bag-plus me-2" />
                    Agregar — ${((parseFloat(productoModal.precio) + precioExtra()) * qty).toFixed(2)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ClienteLayout>
  );
}
