import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import '../styles/staff.css'

export default function StaffLayout({ children, pageTitle, sidebarNav, topbarActions }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login/mesero')
  }

  return (
    <div className="staff-body">
      {/* Sidebar */}
      <aside className={`staff-sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">🍵</span>
          <span className="brand-text">Mochi Matcha</span>
        </div>

        <nav className="sidebar-nav">
          {sidebarNav}
        </nav>

        <div className="sidebar-footer">
          <div className="d-flex align-items-center gap-2 px-3 py-2">
            <div className="avatar-circle">
              {user?.nombre?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="fw-semibold text-truncate" style={{ fontSize: '.8rem', lineHeight: 1.2, color: '#fff' }}>
                {user?.nombre || 'Usuario'}
              </div>
              <div style={{ fontSize: '.7rem', color: 'rgba(255,255,255,.55)' }}>
                {user?.rol || ''}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="ms-1 btn btn-link p-0"
              style={{ color: 'rgba(255,255,255,.5)' }}
              title="Cerrar sesión"
            >
              <i className="bi bi-box-arrow-right"></i>
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 199 }}
        />
      )}

      {/* Main area */}
      <div className="staff-main">
        <header className="staff-topbar">
          <div className="d-flex align-items-center gap-3">
            <button
              className="btn btn-link p-0 d-lg-none"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ color: 'var(--mm-text-muted)' }}
            >
              <i className="bi bi-list fs-4"></i>
            </button>
            <h4 className="mb-0 fw-bold" style={{ fontSize: '1rem' }}>
              {pageTitle || 'Dashboard'}
            </h4>
          </div>
          <div className="d-flex align-items-center gap-2">
            {topbarActions}
            <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{clock}</span>
            <span style={{ fontSize: '.75rem', color: 'var(--mm-success)', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--mm-success)', display: 'inline-block' }}></span>
              En línea
            </span>
          </div>
        </header>

        <main className="staff-content">
          {children}
        </main>
      </div>
    </div>
  )
}
