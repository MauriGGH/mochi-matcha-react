import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import '../styles/cliente.css'

export default function ClientLayout({ children, header, showNav = true }) {
  const { sesionCliente } = useAuth()
  const { count } = useCart()
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = (path) => location.pathname === path

  const solicitarAyuda = async () => {
    try {
      // TODO: conectar con API
      // await api.post('/cliente/solicitar-ayuda/')
      alert('Mesero notificado 🔔')
    } catch {
      alert('Error al notificar')
    }
  }

  return (
    <div style={{ background: '#2A4A36', minHeight: '100vh', display: 'flex', justifyContent: 'center' }}>
      <div id="client-shell">
        {/* Header */}
        {header !== undefined ? header : (
          <header
            className="px-3 py-3 d-flex align-items-center justify-content-between"
            style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', position: 'sticky', top: 0, zIndex: 50 }}
          >
            <span className="fw-semibold" style={{ fontSize: '1rem', color: 'var(--mm-green)', fontFamily: 'var(--font-display)' }}>
              🍵 Mochi Matcha
            </span>
            <div className="d-flex align-items-center gap-2">
              {sesionCliente && (
                <span className="badge rounded-pill" style={{ background: 'var(--mm-green-pale)', color: 'var(--mm-green)', fontSize: '.75rem' }}>
                  <i className="bi bi-person-fill me-1"></i>{sesionCliente.alias}
                </span>
              )}
            </div>
          </header>
        )}

        {/* Content */}
        <main id="client-content">
          {children}
        </main>

        {/* Bottom Nav */}
        {showNav && sesionCliente && (
          <nav className="client-bottom-nav">
            <Link
              to="/menu"
              className={`nav-item ${isActive('/menu') ? 'active' : ''}`}
            >
              <i className="bi bi-grid-fill"></i>
              <span>Menú</span>
            </Link>

            <Link
              to="/carrito"
              className={`nav-item ${isActive('/carrito') ? 'active' : ''}`}
            >
              <i className="bi bi-bag-fill"></i>
              <span>Carrito</span>
              {count > 0 && <span className="nav-badge">{count}</span>}
            </Link>

            <Link
              to="/pedidos"
              className={`nav-item ${isActive('/pedidos') ? 'active' : ''}`}
            >
              <i className="bi bi-receipt"></i>
              <span>Pedidos</span>
            </Link>

            <button className="nav-item" onClick={solicitarAyuda}>
              <i className="bi bi-bell-fill"></i>
              <span>Ayuda</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
