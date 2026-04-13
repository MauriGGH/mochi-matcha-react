import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import StaffLayout from '../../components/StaffLayout'
import { ToastProvider, useToast } from '../../components/Toast'

// Mock data — reemplazar con llamadas API
const MOCK_MESAS = [
  { id: 1, numero_mesa: 1, ubicacion: 'Terraza', estado: 'libre', sesiones: 0, pedidos_pendientes: 0 },
  { id: 2, numero_mesa: 2, ubicacion: 'Interior', estado: 'ocupada', sesiones: 2, pedidos_pendientes: 1, pin: '4821' },
  { id: 3, numero_mesa: 3, ubicacion: 'Interior', estado: 'ocupada', sesiones: 1, pedidos_pendientes: 0, pin: '3307' },
  { id: 4, numero_mesa: 4, ubicacion: 'Barra', estado: 'libre', sesiones: 0, pedidos_pendientes: 0 },
  { id: 5, numero_mesa: 5, ubicacion: 'Terraza', estado: 'pagando', sesiones: 3, pedidos_pendientes: 0, pin: '1194' },
  { id: 6, numero_mesa: 6, ubicacion: 'Barra', estado: 'libre', sesiones: 0, pedidos_pendientes: 0 },
]

const MOCK_PEDIDOS_LISTOS = [
  { pk: 201, sesion: { alias: 'Carlos', mesa: { numero_mesa: 2 } }, detalles: [
    { producto: { nombre: 'Matcha Latte' }, cantidad: 2, subtotal: 170 },
  ]},
]

const MOCK_SOLICITUDES = 1

function MesaDetalle({ mesa, onClose, onIrPago }) {
  return (
    <div className="offcanvas offcanvas-end show" style={{ width: 360, zIndex: 1055 }}>
      <div className="offcanvas-header" style={{ borderBottom: '1px solid var(--mm-border)' }}>
        <h5 className="offcanvas-title fw-bold">Mesa {mesa.numero_mesa}</h5>
        <button type="button" className="btn-close" onClick={onClose}></button>
      </div>
      <div className="offcanvas-body">
        {mesa.ubicacion && <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>{mesa.ubicacion}</p>}

        {mesa.pin && (
          <div style={{ background: 'var(--mm-green-pale)', border: '1.5px solid var(--mm-green)', borderRadius: 'var(--radius-md)', padding: '.75rem 1rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 700, letterSpacing: '.3em', color: 'var(--mm-green-dark)', marginBottom: '1rem' }}>
            {mesa.pin}
          </div>
        )}

        <div className="mb-3">
          <div className="d-flex justify-content-between" style={{ fontSize: '.85rem', padding: '.4rem 0', borderBottom: '1px solid var(--mm-border)' }}>
            <span style={{ color: 'var(--mm-text-muted)' }}>Estado</span>
            <span className="fw-semibold" style={{ textTransform: 'capitalize' }}>{mesa.estado}</span>
          </div>
          <div className="d-flex justify-content-between" style={{ fontSize: '.85rem', padding: '.4rem 0', borderBottom: '1px solid var(--mm-border)' }}>
            <span style={{ color: 'var(--mm-text-muted)' }}>Comensales</span>
            <span className="fw-semibold">{mesa.sesiones}</span>
          </div>
          <div className="d-flex justify-content-between" style={{ fontSize: '.85rem', padding: '.4rem 0' }}>
            <span style={{ color: 'var(--mm-text-muted)' }}>Pedidos pendientes</span>
            <span className="fw-semibold">{mesa.pedidos_pendientes}</span>
          </div>
        </div>

        {mesa.estado !== 'libre' && (
          <div className="d-flex flex-column gap-2 mt-3">
            <button className="btn btn-primary" onClick={() => onIrPago(mesa)}>
              <i className="bi bi-cash-coin me-2"></i>Procesar pago
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MapaMesasInner() {
  const [mesas, setMesas] = useState(MOCK_MESAS)
  const [listosCount] = useState(MOCK_PEDIDOS_LISTOS.length)
  const [solicitudesCount] = useState(MOCK_SOLICITUDES)
  const [mesaSeleccionada, setMesaSeleccionada] = useState(null)
  const navigate = useNavigate()

  const libres = mesas.filter(m => m.estado === 'libre').length
  const ocupadas = mesas.filter(m => m.estado !== 'libre').length

  const sidebarNav = (
    <>
      <Link to="/mesero/mesas" className="active"><i className="bi bi-grid-fill"></i> Mesas</Link>
      <Link to="/mesero/listos">
        <i className="bi bi-bag-check-fill"></i> Pedidos listos
        {listosCount > 0 && <span className="badge-alert">{listosCount}</span>}
      </Link>
      <Link to="/mesero/asistido"><i className="bi bi-plus-circle"></i> Pedido asistido</Link>
      <Link to="/mesero/alertas">
        <i className="bi bi-bell-fill"></i> Alertas
        {solicitudesCount > 0 && <span className="badge-alert">{solicitudesCount}</span>}
      </Link>
    </>
  )

  const topbarActions = (
    <>
      {listosCount > 0 && (
        <Link to="/mesero/listos" className="btn btn-sm rounded-pill px-3"
          style={{ background: 'var(--mm-green-pale)', color: 'var(--mm-green)', fontSize: '.78rem', textDecoration: 'none' }}>
          <i className="bi bi-check2-circle me-1"></i>{listosCount} listos para entregar
        </Link>
      )}
      {solicitudesCount > 0 && (
        <Link to="/mesero/alertas" className="btn btn-sm rounded-pill px-3"
          style={{ background: '#FDEDEC', color: 'var(--mm-danger)', fontSize: '.78rem', textDecoration: 'none' }}>
          <i className="bi bi-bell-fill me-1"></i>{solicitudesCount} solicitudes
        </Link>
      )}
    </>
  )

  return (
    <StaffLayout pageTitle="Mapa de Mesas" sidebarNav={sidebarNav} topbarActions={topbarActions}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h5 className="fw-bold mb-0">Mapa de Mesas</h5>
          <p style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', margin: 0 }}>
            {libres} libres · {ocupadas} ocupadas
          </p>
        </div>
      </div>

      {/* Leyenda */}
      <div className="d-flex gap-3 mb-3 flex-wrap">
        {[
          { clase: 'libre', label: 'Libre', color: '#ccc' },
          { clase: 'ocupada', label: 'Ocupada', color: 'var(--mm-green)' },
          { clase: 'pagando', label: 'Pagando', color: 'var(--mm-gold)' },
        ].map(l => (
          <span key={l.clase} style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, display: 'inline-block' }}></span>
            {l.label}
          </span>
        ))}
      </div>

      {/* Grid de mesas */}
      <div className="table-grid">
        {mesas.map(mesa => (
          <div key={mesa.id} className={`mesa-tile ${mesa.estado}`} onClick={() => setMesaSeleccionada(mesa)}>
            <div className="mesa-dot"></div>
            <div className="mesa-num">{mesa.numero_mesa}</div>
            <div className="mesa-label">
              {mesa.estado === 'libre' ? 'Libre'
                : mesa.estado === 'pagando' ? 'Pagando'
                : `${mesa.sesiones} 👤`}
            </div>
            {mesa.pedidos_pendientes > 0 && (
              <span style={{ position: 'absolute', bottom: '.4rem', right: '.4rem', background: 'var(--mm-gold)', color: '#fff', borderRadius: 99, fontSize: '.6rem', fontWeight: 700, padding: '2px 6px' }}>
                {mesa.pedidos_pendientes}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Panel de detalle */}
      {mesaSeleccionada && (
        <>
          <div onClick={() => setMesaSeleccionada(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 1054 }} />
          <MesaDetalle
            mesa={mesaSeleccionada}
            onClose={() => setMesaSeleccionada(null)}
            onIrPago={(m) => navigate(`/mesero/pago?mesa=${m.id}`)}
          />
        </>
      )}
    </StaffLayout>
  )
}

export default function MapaMesas() {
  return (
    <ToastProvider staff>
      <MapaMesasInner />
    </ToastProvider>
  )
}
