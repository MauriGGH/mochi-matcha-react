import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import { numberInputHandlers } from '../../utils/numberInput';

/* ── helpers ──────────────────────────────────────────────────── */
function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = (msg, type = '') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  };
  return { toasts, show };
}
function ToastContainer({ toasts }) {
  return (
    <div className="mm-toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`mm-toast${t.type === 'success' ? ' mm-toast-success' : t.type === 'error' ? ' mm-toast-error' : ''}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function Modal({ show, title, onClose, onSave, loading, error, children }) {
  if (!show) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--mm-white)', borderRadius: 'var(--radius-lg)', padding: '2rem', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="d-flex align-items-center justify-content-between mb-4">
          <h5 className="fw-bold mb-0">{title}</h5>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--mm-text-muted)' }}>×</button>
        </div>
        {children}
        {error && <div className="alert alert-danger py-2 px-3 mb-3 mt-3" style={{ fontSize: '.875rem' }}>{error}</div>}
        <div className="d-flex gap-2 mt-3">
          <button type="button" className="btn flex-grow-1 py-2" style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text-muted)' }} onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary flex-grow-1 py-2" onClick={onSave} disabled={loading}>
            {loading ? <span className="spinner-border spinner-border-sm me-2" /> : null}Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── MmTab style ──────────────────────────────────────────────── */
function MmTab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      position: 'relative', padding: '.65rem 1.25rem', fontSize: '.875rem', fontWeight: 600,
      border: 'none', borderBottom: active ? '2px solid var(--mm-green)' : '2px solid transparent',
      background: active ? 'var(--mm-green-pale)' : 'transparent',
      color: active ? 'var(--mm-green)' : 'var(--mm-text-muted)',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', cursor: 'pointer',
      marginBottom: -2, transition: 'all .15s',
    }}>
      {active && <span style={{ position: 'absolute', left: '.85rem', right: '.85rem', top: 0, height: 3, borderRadius: '0 0 3px 3px', background: 'var(--mm-gold)' }} />}
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
export default function MenuManager() {
  const navigate = useNavigate();
  const { toasts, show: showToast } = useToast();

  const [tab, setTab] = useState('productos');

  // Shared data
  const [categorias,   setCategorias]   = useState([]);
  const [productos,    setProductos]    = useState([]);
  const [modificadores, setModificadores] = useState([]);
  const [promociones,  setPromociones]  = useState([]);
  const [mesas,        setMesas]        = useState([]);
  const [ubicaciones,  setUbicaciones]  = useState([]);

  const [tiposDescuento, setTiposDescuento] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [modal,   setModal]   = useState(null); // null | 'producto' | 'cat' | 'mod' | 'promo' | 'mesa'
  const [editItem, setEditItem] = useState(null);
  const [form,    setForm]    = useState({});

  // Productos filter
  const [searchProd, setSearchProd] = useState('');
  const [filterCat,  setFilterCat]  = useState('');
  const [searchMod,  setSearchMod]  = useState('');

  // Modificadores: opciones builder  { id?, nombre_opcion, precio_extra, activo, _delete? }
  const [opciones, setOpciones] = useState([{ nombre_opcion: '', precio_extra: 0 }]);

  // Mesas: nueva ubicacion inline + edición de zona existente
  const [showNuevaUb,  setShowNuevaUb]  = useState(false);
  const [nuevaUbNombre, setNuevaUbNombre] = useState('');
  const [editUbId,     setEditUbId]     = useState(null);
  const [editUbNombre, setEditUbNombre] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [rp, rc, rm, rprom, rmesas, rub, rtd] = await Promise.all([
        api.get('/gerente/productos'),
        api.get('/gerente/categorias'),
        api.get('/gerente/modificadores'),
        api.get('/gerente/promociones'),
        api.get('/mesas'),
        api.get('/gerente/ubicaciones'),
        api.get('/gerente/tipos-descuento'),
      ]);
      setProductos(rp.data);
      setCategorias(rc.data);
      setModificadores(rm.data);
      setPromociones(rprom.data);
      setMesas(rmesas.data);
      setUbicaciones(rub.data);
      setTiposDescuento(rtd.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const closeModal = () => { setModal(null); setEditItem(null); setForm({}); setOpciones([{ nombre_opcion: '', precio_extra: 0 }]); setError(''); setEditUbId(null); setEditUbNombre(''); };

  /* ── Productos ── */
  const abrirNuevoProducto = () => {
    setForm({ nombre: '', descripcion: '', precio: '', id_categoria: categorias[0]?.id || '', disponible: true });
    setEditItem(null); setError(''); setModal('producto');
  };
  const abrirEditarProducto = p => {
    setForm({ nombre: p.nombre, descripcion: p.descripcion || '', precio: p.precio, id_categoria: p.id_categoria, disponible: p.disponible });
    setEditItem(p); setError(''); setModal('producto');
  };
  const guardarProducto = async () => {
    const nombre = (form.nombre || '').trim();
    if (!nombre) { setError('El nombre del producto es obligatorio'); return; }
    if (nombre.length > 100) { setError('El nombre no puede superar 100 caracteres'); return; }
    const precio = parseFloat(form.precio);
    if (form.precio === '' || form.precio === undefined || isNaN(precio)) { setError('El precio es obligatorio y debe ser un número'); return; }
    if (precio < 0) { setError('El precio no puede ser negativo'); return; }
    if (!form.id_categoria) { setError('Selecciona una categoría'); return; }
    setLoading(true); setError('');
    try {
      const body = { ...form, nombre, precio };
      if (editItem) await api.put(`/gerente/productos/${editItem.id}`, body);
      else await api.post('/gerente/productos', body);
      closeModal(); cargar(); showToast(editItem ? 'Producto actualizado' : 'Producto creado', 'success');
    } catch (err) { setError(err.response?.data?.error || 'Error al guardar'); }
    finally { setLoading(false); }
  };
  const toggleProducto = async (p) => {
    try {
      await api.put(`/gerente/productos/${p.id}`, { ...p, disponible: !p.disponible });
      cargar();
    } catch { showToast('Error', 'error'); }
  };
  const eliminarProducto = async id => {
    if (!window.confirm('¿Eliminar este producto?')) return;
    try { await api.delete(`/gerente/productos/${id}`); cargar(); showToast('Producto eliminado', 'success'); }
    catch { showToast('Error al eliminar', 'error'); }
  };

  const prodFiltrados = productos.filter(p => {
    const matchNombre = !searchProd || p.nombre.toLowerCase().includes(searchProd.toLowerCase());
    const matchCat = !filterCat || String(p.id_categoria) === String(filterCat);
    return matchNombre && matchCat;
  });

  /* ── Categorías ── */
  const abrirNuevaCat = () => {
    setForm({ nombre: '', orden: 0, area: 'cocina' });
    setEditItem(null); setError(''); setModal('cat');
  };
  const abrirEditarCat = c => {
    setForm({ nombre: c.nombre, orden: c.orden, area: c.area });
    setEditItem(c); setError(''); setModal('cat');
  };
  const guardarCat = async () => {
    const nombre = (form.nombre || '').trim();
    if (!nombre) { setError('El nombre de la categoría es obligatorio'); return; }
    if (nombre.length > 100) { setError('El nombre no puede superar 100 caracteres'); return; }
    setLoading(true); setError('');
    try {
      const body = { ...form, nombre };
      if (editItem) await api.put(`/gerente/categorias/${editItem.id}`, body);
      else await api.post('/gerente/categorias', body);
      closeModal(); cargar(); showToast(editItem ? 'Categoría actualizada' : 'Categoría creada', 'success');
    } catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setLoading(false); }
  };
  const eliminarCat = async id => {
    if (!window.confirm('¿Eliminar esta categoría?')) return;
    try { await api.delete(`/gerente/categorias/${id}`); cargar(); showToast('Categoría eliminada', 'success'); }
    catch { showToast('Error al eliminar', 'error'); }
  };

  /* ── Modificadores ── */
  const abrirNuevoMod = () => {
    setForm({ nombre_grupo: '', tipo: 'única', es_obligatorio: false, max_selecciones: '' });
    setOpciones([{ nombre_opcion: '', precio_extra: 0 }]);
    setEditItem(null); setError(''); setModal('mod');
  };
  const abrirEditarMod = async (g) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/gerente/modificadores/${g.id}/editar`);
      const grupo = data.grupo;
      setForm({ nombre_grupo: grupo.nombre_grupo, tipo: grupo.tipo, es_obligatorio: grupo.es_obligatorio, max_selecciones: grupo.max_selecciones || '' });
      setOpciones(grupo.opciones.map(o => ({ id: o.id, nombre_opcion: o.nombre_opcion, precio_extra: o.precio_extra, activo: o.activo })));
      setEditItem(g); setError(''); setModal('mod');
    } catch { showToast('Error al cargar modificador', 'error'); }
    finally { setLoading(false); }
  };
  const guardarMod = async () => {
    if (!form.nombre_grupo?.trim()) { setError('El nombre del grupo es obligatorio'); return; }
    const opcionesActivas = opciones.filter(o => !o._delete);
    if (!opcionesActivas.some(o => o.nombre_opcion.trim())) { setError('Agrega al menos una opción'); return; }
    setLoading(true); setError('');
    try {
      // Opciones a guardar (activas, con ID si existen)
      const opcionesEnviar = opcionesActivas
        .filter(o => o.nombre_opcion.trim())
        .map(o => ({ ...(o.id ? { id: o.id } : {}), nombre_opcion: o.nombre_opcion.trim(), precio_extra: parseFloat(o.precio_extra) || 0, activo: true }));
      // Opciones existentes marcadas para borrar → desactivar en BD
      const opcionesDesactivar = opciones
        .filter(o => o._delete && o.id)
        .map(o => ({ id: o.id, nombre_opcion: o.nombre_opcion, precio_extra: o.precio_extra || 0, activo: false }));
      const body = {
        nombre_grupo: form.nombre_grupo,
        tipo: form.tipo,
        es_obligatorio: !!form.es_obligatorio,
        max_selecciones: form.max_selecciones ? parseInt(form.max_selecciones) : null,
        opciones: [...opcionesEnviar, ...opcionesDesactivar],
      };
      if (editItem) await api.put(`/gerente/modificadores/${editItem.id}`, body);
      else await api.post('/gerente/modificadores', body);
      closeModal(); cargar(); showToast(editItem ? 'Modificador actualizado' : 'Modificador creado', 'success');
    } catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setLoading(false); }
  };
  const eliminarMod = async id => {
    if (!window.confirm('¿Eliminar este grupo de modificadores?')) return;
    try { await api.delete(`/gerente/modificadores/${id}`); cargar(); showToast('Modificador eliminado', 'success'); }
    catch { showToast('Error al eliminar', 'error'); }
  };

  const modFiltrados = modificadores.filter(m =>
    !searchMod || m.nombre_grupo?.toLowerCase().includes(searchMod.toLowerCase())
  );

  /* ── Promociones ── */
  const togglePromo = async (id, activa) => {
    try {
      await api.post(`/gerente/promociones/${id}/toggle`);
      setPromociones(ps => ps.map(p => p.id === id ? { ...p, activa: !activa } : p));
    } catch { showToast('Error', 'error'); }
  };
  const abrirNuevaPromo = () => {
    const hoy = new Date().toISOString().slice(0, 10);
    setForm({ titulo: '', descripcion_corta: '', id_tipo_descuento: tiposDescuento[0]?.id || '', valor_descuento: '', cantidad_minima: 1, aplicacion: 'item', fecha_inicio: hoy, fecha_fin: '', activa: true, codigo_cupon: '' });
    setEditItem(null); setError(''); setModal('promo');
  };
  const abrirEditarPromo = async (p) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/gerente/promociones/${p.id}/editar`);
      const pr = data.promo;
      setForm({
        titulo: pr.titulo || '',
        descripcion_corta: pr.descripcion_corta || '',
        id_tipo_descuento: pr.id_tipo_descuento || tiposDescuento[0]?.id || '',
        valor_descuento: pr.valor_descuento ?? '',
        cantidad_minima: pr.cantidad_minima ?? 1,
        aplicacion: pr.aplicacion || 'item',
        fecha_inicio: pr.fecha_inicio ? pr.fecha_inicio.slice(0, 10) : '',
        fecha_fin: pr.fecha_fin ? pr.fecha_fin.slice(0, 10) : '',
        activa: pr.activa !== false,
        codigo_cupon: pr.codigo_cupon || '',
      });
      setEditItem(p); setError(''); setModal('promo');
    } catch { showToast('Error al cargar promoción', 'error'); }
    finally { setLoading(false); }
  };
  const guardarPromo = async () => {
    if (!form.titulo?.trim()) { setError('El título es obligatorio'); return; }
    if (!form.fecha_inicio || !form.fecha_fin) { setError('Las fechas de inicio y fin son obligatorias'); return; }
    setLoading(true); setError('');
    try {
      const body = {
        ...form,
        valor_descuento: form.valor_descuento !== '' ? parseFloat(form.valor_descuento) : null,
        cantidad_minima: form.cantidad_minima ? parseInt(form.cantidad_minima) : null,
        id_tipo_descuento: form.id_tipo_descuento || null,
        codigo_cupon: form.codigo_cupon?.trim() || null,
      };
      if (editItem) await api.put(`/gerente/promociones/${editItem.id}`, body);
      else await api.post('/gerente/promociones', body);
      closeModal(); cargar(); showToast(editItem ? 'Promoción actualizada' : 'Promoción creada', 'success');
    } catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setLoading(false); }
  };
  const eliminarPromo = async id => {
    if (!window.confirm('¿Eliminar esta promoción?')) return;
    try { await api.delete(`/gerente/promociones/${id}`); cargar(); showToast('Promoción eliminada', 'success'); }
    catch { showToast('Error al eliminar', 'error'); }
  };

  /* ── Mesas ── */
  const abrirNuevaMesa = () => {
    setForm({ numero_mesa: '', capacidad: 4, id_ubicacion: ubicaciones[0]?.id || '' });
    setEditItem(null); setError(''); setModal('mesa');
  };
  const abrirEditarMesa = m => {
    setForm({ numero_mesa: m.numero_mesa, capacidad: m.capacidad, id_ubicacion: m.id_ubicacion || '' });
    setEditItem(m); setError(''); setModal('mesa');
  };
  const guardarMesa = async () => {
    setLoading(true); setError('');
    try {
      if (editItem) await api.put(`/gerente/mesas/${editItem.id}`, form);
      else await api.post('/gerente/mesas', form);
      closeModal(); cargar(); showToast(editItem ? 'Mesa actualizada' : 'Mesa creada', 'success');
    } catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setLoading(false); }
  };
  const eliminarMesa = async id => {
    if (!window.confirm('¿Eliminar esta mesa?')) return;
    try { await api.delete(`/gerente/mesas/${id}`); cargar(); showToast('Mesa eliminada', 'success'); }
    catch { showToast('Error al eliminar', 'error'); }
  };
  const guardarNuevaUb = async () => {
    if (!nuevaUbNombre.trim()) return;
    try {
      await api.post('/gerente/ubicaciones', { nombre: nuevaUbNombre.trim().toUpperCase() });
      setNuevaUbNombre(''); setShowNuevaUb(false); cargar();
    } catch { showToast('Error al crear ubicación', 'error'); }
  };
  const iniciarEditarUb = (u) => { setEditUbId(u.id); setEditUbNombre(u.nombre); setShowNuevaUb(false); };
  const guardarEditarUb = async (id) => {
    if (!editUbNombre.trim()) return;
    try {
      await api.put(`/gerente/ubicaciones/${id}`, { nombre: editUbNombre.trim().toUpperCase() });
      setEditUbId(null); setEditUbNombre(''); cargar();
    } catch { showToast('Error al actualizar ubicación', 'error'); }
  };
  const eliminarUb = async id => {
    if (!window.confirm('¿Eliminar esta ubicación?')) return;
    try { await api.delete(`/gerente/ubicaciones/${id}`); cargar(); }
    catch { showToast('Error al eliminar', 'error'); }
  };

  /* ── Sidebar ── */
  const sidebarNav = (
    <>
      <a onClick={() => navigate('/gerente')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Floor Plan</a>
      <div className="nav-section-label">Gestión</div>
      <a className="active"><i className="bi bi-basket-fill" /> Gestión de Menú</a>
      <div className="nav-section-label">Reportes</div>
      <a onClick={() => navigate('/gerente/reportes')} style={{ cursor: 'pointer' }}><i className="bi bi-bar-chart-fill" /> Reportes</a>
      <div className="nav-section-label">Admin</div>
      <a onClick={() => navigate('/gerente/empleados')} style={{ cursor: 'pointer' }}><i className="bi bi-people-fill" /> Empleados</a>
      <a onClick={() => navigate('/gerente/configuracion')} style={{ cursor: 'pointer' }}><i className="bi bi-gear-fill" /> Configuración</a>
    </>
  );

  const TABS = ['productos', 'categorias', 'modificadores', 'promociones', 'mesas'];
  const TAB_LABELS = { productos: 'Productos', categorias: 'Categorías', modificadores: 'Modificadores', promociones: 'Promociones', mesas: 'Mesas' };

  return (
    <StaffLayout title="Gestión de Menú" sidebarNav={sidebarNav}>

      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="fw-bold mb-0">Gestión de Menú</h5>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--mm-border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        {TABS.map(t => (
          <MmTab key={t} label={TAB_LABELS[t]} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      {/* ════════ PRODUCTOS ════════ */}
      {tab === 'productos' && (
        <>
          <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
            <div className="d-flex gap-2 flex-wrap">
              <input type="text" className="form-control form-control-sm" placeholder="Buscar producto…"
                style={{ width: 200, borderColor: 'var(--mm-border)' }}
                value={searchProd} onChange={e => setSearchProd(e.target.value)} />
              <select className="form-select form-select-sm" style={{ width: 170, borderColor: 'var(--mm-border)' }}
                value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={abrirNuevoProducto}>
              <i className="bi bi-plus-lg me-1" />Nuevo producto
            </button>
          </div>

          <div className="table-responsive">
            <table className="table data-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>IMG</th>
                  <th>PRODUCTO</th>
                  <th>CATEGORÍA</th>
                  <th>PRECIO</th>
                  <th>ESTADO</th>
                  <th>ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                {prodFiltrados.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
                    <i className="bi bi-cart3" style={{ fontSize: '2rem', display: 'block', marginBottom: '.5rem' }} />
                    No hay productos.
                  </td></tr>
                )}
                {prodFiltrados.map(p => (
                  <tr key={p.id}>
                    <td>
                      {p.imagen_url
                        ? <img src={p.imagen_url} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} alt="" onError={e => e.target.style.display = 'none'} />
                        : <div style={{ width: 40, height: 40, background: 'var(--mm-cream-dark)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i className="bi bi-cup-hot" style={{ fontSize: '1.2rem', color: 'var(--mm-text-muted)' }} /></div>
                      }
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{p.nombre}</div>
                      {p.descripcion && <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>{p.descripcion.slice(0, 50)}</div>}
                    </td>
                    <td>
                      <span style={{ background: 'var(--mm-cream-dark)', padding: '.2rem .6rem', borderRadius: 99, fontSize: '.78rem' }}>{p.categoria?.nombre}</span>
                    </td>
                    <td style={{ fontWeight: 700 }}>${parseFloat(p.precio).toFixed(2)}</td>
                    <td>
                      {p.disponible
                        ? <span style={{ background: '#EAFAF1', color: '#1E8449', borderRadius: 99, padding: '.2rem .7rem', fontSize: '.75rem', fontWeight: 700 }}><i className="bi bi-check-circle-fill me-1" />Activo</span>
                        : <span style={{ background: '#F2F3F4', color: '#566573', borderRadius: 99, padding: '.2rem .7rem', fontSize: '.75rem', fontWeight: 700 }}><i className="bi bi-x-circle me-1" />Agotado</span>
                      }
                    </td>
                    <td>
                      <button className="btn btn-link btn-sm p-1" onClick={() => abrirEditarProducto(p)} title="Editar">
                        <i className="bi bi-pencil" style={{ color: 'var(--mm-text-muted)' }} />
                      </button>
                      <button className="btn btn-link btn-sm p-1" onClick={() => toggleProducto(p)} title={p.disponible ? 'Desactivar' : 'Activar'}>
                        <i className={`bi bi-${p.disponible ? 'eye-slash' : 'eye'}`} style={{ color: p.disponible ? 'var(--mm-danger)' : 'var(--mm-green)' }} />
                      </button>
                      <button className="btn btn-link btn-sm p-1" onClick={() => eliminarProducto(p.id)}>
                        <i className="bi bi-trash3" style={{ color: 'var(--mm-danger)' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ════════ CATEGORÍAS ════════ */}
      {tab === 'categorias' && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', margin: 0 }}>Define las secciones del menú y el área del KDS (Cocina o Bar).</p>
            <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={abrirNuevaCat}>
              <i className="bi bi-plus-lg me-1" />Nueva categoría
            </button>
          </div>
          <div className="row g-3 mt-1">
            {categorias.length === 0 && (
              <div className="col-12 text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
                <i className="bi bi-tags" style={{ fontSize: '2rem', display: 'block', marginBottom: '.5rem' }} />
                <p>No hay categorías aún.</p>
              </div>
            )}
            {categorias.map(c => (
              <div key={c.id} className="col-md-6 col-lg-4">
                <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{c.nombre}</div>
                      <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.2rem' }}>
                        Orden: {c.orden} · <span style={{ background: 'var(--mm-cream-dark)', padding: '.1rem .4rem', borderRadius: 99 }}>{c.area}</span>
                      </div>
                    </div>
                    <div className="d-flex gap-1">
                      <button className="btn btn-link btn-sm p-0" style={{ color: 'var(--mm-text-muted)' }} onClick={() => abrirEditarCat(c)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className="btn btn-link btn-sm p-0" style={{ color: 'var(--mm-danger)' }} onClick={() => eliminarCat(c.id)}>
                        <i className="bi bi-trash3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ════════ MODIFICADORES ════════ */}
      {tab === 'modificadores' && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', margin: 0 }}>Grupos de opciones asociados a productos (leche, tamaño, extras…).</p>
            <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={abrirNuevoMod}>
              <i className="bi bi-plus-lg me-1" />Nuevo grupo
            </button>
          </div>
          <div className="mb-3">
            <input type="text" className="form-control form-control-sm"
              placeholder="Buscar por nombre del grupo…"
              style={{ borderColor: 'var(--mm-border)' }}
              value={searchMod} onChange={e => setSearchMod(e.target.value)} />
          </div>
          {modFiltrados.length === 0 && (
            <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
              <i className="bi bi-sliders" style={{ fontSize: '2.5rem', display: 'block', marginBottom: '.5rem' }} />
              <p>No hay grupos de modificadores.</p>
            </div>
          )}
          {modFiltrados.map(g => (
            <div key={g.id} style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1rem' }}>
              <div className="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{g.nombre_grupo}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)', marginTop: '.2rem' }}>
                    Tipo: {g.tipo} · {g.es_obligatorio
                      ? <span style={{ color: 'var(--mm-danger)', fontWeight: 600 }}>Obligatorio</span>
                      : 'Opcional'}
                    {g.max_selecciones ? ` · Máx. ${g.max_selecciones}` : ''}
                  </div>
                </div>
                <div className="d-flex gap-1">
                  <button className="btn btn-link btn-sm p-1" onClick={() => abrirEditarMod(g)} title="Editar">
                    <i className="bi bi-pencil" style={{ color: 'var(--mm-text-muted)', fontSize: '1.05rem' }} />
                  </button>
                  <button className="btn btn-link btn-sm p-1" style={{ color: 'var(--mm-danger)' }} onClick={() => eliminarMod(g.id)}>
                    <i className="bi bi-trash3" />
                  </button>
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                {(g.opciones || []).map((op, i) => (
                  <span key={i} style={{ background: 'var(--mm-cream-dark)', borderRadius: 99, padding: '.25rem .8rem', fontSize: '.8rem' }}>
                    {op.nombre_opcion}
                    {op.precio_extra > 0
                      ? <span style={{ color: 'var(--mm-gold)', fontWeight: 600 }}> +${parseFloat(op.precio_extra).toFixed(2)}</span>
                      : <span style={{ color: 'var(--mm-success)' }}> Gratis</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ════════ PROMOCIONES ════════ */}
      {tab === 'promociones' && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', margin: 0 }}>Descuentos y ofertas especiales del menú.</p>
            <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={abrirNuevaPromo}>
              <i className="bi bi-plus-lg me-1" />Nueva promoción
            </button>
          </div>
          {promociones.length === 0 && (
            <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
              <i className="bi bi-tag" style={{ fontSize: '2.5rem', display: 'block', marginBottom: '.5rem' }} />
              <p>No hay promociones.</p>
            </div>
          )}
          {promociones.map(p => (
            <div key={p.id} style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1rem', opacity: p.activa ? 1 : .6 }}>
              <div className="d-flex align-items-start gap-3">
                <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0, background: p.activa ? 'var(--mm-green-pale)' : 'var(--mm-cream-dark)' }}>
                  %
                </div>
                <div className="flex-grow-1">
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{p.titulo}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)', marginTop: '.2rem' }}>
                    {p.tipo_descuento_display || p.tipo_display || '—'}
                    {p.fecha_inicio && p.fecha_fin && ` · ${new Date(p.fecha_inicio).toLocaleDateString('es-MX')} – ${new Date(p.fecha_fin).toLocaleDateString('es-MX')}`}
                  </div>
                  {p.productos?.length > 0 && (
                    <div className="d-flex gap-1 flex-wrap mt-1">
                      {p.productos.slice(0, 4).map((pp, i) => (
                        <span key={i} style={{ background: 'var(--mm-cream-dark)', borderRadius: 99, padding: '.15rem .5rem', fontSize: '.72rem' }}>{pp.nombre}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="d-flex align-items-center gap-2 flex-shrink-0">
                  <div className="form-check form-switch mb-0">
                    <input className="form-check-input" type="checkbox" checked={!!p.activa}
                      onChange={() => togglePromo(p.id, p.activa)}
                      style={{ cursor: 'pointer', width: '2.25em', height: '1.1em', accentColor: 'var(--mm-green)' }} />
                  </div>
                  <button className="btn btn-link btn-sm p-1" onClick={() => abrirEditarPromo(p)} title="Editar">
                    <i className="bi bi-pencil" style={{ color: 'var(--mm-text-muted)', fontSize: '1.05rem' }} />
                  </button>
                  <button className="btn btn-link btn-sm p-1" onClick={() => eliminarPromo(p.id)} title="Eliminar">
                    <i className="bi bi-trash3" style={{ color: 'var(--mm-danger)' }} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ════════ MESAS ════════ */}
      {tab === 'mesas' && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', margin: 0 }}>Configura las mesas. El código QR se genera automáticamente.</p>
            <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={abrirNuevaMesa}>
              <i className="bi bi-plus-lg me-1" />Nueva mesa
            </button>
          </div>

          <div className="table-responsive">
            <table className="table data-table">
              <thead>
                <tr><th>#</th><th>CAPACIDAD</th><th>UBICACIÓN</th><th>ESTADO</th><th>ACCIONES</th></tr>
              </thead>
              <tbody>
                {mesas.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
                    <div style={{ fontSize: '2rem' }}>🪑</div>No hay mesas configuradas.
                  </td></tr>
                )}
                {mesas.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 700 }}>Mesa {m.numero_mesa}</td>
                    <td><i className="bi bi-people me-1" style={{ color: 'var(--mm-text-muted)' }} />{m.capacidad}</td>
                    <td style={{ color: 'var(--mm-text-muted)' }}>{m.ubicacion?.nombre || '—'}</td>
                    <td>
                      {m.estado === 'libre' || !m.estado
                        ? <span style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text-muted)', borderRadius: 99, padding: '.2rem .7rem', fontSize: '.75rem' }}>Libre</span>
                        : <span style={{ background: 'var(--mm-green-pale)', color: 'var(--mm-green)', borderRadius: 99, padding: '.2rem .7rem', fontSize: '.75rem', fontWeight: 600 }}>Ocupada</span>
                      }
                    </td>
                    <td>
                      <button className="btn btn-link btn-sm p-1" onClick={() => abrirEditarMesa(m)} title="Editar">
                        <i className="bi bi-pencil" style={{ color: 'var(--mm-text-muted)', fontSize: '1.05rem' }} />
                      </button>
                      <button className="btn btn-link btn-sm p-1" onClick={() => eliminarMesa(m.id)}>
                        <i className="bi bi-trash3" style={{ color: 'var(--mm-danger)' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ubicaciones */}
          <div className="mt-4 p-3" style={{ background: 'var(--mm-cream)', borderRadius: 'var(--radius-md)' }}>
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h6 className="fw-bold mb-0" style={{ fontSize: '.9rem' }}>
                <i className="bi bi-geo-alt-fill me-1" style={{ color: 'var(--mm-green)' }} />Zonas / Ubicaciones
              </h6>
              <button className="btn btn-sm btn-primary" onClick={() => setShowNuevaUb(v => !v)}>
                <i className="bi bi-plus-lg me-1" />Nueva ubicación
              </button>
            </div>
            {showNuevaUb && (
              <div className="d-flex gap-2 mb-3">
                <input type="text" className="form-control form-control-sm" placeholder="Nombre (ej. TERRAZA, BARRA…)"
                  style={{ borderColor: 'var(--mm-border)' }} maxLength={60}
                  value={nuevaUbNombre}
                  onChange={e => setNuevaUbNombre(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarNuevaUb(); } }} />
                <button className="btn btn-sm btn-primary" onClick={guardarNuevaUb}><i className="bi bi-check-lg" /></button>
                <button className="btn btn-sm" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => { setShowNuevaUb(false); setNuevaUbNombre(''); }}><i className="bi bi-x-lg" /></button>
              </div>
            )}
            <div className="d-flex flex-wrap gap-2">
              {ubicaciones.length === 0 && (
                <p className="mb-0" style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)' }}>
                  <i className="bi bi-info-circle me-1" />Sin ubicaciones. Usa "Nueva ubicación" para agregar zonas.
                </p>
              )}
              {ubicaciones.map(u => (
                <div key={u.id}>
                  {editUbId === u.id ? (
                    <div className="d-flex align-items-center gap-1">
                      <input
                        type="text" className="form-control form-control-sm" style={{ width: 140, borderColor: 'var(--mm-border)' }}
                        value={editUbNombre} maxLength={60}
                        onChange={e => setEditUbNombre(e.target.value.toUpperCase())}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarEditarUb(u.id); } if (e.key === 'Escape') { setEditUbId(null); setEditUbNombre(''); } }}
                        autoFocus
                      />
                      <button className="btn btn-sm btn-primary" onClick={() => guardarEditarUb(u.id)}><i className="bi bi-check-lg" /></button>
                      <button className="btn btn-sm" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => { setEditUbId(null); setEditUbNombre(''); }}><i className="bi bi-x-lg" /></button>
                    </div>
                  ) : (
                    <div className="d-flex align-items-center gap-1 px-3 py-1 rounded-pill" style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', fontSize: '.85rem' }}>
                      <span>{u.nombre}</span>
                      <button className="btn btn-link btn-sm p-0 ms-1" onClick={() => iniciarEditarUb(u)} title="Editar nombre">
                        <i className="bi bi-pencil" style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }} />
                      </button>
                      <button className="btn btn-link btn-sm p-0 ms-1" onClick={() => eliminarUb(u.id)} title="Eliminar">
                        <i className="bi bi-trash3" style={{ fontSize: '.75rem', color: 'var(--mm-danger)' }} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ════════ MODALES ════════ */}

      {/* Producto */}
      <Modal show={modal === 'producto'} title={editItem ? 'Editar producto' : 'Nuevo producto'}
        onClose={closeModal} onSave={guardarProducto} loading={loading} error={error}>
        <div className="row g-3">
          <div className="col-md-8">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Nombre *</label>
            <input className="form-control" value={form.nombre || ''} maxLength={100} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} required style={{ borderColor: 'var(--mm-border)' }} />
          </div>
          <div className="col-md-4">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Precio *</label>
            <div className="input-group">
              <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>$</span>
              <input type="number" className="form-control" step="0.01" min="0" value={form.precio || ''} onChange={e => setForm(p => ({ ...p, precio: e.target.value }))} style={{ borderColor: 'var(--mm-border)' }} placeholder="0.00" />
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Categoría *</label>
            <select className="form-select" value={form.id_categoria || ''} onChange={e => setForm(p => ({ ...p, id_categoria: e.target.value }))} style={{ borderColor: 'var(--mm-border)' }}>
              <option value="">Selecciona…</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Descripción</label>
            <textarea className="form-control" rows={2} maxLength={255} style={{ borderColor: 'var(--mm-border)', resize: 'none' }}
              value={form.descripcion || ''} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Breve descripción…" />
          </div>
          <div className="col-12">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" checked={!!form.disponible} onChange={e => setForm(p => ({ ...p, disponible: e.target.checked }))} style={{ accentColor: 'var(--mm-green)' }} />
              <label className="form-check-label fw-semibold" style={{ fontSize: '.875rem' }}>Disponible en el menú</label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Categoría */}
      <Modal show={modal === 'cat'} title={editItem ? 'Editar categoría' : 'Nueva categoría'}
        onClose={closeModal} onSave={guardarCat} loading={loading} error={error}>
        <div className="mb-3">
          <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Nombre *</label>
          <input className="form-control" value={form.nombre || ''} maxLength={100} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} required style={{ borderColor: 'var(--mm-border)' }} />
        </div>
        <div className="mb-3">
          <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Área KDS</label>
          <select className="form-select" value={form.area || 'cocina'} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} style={{ borderColor: 'var(--mm-border)' }}>
            <option value="ambos">Ambos</option>
            <option value="cocina">Solo Cocina</option>
            <option value="bar">Solo Bar</option>
          </select>
        </div>
        <div className="mb-3">
          <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Orden</label>
          <input type="number" className="form-control" value={form.orden ?? 0} onChange={e => setForm(p => ({ ...p, orden: e.target.value }))} style={{ borderColor: 'var(--mm-border)' }} />
        </div>
      </Modal>

      {/* Modificador */}
      <Modal show={modal === 'mod'} title={editItem ? 'Editar grupo de modificadores' : 'Nuevo grupo de modificadores'}
        onClose={closeModal} onSave={guardarMod} loading={loading} error={error}>
        <div className="row g-3 mb-3">
          <div className="col-12">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Nombre del grupo *</label>
            <input className="form-control" maxLength={100} placeholder="ej. Tipo de leche" style={{ borderColor: 'var(--mm-border)' }}
              value={form.nombre_grupo || ''} onChange={e => setForm(p => ({ ...p, nombre_grupo: e.target.value }))} />
          </div>
          <div className="col-md-5">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Tipo</label>
            <select className="form-select" style={{ borderColor: 'var(--mm-border)' }} value={form.tipo || 'única'} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))}>
              <option value="única">Selección única</option>
              <option value="múltiple">Múltiple</option>
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Máx. selecciones</label>
            <input type="number" className="form-control" min={1} placeholder="Ilimitado" style={{ borderColor: 'var(--mm-border)' }}
              value={form.max_selecciones || ''} onChange={e => setForm(p => ({ ...p, max_selecciones: e.target.value }))} />
          </div>
          <div className="col-md-3 d-flex align-items-end pb-1">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" style={{ accentColor: 'var(--mm-green)' }}
                checked={!!form.es_obligatorio} onChange={e => setForm(p => ({ ...p, es_obligatorio: e.target.checked }))} />
              <label className="form-check-label fw-semibold" style={{ fontSize: '.875rem' }}>Obligatorio</label>
            </div>
          </div>
        </div>
        <h6 className="fw-bold mb-2">Opciones</h6>
        {opciones.map((op, i) => op._delete ? null : (
          <div key={op.id ?? i} className="d-flex gap-2 mb-2 align-items-center">
            <input className="form-control form-control-sm" placeholder="Nombre opción" style={{ borderColor: 'var(--mm-border)' }}
              value={op.nombre_opcion} onChange={e => setOpciones(prev => prev.map((x, j) => j === i ? { ...x, nombre_opcion: e.target.value } : x))} />
            <div className="input-group input-group-sm" style={{ maxWidth: 110 }}>
              <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>$</span>
              <input type="number" className="form-control" step="0.01" min="0" placeholder="0.00" style={{ borderColor: 'var(--mm-border)' }}
                value={op.precio_extra} onChange={e => setOpciones(prev => prev.map((x, j) => j === i ? { ...x, precio_extra: e.target.value } : x))} />
            </div>
            <button type="button" className="btn btn-link btn-sm p-0"
              onClick={() => op.id
                ? setOpciones(prev => prev.map((x, j) => j === i ? { ...x, _delete: true } : x))
                : setOpciones(prev => prev.filter((_, j) => j !== i))
              }>
              <i className="bi bi-trash3" style={{ color: 'var(--mm-danger)' }} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm mt-1" style={{ background: 'var(--mm-cream-dark)' }}
          onClick={() => setOpciones(prev => [...prev, { nombre_opcion: '', precio_extra: 0 }])}>
          <i className="bi bi-plus-lg me-1" />Agregar opción
        </button>
      </Modal>

      {/* Promoción */}
      <Modal show={modal === 'promo'} title={editItem ? 'Editar promoción' : 'Nueva promoción'}
        onClose={closeModal} onSave={guardarPromo} loading={loading} error={error}>
        <div className="row g-3">
          <div className="col-12">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Título *</label>
            <input className="form-control" maxLength={120} placeholder="ej. 2x1 en matchas los martes"
              style={{ borderColor: 'var(--mm-border)' }}
              value={form.titulo || ''} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} />
          </div>
          <div className="col-12">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Descripción corta</label>
            <input className="form-control" maxLength={200} placeholder="Visible en el menú del cliente"
              style={{ borderColor: 'var(--mm-border)' }}
              value={form.descripcion_corta || ''} onChange={e => setForm(p => ({ ...p, descripcion_corta: e.target.value }))} />
          </div>
          <div className="col-md-6">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Tipo de descuento</label>
            <select className="form-select" style={{ borderColor: 'var(--mm-border)' }}
              value={form.id_tipo_descuento || ''} onChange={e => setForm(p => ({ ...p, id_tipo_descuento: e.target.value }))}>
              <option value="">Sin tipo</option>
              {tiposDescuento.map(t => <option key={t.id} value={t.id}>{t.descripcion}</option>)}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Valor del descuento</label>
            <div className="input-group">
              <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>$/%</span>
              <input type="number" className="form-control" step="0.01" min="0" placeholder="0"
                style={{ borderColor: 'var(--mm-border)' }}
                value={form.valor_descuento ?? ''} onChange={e => setForm(p => ({ ...p, valor_descuento: e.target.value }))} />
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Cantidad mínima</label>
            <input type="number" className="form-control" min={1} placeholder="1"
              style={{ borderColor: 'var(--mm-border)' }}
              value={form.cantidad_minima ?? 1} onChange={e => setForm(p => ({ ...p, cantidad_minima: e.target.value }))} />
          </div>
          <div className="col-md-6">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Aplicación</label>
            <select className="form-select" style={{ borderColor: 'var(--mm-border)' }}
              value={form.aplicacion || 'item'} onChange={e => setForm(p => ({ ...p, aplicacion: e.target.value }))}>
              <option value="item">Por producto</option>
              <option value="pedido">Por pedido completo</option>
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Fecha inicio *</label>
            <input type="date" className="form-control" style={{ borderColor: 'var(--mm-border)' }}
              value={form.fecha_inicio || ''} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
          </div>
          <div className="col-md-6">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Fecha fin *</label>
            <input type="date" className="form-control" style={{ borderColor: 'var(--mm-border)' }}
              value={form.fecha_fin || ''} onChange={e => setForm(p => ({ ...p, fecha_fin: e.target.value }))} />
          </div>
          <div className="col-12">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Código cupón <span style={{ fontWeight: 400, color: 'var(--mm-text-muted)' }}>(opcional)</span></label>
            <input className="form-control" maxLength={60} placeholder="ej. PROMO10"
              style={{ borderColor: 'var(--mm-border)', textTransform: 'uppercase' }}
              value={form.codigo_cupon || ''} onChange={e => setForm(p => ({ ...p, codigo_cupon: e.target.value.toUpperCase() }))} />
          </div>
          <div className="col-12">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" style={{ accentColor: 'var(--mm-green)' }}
                checked={!!form.activa} onChange={e => setForm(p => ({ ...p, activa: e.target.checked }))} />
              <label className="form-check-label fw-semibold" style={{ fontSize: '.875rem' }}>Promoción activa</label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Mesa */}
      <Modal show={modal === 'mesa'} title={editItem ? 'Editar mesa' : 'Nueva mesa'}
        onClose={closeModal} onSave={guardarMesa} loading={loading} error={error}>
        <div className="mb-3">
          <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Número *</label>
          <input type="number" className="form-control" min={1} value={form.numero_mesa || ''} onChange={e => setForm(p => ({ ...p, numero_mesa: e.target.value }))} required style={{ borderColor: 'var(--mm-border)' }} {...numberInputHandlers({ integerOnly: true })} />
        </div>
        <div className="mb-3">
          <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Capacidad</label>
          <input type="number" className="form-control" min={1} value={form.capacidad || 4} onChange={e => setForm(p => ({ ...p, capacidad: e.target.value }))} style={{ borderColor: 'var(--mm-border)' }} {...numberInputHandlers({ integerOnly: true })} />
        </div>
        <div className="mb-3">
          <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Ubicación</label>
          <select className="form-select" value={form.id_ubicacion || ''} onChange={e => setForm(p => ({ ...p, id_ubicacion: e.target.value }))} style={{ borderColor: 'var(--mm-border)' }}>
            <option value="">Sin ubicación</option>
            {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
      </Modal>

      <ToastContainer toasts={toasts} />
    </StaffLayout>
  );
}
