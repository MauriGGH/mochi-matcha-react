import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import '../../../src/styles/staff.css'

const MOCK_PEDIDOS = [
  {
    pk: 301, fecha_ts: Date.now() - 4 * 60 * 1000,
    sesion: { alias: 'Carlos', mesa: { numero_mesa: 2 } },
    detalles: [
      { producto: { nombre: 'Matcha Latte' }, cantidad: 2, notas: 'Sin azúcar', mods: ['Mediano'] },
      { producto: { nombre: 'Mochi Matcha' }, cantidad: 1, notas: '', mods: [] },
    ]
  },
  {
    pk: 302, fecha_ts: Date.now() - 11 * 60 * 1000,
    sesion: { alias: 'Ana', mesa: { numero_mesa: 5 } },
    detalles: [
      { producto: { nombre: 'Hojicha Latte' }, cantidad: 1, notas: 'Extra caliente', mods: ['Grande'] },
      { producto: { nombre: 'Mochi Fresa' }, cantidad: 3, notas: '', mods: [] },
    ]
  },
  {
    pk: 303, fecha_ts: Date.now() - 1 * 60 * 1000,
    sesion: { alias: 'Luis', mesa: { numero_mesa: 3 } },
    detalles: [
      { producto: { nombre: 'Matcha Frappé' }, cantidad: 1, notas: '', mods: [] },
    ]
  },
]

const MOCK_LISTOS = [
  {
    pk: 299, sesion: { alias: 'Mara', mesa: { numero_mesa: 1 } },
    detalles: [{ producto: { nombre: 'Iced Hojicha' }, cantidad: 2, notas: '', mods: [] }]
  }
]

function useClock() {
  const [time, setTime] = useState(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })), 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

function useTimers(pedidos) {
  const [timers, setTimers] = useState({})
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      const updated = {}
      pedidos.forEach(p => {
        const mins = Math.floor((now - p.fecha_ts) / 60000)
        const secs = Math.floor(((now - p.fecha_ts) % 60000) / 1000)
        updated[p.pk] = { mins, secs, label: `${mins}:${String(secs).padStart(2, '0')}` }
      })
      setTimers(updated)
    }, 1000)
    return () => clearInterval(id)
  }, [pedidos])
  return timers
}

function timerClass(mins) {
  if (mins < 5) return 'green'
  if (mins < 10) return 'yellow'
  return 'red'
}

function cardClass(mins) {
  if (mins < 5) return ''
  if (mins < 10) return 'yellow'
  return 'red'
}

export default function KDS() {
  const [searchParams] = useSearchParams()
  const area = searchParams.get('area') || 'cocina'
  const navigate = useNavigate()
  const clock = useClock()

  const [pendientes, setPendientes] = useState(MOCK_PEDIDOS)
  const [listos, setListos] = useState(MOCK_LISTOS)
  const [showSettings, setShowSettings] = useState(false)
  const [thresholds, setThresholds] = useState({ verde: 5, amarillo: 10 })

  const timers = useTimers(pendientes)

  const marcarListo = (pk) => {
    const pedido = pendientes.find(p => p.pk === pk)
    if (!pedido) return
    // TODO: await api.post(`/cocina/pedido/${pk}/listo/`)
    setPendientes(prev => prev.filter(p => p.pk !== pk))
    setListos(prev => [pedido, ...prev])
  }

  return (
    <div className="kds-body">
      {/* Header */}
      <header className="kds-header">
        <div className="d-flex align-items-center gap-3">
          <span style={{ fontSize: '1.25rem' }}>🍵</span>
          <div>
            <span style={{ fontWeight: 700, fontSize: '.9rem' }}>Kitchen Display</span>
            <span style={{ color: '#888', fontSize: '.8rem', marginLeft: '.4rem' }}>Mochi Matcha</span>
          </div>
          {/* Area tabs */}
          <div className="d-flex gap-1 ms-2">
            {['cocina', 'bar'].map(a => (
              <button key={a} onClick={() => navigate(`/cocina/kds?area=${a}`)}
                className="btn btn-sm px-3"
                style={{
                  fontSize: '.8rem',
                  background: area === a ? 'var(--mm-green)' : '#2a2a2a',
                  color: area === a ? '#fff' : '#aaa',
                  border: 'none',
                }}>
                <i className={`bi ${a === 'cocina' ? 'bi-fire' : 'bi-cup-straw'} me-1`}></i>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
          {/* Counters */}
          <div className="d-flex gap-2 ms-2">
            <span className="badge rounded-pill px-3 py-2" style={{ background: '#2a2a2a', color: 'var(--kds-yellow)', fontSize: '.78rem' }}>
              <i className="bi bi-clock me-1"></i>Pendientes {pendientes.length}
            </span>
            <span className="badge rounded-pill px-3 py-2" style={{ background: '#2a2a2a', color: 'var(--kds-green)', fontSize: '.78rem' }}>
              <i className="bi bi-check2-circle me-1"></i>Listos {listos.length}
            </span>
          </div>
        </div>

        <div className="d-flex align-items-center gap-3">
          <div className="d-flex align-items-center gap-2" style={{ fontSize: '.72rem' }}>
            <span style={{ color: 'var(--kds-green)' }}>● 0–{thresholds.verde} min</span>
            <span style={{ color: 'var(--kds-yellow)' }}>● {thresholds.verde}–{thresholds.amarillo} min</span>
            <span style={{ color: 'var(--kds-red)' }}>● +{thresholds.amarillo} min</span>
          </div>
          <button className="btn btn-sm" style={{ background: '#2a2a2a', color: '#aaa', border: 'none' }} onClick={() => setShowSettings(true)}>
            <i className="bi bi-gear"></i>
          </button>
          <span style={{ fontSize: '.8rem', color: '#666' }}>{clock}</span>
          <Link to="/login/cocina" style={{ color: '#666', textDecoration: 'none', fontSize: '.8rem' }}>Salir</Link>
        </div>
      </header>

      {/* Columns */}
      <div className="kds-columns">
        {/* Pendientes */}
        <div className="kds-column">
          <div className="kds-col-header pending">
            <i className="bi bi-hourglass-split me-2"></i>{area.charAt(0).toUpperCase() + area.slice(1)} — Pedidos Pendientes
          </div>
          <div className="kds-col-body">
            {pendientes.length === 0 && (
              <div style={{ textAlign: 'center', color: '#555', paddingTop: '3rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>✅</div>
                <p style={{ fontSize: '.85rem' }}>Sin pedidos pendientes</p>
              </div>
            )}
            {pendientes.map(p => {
              const t = timers[p.pk] || { mins: 0, label: '0:00' }
              return (
                <div key={p.pk} className={`kds-card ${cardClass(t.mins)}`} id={`ticket-${p.pk}`}>
                  <div className="kds-card-header">
                    <div className="d-flex align-items-center gap-2">
                      <span className="kds-table-badge">Mesa {p.sesion.mesa.numero_mesa}</span>
                      <span style={{ fontSize: '.8rem', color: '#ccc' }}>{p.sesion.alias}</span>
                    </div>
                    <span className={`kds-timer ${timerClass(t.mins)}`}>{t.label}</span>
                  </div>
                  <div className="kds-items">
                    {p.detalles.map((d, i) => (
                      <div key={i} className="kds-item">
                        <div>
                          <span className="kds-item-qty">{d.cantidad}×</span>
                          {d.producto.nombre}
                          {d.mods?.length > 0 && <div className="kds-item-mods">{d.mods.join(', ')}</div>}
                          {d.notas && <div className="kds-item-notes">"{d.notas}"</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="btn-listo" onClick={() => marcarListo(p.pk)}>
                    <i className="bi bi-check2-circle me-2"></i>Marcar como listo
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Listos */}
        <div className="kds-column">
          <div className="kds-col-header done">
            <i className="bi bi-check2-circle me-2"></i>Listos para entregar
          </div>
          <div className="kds-col-body">
            {listos.length === 0 && (
              <div style={{ textAlign: 'center', color: '#555', paddingTop: '3rem' }}>
                <p style={{ fontSize: '.85rem' }}>Aquí aparecerán los pedidos listos</p>
              </div>
            )}
            {listos.map(p => (
              <div key={p.pk} className="kds-card" style={{ borderLeftColor: 'var(--kds-green)', opacity: .7 }}>
                <div className="kds-card-header">
                  <div className="d-flex align-items-center gap-2">
                    <span className="kds-table-badge">Mesa {p.sesion.mesa.numero_mesa}</span>
                    <span style={{ fontSize: '.8rem', color: '#ccc' }}>{p.sesion.alias}</span>
                  </div>
                  <span className="kds-timer green">✓ Listo</span>
                </div>
                <div className="kds-items">
                  {p.detalles.map((d, i) => (
                    <div key={i} className="kds-item">
                      <span><span className="kds-item-qty">{d.cantidad}×</span>{d.producto.nombre}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1055, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 'var(--radius-md)', padding: '1.5rem', width: 360, color: '#fff' }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Configuración KDS</h6>
              <button className="btn-close btn-close-white" onClick={() => setShowSettings(false)}></button>
            </div>
            <div className="mb-3">
              <label style={{ fontSize: '.875rem', display: 'block', marginBottom: '.35rem' }}>
                Umbral verde (minutos)
              </label>
              <input type="number" className="form-control" value={thresholds.verde}
                onChange={e => setThresholds(t => ({ ...t, verde: Number(e.target.value) }))}
                style={{ background: '#2a2a2a', border: '1px solid #444', color: '#fff', borderRadius: 'var(--radius-sm)' }} />
            </div>
            <div className="mb-4">
              <label style={{ fontSize: '.875rem', display: 'block', marginBottom: '.35rem' }}>
                Umbral amarillo (minutos)
              </label>
              <input type="number" className="form-control" value={thresholds.amarillo}
                onChange={e => setThresholds(t => ({ ...t, amarillo: Number(e.target.value) }))}
                style={{ background: '#2a2a2a', border: '1px solid #444', color: '#fff', borderRadius: 'var(--radius-sm)' }} />
            </div>
            <button className="btn btn-primary w-100" onClick={() => setShowSettings(false)}>Guardar</button>
          </div>
        </div>
      )}
    </div>
  )
}
