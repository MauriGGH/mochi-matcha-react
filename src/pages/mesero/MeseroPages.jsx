// ─── Pedidos Listos ───────────────────────────────────────────────────────────
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import StaffLayout from '../../components/StaffLayout'
import { ToastProvider, useToast } from '../../components/Toast'

const SIDEBAR_MESERO = (listosCount = 0, solicitudesCount = 0) => (
  <>
    <Link to="/mesero/mesas"><i className="bi bi-grid-fill"></i> Mesas</Link>
    <Link to="/mesero/listos" className="active">
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

// Mock data
const MOCK_LISTOS = [
  { pk: 201, sesion: { alias: 'Carlos', mesa: { numero_mesa: 2 } }, detalles: [
    { producto: { nombre: 'Matcha Latte' }, cantidad: 2, subtotal: 170 },
    { producto: { nombre: 'Mochi Matcha' }, cantidad: 1, subtotal: 55 },
  ]},
  { pk: 202, sesion: { alias: 'Ana', mesa: { numero_mesa: 5 } }, detalles: [
    { producto: { nombre: 'Iced Hojicha' }, cantidad: 1, subtotal: 85 },
  ]},
]

export function PedidosListos() {
  const [pedidos, setPedidos] = useState(MOCK_LISTOS)
  const { showToast } = useToast()

  const marcarEntregado = (pk) => {
    // TODO: await api.post(`/mesero/pedidos/${pk}/entregar/`)
    setPedidos(prev => prev.filter(p => p.pk !== pk))
    showToast('Pedido marcado como entregado ✓', 'success')
  }

  return (
    <StaffLayout pageTitle="Pedidos Listos" sidebarNav={SIDEBAR_MESERO(pedidos.length)}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="fw-bold mb-0">Pedidos listos para entregar</h5>
        <Link to="/mesero/mesas" className="btn btn-sm" style={{ background: 'var(--mm-cream-dark)' }}>
          <i className="bi bi-arrow-left me-1"></i>Volver al mapa
        </Link>
      </div>

      {pedidos.length ? (
        <div className="row g-3">
          {pedidos.map(p => (
            <div key={p.pk} className="col-md-6 col-lg-4">
              <div style={{ border: '2px solid var(--mm-green)', borderRadius: 'var(--radius-md)', background: 'var(--mm-white)', padding: '1.25rem' }}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div>
                    <span className="fw-bold" style={{ fontSize: '1rem' }}>Mesa {p.sesion.mesa.numero_mesa}</span>
                    <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', marginLeft: '.5rem' }}>{p.sesion.alias}</span>
                  </div>
                  <span style={{ background: '#EAFAF1', color: '#1E8449', borderRadius: 99, padding: '.2rem .7rem', fontSize: '.75rem', fontWeight: 700 }}>
                    <i className="bi bi-check-circle-fill me-1"></i>Listo
                  </span>
                </div>
                <div className="mb-3">
                  {p.detalles.map((d, i) => (
                    <div key={i} style={{ fontSize: '.875rem', padding: '.25rem 0', borderBottom: '1px solid var(--mm-border)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{d.cantidad}× {d.producto.nombre}</span>
                      <span style={{ color: 'var(--mm-text-muted)' }}>${d.subtotal}</span>
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary w-100 rounded-3 py-2 fw-bold" onClick={() => marcarEntregado(p.pk)}>
                  <i className="bi bi-check2 me-2"></i>Marcar como entregado
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h6 className="fw-bold">No hay pedidos listos por entregar</h6>
          <p style={{ fontSize: '.875rem' }}>Todos los pedidos han sido entregados</p>
          <Link to="/mesero/mesas" className="btn btn-primary mt-2">Ver mapa de mesas</Link>
        </div>
      )}
    </StaffLayout>
  )
}

// ─── Alertas ──────────────────────────────────────────────────────────────────
const MOCK_ALERTAS = [
  { id: 1, mesa: 3, alias: 'Luis', hora: '14:42', tipo: 'ayuda' },
  { id: 2, mesa: 7, alias: 'Mara', hora: '14:38', tipo: 'ayuda' },
]

export function Alertas() {
  const [alertas, setAlertas] = useState(MOCK_ALERTAS)
  const { showToast } = useToast()

  const atender = (id) => {
    setAlertas(prev => prev.filter(a => a.id !== id))
    showToast('Solicitud atendida', 'success')
  }

  return (
    <StaffLayout pageTitle="Alertas" sidebarNav={SIDEBAR_MESERO(0, alertas.length)}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="fw-bold mb-0">Solicitudes de clientes</h5>
        <Link to="/mesero/mesas" className="btn btn-sm" style={{ background: 'var(--mm-cream-dark)' }}>
          <i className="bi bi-arrow-left me-1"></i>Volver al mapa
        </Link>
      </div>

      {alertas.length ? (
        <div className="row g-3">
          {alertas.map(a => (
            <div key={a.id} className="col-md-6 col-lg-4">
              <div style={{ border: '2px solid var(--mm-danger)', borderRadius: 'var(--radius-md)', background: '#FDEDEC', padding: '1.25rem' }}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div>
                    <span className="fw-bold" style={{ fontSize: '1rem' }}>Mesa {a.mesa}</span>
                    <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', marginLeft: '.5rem' }}>{a.alias}</span>
                  </div>
                  <span style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>{a.hora}</span>
                </div>
                <p style={{ fontSize: '.875rem', marginBottom: '1rem' }}>
                  <i className="bi bi-bell-fill me-2" style={{ color: 'var(--mm-danger)' }}></i>
                  Solicita atención del mesero
                </p>
                <button className="btn w-100 rounded-3 py-2 fw-bold"
                  style={{ background: 'var(--mm-danger)', color: '#fff' }} onClick={() => atender(a.id)}>
                  <i className="bi bi-check2 me-2"></i>Atendido
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔔</div>
          <h6 className="fw-bold">No hay solicitudes pendientes</h6>
          <p style={{ fontSize: '.875rem' }}>Todo tranquilo por el momento</p>
        </div>
      )}
    </StaffLayout>
  )
}

// ─── Pedido Asistido ──────────────────────────────────────────────────────────
const MOCK_PRODUCTOS_ASISTIDO = [
  { id: 1, nombre: 'Matcha Latte', precio: 85, categoria: 'Bebidas calientes' },
  { id: 2, nombre: 'Hojicha Latte', precio: 80, categoria: 'Bebidas calientes' },
  { id: 4, nombre: 'Mochi Matcha', precio: 55, categoria: 'Mochis' },
  { id: 5, nombre: 'Mochi Fresa', precio: 55, categoria: 'Mochis' },
  { id: 7, nombre: 'Matcha Frappé', precio: 95, categoria: 'Bebidas frías' },
]
const MOCK_MESAS_ASISTIDO = MOCK_LISTOS.map(() => null)
  .concat([{ id: 1, numero_mesa: 1 }, { id: 4, numero_mesa: 4 }])

export function PedidoAsistido() {
  const [items, setItems] = useState([])
  const [mesaId, setMesaId] = useState('')
  const { showToast } = useToast()

  const agregarItem = (prod) => setItems(prev => {
    const exist = prev.find(i => i.id === prod.id)
    if (exist) return prev.map(i => i.id === prod.id ? { ...i, cantidad: i.cantidad + 1 } : i)
    return [...prev, { ...prod, cantidad: 1 }]
  })
  const quitarItem = (id) => setItems(prev => prev.map(i => i.id === id ? { ...i, cantidad: i.cantidad - 1 } : i).filter(i => i.cantidad > 0))
  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0)

  const enviar = () => {
    if (!mesaId) { showToast('Selecciona una mesa', 'error'); return }
    if (!items.length) { showToast('Agrega al menos un producto', 'error'); return }
    // TODO: await api.post('/mesero/pedido-asistido/', { mesa_id: mesaId, items })
    showToast('Pedido enviado a cocina ✓', 'success')
    setItems([])
    setMesaId('')
  }

  return (
    <StaffLayout pageTitle="Pedido Asistido" sidebarNav={SIDEBAR_MESERO()}>
      <div className="row g-3">
        {/* Productos */}
        <div className="col-lg-8">
          <h6 className="fw-bold mb-3">Seleccionar productos</h6>
          <div className="row g-2">
            {MOCK_PRODUCTOS_ASISTIDO.map(prod => (
              <div key={prod.id} className="col-sm-6 col-md-4">
                <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1rem', cursor: 'pointer', transition: 'box-shadow .2s' }}
                  onClick={() => agregarItem(prod)}>
                  <div style={{ fontSize: '2rem', textAlign: 'center', marginBottom: '.5rem' }}>🍵</div>
                  <div className="fw-bold" style={{ fontSize: '.9rem', textAlign: 'center' }}>{prod.nombre}</div>
                  <div style={{ color: 'var(--mm-green)', fontWeight: 700, textAlign: 'center', marginTop: '.25rem' }}>${prod.precio}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Resumen */}
        <div className="col-lg-4">
          <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', position: 'sticky', top: 0 }}>
            <h6 className="fw-bold mb-3">Resumen del pedido</h6>

            <div className="mb-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Mesa</label>
              <select className="form-select" value={mesaId} onChange={e => setMesaId(e.target.value)}
                style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)' }}>
                <option value="">Seleccionar mesa…</option>
                {[{ id: 1, numero_mesa: 1 }, { id: 4, numero_mesa: 4 }].map(m => (
                  <option key={m.id} value={m.id}>Mesa {m.numero_mesa}</option>
                ))}
              </select>
            </div>

            <div style={{ minHeight: 120, marginBottom: '1rem' }}>
              {!items.length ? (
                <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', textAlign: 'center', paddingTop: '2rem' }}>Sin productos aún</p>
              ) : items.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.35rem 0', borderBottom: '1px solid var(--mm-border)', fontSize: '.875rem' }}>
                  <span>{item.nombre}</span>
                  <div className="d-flex align-items-center gap-2">
                    <button onClick={() => quitarItem(item.id)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--mm-border)', background: 'none', cursor: 'pointer', fontSize: '.9rem' }}>−</button>
                    <span style={{ fontWeight: 700 }}>{item.cantidad}</span>
                    <button onClick={() => agregarItem(item)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--mm-border)', background: 'none', cursor: 'pointer', fontSize: '.9rem' }}>+</button>
                    <span style={{ minWidth: 50, textAlign: 'right', color: 'var(--mm-green)', fontWeight: 600 }}>${(item.precio * item.cantidad)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="d-flex justify-content-between fw-bold mb-3" style={{ fontSize: '1rem' }}>
              <span>Total</span>
              <span style={{ color: 'var(--mm-green)' }}>${total.toFixed(2)}</span>
            </div>

            <button className="btn btn-primary w-100 py-2 fw-bold" onClick={enviar}>
              <i className="bi bi-send-fill me-2"></i>Enviar a cocina
            </button>
          </div>
        </div>
      </div>
    </StaffLayout>
  )
}

// ─── Pago ─────────────────────────────────────────────────────────────────────
const METODOS_PAGO = [
  { id: 1, descripcion: 'Efectivo', emoji: '💵' },
  { id: 2, descripcion: 'Tarjeta de crédito/débito', emoji: '💳' },
  { id: 3, descripcion: 'Transferencia', emoji: '🔀' },
]

export function Pago() {
  const navigate = useNavigate()
  const [metodoPago, setMetodoPago] = useState(1)
  const [montoRecibido, setMontoRecibido] = useState('')
  const { showToast } = useToast()

  // Mock — en producción se recibirá mesa_id por query param y se cargarán pedidos de la API
  const mesa = { pk: 2, numero_mesa: 2, ubicacion: 'Interior', pin_actual: '4821' }
  const pedidos = [
    { pk: 101, sesion: { alias: 'Carlos' }, fecha: '14:35', detalles: [
      { producto: { nombre: 'Matcha Latte (Mediano)' }, cantidad: 1, subtotal: 95 },
      { producto: { nombre: 'Mochi Matcha' }, cantidad: 2, subtotal: 110 },
    ]},
  ]
  const total = pedidos.flatMap(p => p.detalles).reduce((s, d) => s + d.subtotal, 0)
  const cambio = parseFloat(montoRecibido) > total ? parseFloat(montoRecibido) - total : 0

  const confirmarPago = () => {
    // TODO: await api.post('/mesero/procesar-pago/', { mesa_id: mesa.pk, metodo_pago_id: metodoPago })
    showToast('Pago registrado correctamente ✓', 'success')
    navigate('/mesero/mesas')
  }

  return (
    <StaffLayout
      pageTitle="Pago"
      sidebarNav={<Link to="/mesero/mesas"><i className="bi bi-arrow-left"></i> Volver a mesas</Link>}
    >
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Header de mesa */}
        <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.25rem' }} className="d-flex align-items-center justify-content-between">
          <div>
            <h5 className="fw-bold mb-0">Mesa {mesa.numero_mesa}</h5>
            {mesa.ubicacion && <div style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{mesa.ubicacion}</div>}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '.2em', color: 'var(--mm-green)', background: 'var(--mm-green-pale)', padding: '.4rem .9rem', borderRadius: 'var(--radius-sm)' }}>
            {mesa.pin_actual}
          </div>
        </div>

        {/* Resumen de consumo */}
        <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h6 className="fw-bold mb-3">Resumen de consumo</h6>
          {pedidos.map(p => (
            <div key={p.pk} className="mb-2" style={{ paddingBottom: '.5rem', borderBottom: '1px solid var(--mm-border)' }}>
              <div className="d-flex justify-content-between" style={{ fontSize: '.82rem', color: 'var(--mm-text-muted)' }}>
                <span>Pedido #{p.pk} · {p.sesion.alias}</span>
                <span>{p.fecha}</span>
              </div>
              {p.detalles.map((d, i) => (
                <div key={i} className="d-flex justify-content-between" style={{ fontSize: '.875rem', padding: '.2rem 0' }}>
                  <span>{d.cantidad}× {d.producto.nombre}</span>
                  <span style={{ fontWeight: 600 }}>${d.subtotal}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="d-flex justify-content-between mt-2" style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
            <span>Subtotal</span><span>${total}</span>
          </div>
          <div className="d-flex justify-content-between fw-bold mt-1" style={{ fontSize: '1.1rem' }}>
            <span>Total</span>
            <span style={{ color: 'var(--mm-green)' }}>${total}</span>
          </div>
        </div>

        {/* Método de pago */}
        <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h6 className="fw-bold mb-3">Método de pago</h6>
          <div className="mb-4">
            {METODOS_PAGO.map(m => (
              <label key={m.id} onClick={() => setMetodoPago(m.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.85rem 1rem', border: `1.5px solid ${metodoPago === m.id ? 'var(--mm-green)' : 'var(--mm-border)'}`, borderRadius: 'var(--radius-sm)', marginBottom: '.5rem', cursor: 'pointer', background: metodoPago === m.id ? 'var(--mm-green-pale)' : 'transparent', transition: 'all .15s' }}>
                <span style={{ fontSize: '1.1rem' }}>{m.emoji}</span>
                <span style={{ fontWeight: 600 }}>{m.descripcion}</span>
              </label>
            ))}
          </div>

          {/* Monto recibido (efectivo) */}
          {metodoPago === 1 && (
            <div className="mb-4">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Monto recibido</label>
              <div className="input-group">
                <span className="input-group-text" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)', fontWeight: 700 }}>$</span>
                <input type="number" className="form-control" placeholder="0.00" step="0.01" min="0"
                  value={montoRecibido} onChange={e => setMontoRecibido(e.target.value)}
                  style={{ borderColor: 'var(--mm-border)', fontSize: '1.1rem', fontWeight: 600 }} />
              </div>
              {cambio > 0 && (
                <div style={{ display: 'block', marginTop: '.5rem', padding: '.6rem .9rem', background: 'var(--mm-green-pale)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '.875rem', color: 'var(--mm-green)', fontWeight: 600 }}>Cambio: ${cambio.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          <button className="btn btn-primary w-100 py-3 fw-bold" style={{ fontSize: '1.05rem' }} onClick={confirmarPago}>
            <i className="bi bi-cash-coin me-2"></i>Confirmar pago — ${total}
          </button>
        </div>

        <button onClick={() => navigate('/mesero/mesas')} className="btn w-100 py-2" style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text-muted)' }}>
          <i className="bi bi-arrow-left me-1"></i>Cancelar y volver
        </button>
      </div>
    </StaffLayout>
  )
}

// ─── Wrappers con Toast ───────────────────────────────────────────────────────
export function PedidosListosPage() { return <ToastProvider staff><PedidosListos /></ToastProvider> }
export function AlertasPage() { return <ToastProvider staff><Alertas /></ToastProvider> }
export function PedidoAsistidoPage() { return <ToastProvider staff><PedidoAsistido /></ToastProvider> }
export function PagoPage() { return <ToastProvider staff><Pago /></ToastProvider> }
