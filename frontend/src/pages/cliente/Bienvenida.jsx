/**
 * Bienvenida.jsx — landing del cliente al escanear el QR de la mesa.
 * Ruta: /mesa/:codigo_qr. Verifica disponibilidad de la mesa y muestra uno de
 * cinco estados: loading, libre (crear sesión), ocupada (unirse / recuperar),
 * pin_generado (mostrar PIN nuevo) o error_mesa.
 *
 * Exporta: default Bienvenida().
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import CharCounter from '../../components/forms/CharCounter';

/** Pantalla post-QR para entrar/recuperar sesión de mesa. Sin props. */
export default function Bienvenida() {
  const { codigo_qr } = useParams();
  const navigate = useNavigate();

  const [estado, setEstado] = useState('loading');
  const [mesa, setMesa] = useState(null);
  const [sesionesActivas, setSesionesActivas] = useState(0);
  const [alias, setAlias] = useState('');
  const [pin, setPin] = useState('');
  const [pinGenerado, setPinGenerado] = useState('');
  const [idSesion, setIdSesion] = useState(null);
  const [opcion, setOpcion] = useState(null); // 'nuevo' | 'recuperar'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Al montar (o cambiar QR), preguntar al backend si la mesa está libre/ocupada.
  useEffect(() => { verificarMesa(); }, [codigo_qr]);

  // GET /cliente/mesa/:qr → 200 mesa libre · 409 con error 'Mesa ocupada' → estado distinto.
  async function verificarMesa() {
    setEstado('loading');
    try {
      const { data } = await api.get(`/cliente/mesa/${codigo_qr}`);
      setMesa(data);
      setEstado('libre');
    } catch (err) {
      const status = err.response?.status;
      const body   = err.response?.data || {};
      if (status === 409 && body.error === 'Mesa ocupada') {
        setMesa({ numero_mesa: body.numero_mesa });
        setSesionesActivas(body.sesiones_activas || 0);
        setEstado('ocupada');
      } else {
        setEstado('error_mesa');
      }
    }
  }

  // Crea sesión con alias y persiste credenciales en sessionStorage.
  // Si es la primera sesión de la mesa, el backend genera PIN y lo mostramos
  // en el estado 'pin_generado' antes de pasar al menú.
  async function crearSesion(e) {
    e.preventDefault();
    if (!alias.trim()) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/cliente/sesion', { id_mesa: mesa.id, alias: alias.trim() });
      sessionStorage.setItem('token_sesion', data.token_sesion);
      sessionStorage.setItem('id_sesion', String(data.id_sesion));
      sessionStorage.setItem('alias', alias.trim());
      sessionStorage.setItem('numero_mesa', String(data.numero_mesa || ''));
      sessionStorage.setItem('pin_mesa', data.pin || '');
      if (data.was_first && data.pin) {
        setPinGenerado(data.pin);
        setIdSesion(data.id_sesion);
        setEstado('pin_generado');
      } else {
        navigate(`/menu/${data.id_sesion}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear sesión');
    } finally { setLoading(false); }
  }

  // Recupera una sesión existente con el PIN compartido por otro miembro de la mesa.
  async function recuperarSesion(e) {
    e.preventDefault();
    if (!pin.trim()) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/cliente/recuperar', { codigo_qr, pin: pin.trim() });
      sessionStorage.setItem('token_sesion', data.token_sesion);
      sessionStorage.setItem('id_sesion', String(data.id_sesion));
      sessionStorage.setItem('alias', data.alias);
      sessionStorage.setItem('numero_mesa', String(data.numero_mesa || ''));
      sessionStorage.setItem('pin_mesa', data.pin_mesa || '');
      navigate(`/menu/${data.id_sesion}`);
    } catch (err) {
      setError(err.response?.data?.error || 'PIN incorrecto');
    } finally { setLoading(false); }
  }

  const heroStyle = {
    background: 'var(--mm-green-dark)',
    padding: '2.5rem 1.5rem 2rem',
    textAlign: 'center',
    color: '#fff',
  };

  if (estado === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--mm-green-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner-border" style={{ color: '#fff' }} />
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--mm-green-dark)', minHeight: '100vh', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, background: 'var(--mm-cream)', minHeight: '100vh' }}>

        {/* ── PIN GENERADO ─── */}
        {estado === 'pin_generado' && (
          <>
            <div style={heroStyle}>
              <i className="bi bi-cup-hot-fill" style={{ fontSize: '3rem', marginBottom: '.5rem', display: 'block' }} />
              <h2 className="fw-bold mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
            </div>
            <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
              <div className="text-center mb-3">
                <span className="mesa-badge">
                  <i className="bi bi-geo-alt-fill me-1" />Mesa {mesa?.numero_mesa}
                </span>
              </div>
              <div className="text-center mb-3">
                <i className="bi bi-check-circle-fill" style={{ fontSize: '1.5rem', color: 'var(--mm-green)', display: 'block', marginBottom: '.25rem' }} />
                <h5 className="fw-bold mb-1">¡Hola, {alias}!</h5>
                <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
                  Tu sesión fue creada. Guarda este PIN para compartirlo con tus acompañantes.
                </p>
              </div>
              <div className="pin-display mb-1">
                {pinGenerado.split('').map((d, i) => (
                  <div key={i} className="pin-digit">{d}</div>
                ))}
              </div>
              <p className="text-center mb-4" style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>
                PIN de la mesa · compártelo para que otros puedan unirse
              </p>
              <button className="btn btn-primary w-100 py-3" onClick={() => navigate(`/menu/${idSesion}`)}>
                <i className="bi bi-grid-fill me-2" />Ver el menú
              </button>
            </div>
          </>
        )}

        {/* ── ERROR MESA ─── */}
        {estado === 'error_mesa' && (
          <>
            <div style={{ ...heroStyle, minHeight: '100vh', alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column' }}>
              <i className="bi bi-cup-hot-fill" style={{ fontSize: '3.5rem', marginBottom: '1rem', display: 'block' }} />
              <h2 className="fw-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>Mochi Matcha</h2>
              <p className="opacity-75 mb-0">Escanea el código QR de tu mesa para continuar</p>
            </div>
          </>
        )}

        {/* ── MESA LIBRE ─── */}
        {estado === 'libre' && !opcion && (
          <>
            <div style={heroStyle}>
              <i className="bi bi-cup-hot-fill" style={{ fontSize: '3rem', marginBottom: '.5rem', display: 'block' }} />
              <h2 className="fw-bold mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
              <p className="opacity-75 mt-1" style={{ fontSize: '.9rem' }}>Bienvenido a tu mesa. ¡Ordena a tu ritmo!</p>
            </div>
            <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
              <div className="text-center mb-3">
                <span className="mesa-badge">
                  <i className="bi bi-geo-alt-fill me-1" />Mesa {mesa?.numero_mesa}
                </span>
              </div>
              <h5 className="fw-bold mb-1">Crear sesión</h5>
              <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
                Elige un alias para identificarte en tu mesa.
              </p>
              <form onSubmit={crearSesion}>
                <div className="mb-3">
                  <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Tu alias <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    className="form-control form-control-lg rounded-3"
                    placeholder="EJ. CARLOS, ALE, EL HAMBRIENTO…"
                    value={alias}
                    onChange={e => setAlias(e.target.value.toUpperCase().slice(0, 50))}
                    maxLength={50} required
                    style={{ borderColor: 'var(--mm-border)', fontSize: '.95rem', textTransform: 'uppercase' }}
                    autoComplete="off" autoCorrect="off" autoCapitalize="characters"
                  />
                  <CharCounter value={alias} max={50} />
                </div>
                {error && <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '.875rem' }}>{error}</div>}
                <button type="submit" className="btn btn-primary w-100 py-3" style={{ fontSize: '1rem' }} disabled={loading}>
                  {loading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-arrow-right-circle me-2" />}
                  Entrar al menú
                </button>
              </form>
            </div>
          </>
        )}

        {/* ── MESA OCUPADA ─── */}
        {estado === 'ocupada' && !opcion && (
          <>
            <div style={heroStyle}>
              <i className="bi bi-cup-hot-fill" style={{ fontSize: '3rem', marginBottom: '.5rem', display: 'block' }} />
              <h2 className="fw-bold mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
            </div>
            <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
              <div className="text-center mb-3">
                <span className="mesa-badge">
                  <i className="bi bi-geo-alt-fill me-1" />Mesa {mesa?.numero_mesa}
                </span>
              </div>
              <h5 className="fw-bold mb-1 text-center">Mesa en uso</h5>
              <p className="text-center mb-4" style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
                Hay {sesionesActivas} persona{sesionesActivas !== 1 ? 's' : ''} en esta mesa. ¿Cómo quieres continuar?
              </p>
              <div className="row g-3 mb-3">
                <div className="col-6">
                  <div className="option-card" onClick={() => { setOpcion('nuevo'); setError(''); }}>
                    <i className="bi bi-person-plus-fill" />
                    <div className="fw-bold mt-2" style={{ fontSize: '.9rem' }}>Soy nuevo</div>
                    <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.25rem' }}>Crea tu sesión</div>
                  </div>
                </div>
                <div className="col-6">
                  <div className="option-card" onClick={() => { setOpcion('recuperar'); setError(''); }}>
                    <i className="bi bi-key-fill" />
                    <div className="fw-bold mt-2" style={{ fontSize: '.9rem' }}>Ya tengo cuenta</div>
                    <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.25rem' }}>Recuperar sesión</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── OPCION: NUEVO (unirse a mesa ocupada) ─── */}
        {opcion === 'nuevo' && (
          <>
            <div style={heroStyle}>
              <i className="bi bi-cup-hot-fill" style={{ fontSize: '3rem', marginBottom: '.5rem', display: 'block' }} />
              <h2 className="fw-bold mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
            </div>
            <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
              <div className="text-center mb-3">
                <span className="mesa-badge">
                  <i className="bi bi-geo-alt-fill me-1" />Mesa {mesa?.numero_mesa}
                </span>
              </div>
              <a
                onClick={() => { setOpcion(null); setError(''); }}
                className="d-flex align-items-center gap-1 mb-3 text-decoration-none"
                style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', cursor: 'pointer' }}
              >
                <i className="bi bi-chevron-left" /> Volver
              </a>
              <h5 className="fw-bold mb-1">Unirse a la Mesa {mesa?.numero_mesa}</h5>
              <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
                Elige un alias único para identificarte
              </p>
              <form onSubmit={crearSesion}>
                <div className="mb-3">
                  <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Tu alias <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    className="form-control form-control-lg rounded-3"
                    placeholder="EJ. CARLOS, ALE…"
                    value={alias}
                    onChange={e => setAlias(e.target.value.toUpperCase().slice(0, 50))}
                    maxLength={50} required
                    style={{ borderColor: 'var(--mm-border)', fontSize: '.95rem', textTransform: 'uppercase' }}
                    autoComplete="off" autoCapitalize="characters"
                  />
                  <CharCounter value={alias} max={50} />
                </div>
                {error && <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '.875rem' }}>{error}</div>}
                <button type="submit" className="btn btn-primary w-100 py-3" style={{ fontSize: '1rem' }} disabled={loading}>
                  {loading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-arrow-right-circle me-2" />}
                  Unirse a la mesa
                </button>
              </form>
            </div>
          </>
        )}

        {/* ── OPCION: RECUPERAR ─── */}
        {opcion === 'recuperar' && (
          <>
            <div style={heroStyle}>
              <i className="bi bi-cup-hot-fill" style={{ fontSize: '3rem', marginBottom: '.5rem', display: 'block' }} />
              <h2 className="fw-bold mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
            </div>
            <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
              <div className="text-center mb-3">
                <span className="mesa-badge">
                  <i className="bi bi-geo-alt-fill me-1" />Mesa {mesa?.numero_mesa}
                </span>
              </div>
              <a
                onClick={() => { setOpcion(null); setError(''); }}
                className="d-flex align-items-center gap-1 mb-3 text-decoration-none"
                style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', cursor: 'pointer' }}
              >
                <i className="bi bi-chevron-left" /> Volver
              </a>
              <h5 className="fw-bold mb-1">Recuperar sesión</h5>
              <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
                Ingresa el PIN de la mesa.
              </p>
              <form onSubmit={recuperarSesion}>
                <div className="mb-4">
                  <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>PIN de la mesa</label>
                  <input
                    type="text"
                    className="form-control rounded-3 text-center"
                    placeholder="• • • •"
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric" maxLength={4} required
                    style={{ borderColor: 'var(--mm-border)', fontSize: '1.5rem', letterSpacing: '.5em', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                {error && <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '.875rem' }}>{error}</div>}
                <button type="submit" className="btn btn-primary w-100 py-3" style={{ fontSize: '1rem' }} disabled={loading}>
                  {loading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-arrow-right-circle me-2" />}
                  Recuperar sesión
                </button>
              </form>
            </div>
          </>
        )}

        <div style={{ height: '2rem' }} />
      </div>
    </div>
  );
}
