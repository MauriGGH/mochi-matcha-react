import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ROL_CONFIG = {
  mesero: {
    display: 'Acceso Mesero',
    emoji: '🧑‍🍳',
    bg: 'var(--mm-green-pale)',
    demo: { usuario: 'mesero1', contrasena: 'mesero123' },
    redirect: '/mesero/mesas',
    rol: 'Mesero',
  },
  gerente: {
    display: 'Acceso Gerente',
    emoji: '💼',
    bg: 'var(--mm-gold-pale)',
    demo: { usuario: 'gerente1', contrasena: 'gerente123' },
    redirect: '/gerente/floor-plan',
    rol: 'Gerente',
  },
  cocina: {
    display: 'Acceso Cocina',
    emoji: '🍳',
    bg: '#FEF3E7',
    demo: { usuario: 'cocina1', contrasena: 'cocina123' },
    redirect: '/cocina/kds',
    rol: 'Cocina',
  },
}

export default function Login() {
  const { rol = 'mesero' } = useParams()
  const config = ROL_CONFIG[rol] || ROL_CONFIG.mesero
  const { login } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ usuario: '', contrasena: '' })
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // TODO: reemplazar con llamada real a la API Django
      // const res = await api.post(`/${rol}/login/`, form)
      // login(res.data.user)

      // Simulación con credenciales demo
      if (form.usuario === config.demo.usuario && form.contrasena === config.demo.contrasena) {
        login({ nombre: form.usuario, rol: config.rol })
        navigate(config.redirect)
      } else {
        setError('Usuario o contraseña incorrectos')
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const fillDemo = () => {
    setForm(config.demo)
    setShowPass(true)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, var(--mm-green-dark) 0%, var(--mm-green) 60%, #5A8F6B 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-body)', padding: '1rem',
    }}>
      <div style={{
        background: 'var(--mm-white)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-lg)',
        padding: '2.5rem 2rem',
        width: '100%', maxWidth: 380,
      }}>
        {/* Icon */}
        <div style={{
          width: 68, height: 68,
          borderRadius: 'var(--radius-md)',
          background: config.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.9rem', margin: '0 auto 1.25rem',
        }}>
          {config.emoji}
        </div>

        <h4 className="fw-bold text-center mb-1">{config.display}</h4>
        <p className="text-center mb-4" style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)' }}>
          Ingresa tus credenciales para continuar
        </p>

        {error && (
          <div className="alert alert-danger rounded-3 py-2 px-3 mb-3" style={{ fontSize: '.85rem' }}>
            <i className="bi bi-exclamation-triangle me-1"></i>{error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Usuario */}
          <div className="mb-3">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Usuario</label>
            <div className="input-group">
              <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>
                <i className="bi bi-person text-muted"></i>
              </span>
              <input
                type="text"
                name="usuario"
                value={form.usuario}
                onChange={handleChange}
                className="form-control"
                placeholder="Tu usuario"
                autoComplete="username"
                required
                style={{ borderLeft: 'none', borderColor: 'var(--mm-border)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0' }}
              />
            </div>
          </div>

          {/* Contraseña */}
          <div className="mb-4">
            <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Contraseña</label>
            <div className="input-group">
              <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)' }}>
                <i className="bi bi-lock text-muted"></i>
              </span>
              <input
                type={showPass ? 'text' : 'password'}
                name="contrasena"
                value={form.contrasena}
                onChange={handleChange}
                className="form-control"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                style={{ borderLeft: 'none', borderRight: 'none', borderColor: 'var(--mm-border)' }}
              />
              <button
                type="button"
                className="input-group-text btn"
                onClick={() => setShowPass(!showPass)}
                style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)', cursor: 'pointer' }}
              >
                <i className={`bi ${showPass ? 'bi-eye-slash' : 'bi-eye'} text-muted`}></i>
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-100 py-3"
            disabled={loading}
            style={{ fontSize: '.95rem' }}
          >
            {loading
              ? <><span className="spinner-border spinner-border-sm me-2"></span>Ingresando…</>
              : <><i className="bi bi-arrow-right-circle me-2"></i>Iniciar sesión</>
            }
          </button>
        </form>

        {/* Demo hint */}
        <div className="text-center mt-3">
          <button
            onClick={fillDemo}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '.35rem',
              background: 'var(--mm-cream-dark)', borderRadius: 'var(--radius-pill)',
              padding: '.3rem .75rem', fontSize: '.75rem', color: 'var(--mm-text-muted)',
              border: 'none', cursor: 'pointer', transition: 'background .15s',
            }}
          >
            Demo: <code style={{ fontFamily: 'var(--font-mono)', fontSize: '.75rem' }}>{config.demo.usuario}</code>
            {' / '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '.75rem' }}>{config.demo.contrasena}</code>
          </button>
        </div>

        {/* Links para otros roles */}
        <div className="text-center mt-4 d-flex justify-content-center gap-3">
          {Object.entries(ROL_CONFIG).filter(([r]) => r !== rol).map(([r, c]) => (
            <a
              key={r}
              href={`/login/${r}`}
              style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)', textDecoration: 'none' }}
            >
              {c.emoji} {c.rol}
            </a>
          ))}
        </div>

        <p className="text-center mt-3 mb-0" style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>
          🍵 Mochi Matcha · Sistema de pedidos
        </p>
      </div>
    </div>
  )
}
