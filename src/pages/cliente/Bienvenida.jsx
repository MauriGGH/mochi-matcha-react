import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ClientLayout from '../../components/ClientLayout'

// Mock data — reemplazar con llamadas a la API cuando el backend esté listo
const MOCK_MESAS = {
  1: { id: 1, numero_mesa: 1, ubicacion: 'Terraza', estado: 'libre', pin_actual: null },
  2: { id: 2, numero_mesa: 2, ubicacion: 'Interior', estado: 'ocupada', pin_actual: '4821', sesiones_activas: 2 },
  3: { id: 3, numero_mesa: 3, ubicacion: 'Barra', estado: 'libre', pin_actual: null },
}

function generarPin() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export default function Bienvenida() {
  const [searchParams] = useSearchParams()
  const mesaId = searchParams.get('mesa')
  const stepParam = searchParams.get('step')

  const mesa = mesaId ? MOCK_MESAS[mesaId] : null
  const { crearSesionCliente } = useAuth()
  const navigate = useNavigate()

  const [alias, setAlias] = useState('')
  const [pin, setPin] = useState('')
  const [step, setStep] = useState(stepParam || '')
  const [aliasError, setAliasError] = useState('')
  const [pinGenerado, setPinGenerado] = useState(null)
  const [generatedAlias, setGeneratedAlias] = useState('')

  // ── Sin mesa ──
  if (!mesaId || !mesa) {
    return (
      <ClientLayout showNav={false} header={null}>
        <div style={{
          minHeight: '100vh', background: 'linear-gradient(160deg, var(--mm-green-dark), var(--mm-green))',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🍵</div>
          <h2 className="fw-bold text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>Mochi Matcha</h2>
          <p className="text-white mb-0" style={{ opacity: .75 }}>Escanea el código QR de tu mesa para continuar</p>
        </div>
      </ClientLayout>
    )
  }

  // ── PIN generado (primer cliente) ──
  if (pinGenerado) {
    return (
      <ClientLayout showNav={false} header={null}>
        <div className="welcome-hero" style={{ padding: '2.5rem 1.5rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>🍵</div>
          <h2 className="fw-bold text-white mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
        </div>
        <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
          <div className="text-center mb-3">
            <span className="mesa-badge"><i className="bi bi-geo-alt-fill"></i> Mesa {mesa.numero_mesa}{mesa.ubicacion ? ` · ${mesa.ubicacion}` : ''}</span>
          </div>
          <div className="text-center mb-3">
            <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>✅</div>
            <h5 className="fw-bold mb-1">¡Hola, {generatedAlias}!</h5>
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>Tu sesión fue creada. Guarda este PIN para compartirlo con tus acompañantes.</p>
          </div>
          <div className="pin-display mb-1">
            {pinGenerado.split('').map((d, i) => <div key={i} className="pin-digit">{d}</div>)}
          </div>
          <p className="text-center mb-4" style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>PIN de la mesa · compártelo para que otros puedan unirse</p>
          <button
            className="btn btn-primary w-100 py-3"
            style={{ fontSize: '1rem' }}
            onClick={() => navigate('/menu')}
          >
            <i className="bi bi-grid-fill me-2"></i>Ver el menú
          </button>
        </div>
      </ClientLayout>
    )
  }

  // ── Mesa libre o "Soy nuevo" → Crear sesión ──
  if (mesa.estado === 'libre' || step === 'nuevo') {
    const handleCrearSesion = (e) => {
      e.preventDefault()
      if (!alias.trim()) { setAliasError('El alias es requerido'); return }
      const newPin = generarPin()
      crearSesionCliente({ alias: alias.trim(), mesa_id: mesa.id, pin: newPin, mesa })
      setGeneratedAlias(alias.trim())
      setPinGenerado(newPin)
    }

    return (
      <ClientLayout showNav={false} header={null}>
        <div className="welcome-hero" style={{ padding: '2.5rem 1.5rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>🍵</div>
          <h2 className="fw-bold text-white mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
          <p className="text-white mt-1" style={{ fontSize: '.9rem', opacity: .85 }}>Bienvenido a tu mesa. ¡Ordena a tu ritmo!</p>
        </div>
        <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
          <div className="text-center mb-3">
            <span className="mesa-badge"><i className="bi bi-geo-alt-fill"></i> Mesa {mesa.numero_mesa}{mesa.ubicacion ? ` · ${mesa.ubicacion}` : ''}</span>
          </div>
          {step === 'nuevo' && (
            <button
              onClick={() => setStep('')}
              className="d-flex align-items-center gap-1 mb-3 btn btn-link p-0 text-decoration-none"
              style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)' }}
            >
              <i className="bi bi-chevron-left"></i> Volver
            </button>
          )}
          <h5 className="fw-bold mb-1">{step === 'nuevo' ? `Unirse a la Mesa ${mesa.numero_mesa}` : 'Crear sesión'}</h5>
          <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
            Elige un alias {step === 'nuevo' ? 'único' : ''} para identificarte en tu mesa.
          </p>
          <form onSubmit={handleCrearSesion}>
            <div className="mb-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Tu alias <span className="text-danger">*</span></label>
              <input
                type="text"
                value={alias}
                onChange={e => { setAlias(e.target.value); setAliasError('') }}
                className="form-control form-control-lg rounded-3"
                placeholder="ej. Carlos, Ale, El hambriento…"
                maxLength={50}
                autoComplete="off"
                style={{ borderColor: 'var(--mm-border)', fontSize: '.95rem' }}
              />
              {aliasError && <div className="text-danger mt-1" style={{ fontSize: '.8rem' }}><i className="bi bi-exclamation-circle me-1"></i>{aliasError}</div>}
            </div>
            <button type="submit" className="btn btn-primary w-100 py-3" style={{ fontSize: '1rem' }}>
              <i className="bi bi-arrow-right-circle me-2"></i>
              {step === 'nuevo' ? 'Unirse a la mesa' : 'Entrar al menú'}
            </button>
          </form>
        </div>
      </ClientLayout>
    )
  }

  // ── Mesa ocupada → Elegir opción ──
  if (mesa.estado === 'ocupada' && !step) {
    return (
      <ClientLayout showNav={false} header={null}>
        <div className="welcome-hero" style={{ padding: '2.5rem 1.5rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>🍵</div>
          <h2 className="fw-bold text-white mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
        </div>
        <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
          <div className="text-center mb-3">
            <span className="mesa-badge"><i className="bi bi-geo-alt-fill"></i> Mesa {mesa.numero_mesa}</span>
          </div>
          <h5 className="fw-bold mb-1 text-center">Mesa en uso</h5>
          <p className="text-center mb-4" style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
            Hay {mesa.sesiones_activas || 1} persona(s) en esta mesa. ¿Cómo quieres continuar?
          </p>
          <div className="row g-3 mb-3">
            <div className="col-6">
              <div className="option-card" onClick={() => setStep('nuevo')}>
                <i className="bi bi-person-plus-fill" style={{ fontSize: '1.75rem', color: 'var(--mm-green)' }}></i>
                <div className="fw-bold mt-2" style={{ fontSize: '.9rem' }}>Soy nuevo</div>
                <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.25rem' }}>Crea tu sesión</div>
              </div>
            </div>
            <div className="col-6">
              <div className="option-card" onClick={() => setStep('recuperar')}>
                <i className="bi bi-key-fill" style={{ fontSize: '1.75rem', color: 'var(--mm-green)' }}></i>
                <div className="fw-bold mt-2" style={{ fontSize: '.9rem' }}>Ya tengo cuenta</div>
                <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.25rem' }}>Recuperar sesión</div>
              </div>
            </div>
          </div>
        </div>
      </ClientLayout>
    )
  }

  // ── Recuperar sesión ──
  if (step === 'recuperar') {
    const handleRecuperar = (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const aliasVal = fd.get('alias')
      const pinVal = fd.get('pin')
      if (pinVal === mesa.pin_actual) {
        crearSesionCliente({ alias: aliasVal, mesa_id: mesa.id, pin: pinVal, mesa })
        navigate('/menu')
      } else {
        setAliasError('Alias o PIN incorrecto')
      }
    }

    return (
      <ClientLayout showNav={false} header={null}>
        <div className="welcome-hero" style={{ padding: '2.5rem 1.5rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>🍵</div>
          <h2 className="fw-bold text-white mb-0" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>Mochi Matcha</h2>
        </div>
        <div className="welcome-card mx-3" style={{ marginTop: '-1.5rem' }}>
          <div className="text-center mb-3">
            <span className="mesa-badge"><i className="bi bi-geo-alt-fill"></i> Mesa {mesa.numero_mesa}</span>
          </div>
          <button onClick={() => setStep('')} className="d-flex align-items-center gap-1 mb-3 btn btn-link p-0 text-decoration-none" style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)' }}>
            <i className="bi bi-chevron-left"></i> Volver
          </button>
          <h5 className="fw-bold mb-1">Recuperar sesión</h5>
          <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>Ingresa tu alias y el PIN de la mesa.</p>
          <form onSubmit={handleRecuperar}>
            <div className="mb-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Tu alias</label>
              <input name="alias" type="text" className="form-control rounded-3" placeholder="El alias que elegiste"
                style={{ borderColor: 'var(--mm-border)' }} autoComplete="off" required maxLength={50} />
            </div>
            <div className="mb-4">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>PIN de la mesa</label>
              <input name="pin" type="text" maxLength={4} minLength={4} pattern="[0-9]{4}" required
                className="form-control rounded-3 text-center" placeholder="• • • •" inputMode="numeric"
                style={{ borderColor: 'var(--mm-border)', fontSize: '1.5rem', letterSpacing: '.5em', fontFamily: 'var(--font-mono)' }} />
            </div>
            {aliasError && (
              <div className="alert alert-danger py-2 px-3 rounded-3 mb-3" style={{ fontSize: '.85rem' }}>
                <i className="bi bi-exclamation-triangle me-1"></i>{aliasError}
              </div>
            )}
            <button type="submit" className="btn btn-primary w-100 py-3" style={{ fontSize: '1rem' }}>
              <i className="bi bi-arrow-right-circle me-2"></i>Recuperar sesión
            </button>
          </form>
        </div>
      </ClientLayout>
    )
  }

  return null
}
