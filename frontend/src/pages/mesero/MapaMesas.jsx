/**
 * MapaMesas.jsx — vista principal del mesero. Pantalla central de su flujo.
 * Grid de mesas con estado visual (color/badge), filtros por estado,
 * contadores de listos/cobrando/alertas y panel lateral con tabs (sesiones,
 * pedidos, solicitudes, resumen). Permite agregar sesiones, abrir pedidos
 * asistidos, solicitar cuentas, cancelar pedidos y cerrar mesas.
 *
 * Ruta: /mesero/mapa. Exporta: default MapaMesas().
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import { useToast } from '../../components/Toast';
import AsistidoModal from './AsistidoModal';
import CharCounter from '../../components/forms/CharCounter';
import { upperOnChange } from '../../hooks/useUpperInput';
import { usePageTitle } from '../../hooks/usePageTitle';

const POLL_MS = 3000; // refresh del grid de mesas y del panel de detalle

const ESTADO_VISUAL = {
  libre:    { label: 'Libre',       color: '#27AE60', bg: '#EAFAF1' },
  ocupada:  { label: 'Ocupada',     color: '#3498DB', bg: '#E8F4FD' },
  // fix#1 Bug B: cocina usa el azul info (#1A6A8A / #EBF5FB) del Django staff.css
  cocina:   { label: 'En cocina',   color: '#1A6A8A', bg: '#EBF5FB' },
  listo:    { label: 'Pedido listo',color: '#16A085', bg: '#D5F5E3' },
  cobrando: { label: 'Cobrando',    color: '#8E44AD', bg: '#F4E4F8' },
  alerta:   { label: '¡Alerta!',    color: '#E74C3C', bg: '#FDEDEC' },
};

const STATUS_BG = { recibido: '#FEF5E7', preparando: '#FEF9E7', listo: '#D5F5E3', entregado: '#E8F4FD', cancelado: '#FDEDEC' };
const STATUS_FG = { recibido: '#7D6608', preparando: '#7D6608', listo: '#1E8449', entregado: '#1F618D', cancelado: '#922B21' };
const ESTADO_DISP = { recibido: 'Recibido', preparando: 'Preparando', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };

/** Resuelve el descriptor visual (color/bg/label) del tile de una mesa. */
function tileVisual(mesa) {
  return ESTADO_VISUAL[mesa.estado_visual || mesa.estado] || ESTADO_VISUAL.libre;
}

/** Pantalla principal del mesero: grid de mesas + panel detalle. Sin props. */
export default function MapaMesas() {
  usePageTitle('Mapa de Mesas');
  const navigate = useNavigate();
  const toast = useToast();
  const [mesas, setMesas] = useState([]);
  const [mesaSeleccionada, setMesaSeleccionada] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [activeTab, setActiveTab] = useState('sesiones');
  const [filtroEstado, setFiltroEstado] = useState('todas');

  const [listosCount, setListosCount] = useState(0);
  const [solicitudesCount, setSolicitudesCount] = useState(0);
  const [alertasCount, setAlertasCount] = useState(0);

  // Modales
  const [showAddSesion, setShowAddSesion] = useState(false);
  const [aliasNuevo, setAliasNuevo] = useState('');
  const [showAsistido, setShowAsistido] = useState(false);
  const [asistidoSesion, setAsistidoSesion] = useState(null);
  const [showCancelPedido, setShowCancelPedido] = useState(false);
  const [pedidoACancelar, setPedidoACancelar] = useState(null);
  const [motivoCancel, setMotivoCancel] = useState('');

  // Poll del listado global; calcula también los 3 contadores del header/sidebar.
  const cargarMesas = useCallback(async () => {
    try {
      const { data } = await api.get('/mesas');
      setMesas(data);
      setListosCount(data.reduce((a, m) => a + (m.pedidosListos || 0), 0));
      setSolicitudesCount(data.filter((m) => m.estado_visual === 'cobrando').length);
      setAlertasCount(data.reduce((a, m) => a + (m.alertas?.length || 0), 0));
    } catch { /* network hiccup — siguiente tick reintenta */ }
  }, []);

  // Polling cada POLL_MS (no se pausa por visibilidad porque es la vista principal del mesero).
  useEffect(() => {
    cargarMesas();
    const id = setInterval(cargarMesas, POLL_MS);
    return () => clearInterval(id);
  }, [cargarMesas]);

  // Detalle completo (sesiones + pedidos + solicitudes) de una mesa seleccionada.
  const cargarDetalle = useCallback(async (id) => {
    setCargandoDetalle(true);
    try {
      const { data } = await api.get(`/mesas/${id}`);
      setDetalle(data);
    } catch { /* ignore — los datos previos quedan visibles */ }
    finally { setCargandoDetalle(false); }
  }, []);

  // Refresca el panel lateral en cada poll mientras haya una mesa seleccionada.
  useEffect(() => {
    if (!mesaSeleccionada) return;
    const id = setInterval(() => cargarDetalle(mesaSeleccionada), POLL_MS);
    return () => clearInterval(id);
  }, [mesaSeleccionada, cargarDetalle]);

  // Abre el panel lateral para esa mesa y resetea la tab a "sesiones".
  const seleccionarMesa = (mesa) => {
    setMesaSeleccionada(mesa.id);
    cargarDetalle(mesa.id);
    setActiveTab('sesiones');
  };

  // ── Acciones ────────────────────────────────────────────────────────────
  // Cierra la mesa (libera para nuevo cliente). Requiere confirmación porque
  // termina todas las sesiones activas. Tras éxito limpia el panel lateral.
  const cerrarMesa = async (id) => {
    const ok = await toast.confirm({
      title: 'Cerrar mesa',
      message: '¿Cerrar esta mesa y finalizar todas sus sesiones?',
      confirmText: 'Cerrar mesa', tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.put(`/mesas/${id}/cerrar`);
      setMesaSeleccionada(null); setDetalle(null);
      cargarMesas();
      toast.success('Mesa cerrada correctamente');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cerrar la mesa');
    }
  };

  // Cierra solo una sesión (cliente individual) sin tocar el resto de la mesa.
  const cerrarSesion = async (sesionId, alias) => {
    const ok = await toast.confirm({
      title: 'Cerrar sesión',
      message: `¿Cerrar la sesión de ${alias}?`,
      confirmText: 'Cerrar sesión', tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.post('/mesero/cerrar-sesion', { sesion_id: sesionId });
      cargarDetalle(mesaSeleccionada); cargarMesas();
      toast.success(`Sesión de ${alias} cerrada`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cerrar la sesión');
    }
  };

  // Crea una sesión "asistida" en la mesa sin requerir QR (el mesero la abre por el cliente).
  const agregarSesionAsistida = async () => {
    if (!aliasNuevo.trim()) return;
    try {
      await api.post('/mesero/sesion-asistida', { mesa_id: mesaSeleccionada, alias: aliasNuevo.trim() });
      setShowAddSesion(false); setAliasNuevo('');
      cargarDetalle(mesaSeleccionada); cargarMesas();
      toast.success(`Cliente "${aliasNuevo.trim()}" agregado`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo agregar la sesión');
    }
  };

  // Cancela una solicitud de cuenta sin tocar el estado de la mesa.
  const cancelarSolicitud = async (solId) => {
    const ok = await toast.confirm({
      title: 'Cancelar solicitud',
      message: '¿Cancelar esta solicitud de pago? La mesa permanecerá activa.',
      confirmText: 'Cancelar solicitud', tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.post('/mesero/cancelar-solicitud', { solicitud_id: solId });
      cargarDetalle(mesaSeleccionada); cargarMesas();
      toast.success('Solicitud cancelada');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cancelar');
    }
  };

  // Solicita la cuenta global (tipo 'grupal') desde el mesero (atajo presencial).
  const solicitarCuentaMesa = async (mesaId) => {
    const ok = await toast.confirm({
      title: 'Solicitar cuenta',
      message: '¿Solicitar la cuenta para toda la mesa?',
      confirmText: 'Solicitar', tone: 'success',
    });
    if (!ok) return;
    try {
      await api.post('/mesero/solicitar-cuenta', { mesa_id: mesaId, tipo: 'grupal' });
      cargarDetalle(mesaSeleccionada); cargarMesas();
      toast.success('Solicitud de cuenta creada (mesa completa)');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo crear la solicitud');
    }
  };

  // Solicita la cuenta individual de una sesión (cobro split).
  const solicitarCuentaSesion = async (sesionId, alias) => {
    const ok = await toast.confirm({
      title: 'Solicitar cuenta individual',
      message: `¿Solicitar la cuenta individual de ${alias}?`,
      confirmText: 'Solicitar', tone: 'success',
    });
    if (!ok) return;
    try {
      await api.post('/mesero/solicitar-cuenta', { mesa_id: mesaSeleccionada, sesion_id: sesionId, tipo: 'individual' });
      cargarDetalle(mesaSeleccionada); cargarMesas();
      toast.success(`Solicitud creada para ${alias}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo crear la solicitud');
    }
  };

  // Marca un pedido 'listo' → 'entregado'. Esto lo dispara el mesero al
  // llevar la comida físicamente a la mesa (no la cocina).
  const entregarPedido = async (pedidoId) => {
    try {
      await api.post('/cocina/marcar-entregado', { pedido_id: pedidoId });
      cargarDetalle(mesaSeleccionada); cargarMesas();
      toast.success(`Pedido #${pedidoId} entregado`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al entregar');
    }
  };

  // Cancela un pedido. Motivo obligatorio para trazabilidad/auditoría (mesero).
  const cancelarPedido = async () => {
    if (!motivoCancel.trim()) { toast.warning('El motivo es obligatorio'); return; }
    try {
      await api.post('/mesero/cancelar-pedido', { pedido_id: pedidoACancelar, motivo: motivoCancel.trim() });
      setShowCancelPedido(false); setMotivoCancel(''); setPedidoACancelar(null);
      cargarDetalle(mesaSeleccionada);
      toast.success(`Pedido #${pedidoACancelar} cancelado`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cancelar');
    }
  };

  // Lanza el modal de pedido asistido para una sesión específica.
  const abrirAsistido = (sesion) => {
    setAsistidoSesion(sesion);
    setShowAsistido(true);
  };

  const sidebarNav = (
    <>
      <a className="active" style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Mesas</a>
      <a onClick={() => navigate('/mesero/listos')} style={{ cursor: 'pointer' }}>
        <i className="bi bi-bag-check-fill" /> Pedidos listos
        {listosCount > 0 && <span className="badge-alert">{listosCount}</span>}
      </a>
      <a onClick={() => navigate('/mesero/alertas')} style={{ cursor: 'pointer' }}>
        <i className="bi bi-bell-fill" /> Alertas
        {alertasCount > 0 && <span className="badge-alert">{alertasCount}</span>}
      </a>
    </>
  );

  const mesasFiltradas = filtroEstado === 'todas'
    ? mesas
    : mesas.filter((m) => (m.estado_visual || m.estado) === filtroEstado);

  // ─── Render tabs ────────────────────────────────────────────────────────
  const renderTabContent = () => {
    if (!detalle) return null;
    const sesiones = detalle.sesiones || [];
    const solicitudes = detalle.solicitudes || [];

    if (activeTab === 'sesiones') {
      return (
        <div>
          <button onClick={() => setShowAddSesion(true)} className="btn btn-sm w-100 mb-2"
            style={{ background: 'var(--mm-cream-dark)', fontSize: '.85rem', padding: '.5rem' }}>
            <i className="bi bi-person-plus me-1" /> Agregar cliente a la mesa
          </button>
          <button onClick={() => solicitarCuentaMesa(detalle.mesa_id)} className="btn btn-sm w-100 mb-3"
            style={{ background: 'var(--mm-gold)', color: '#fff', fontSize: '.85rem', padding: '.5rem' }}>
            <i className="bi bi-receipt me-1" /> Solicitar cuenta (mesa completa)
          </button>
          {sesiones.length === 0 && (
            <div className="text-center py-3" style={{ color: 'var(--mm-text-muted)' }}>
              <i className="bi bi-people" style={{ fontSize: '2rem', display: 'block', marginBottom: '.4rem' }} />
              <p style={{ fontSize: '.85rem', margin: 0 }}>Sin sesiones activas</p>
            </div>
          )}
          {sesiones.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--mm-border)', borderRadius: 6, padding: '.75rem', marginBottom: '.75rem' }}>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <div className="d-flex gap-2 align-items-center">
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--mm-green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                    {s.alias?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{s.alias}</div>
                    <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>
                      {(s.pedidos || []).length} pedidos · ${parseFloat(s.total || 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="d-flex gap-2">
                <button onClick={() => abrirAsistido(s)} className="btn btn-sm flex-grow-1"
                  style={{ background: 'var(--mm-green)', color: '#fff', fontSize: '.78rem' }}>
                  <i className="bi bi-plus-circle me-1" />+ Pedido
                </button>
                <button onClick={() => solicitarCuentaSesion(s.id, s.alias)} className="btn btn-sm"
                  style={{ background: 'var(--mm-gold)', color: '#fff', fontSize: '.78rem' }}>
                  <i className="bi bi-receipt me-1" />Cuenta
                </button>
                <button onClick={() => cerrarSesion(s.id, s.alias)} className="btn btn-sm"
                  style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-danger)', fontSize: '.78rem' }}>
                  <i className="bi bi-x-circle me-1" />Cerrar
                </button>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === 'pedidos') {
      const todos = sesiones.flatMap((s) => (s.pedidos || []).map((p) => ({ ...p, alias: s.alias })));
      if (todos.length === 0) {
        return (
          <div className="text-center py-4" style={{ color: 'var(--mm-text-muted)' }}>
            <i className="bi bi-clipboard" style={{ fontSize: '2rem', display: 'block', marginBottom: '.4rem' }} />
            <p style={{ fontSize: '.85rem', margin: 0 }}>Sin pedidos</p>
          </div>
        );
      }
      return (
        <div>
          {todos.map((p) => (
            <div key={p.id} style={{ border: '1px solid var(--mm-border)', borderRadius: 6, padding: '.75rem', marginBottom: '.75rem' }}>
              <div className="d-flex align-items-center justify-content-between mb-1">
                <span style={{ fontWeight: 600, fontSize: '.875rem' }}>#{p.id} · {p.alias}</span>
                <span style={{
                  background: STATUS_BG[p.estado] || '#f5f5f5',
                  color: STATUS_FG[p.estado] || '#333',
                  borderRadius: 99, padding: '.2rem .6rem', fontSize: '.7rem', fontWeight: 700,
                }}>{ESTADO_DISP[p.estado] || p.estado}</span>
              </div>
              {(p.items || []).map((i, idx) => (
                <div key={idx} style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
                  {i.cantidad}× {i.nombre}
                </div>
              ))}
              <div className="d-flex gap-2 mt-2">
                {p.estado === 'listo' && (
                  <button onClick={() => entregarPedido(p.id)} className="btn btn-sm flex-grow-1"
                    style={{ background: 'var(--mm-green)', color: '#fff', fontSize: '.78rem' }}>
                    <i className="bi bi-check2 me-1" />Entregado
                  </button>
                )}
                {!['entregado', 'cancelado'].includes(p.estado) && (
                  <button onClick={() => { setPedidoACancelar(p.id); setShowCancelPedido(true); }} className="btn btn-sm"
                    style={{ background: '#FDEDEC', color: 'var(--mm-danger)', fontSize: '.78rem' }}>
                    <i className="bi bi-x-circle me-1" />Cancelar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === 'solicitudes') {
      if (solicitudes.length === 0) {
        return (
          <div className="text-center py-4" style={{ color: 'var(--mm-text-muted)' }}>
            <i className="bi bi-bell" style={{ fontSize: '2rem', display: 'block', marginBottom: '.4rem' }} />
            <p style={{ fontSize: '.85rem', margin: 0 }}>Sin solicitudes</p>
          </div>
        );
      }
      return (
        <div>
          {solicitudes.map((s) => (
            <div key={s.id} style={{ border: '2px solid var(--mm-green)', background: 'var(--mm-green-pale)', borderRadius: 6, padding: '.75rem', marginBottom: '.75rem' }}>
              <div className="d-flex justify-content-between mb-1">
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.875rem' }}>Solicitud de cuenta</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>
                    {s.alias} · {s.tipo === 'grupal' ? 'Toda la mesa' : 'Individual'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, color: 'var(--mm-green)' }}>${parseFloat(s.total).toFixed(2)}</span>
                  {s.metodo_pref && (
                    <div><span style={{ fontSize: '.7rem', background: 'var(--mm-white)', color: 'var(--mm-green)', borderRadius: 99, padding: '.1rem .45rem', marginTop: '.2rem', display: 'inline-block' }}>{s.metodo_pref}</span></div>
                  )}
                </div>
              </div>
              <div className="d-flex gap-2 mt-2">
                <button onClick={() => navigate(`/mesero/pago?mesa_id=${detalle.mesa_id}&sol_id=${s.id}`)}
                  className="btn btn-primary btn-sm flex-grow-1">
                  <i className="bi bi-cash-coin me-1" />Procesar pago
                </button>
                <button onClick={() => cancelarSolicitud(s.id)} className="btn btn-sm"
                  style={{ background: '#FDEDEC', color: 'var(--mm-danger)' }}>
                  <i className="bi bi-x-circle" />
                </button>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === 'resumen') {
      const totalPedidos = sesiones.reduce((a, s) => a + (s.pedidos || []).length, 0);
      const totalItems = sesiones.reduce(
        (a, s) => a + (s.pedidos || []).reduce((sa, p) => sa + (p.items || []).length, 0), 0);
      return (
        <div>
          <div style={{ background: 'var(--mm-green-pale)', borderRadius: 6, padding: '1rem', textAlign: 'center', marginBottom: '1rem' }}>
            <div style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>Total consumido</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--mm-green)' }}>
              ${parseFloat(detalle.total_mesa || 0).toFixed(2)}
            </div>
          </div>
          <div style={{ fontSize: '.85rem' }}>
            <div className="d-flex justify-content-between py-2" style={{ borderBottom: '1px solid var(--mm-border)' }}>
              <span>Sesiones activas</span>
              <strong>{sesiones.length}</strong>
            </div>
            <div className="d-flex justify-content-between py-2" style={{ borderBottom: '1px solid var(--mm-border)' }}>
              <span>Pedidos totales</span>
              <strong>{totalPedidos}</strong>
            </div>
            <div className="d-flex justify-content-between py-2" style={{ borderBottom: '1px solid var(--mm-border)' }}>
              <span>Ítems totales</span>
              <strong>{totalItems}</strong>
            </div>
            <div className="d-flex justify-content-between py-2" style={{ borderBottom: '1px solid var(--mm-border)' }}>
              <span>Solicitudes pendientes</span>
              <strong>{solicitudes.length}</strong>
            </div>
            {detalle.pin && (
              <div className="d-flex justify-content-between py-2">
                <span>PIN</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--mm-green)' }}>{detalle.pin}</strong>
              </div>
            )}
          </div>
        </div>
      );
    }
  };

  return (
    <StaffLayout title="Mapa de Mesas" sidebarNav={sidebarNav}>
      <div className="d-flex gap-3" style={{ height: 'calc(100vh - 56px - 3rem)', overflow: 'hidden' }}>
        {/* Grid de mesas */}
        <div className="flex-grow-1 overflow-y-auto">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h5 className="fw-bold mb-0">Mesas <span style={{ fontSize: '.8rem', fontWeight: 400, color: 'var(--mm-text-muted)' }}>— Floor Plan</span></h5>
            <div className="d-flex align-items-center gap-3">
              <span className="badge" style={{ background: '#EAFAF1', color: '#1E8449' }}>
                <i className="bi bi-bag-check me-1" />{listosCount} listos
              </span>
              <span className="badge" style={{ background: '#F4E4F8', color: '#7D3C98' }}>
                <i className="bi bi-cash-coin me-1" />{solicitudesCount} cobrando
              </span>
              <span className="badge" style={{ background: '#FDEDEC', color: '#C0392B' }}>
                <i className="bi bi-bell-fill me-1" />{alertasCount} alertas
              </span>
            </div>
          </div>

          {/* Filtros */}
          <div className="mb-3 d-flex flex-wrap gap-2">
            {['todas', 'libre', 'ocupada', 'cocina', 'listo', 'cobrando', 'alerta'].map((f) => (
              <button key={f} onClick={() => setFiltroEstado(f)}
                style={{
                  padding: '.3rem .85rem',
                  background: filtroEstado === f ? 'var(--mm-green)' : 'var(--mm-cream-dark)',
                  color: filtroEstado === f ? '#fff' : 'var(--mm-text)',
                  border: 'none', borderRadius: 99, fontSize: '.75rem', fontWeight: 600,
                  cursor: 'pointer', textTransform: 'capitalize',
                }}>
                {f === 'todas' ? `Todas (${mesas.length})` : (ESTADO_VISUAL[f]?.label || f)}
              </button>
            ))}
          </div>

          <div className="table-grid">
            {mesasFiltradas.map((mesa) => {
              const tile = tileVisual(mesa);
              const sel = mesaSeleccionada === mesa.id;
              return (
                <div key={mesa.id} onClick={() => seleccionarMesa(mesa)}
                  style={{
                    background: tile.bg,
                    border: `2px solid ${sel ? 'var(--mm-green)' : tile.color}`,
                    borderRadius: 10, padding: '1rem', cursor: 'pointer',
                    boxShadow: sel ? '0 4px 12px rgba(61,107,79,.3)' : 'none',
                    position: 'relative',
                  }}>
                  {mesa.alertas?.length > 0 && (
                    <span style={{ position: 'absolute', top: 6, right: 6, background: '#E74C3C', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.65rem', fontWeight: 700 }}>
                      {mesa.alertas.length}
                    </span>
                  )}
                  {mesa.pedidosListos > 0 && (
                    <span style={{ position: 'absolute', top: 6, left: 6, background: 'var(--mm-success)', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.65rem', fontWeight: 700 }}>
                      {mesa.pedidosListos}
                    </span>
                  )}
                  {/* fix#8: usar className 'mesa-num' para que herede Playfair
                      Display desde staff.css. Inline mantiene solo color/size
                      dinámicos por estado_visual. */}
                  <div className="mesa-num" style={{ fontSize: '1.7rem', color: tile.color, textAlign: 'center', lineHeight: 1 }}>
                    {mesa.numero_mesa}
                  </div>
                  <div className="mesa-label" style={{ fontSize: '.72rem', color: tile.color, textAlign: 'center', marginTop: '.4rem' }}>
                    {tile.label}
                  </div>
                  {mesa.ubicacion && (
                    <div style={{ fontSize: '.6rem', color: 'var(--mm-text-muted)', textAlign: 'center', marginTop: '.2rem' }}>
                      {mesa.ubicacion.nombre}
                    </div>
                  )}
                  {mesa.pin_actual && (
                    <div style={{ fontSize: '.65rem', color: '#555', fontFamily: 'var(--font-mono)', textAlign: 'center', marginTop: '.15rem' }}>
                      PIN: <strong>{mesa.pin_actual}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel detalle con tabs */}
        {mesaSeleccionada && (
          <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--mm-white)', borderRadius: 10, border: '1px solid var(--mm-border)' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--mm-border)' }}>
              <div className="d-flex justify-content-between align-items-center">
                <h6 className="fw-bold mb-0">Mesa {detalle?.numero_mesa}</h6>
                <button onClick={() => { setMesaSeleccionada(null); setDetalle(null); }}
                  style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: 'var(--mm-text-muted)' }}>×</button>
              </div>
              {/* fix#2 Bug D: banner prominente cuando hay nota_cierre + botón
                  "Cerrar mesa" inline. Replica el flujo del Django mesero/mapa_mesas.html. */}
              {detalle?.nota_cierre && (
                <div
                  className="mt-2 mb-0"
                  style={{
                    background: '#FFF4D6',
                    border: '1px solid #E8C04E',
                    borderRadius: 'var(--radius-sm)',
                    padding: '.65rem .8rem',
                  }}
                >
                  <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: '.78rem', fontWeight: 700, color: '#7A5A0A' }}>
                    <i className="bi bi-exclamation-triangle-fill" />
                    Mesa pagada — Cerrar manualmente
                  </div>
                  <div style={{ fontSize: '.76rem', color: '#6B4F0E', marginBottom: '.5rem' }}>
                    {detalle.nota_cierre}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm w-100 fw-semibold"
                    style={{ background: 'var(--mm-green)', color: '#fff' }}
                    onClick={() => cerrarMesa(detalle.mesa_id)}
                  >
                    <i className="bi bi-door-closed me-1" />Cerrar mesa
                  </button>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--mm-border)' }}>
              {['sesiones', 'pedidos', 'solicitudes', 'resumen'].map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1, padding: '.6rem', fontSize: '.8rem', fontWeight: 600,
                    border: 'none', background: 'none', cursor: 'pointer',
                    borderBottom: `2px solid ${activeTab === tab ? 'var(--mm-green)' : 'transparent'}`,
                    color: activeTab === tab ? 'var(--mm-green)' : 'var(--mm-text-muted)',
                    textTransform: 'capitalize',
                  }}>
                  {tab}
                </button>
              ))}
            </div>

            {/* Contenido tab */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              {cargandoDetalle && !detalle ? (
                <div className="text-center py-4"><div className="spinner-border spinner-border-sm" /></div>
              ) : detalle ? renderTabContent() : (
                <div className="text-center py-3" style={{ color: 'var(--mm-text-muted)' }}>
                  <div style={{ fontSize: '2rem' }}>🪑</div>
                  <p style={{ fontSize: '.85rem', marginTop: '.5rem' }}>Selecciona una mesa</p>
                </div>
              )}
            </div>

            {/* Footer */}
            {detalle && !detalle.mesa_libre && (
              <div style={{ padding: '.75rem 1rem', borderTop: '1px solid var(--mm-border)' }}>
                <button onClick={() => cerrarMesa(detalle.mesa_id)} className="btn btn-outline-danger btn-sm w-100">
                  <i className="bi bi-door-closed me-1" />Cerrar mesa
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal agregar cliente */}
      {showAddSesion && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAddSesion(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '2rem', width: '100%', maxWidth: 380 }}>
            <h5 className="fw-bold mb-3"><i className="bi bi-person-plus me-2" style={{ color: 'var(--mm-green)' }} />Agregar cliente</h5>
            <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>
              El mesero abre una sesión asistida sin que el cliente escanee QR.
            </p>
            <input type="text" className="form-control" placeholder="ALIAS / NOMBRE"
              value={aliasNuevo} onChange={upperOnChange(setAliasNuevo, 50)}
              maxLength={50} autoFocus
              style={{ textTransform: 'uppercase' }}
              autoCapitalize="characters"
              onKeyDown={(e) => e.key === 'Enter' && agregarSesionAsistida()} />
            <CharCounter value={aliasNuevo} max={50} />
            <div className="mb-3" />
            <div className="d-flex gap-2">
              <button className="btn flex-grow-1" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => setShowAddSesion(false)}>Cancelar</button>
              <button className="btn btn-primary flex-grow-1" onClick={agregarSesionAsistida} disabled={!aliasNuevo.trim()}>
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cancelar pedido */}
      {showCancelPedido && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowCancelPedido(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '2rem', width: '100%', maxWidth: 400 }}>
            <h5 className="fw-bold text-danger mb-1"><i className="bi bi-x-circle me-2" />Cancelar pedido #{pedidoACancelar}</h5>
            <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>Ingresa el motivo (obligatorio para auditoría).</p>
            <textarea className="form-control" rows={3}
              placeholder="EJ. CLIENTE CAMBIÓ DE OPINIÓN..."
              value={motivoCancel} onChange={upperOnChange(setMotivoCancel, 500)}
              style={{ textTransform: 'uppercase' }}
              maxLength={500} autoFocus />
            <CharCounter value={motivoCancel} max={500} />
            <div className="mb-3" />
            <div className="d-flex gap-2">
              <button className="btn flex-grow-1" style={{ background: 'var(--mm-cream-dark)' }}
                onClick={() => { setShowCancelPedido(false); setMotivoCancel(''); }}>Volver</button>
              <button className="btn btn-danger flex-grow-1" onClick={cancelarPedido}
                disabled={!motivoCancel.trim()}>Confirmar cancelación</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pedido asistido */}
      {showAsistido && asistidoSesion && (
        <AsistidoModal
          sesion={asistidoSesion}
          onClose={() => { setShowAsistido(false); setAsistidoSesion(null); }}
          onSuccess={() => {
            setShowAsistido(false); setAsistidoSesion(null);
            cargarDetalle(mesaSeleccionada); cargarMesas();
            toast.success(`Pedido enviado a cocina para ${asistidoSesion.alias}`);
          }}
        />
      )}
    </StaffLayout>
  );
}
