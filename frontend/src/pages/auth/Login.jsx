/**
 * Login.jsx — pantalla de inicio de sesión para staff (mesero/cocina/gerente).
 * Toma `rol` por prop para pintar branding contextual (ícono + display name)
 * y redirige al destino correcto del rol tras autenticarse.
 *
 * Exporta: default Login({ rol, usuarioPrevio }).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import '../../styles/login.css';

// Metadata visual por rol (texto y bootstrap icon en el panel branding).
const ROLE_META = {
  mesero:  { display: 'Mesero',             icon: 'bi-person-badge-fill' },
  cocina:  { display: 'Cocina',             icon: 'bi-fire' },
  gerente: { display: 'Administrador',      icon: 'bi-briefcase-fill' },
  staff:   { display: 'Acceso al sistema',  icon: 'bi-shield-lock-fill' },
};

// Ruta inicial post-login según rol del empleado autenticado.
const DESTINOS_POR_ROL = {
  mesero:  '/mesero/mapa',
  cocina:  '/cocina/kds',
  gerente: '/gerente/dashboard',
  admin:   '/gerente/dashboard',
};

/**
 * @param {object} props
 * @param {('mesero'|'cocina'|'gerente'|'staff')} [props.rol='staff'] Hint visual para branding.
 * @param {string} [props.usuarioPrevio=''] Pre-llena el campo usuario (útil tras logout).
 */
export default function Login({ rol = 'staff', usuarioPrevio = '' }) {
  const { empleado, login } = useAuth();
  const navigate            = useNavigate();
  const [usuario, setUsuario]   = useState(usuarioPrevio);
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const meta = ROLE_META[rol] || ROLE_META.staff;

  // Si ya hay sesión activa, redirigir al destino del rol.
  useEffect(() => {
    if (empleado) navigate(DESTINOS_POR_ROL[empleado.rol] || '/', { replace: true });
  }, [empleado, navigate]);

  // Validación client-side antes de enviar al servidor.
  const validate = () => {
    const u = usuario.trim();
    if (!u) return 'El usuario no puede estar vacío';
    if (u.length < 3) return 'El usuario debe tener al menos 3 caracteres';
    if (!password) return 'La contraseña no puede estar vacía';
    if (password.length < 4) return 'La contraseña debe tener al menos 4 caracteres';
    return null;
  };

  // Submit: delega al AuthContext.login() y enruta según el rol devuelto.
  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError('');
    setLoading(true);
    try {
      const empleado = await login(usuario.trim(), password);
      navigate(DESTINOS_POR_ROL[empleado.rol] || '/');
    } catch {
      setError('Usuario o contraseña incorrectos');
      setPassword(''); // limpiar contraseña para que el usuario la reescriba
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      {/* ── Panel de branding (izquierda) ── */}
      <div className="login-brand">
        <div className="brand-icon">
          <i className="bi bi-cup-hot-fill" style={{ color: '#fff' }} />
        </div>
        <div className="brand-title">Mochi Matcha</div>
        <div className="brand-sub">Sistema de pedidos</div>
        <div className="brand-divider" />
        <div className="brand-role-pill">
          <i className={`bi ${meta.icon}`} />
          {meta.display}
        </div>
      </div>

      {/* ── Panel del formulario (derecha) ── */}
      <div className="login-form-panel">
        <div className="login-form-wrap">
          <p className="login-form-title">Iniciar sesión</p>
          <p className="login-form-sub">Ingresa tus credenciales para acceder al sistema.</p>

          {error && (
            <div
              className="login-alert alert py-2 px-3 mb-4 rounded-3 d-flex align-items-center gap-2"
              role="alert"
            >
              <i className="bi bi-exclamation-circle-fill" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label" htmlFor="usuarioInput">Usuario</label>
              <div className="input-group">
                <span className="input-group-text"><i className="bi bi-person" /></span>
                <input
                  id="usuarioInput"
                  name="usuario"
                  type="text"
                  className="form-control"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder="Tu nombre de usuario"
                  autoComplete="username"
                  maxLength={50}
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.68rem', color: 'var(--mm-text-muted)', marginTop: '.15rem' }}>
                <span>Mínimo 3 caracteres</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: usuario.length >= 48 ? 'var(--mm-danger)' : 'var(--mm-text-muted)' }}>{usuario.length} / 50</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label" htmlFor="passInput">Contraseña</label>
              <div className="input-group">
                <span className="input-group-text"><i className="bi bi-lock" /></span>
                <input
                  id="passInput"
                  name="contrasena"
                  type={showPass ? 'text' : 'password'}
                  className="form-control"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  className="btn-toggle-pass"
                  onClick={() => setShowPass((s) => !s)}
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  <i className={`bi ${showPass ? 'bi-eye-slash' : 'bi-eye'}`} />
                </button>
              </div>
              <div style={{ fontSize: '.68rem', color: 'var(--mm-text-muted)', marginTop: '.15rem' }}>
                Mínimo 4 caracteres
              </div>
            </div>

            <button type="submit" className="btn-login" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                  Ingresando…
                </>
              ) : (
                <>
                  Entrar <i className="bi bi-arrow-right-short" style={{ fontSize: '1.1rem' }} />
                </>
              )}
            </button>
          </form>

          <p className="login-footer">
            <i className="bi bi-shield-check me-1" />
            Acceso restringido al personal autorizado
          </p>
        </div>
      </div>
    </div>
  );
}
