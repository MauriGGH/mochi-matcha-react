/**
 * Reportes avanzados del gerente — 8 secciones espejo del Django original.
 *
 * Pestañas:
 *   - Corte de caja (cierre del turno con totales por método de pago)
 *   - Ventas, Productos, Empleados, Tiempos, Mesas, Cancelaciones
 *   - Auditoría (lista paginada de eventos desde tabla `auditorias`)
 *
 * Datos: /gerente/reportes/avanzados (fallback a /gerente/reportes si el
 * endpoint avanzado no existe). Auditoría se carga a demanda al cambiar
 * a esa pestaña vía /gerente/auditoria.
 *
 * Exporta a Excel/PDF con selección de secciones (modal). El POST a
 * /gerente/reportes/avanzados/exportar devuelve un blob para descarga.
 *
 * Export único: <ReportesAvanzados /> — montado en /gerente/reportes/avanzados.
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import { usePageTitle } from '../../hooks/usePageTitle';
import '../../styles/reportes.css';

const PERIODOS = [
  { value: 'hoy',      label: 'Hoy'       },
  { value: 'semana',   label: 'Semana'    },
  { value: 'quincena', label: 'Quincena'  },
  { value: 'mes',      label: 'Mes'       },
  { value: 'anio',     label: 'Año'       },
];

// fix#10: 8 categorías como el Django (corte, tiempos y mesas son nuevas)
const TABS = [
  { id: 'corte',         icon: 'bi-stopwatch-fill', label: 'Corte de caja', hero: 'green'  },
  { id: 'ventas',        icon: 'bi-cash-stack',     label: 'Ventas',        hero: 'green'  },
  { id: 'productos',     icon: 'bi-basket-fill',    label: 'Productos',     hero: 'gold'   },
  { id: 'empleados',     icon: 'bi-person-badge-fill', label: 'Empleados',  hero: 'blue'   },
  { id: 'tiempos',       icon: 'bi-stopwatch',      label: 'Tiempos',       hero: 'teal'   },
  { id: 'mesas',         icon: 'bi-grid-3x3',       label: 'Mesas',         hero: 'blue'   },
  { id: 'cancelaciones', icon: 'bi-x-circle',       label: 'Cancelaciones', hero: 'danger' },
  { id: 'auditoria',     icon: 'bi-shield-check',   label: 'Auditoría',     hero: 'teal'   },
];

const PAGE_SIZE = 20;
const fmt = (n) => parseFloat(n || 0).toFixed(2);
const fmtFecha = (s) => s ? new Date(s).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Página principal de reportes avanzados (8 secciones).
 * @returns {JSX.Element}
 */
export default function ReportesAvanzados() {
  usePageTitle('Reportes Avanzados');
  const navigate = useNavigate();
  const [periodo, setPeriodo]     = useState('semana');
  const [tab, setTab]             = useState('ventas');
  const [data, setData]           = useState(null);
  const [auditoria, setAuditoria] = useState([]);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [exportSecciones, setExportSecciones] = useState({
    corte: false, ventas: true, productos: true, empleados: false,
    tiempos: false, mesas: false, cancelaciones: false, auditoria: false,
  });

  // Carga reportes avanzados; si el endpoint avanzado falla (404 en envs
  // viejos), cae al endpoint básico /gerente/reportes para no romper la UI.
  useEffect(() => {
    setLoading(true);
    api.get(`/gerente/reportes/avanzados?periodo=${periodo}`)
      .then(({ data: d }) => setData(d))
      .catch(() => api.get(`/gerente/reportes?periodo=${periodo}`).then(({ data: d }) => setData(d)).catch(() => setData(null)))
      .finally(() => setLoading(false));
  }, [periodo]);

  // Auditoría se carga sólo al cambiar a esa pestaña (lista grande, lazy).
  useEffect(() => {
    if (tab !== 'auditoria') return;
    api.get(`/gerente/auditoria?periodo=${periodo}&limit=200`)
      .then(({ data: d }) => setAuditoria(d.eventos || d.items || d || []))
      .catch(() => setAuditoria([]));
  }, [tab, periodo]);

  const sidebarNav = (
    <>
      <a onClick={() => navigate('/gerente')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Floor Plan</a>
      <div className="nav-section-label">Gestión</div>
      <a onClick={() => navigate('/gerente/menu')} style={{ cursor: 'pointer' }}><i className="bi bi-basket-fill" /> Gestión de Menú</a>
      <div className="nav-section-label">Reportes</div>
      <a onClick={() => navigate('/gerente/reportes')} style={{ cursor: 'pointer' }}><i className="bi bi-bar-chart-fill" /> Reportes</a>
      <a className="active"><i className="bi bi-graph-up-arrow" /> Reportes avanzados</a>
      <div className="nav-section-label">Admin</div>
      <a onClick={() => navigate('/gerente/empleados')} style={{ cursor: 'pointer' }}><i className="bi bi-people-fill" /> Empleados</a>
      <a onClick={() => navigate('/gerente/configuracion')} style={{ cursor: 'pointer' }}><i className="bi bi-gear-fill" /> Configuración</a>
    </>
  );

  const stats         = data?.stats || {};
  const ventasPorDia  = data?.ventas_por_dia || [];
  const topProductos  = data?.top_productos || [];
  const cancelaciones = data?.cancelaciones || [];
  const empleados     = data?.empleados || data?.por_empleado || [];
  const desde = data?.desde ? new Date(data.desde).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const hasta = data?.hasta ? new Date(data.hasta).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

  const heroVariant = TABS.find((t) => t.id === tab)?.hero || 'green';

  const auditPaged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return auditoria.slice(start, start + PAGE_SIZE);
  }, [auditoria, page]);
  const totalPages = Math.max(1, Math.ceil(auditoria.length / PAGE_SIZE));

  const descargarBlob = async (e, formato) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/gerente/reportes/avanzados/exportar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ formato, periodo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `reporte-avanzado-${periodo}.${formato === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar el reporte. Intenta de nuevo.');
    }
  };

  const exportarCustom = async () => {
    try {
      const token = localStorage.getItem('token');
      const secciones = Object.entries(exportSecciones).filter(([, v]) => v).map(([k]) => k);
      if (!secciones.length) { toast.error('Selecciona al menos una sección para exportar.'); return; }
      const res = await fetch(`/api/gerente/reportes/exportar-custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ periodo, secciones, formato: 'excel' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `reporte-custom-${periodo}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setShowExport(false);
    } catch {
      toast.error('No se pudo generar el reporte. Intenta de nuevo.');
    }
  };

  return (
    <StaffLayout title="Reportes avanzados" sidebarNav={sidebarNav}>

      {/* ── Page Header ── */}
      <div className="rep-page-header">
        <div>
          <h5 className="fw-bold mb-0" style={{ fontSize: '1.05rem' }}>Reportes avanzados</h5>
          {desde && <p style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', margin: '.2rem 0 0' }}>{desde} — {hasta}</p>}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="period-pills">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`period-pill${periodo === p.value ? ' active' : ''}`}
                onClick={() => setPeriodo(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <a href="#" className="rep-action-btn excel" onClick={(e) => descargarBlob(e, 'excel')}>
            <i className="bi bi-file-earmark-excel" />Excel
          </a>
          <a href="#" className="rep-action-btn pdf" onClick={(e) => descargarBlob(e, 'pdf')}>
            <i className="bi bi-file-earmark-pdf" />PDF
          </a>
          <button type="button" className="rep-action-btn outline" onClick={() => setShowExport(true)}>
            <i className="bi bi-sliders" />Export custom
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-5"><div className="spinner-border" /></div>}

      {!loading && (
        <>
          {/* ── Corte del día ── */}
          <div className="corte-header">
            <div className="corte-orbe-left" />
            <div className="corte-title-glass">
              <div className="corte-label"><i className="bi bi-scissors me-1" />Corte del período</div>
              <div className="corte-titulo">{desde} — {hasta}</div>
            </div>
            <div className="corte-divider" />
            <div className="corte-grid">
              <div className="corte-kpi"><div className="val">${fmt(stats.total_ventas)}</div><div className="lbl">Ventas</div></div>
              <div className="corte-kpi"><div className="val">{stats.total_pedidos || 0}</div><div className="lbl">Pedidos</div></div>
              <div className="corte-kpi"><div className="val">${fmt(stats.ticket_promedio)}</div><div className="lbl">Ticket prom.</div></div>
              <div className="corte-kpi"><div className="val">{stats.cancelaciones_count || 0}</div><div className="lbl">Cancelaciones</div></div>
              {stats.propinas != null && (
                <div className="corte-kpi"><div className="val">${fmt(stats.propinas)}</div><div className="lbl">Propinas</div></div>
              )}
            </div>
          </div>

          {/* ── Tabs (fix#10: rep-cats con 8 categorías) ── */}
          <div className="rep-cats">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`rep-cat${tab === t.id ? ' active' : ''}`}
                onClick={() => { setTab(t.id); setPage(1); }}
              >
                <i className={`bi ${t.icon}`} />{t.label}
              </button>
            ))}
          </div>

          {/* ── Hero por sección ── */}
          <div className={`section-hero ${heroVariant}`}>
            <div className="section-hero-orbe" />
            <div className="hero-glass">
              <div className="hero-label">Sección</div>
              <div className="hero-title">{TABS.find((t) => t.id === tab)?.label}</div>
            </div>
            <div className="hero-divider" />
            <div className="hero-kpis">
              <div className="hero-kpi"><div className="val">{ventasPorDia.length}</div><div className="lbl">Días</div></div>
              <div className="hero-kpi"><div className="val">{topProductos.length}</div><div className="lbl">Productos</div></div>
              <div className="hero-kpi"><div className="val">{empleados.length}</div><div className="lbl">Empleados</div></div>
              <div className="hero-kpi"><div className="val">{cancelaciones.length}</div><div className="lbl">Cancelados</div></div>
            </div>
          </div>

          {/* ── Tab Corte de caja (fix#10) ──────────────────────────────── */}
          {tab === 'corte' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-stopwatch-fill" />Corte detallado por mesero</div>
              <table>
                <thead><tr><th>Mesero</th><th className="tr">Cobros</th><th className="tr">Efectivo</th><th className="tr">Tarjeta</th><th className="tr">Mixto</th><th className="tr">PayPal</th><th className="tr">Total</th></tr></thead>
                <tbody>
                  {(data?.corte_por_mesero || []).length ? data.corte_por_mesero.map((m) => (
                    <tr key={m.id_empleado || m.usuario}>
                      <td style={{ fontWeight: 600 }}>{m.nombre || m.usuario}</td>
                      <td className="tr">{m.cobros || 0}</td>
                      <td className="tr" style={{ fontFamily: 'var(--font-mono)' }}>${fmt(m.efectivo)}</td>
                      <td className="tr" style={{ fontFamily: 'var(--font-mono)' }}>${fmt(m.tarjeta)}</td>
                      <td className="tr" style={{ fontFamily: 'var(--font-mono)' }}>${fmt(m.mixto)}</td>
                      <td className="tr" style={{ fontFamily: 'var(--font-mono)' }}>${fmt(m.paypal)}</td>
                      <td className="tr" style={{ fontWeight: 800, color: 'var(--mm-green)', fontFamily: 'var(--font-mono)' }}>${fmt(m.total)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="7" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>
                      <i className="bi bi-info-circle me-1" />Endpoint backend pendiente: <code>/gerente/reportes/avanzados</code> debe devolver <code>corte_por_mesero</code> con desglose por método.
                    </td></tr>
                  )}
                </tbody>
              </table>
              {/* El corte-header glass del top ya muestra el resumen del período */}
            </div>
          )}

          {/* ── Tab Ventas ── */}
          {tab === 'ventas' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-calendar3" />Ventas por día</div>
              <table>
                <thead><tr><th>Día</th><th className="tr">Tickets</th><th className="tr">Total</th></tr></thead>
                <tbody>
                  {ventasPorDia.length ? ventasPorDia.map((d) => (
                    <tr key={d.dia}>
                      <td>{d.dia}</td>
                      <td className="tr">{d.tickets || 0}</td>
                      <td className="tr" style={{ fontWeight: 800, color: 'var(--mm-green)', fontFamily: 'var(--font-mono)' }}>${fmt(d.total)}</td>
                    </tr>
                  )) : <tr><td colSpan="3" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>Sin datos</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab Productos ── */}
          {tab === 'productos' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-trophy-fill" />Top productos</div>
              <table>
                <thead><tr><th>#</th><th>Producto</th><th className="tr">Unidades</th><th className="tr">Ingreso</th></tr></thead>
                <tbody>
                  {topProductos.length ? topProductos.map((prod, i) => {
                    const rankCls = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-n';
                    return (
                      <tr key={prod.id}>
                        <td><span className={`rank-num ${rankCls}`}>{i + 1}</span></td>
                        <td style={{ fontWeight: 600 }}>{prod.nombre}</td>
                        <td className="tr" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{prod.total_vendido}</td>
                        <td className="tr" style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--mm-green)' }}>${fmt(prod.ingreso)}</td>
                      </tr>
                    );
                  }) : <tr><td colSpan="4" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>Sin datos</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab Empleados ── */}
          {tab === 'empleados' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-people-fill" />Productividad por empleado</div>
              <table>
                <thead><tr><th>Empleado</th><th>Rol</th><th className="tr">Mesas atendidas</th><th className="tr">Ventas</th></tr></thead>
                <tbody>
                  {empleados.length ? empleados.map((emp) => (
                    <tr key={emp.id || emp.usuario}>
                      <td style={{ fontWeight: 600 }}>{emp.nombre || emp.usuario}</td>
                      <td><span className="badge-pill badge-green">{emp.rol || '—'}</span></td>
                      <td className="tr" style={{ fontFamily: 'var(--font-mono)' }}>{emp.mesas_atendidas ?? '—'}</td>
                      <td className="tr" style={{ fontFamily: 'var(--font-mono)', color: 'var(--mm-green)', fontWeight: 700 }}>${fmt(emp.total_ventas)}</td>
                    </tr>
                  )) : <tr><td colSpan="4" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>Endpoint backend pendiente (`/gerente/reportes/avanzados` con `empleados`)</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab Tiempos (fix#10) ──────────────────────────────────── */}
          {tab === 'tiempos' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-stopwatch" />Tiempos de atención</div>
              <table>
                <thead><tr><th>Métrica</th><th className="tr">Promedio (min)</th><th className="tr">Mediana</th><th className="tr">Máx</th></tr></thead>
                <tbody>
                  {data?.tiempos ? (
                    <>
                      <tr><td>Pedido → entrega (global)</td><td className="tr">{fmt(data.tiempos.promedio_global)}</td><td className="tr">{fmt(data.tiempos.mediana_global)}</td><td className="tr">{fmt(data.tiempos.max_global)}</td></tr>
                      <tr><td>Cocina (marcar listo)</td><td className="tr">{fmt(data.tiempos.cocina?.promedio)}</td><td className="tr">{fmt(data.tiempos.cocina?.mediana)}</td><td className="tr">{fmt(data.tiempos.cocina?.max)}</td></tr>
                      <tr><td>Bar (marcar listo)</td><td className="tr">{fmt(data.tiempos.bar?.promedio)}</td><td className="tr">{fmt(data.tiempos.bar?.mediana)}</td><td className="tr">{fmt(data.tiempos.bar?.max)}</td></tr>
                    </>
                  ) : (
                    <tr><td colSpan="4" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>
                      <i className="bi bi-info-circle me-1" />Endpoint backend pendiente: <code>/gerente/reportes/avanzados</code> debe devolver <code>tiempos {`{`} promedio_global, mediana_global, max_global, cocina, bar {`}`}</code> calculados desde <code>Pedido.fecha_hora_ingreso</code> y <code>DetallePedido.fecha_listo</code>.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab Mesas (fix#10) ───────────────────────────────────────── */}
          {tab === 'mesas' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-grid-3x3" />Uso de mesas</div>
              <table>
                <thead><tr><th>Mesa</th><th className="tr">Sesiones</th><th className="tr">Pedidos</th><th className="tr">Recaudado</th></tr></thead>
                <tbody>
                  {(data?.mesas || []).length ? data.mesas.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>Mesa {m.numero || m.numero_mesa}</td>
                      <td className="tr">{m.sesiones || 0}</td>
                      <td className="tr">{m.pedidos || 0}</td>
                      <td className="tr" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mm-green)' }}>${fmt(m.total)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="4" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>
                      <i className="bi bi-info-circle me-1" />Endpoint backend pendiente: <code>/gerente/reportes/avanzados</code> debe devolver <code>mesas [{`{`} id, numero, sesiones, pedidos, total {`}`}]</code> agregado por mesa.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab Cancelaciones ── */}
          {tab === 'cancelaciones' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-x-circle-fill" style={{ color: 'var(--mm-danger)' }} />Cancelaciones</div>
              <table>
                <thead><tr><th>Pedido</th><th>Fecha</th><th>Mesa</th><th>Motivo</th></tr></thead>
                <tbody>
                  {cancelaciones.length ? cancelaciones.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--mm-danger)' }}>#{p.id}</td>
                      <td style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{fmtFecha(p.fecha)}</td>
                      <td>Mesa {p.mesa_numero}</td>
                      <td style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{p.motivo || '—'}</td>
                    </tr>
                  )) : <tr><td colSpan="4" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>Sin cancelaciones</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab Auditoría (paginada) ── */}
          {tab === 'auditoria' && (
            <div className="data-table">
              <div className="data-table-header"><i className="bi bi-shield-check" />Auditoría · {auditoria.length} eventos</div>
              <table className="audit-table">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
                <tbody>
                  {auditPaged.length ? auditPaged.map((ev, i) => (
                    <tr key={ev.id ?? i}>
                      <td style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>{fmtFecha(ev.fecha || ev.fecha_hora || ev.timestamp)}</td>
                      <td style={{ fontWeight: 600 }}>{ev.usuario || ev.empleado || '—'}</td>
                      <td><span className="badge-pill badge-green">{ev.accion || ev.tipo || '—'}</span></td>
                      <td style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{ev.detalle || ev.descripcion || '—'}</td>
                    </tr>
                  )) : <tr><td colSpan="4" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--mm-text-muted)' }}>Sin eventos para el período</td></tr>}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '.5rem', padding: '.75rem' }}>
                  <button className="rep-action-btn outline" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <i className="bi bi-chevron-left" />Anterior
                  </button>
                  <span style={{ fontSize: '.82rem', color: 'var(--mm-text-muted)' }}>Página {page} / {totalPages}</span>
                  <button className="rep-action-btn outline" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Siguiente<i className="bi bi-chevron-right" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Modal Export Custom ── */}
      {showExport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', padding: '1.75rem', width: '100%', maxWidth: 480 }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="fw-bold mb-0"><i className="bi bi-sliders me-2" />Exportación personalizada</h5>
              <button type="button" onClick={() => setShowExport(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>Elige las secciones a incluir en el Excel.</p>

            <div className="exp-cat-hdr"><i className="bi bi-folder2-open" />Secciones</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.25rem', marginBottom: '1.25rem' }}>
              {Object.keys(exportSecciones).map((k) => (
                <label key={k} className="exp-chk">
                  <input
                    type="checkbox"
                    checked={exportSecciones[k]}
                    onChange={(e) => setExportSecciones((prev) => ({ ...prev, [k]: e.target.checked }))}
                  />
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </label>
              ))}
            </div>

            <div className="d-flex gap-2">
              <button className="btn flex-grow-1 py-2" onClick={() => setShowExport(false)} style={{ background: 'var(--mm-cream-dark)' }}>Cancelar</button>
              <button className="btn btn-primary flex-grow-1 py-2" onClick={exportarCustom}>
                <i className="bi bi-download me-2" />Descargar Excel
              </button>
            </div>
          </div>
        </div>
      )}
    </StaffLayout>
  );
}
