/**
 * Reportes básicos del gerente — KPIs, gráficas de ventas y top productos.
 *
 * - Selector de período (hoy / 7d / 30d / año / rango personalizado).
 * - 3 pestañas: Ventas, Más vendidos, Cancelaciones.
 * - Exporta a Excel/PDF vía /gerente/reportes/exportar (descarga blob).
 *
 * Para el detalle completo (corte de caja, tiempos, auditoría) ver
 * ReportesAvanzados.jsx.
 *
 * Export único: <Reportes /> — montado en /gerente/reportes.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import '../../styles/reportes.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const PERIODOS = [
  { value: 'hoy',           label: 'Hoy'          },
  { value: 'semana',        label: '7 días'       },
  { value: 'mes',           label: '30 días'      },
  { value: 'anio',          label: 'Año'          },
  { value: 'personalizado', label: 'Personalizado'},
];

const TABS = [
  { id: 'ventas',        icon: 'bi-graph-up-arrow', label: 'Ventas'       },
  { id: 'productos',     icon: 'bi-bag-fill',       label: 'Más vendidos' },
  { id: 'cancelaciones', icon: 'bi-x-circle',       label: 'Cancelaciones'},
];

function fmt(n) { return parseFloat(n || 0).toFixed(2); }
function fmtFecha(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

const CHART_OPTIONS_BASE = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    y: { beginAtZero: true, grid: { color: 'rgba(226,221,213,.6)' } },
    x: { grid: { display: false } },
  },
};

/**
 * Página principal de reportes básicos.
 * @returns {JSX.Element}
 */
export default function Reportes() {
  usePageTitle('Reportes');
  const navigate = useNavigate();
  const [periodo, setPeriodo]   = useState('semana');
  const [tab, setTab]           = useState('ventas');
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  // fix#10: período personalizado con date pickers (desde/hasta)
  const [rango, setRango]       = useState({ desde: '', hasta: '' });

  // Refetch de reportes cada vez que cambie periodo o rango personalizado.
  // En modo personalizado esperamos a que ambos date pickers tengan valor
  // para no spamear al backend con queries inválidas.
  useEffect(() => {
    if (periodo === 'personalizado' && (!rango.desde || !rango.hasta)) {
      // Esperar a que el usuario aplique las fechas antes de fetchear
      return;
    }
    setLoading(true);
    const params = periodo === 'personalizado'
      ? `?desde=${rango.desde}&hasta=${rango.hasta}`
      : `?periodo=${periodo}`;
    api.get(`/gerente/reportes${params}`)
      .then(({ data: d }) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [periodo, rango.desde, rango.hasta]);

  const sidebarNav = (
    <>
      <a onClick={() => navigate('/gerente')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Floor Plan</a>
      <div className="nav-section-label">Gestión</div>
      <a onClick={() => navigate('/gerente/menu')} style={{ cursor: 'pointer' }}><i className="bi bi-basket-fill" /> Gestión de Menú</a>
      <div className="nav-section-label">Reportes</div>
      <a className="active"><i className="bi bi-bar-chart-fill" /> Reportes</a>
      <a onClick={() => navigate('/gerente/reportes/avanzados')} style={{ cursor: 'pointer' }}><i className="bi bi-graph-up-arrow" /> Reportes avanzados</a>
      <div className="nav-section-label">Admin</div>
      <a onClick={() => navigate('/gerente/empleados')} style={{ cursor: 'pointer' }}><i className="bi bi-people-fill" /> Empleados</a>
      <a onClick={() => navigate('/gerente/configuracion')} style={{ cursor: 'pointer' }}><i className="bi bi-gear-fill" /> Configuración</a>
    </>
  );

  const descargarBlob = async (e, formato) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/gerente/reportes/exportar?formato=${formato}&periodo=${periodo}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `reporte-${periodo}.${formato === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar el reporte. Intenta de nuevo.');
    }
  };

  const stats        = data?.stats || {};
  const ventasPorDia = data?.ventas_por_dia || [];
  const topProductos = data?.top_productos || [];
  const pedidosRec   = data?.pedidos_recientes || [];
  const cancelaciones = data?.cancelaciones || [];
  const desde = data?.desde ? new Date(data.desde).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const hasta  = data?.hasta  ? new Date(data.hasta).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

  const salesChartData = {
    labels: ventasPorDia.map(d => d.dia),
    datasets: [{
      label: 'Ventas ($)',
      data: ventasPorDia.map(d => d.total),
      backgroundColor: 'rgba(61,107,79,.75)',
      borderRadius: 6,
      borderSkipped: false,
    }],
  };
  const ticketsChartData = {
    labels: ventasPorDia.map(d => d.dia),
    datasets: [{
      label: 'Tickets',
      data: ventasPorDia.map(d => d.tickets),
      backgroundColor: 'rgba(26,106,138,.75)',
      borderRadius: 5,
      borderSkipped: false,
    }],
  };
  const salesOpts = {
    ...CHART_OPTIONS_BASE,
    scales: {
      ...CHART_OPTIONS_BASE.scales,
      y: { ...CHART_OPTIONS_BASE.scales.y, ticks: { callback: v => '$' + v } },
    },
  };

  const maxVendido = Math.max(...topProductos.map(p => p.total_vendido), 1);

  return (
    <StaffLayout title="Reportes" sidebarNav={sidebarNav}>

      {/* ── Page Header ── */}
      <div className="rep-page-header">
        <div>
          <h5 className="fw-bold mb-0" style={{ fontSize: '1.05rem' }}>Resumen de reportes</h5>
          {desde && <p style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', margin: '.2rem 0 0' }}>{desde} — {hasta}</p>}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="period-pills">
            {PERIODOS.map(p => (
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
        </div>
        {/* fix#10: rango personalizado con date pickers */}
        {periodo === 'personalizado' && (
          <div className="d-flex align-items-center gap-2 mt-2 flex-wrap" style={{ flexBasis: '100%' }}>
            <label style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>Desde:</label>
            <input
              type="date"
              className="form-control form-control-sm"
              style={{ borderColor: 'var(--mm-border)', maxWidth: 160 }}
              value={rango.desde}
              onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
            />
            <label style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>Hasta:</label>
            <input
              type="date"
              className="form-control form-control-sm"
              style={{ borderColor: 'var(--mm-border)', maxWidth: 160 }}
              value={rango.hasta}
              onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
              min={rango.desde || undefined}
            />
            {(!rango.desde || !rango.hasta) && (
              <small style={{ color: 'var(--mm-text-muted)', fontSize: '.72rem' }}>
                <i className="bi bi-info-circle me-1" />Selecciona ambas fechas para cargar el reporte
              </small>
            )}
          </div>
        )}
      </div>

      {loading && <div className="text-center py-5"><div className="spinner-border" /></div>}

      {!loading && data && (
        <>
          {/* ── KPI Grid (fix#10: 6 KPIs como el Django) ── */}
          <div className="kpi-grid">
            {[
              { icon: 'bi-cash-stack',       label: 'Ventas totales',  value: `$${fmt(stats.total_ventas)}`,    variant: '' },
              { icon: 'bi-receipt',          label: 'Cobros',          value: stats.total_sesiones || 0,         variant: 'accent' },
              { icon: 'bi-currency-dollar',  label: 'Ticket promedio', value: `$${fmt(stats.ticket_promedio)}`, variant: 'kpi-teal' },
              { icon: 'bi-bag-check',        label: 'Pedidos',         value: stats.total_pedidos || 0,          variant: 'kpi-blue' },
              { icon: 'bi-grid-3x3',         label: 'Mesas atendidas', value: stats.total_sesiones || 0,         variant: '' },
              { icon: 'bi-x-circle',         label: 'Cancelaciones',   value: stats.cancelaciones_count || 0,    variant: 'kpi-danger' },
            ].map((s, i) => (
              <div key={i} className={`kpi${s.variant ? ` ${s.variant}` : ''}`}>
                <div className="kpi-icon"><i className={`bi ${s.icon}`} /></div>
                <div className="kpi-val">{s.value}</div>
                <div className="kpi-lbl">{s.label}</div>
              </div>
            ))}
          </div>

          {/* ── Tabs ── */}
          <div className="rep-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                className={`report-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <i className={`bi ${t.icon} me-1`} />{t.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Ventas ── */}
          {tab === 'ventas' && (
            <div className="row g-4">
              <div className="col-12">
                <div className="rep-card">
                  <div className="rep-card-title">
                    <span><i className="bi bi-bar-chart-fill me-1" />Ventas por día</span>
                    <span style={{ fontSize: '.72rem', fontWeight: 600 }}>Último{ventasPorDia.length !== 1 ? 's' : ''} {ventasPorDia.length} día{ventasPorDia.length !== 1 ? 's' : ''}</span>
                  </div>
                  {ventasPorDia.length > 0 ? <Bar data={salesChartData} options={salesOpts} height={80} /> : (
                    <p style={{ color: 'var(--mm-text-muted)', fontSize: '.85rem' }}>Sin datos para el período</p>
                  )}
                </div>
              </div>
              <div className="col-md-6">
                <div className="rep-card">
                  <div className="rep-card-title"><i className="bi bi-ticket-perforated me-1" />Tickets por día</div>
                  {ventasPorDia.length > 0 ? <Bar data={ticketsChartData} options={CHART_OPTIONS_BASE} height={120} /> : (
                    <p style={{ color: 'var(--mm-text-muted)', fontSize: '.85rem' }}>Sin datos</p>
                  )}
                </div>
              </div>
              <div className="col-md-6">
                <div className="rep-card" style={{ height: '100%' }}>
                  <div className="rep-card-title"><i className="bi bi-clock-history me-1" />Pedidos recientes</div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {pedidosRec.length ? pedidosRec.map(p => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.5rem 0', borderBottom: '1px solid var(--mm-border)' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '.82rem', color: 'var(--mm-green)' }}>#{p.id}</span>
                          <span style={{ color: 'var(--mm-text-muted)', marginLeft: '.5rem', fontSize: '.8rem' }}>Mesa {p.mesa_numero}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                          <span className="badge-pill badge-green">{p.items_count} items</span>
                          <span style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {new Date(p.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    )) : (
                      <p style={{ color: 'var(--mm-text-muted)', fontSize: '.85rem', margin: '1rem 0' }}>Sin pedidos en el período</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Más vendidos ── */}
          {tab === 'productos' && (
            <div className="rep-card">
              <div className="rep-card-title">
                <span><i className="bi bi-trophy-fill me-1" style={{ color: 'var(--mm-gold)' }} />Top productos del período</span>
              </div>
              <div className="table-responsive">
                <table className="rep-table">
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--mm-border)' }}>
                      {['#', 'Producto', 'Unidades', 'Ingreso'].map((h, i) => (
                        <th key={h} style={{ padding: '.5rem 0', fontSize: '.65rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--mm-text-muted)', fontWeight: 800, textAlign: i === 3 ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topProductos.length ? topProductos.map((prod, i) => {
                      const rankCls = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-n';
                      return (
                      <tr key={prod.id}>
                        <td><span className={`rank-num ${rankCls}`}>{i + 1}</span></td>
                        <td style={{ fontWeight: 600 }}>{prod.nombre}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                            <div style={{ background: 'linear-gradient(90deg,var(--mm-green),var(--mm-green-light))', height: 6, borderRadius: 99, width: Math.round((prod.total_vendido / maxVendido) * 100) + 'px', maxWidth: 100 }} />
                            <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '.82rem' }}>{prod.total_vendido}</span>
                          </div>
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--mm-green)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>${fmt(prod.ingreso)}</td>
                      </tr>
                      );
                    }) : (
                      <tr><td colSpan="4" style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--mm-text-muted)' }}>Sin datos para el período seleccionado</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Tab: Cancelaciones ── */}
          {tab === 'cancelaciones' && (
            <div className="rep-card">
              <div className="rep-card-title">
                <span><i className="bi bi-x-circle-fill me-1" style={{ color: 'var(--mm-danger)' }} />Auditoría de cancelaciones</span>
              </div>
              <div className="table-responsive">
                <table className="audit-table">
                  <thead>
                    <tr>
                      {['Pedido', 'Fecha', 'Mesa', 'Motivo'].map(h => (<th key={h}>{h}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {cancelaciones.length ? cancelaciones.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '.8rem', color: 'var(--mm-danger)' }}>#{p.id}</td>
                        <td style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{fmtFecha(p.fecha)}</td>
                        <td>Mesa {p.mesa_numero}</td>
                        <td style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{p.motivo || '—'}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan="4" style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--mm-text-muted)' }}>Sin cancelaciones en el período</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !data && (
        <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
          <i className="bi bi-bar-chart" style={{ fontSize: '3rem', display: 'block', marginBottom: '1rem' }} />
          <h6 className="fw-bold">Sin datos para este período</h6>
        </div>
      )}
    </StaffLayout>
  );
}
