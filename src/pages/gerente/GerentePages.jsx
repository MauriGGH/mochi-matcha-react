import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import StaffLayout from '../../components/StaffLayout'
import { ToastProvider, useToast } from '../../components/Toast'

// ── Sidebar compartida gerente ──────────────────────────────────────────────
export function SidebarGerente({ active }) {
  return (
    <>
      <Link to="/gerente/floor-plan" className={active === 'floor-plan' ? 'active' : ''}>
        <i className="bi bi-grid-fill"></i> Floor Plan
      </Link>
      <div className="nav-section-label">Gestión</div>
      <Link to="/gerente/menu" className={active === 'menu' ? 'active' : ''}>
        <i className="bi bi-basket-fill"></i> Gestión de Menú
      </Link>
      <div className="nav-section-label">Reportes</div>
      <Link to="/gerente/reportes" className={active === 'reportes' ? 'active' : ''}>
        <i className="bi bi-bar-chart-fill"></i> Reportes
      </Link>
      <div className="nav-section-label">Admin</div>
      <Link to="/gerente/empleados" className={active === 'empleados' ? 'active' : ''}>
        <i className="bi bi-people-fill"></i> Empleados
      </Link>
      <Link to="/gerente/configuracion" className={active === 'configuracion' ? 'active' : ''}>
        <i className="bi bi-gear-fill"></i> Configuración
      </Link>
    </>
  )
}

// ── Mock data ────────────────────────────────────────────────────────────────
const MOCK_MESAS_GERENTE = [
  { id: 1, numero_mesa: 1, ubicacion: 'Terraza', estado: 'libre', capacidad: 4 },
  { id: 2, numero_mesa: 2, ubicacion: 'Interior', estado: 'ocupada', capacidad: 2 },
  { id: 3, numero_mesa: 3, ubicacion: 'Interior', estado: 'ocupada', capacidad: 4 },
  { id: 4, numero_mesa: 4, ubicacion: 'Barra', estado: 'libre', capacidad: 2 },
  { id: 5, numero_mesa: 5, ubicacion: 'Terraza', estado: 'pagando', capacidad: 6 },
]

const MOCK_EMPLEADOS = [
  { id: 1, nombre: 'María García', rol: 'mesero', usuario: 'maria_g', activo: true },
  { id: 2, nombre: 'Carlos López', rol: 'cocina', usuario: 'carlos_l', activo: true },
  { id: 3, nombre: 'Ana Martínez', rol: 'mesero', usuario: 'ana_m', activo: false },
]

const MOCK_PRODUCTOS = [
  { id: 1, nombre: 'Matcha Latte', categoria: 'Bebidas calientes', precio: 85, disponible: true },
  { id: 2, nombre: 'Hojicha Latte', categoria: 'Bebidas calientes', precio: 80, disponible: true },
  { id: 4, nombre: 'Mochi Matcha', categoria: 'Mochis', precio: 55, disponible: true },
  { id: 7, nombre: 'Matcha Frappé', categoria: 'Bebidas frías', precio: 95, disponible: false },
]

const MOCK_STATS = {
  ventas_hoy: 4850,
  pedidos_hoy: 23,
  ticket_promedio: 211,
  mesas_activas: 3,
}

// ── FloorPlan ────────────────────────────────────────────────────────────────
export function FloorPlan() {
  const [mesas, setMesas] = useState(MOCK_MESAS_GERENTE)
  const [mesaSel, setMesaSel] = useState(null)
  const [showNuevaMesa, setShowNuevaMesa] = useState(false)
  const [nuevaMesa, setNuevaMesa] = useState({ numero_mesa: '', ubicacion: '', capacidad: 4 })
  const { showToast } = useToast()
  const navigate = useNavigate()

  const guardarMesa = () => {
    if (!nuevaMesa.numero_mesa) return
    setMesas(prev => [...prev, { ...nuevaMesa, id: Date.now(), estado: 'libre' }])
    setShowNuevaMesa(false)
    setNuevaMesa({ numero_mesa: '', ubicacion: '', capacidad: 4 })
    showToast('Mesa creada correctamente', 'success')
  }

  const eliminarMesa = (id) => {
    if (!window.confirm('¿Eliminar esta mesa?')) return
    setMesas(prev => prev.filter(m => m.id !== id))
    setMesaSel(null)
    showToast('Mesa eliminada', 'success')
  }

  return (
    <StaffLayout pageTitle="Floor Plan" sidebarNav={<SidebarGerente active="floor-plan" />}
      topbarActions={
        <button className="btn btn-primary btn-sm" onClick={() => setShowNuevaMesa(true)}>
          <i className="bi bi-plus me-1"></i>Nueva mesa
        </button>
      }>
      <div className="d-flex gap-3" style={{ height: 'calc(100vh - 56px - 3rem)', overflow: 'hidden' }}>
        {/* Mapa */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h5 className="fw-bold mb-0">Distribución del restaurante</h5>
            <div style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
              {mesas.filter(m => m.estado !== 'libre').length}/{mesas.length} ocupadas
            </div>
          </div>
          <div className="table-grid">
            {mesas.map(m => (
              <div key={m.id} className={`mesa-tile ${m.estado}`} onClick={() => setMesaSel(m)}>
                <div className="mesa-dot"></div>
                <div className="mesa-num">{m.numero_mesa}</div>
                <div className="mesa-label">{m.estado === 'libre' ? 'Libre' : m.estado}</div>
                {m.ubicacion && <div style={{ fontSize: '.6rem', color: 'var(--mm-text-muted)', marginTop: '.2rem' }}>{m.ubicacion}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Panel derecho */}
        {mesaSel && (
          <div style={{ width: 280, background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', overflowY: 'auto' }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Mesa {mesaSel.numero_mesa}</h6>
              <button className="btn-close" onClick={() => setMesaSel(null)}></button>
            </div>
            {[['Ubicación', mesaSel.ubicacion || '—'], ['Estado', mesaSel.estado], ['Capacidad', `${mesaSel.capacidad} personas`]].map(([k, v]) => (
              <div key={k} className="d-flex justify-content-between" style={{ fontSize: '.85rem', padding: '.4rem 0', borderBottom: '1px solid var(--mm-border)' }}>
                <span style={{ color: 'var(--mm-text-muted)' }}>{k}</span>
                <span className="fw-semibold">{v}</span>
              </div>
            ))}
            <div className="d-flex flex-column gap-2 mt-3">
              <button className="btn btn-sm w-100" style={{ background: 'var(--mm-cream-dark)' }}
                onClick={() => navigate(`/mesero/pago?mesa=${mesaSel.id}`)}>
                <i className="bi bi-cash-coin me-1"></i>Procesar pago
              </button>
              <button className="btn btn-sm w-100" style={{ background: '#FDEDEC', color: 'var(--mm-danger)', border: 'none' }}
                onClick={() => eliminarMesa(mesaSel.id)}>
                <i className="bi bi-trash me-1"></i>Eliminar mesa
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal nueva mesa */}
      {showNuevaMesa && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1055, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--mm-white)', borderRadius: 'var(--radius-md)', padding: '1.5rem', width: 360 }}>
            <h6 className="fw-bold mb-3">Nueva mesa</h6>
            {[
              { label: 'Número de mesa', key: 'numero_mesa', type: 'number' },
              { label: 'Ubicación', key: 'ubicacion', type: 'text' },
              { label: 'Capacidad', key: 'capacidad', type: 'number' },
            ].map(({ label, key, type }) => (
              <div key={key} className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>{label}</label>
                <input type={type} className="form-control" value={nuevaMesa[key]}
                  onChange={e => setNuevaMesa(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)' }} />
              </div>
            ))}
            <div className="d-flex gap-2">
              <button className="btn btn-primary flex-1" onClick={guardarMesa}>Guardar</button>
              <button className="btn flex-1" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => setShowNuevaMesa(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </StaffLayout>
  )
}

// ── MenuManager ──────────────────────────────────────────────────────────────
export function MenuManager() {
  const [productos, setProductos] = useState(MOCK_PRODUCTOS)
  const [tab, setTab] = useState('productos')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ nombre: '', categoria: '', precio: '', descripcion: '' })
  const { showToast } = useToast()

  const toggleDisponible = (id) => {
    setProductos(prev => prev.map(p => p.id === id ? { ...p, disponible: !p.disponible } : p))
    showToast('Disponibilidad actualizada', 'success')
  }

  const eliminar = (id) => {
    if (!window.confirm('¿Eliminar este producto?')) return
    setProductos(prev => prev.filter(p => p.id !== id))
    showToast('Producto eliminado', 'success')
  }

  const guardar = () => {
    if (!form.nombre || !form.precio) { showToast('Completa los campos requeridos', 'error'); return }
    setProductos(prev => [...prev, { id: Date.now(), ...form, precio: parseFloat(form.precio), disponible: true }])
    setShowForm(false)
    setForm({ nombre: '', categoria: '', precio: '', descripcion: '' })
    showToast('Producto creado correctamente', 'success')
  }

  const tabs = ['productos', 'categorías', 'modificadores', 'promociones']

  return (
    <StaffLayout pageTitle="Gestión de Menú" sidebarNav={<SidebarGerente active="menu" />}
      topbarActions={
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
          <i className="bi bi-plus me-1"></i>Nuevo producto
        </button>
      }>
      {/* Tabs */}
      <div className="d-flex gap-1 mb-4" style={{ borderBottom: '2px solid var(--mm-border)', paddingBottom: '.5rem' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="btn btn-sm"
            style={{ background: tab === t ? 'var(--mm-green)' : 'var(--mm-cream-dark)', color: tab === t ? '#fff' : 'var(--mm-text-muted)', borderRadius: 'var(--radius-pill)', textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'productos' && (
        <div className="table-responsive">
          <table className="table data-table">
            <thead>
              <tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>PRECIO</th><th>ESTADO</th><th>ACCIONES</th></tr>
            </thead>
            <tbody>
              {productos.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <span style={{ fontSize: '1.25rem' }}>🍵</span>
                      <span className="fw-semibold" style={{ fontSize: '.9rem' }}>{p.nombre}</span>
                    </div>
                  </td>
                  <td>{p.categoria}</td>
                  <td className="fw-bold" style={{ color: 'var(--mm-green)' }}>${p.precio}</td>
                  <td>
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" checked={p.disponible}
                        onChange={() => toggleDisponible(p.id)} style={{ cursor: 'pointer' }} />
                    </div>
                  </td>
                  <td>
                    <div className="d-flex gap-1">
                      <button className="btn btn-sm" style={{ background: 'var(--mm-cream-dark)', fontSize: '.75rem' }}>
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button className="btn btn-sm" style={{ background: '#FDEDEC', color: 'var(--mm-danger)', fontSize: '.75rem' }}
                        onClick={() => eliminar(p.id)}>
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab !== 'productos' && (
        <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🚧</div>
          <h6>Sección en construcción</h6>
          <p style={{ fontSize: '.875rem' }}>Esta sección se conectará con el backend en la siguiente fase</p>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1055, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--mm-white)', borderRadius: 'var(--radius-md)', padding: '1.5rem', width: 420 }}>
            <h6 className="fw-bold mb-3">Nuevo producto</h6>
            {[
              { label: 'Nombre *', key: 'nombre' },
              { label: 'Categoría', key: 'categoria' },
              { label: 'Precio *', key: 'precio', type: 'number' },
              { label: 'Descripción', key: 'descripcion' },
            ].map(({ label, key, type = 'text' }) => (
              <div key={key} className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>{label}</label>
                <input type={type} className="form-control" value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)' }} />
              </div>
            ))}
            <div className="d-flex gap-2 mt-2">
              <button className="btn btn-primary flex-1" onClick={guardar}>Guardar</button>
              <button className="btn flex-1" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </StaffLayout>
  )
}

// ── Empleados ────────────────────────────────────────────────────────────────
const ROL_LABELS = { mesero: '🧑‍🍳 Mesero', cocina: '🍳 Cocina', gerente: '💼 Gerente' }

export function Empleados() {
  const [empleados, setEmpleados] = useState(MOCK_EMPLEADOS)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ nombre: '', usuario: '', rol: 'mesero', contrasena: '' })
  const { showToast } = useToast()

  const toggleActivo = (id) => {
    setEmpleados(prev => prev.map(e => e.id === id ? { ...e, activo: !e.activo } : e))
    showToast('Estado actualizado', 'success')
  }

  const guardar = () => {
    if (!form.nombre || !form.usuario) { showToast('Completa los campos requeridos', 'error'); return }
    setEmpleados(prev => [...prev, { ...form, id: Date.now(), activo: true }])
    setShowForm(false)
    setForm({ nombre: '', usuario: '', rol: 'mesero', contrasena: '' })
    showToast('Empleado creado correctamente', 'success')
  }

  return (
    <StaffLayout pageTitle="Empleados" sidebarNav={<SidebarGerente active="empleados" />}
      topbarActions={
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
          <i className="bi bi-plus me-1"></i>Nuevo empleado
        </button>
      }>
      <div className="table-responsive">
        <table className="table data-table">
          <thead>
            <tr><th>NOMBRE</th><th>USUARIO</th><th>ROL</th><th>ESTADO</th><th>ACCIONES</th></tr>
          </thead>
          <tbody>
            {empleados.map(e => (
              <tr key={e.id}>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--mm-green-pale)', color: 'var(--mm-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '.875rem' }}>
                      {e.nombre.charAt(0)}
                    </div>
                    <span className="fw-semibold" style={{ fontSize: '.9rem' }}>{e.nombre}</span>
                  </div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.85rem' }}>{e.usuario}</td>
                <td>{ROL_LABELS[e.rol] || e.rol}</td>
                <td>
                  <span style={{ background: e.activo ? '#EAFAF1' : '#F2F3F4', color: e.activo ? '#1E8449' : '#566573', borderRadius: 99, padding: '.2rem .6rem', fontSize: '.75rem', fontWeight: 700 }}>
                    {e.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <div className="d-flex gap-1">
                    <button className="btn btn-sm" style={{ fontSize: '.75rem', background: e.activo ? '#F2F3F4' : 'var(--mm-green-pale)', color: e.activo ? '#566573' : 'var(--mm-green)' }}
                      onClick={() => toggleActivo(e.id)}>
                      {e.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1055, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--mm-white)', borderRadius: 'var(--radius-md)', padding: '1.5rem', width: 400 }}>
            <h6 className="fw-bold mb-3">Nuevo empleado</h6>
            {[
              { label: 'Nombre completo *', key: 'nombre' },
              { label: 'Usuario *', key: 'usuario' },
              { label: 'Contraseña *', key: 'contrasena', type: 'password' },
            ].map(({ label, key, type = 'text' }) => (
              <div key={key} className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>{label}</label>
                <input type={type} className="form-control" value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)' }} />
              </div>
            ))}
            <div className="mb-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Rol</label>
              <select className="form-select" value={form.rol} onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}
                style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)' }}>
                <option value="mesero">Mesero</option>
                <option value="cocina">Cocina</option>
                <option value="gerente">Gerente</option>
              </select>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-primary flex-1" onClick={guardar}>Guardar</button>
              <button className="btn flex-1" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </StaffLayout>
  )
}

// ── Reportes ─────────────────────────────────────────────────────────────────
export function Reportes() {
  const [periodo, setPeriodo] = useState('hoy')
  const stats = MOCK_STATS
  const auditoria = [
    { fecha: '12/04 14:42', accion: 'Pago registrado', empleado: 'maria_g', mesa: 'Mesa 2', detalle: 'Efectivo $225' },
    { fecha: '12/04 14:35', accion: 'Pedido enviado', empleado: 'carlos_l', mesa: 'Mesa 5', detalle: '3 productos' },
    { fecha: '12/04 14:10', accion: 'Mesa liberada', empleado: 'maria_g', mesa: 'Mesa 1', detalle: 'Sesión cerrada' },
  ]

  const statCards = [
    { label: 'Ventas del día', value: `$${stats.ventas_hoy.toLocaleString()}`, icon: 'bi-cash-stack', color: 'var(--mm-green)' },
    { label: 'Pedidos', value: stats.pedidos_hoy, icon: 'bi-receipt', color: 'var(--mm-gold)' },
    { label: 'Ticket promedio', value: `$${stats.ticket_promedio}`, icon: 'bi-graph-up', color: 'var(--mm-info)' },
    { label: 'Mesas activas', value: stats.mesas_activas, icon: 'bi-grid-fill', color: 'var(--mm-success)' },
  ]

  return (
    <StaffLayout pageTitle="Reportes" sidebarNav={<SidebarGerente active="reportes" />}
      topbarActions={
        <div className="d-flex gap-2 align-items-center">
          <div className="dropdown">
            <button className="btn btn-sm dropdown-toggle" data-bs-toggle="dropdown"
              style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', fontSize: '.85rem' }}>
              <i className="bi bi-calendar3 me-1"></i>
              {{ hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes' }[periodo]}
            </button>
            <ul className="dropdown-menu shadow-sm border-0 rounded-3">
              {[['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes']].map(([v, l]) => (
                <li key={v}><button className="dropdown-item" onClick={() => setPeriodo(v)}>{l}</button></li>
              ))}
            </ul>
          </div>
        </div>
      }>
      {/* Stats */}
      <div className="row g-3 mb-4">
        {statCards.map((s, i) => (
          <div key={i} className="col-sm-6 col-xl-3">
            <div className="stat-card d-flex align-items-center gap-3">
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', background: 'var(--mm-cream-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', color: s.color }}>
                <i className={`bi ${s.icon}`}></i>
              </div>
              <div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Auditoria */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h6 className="fw-bold mb-0">Registro de actividad</h6>
      </div>
      <div className="table-responsive">
        <table className="table data-table">
          <thead>
            <tr><th>FECHA</th><th>ACCIÓN</th><th>EMPLEADO</th><th>MESA</th><th>DETALLE</th></tr>
          </thead>
          <tbody>
            {auditoria.map((r, i) => (
              <tr key={i}>
                <td style={{ fontSize: '.8rem', whiteSpace: 'nowrap', color: 'var(--mm-text-muted)' }}>{r.fecha}</td>
                <td><span style={{ fontWeight: 600, fontSize: '.85rem' }}>{r.accion}</span></td>
                <td style={{ fontSize: '.85rem' }}>{r.empleado}</td>
                <td style={{ fontSize: '.85rem' }}>{r.mesa}</td>
                <td style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>{r.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StaffLayout>
  )
}

// ── Configuracion ─────────────────────────────────────────────────────────────
export function Configuracion() {
  const [mantenimiento, setMantenimiento] = useState(false)
  const [msgMantenimiento, setMsgMantenimiento] = useState('Estamos realizando mejoras. Volvemos en breve. 🍵')
  const [thresholds, setThresholds] = useState({ verde: 5, amarillo: 10 })
  const { showToast } = useToast()

  const guardar = () => {
    // TODO: await api.post('/gerente/configuracion/', { ... })
    showToast('Configuración guardada correctamente', 'success')
  }

  return (
    <StaffLayout pageTitle="Configuración" sidebarNav={<SidebarGerente active="configuracion" />}>
      <div style={{ maxWidth: 680 }}>
        {/* Modo mantenimiento */}
        <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h6 className="fw-bold mb-1">Modo de mantenimiento</h6>
          <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
            Activa una pantalla informativa para los clientes mientras realizas actualizaciones.
          </p>
          <div style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)', padding: '1rem', marginBottom: '1.25rem' }}
            className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-3">
              <div style={{ width: 40, height: 40, background: 'var(--mm-cream-dark)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                ⏸
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '.9rem' }}>Modo mantenimiento</div>
                <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
                  {mantenimiento ? 'Activo — clientes ven pantalla de mantenimiento' : 'Inactivo — restaurante operando con normalidad'}
                </div>
              </div>
            </div>
            <div className="form-check form-switch mb-0">
              <input className="form-check-input" type="checkbox" checked={mantenimiento}
                onChange={e => setMantenimiento(e.target.checked)}
                style={{ cursor: 'pointer', width: '2.75em', height: '1.35em' }} />
            </div>
          </div>
          <div>
            <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Mensaje personalizado</label>
            <textarea className="form-control" rows={3} value={msgMantenimiento}
              onChange={e => setMsgMantenimiento(e.target.value)}
              style={{ borderColor: 'var(--mm-border)', resize: 'none', fontSize: '.875rem' }} />
            <p style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', marginTop: '.35rem' }}>
              Este mensaje se mostrará a los clientes cuando intenten acceder.
            </p>
          </div>
        </div>

        {/* Semáforo KDS */}
        <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h6 className="fw-bold mb-1">Umbrales del semáforo (KDS)</h6>
          <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1.25rem' }}>
            Define en cuántos minutos cambia el color del temporizador en cocina.
          </p>
          <div className="row g-3">
            {[
              { label: '🟢 Verde → Amarillo (minutos)', key: 'verde' },
              { label: '🟡 Amarillo → Rojo (minutos)', key: 'amarillo' },
            ].map(({ label, key }) => (
              <div key={key} className="col-sm-6">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>{label}</label>
                <input type="number" className="form-control" min={1} value={thresholds[key]}
                  onChange={e => setThresholds(t => ({ ...t, [key]: Number(e.target.value) }))}
                  style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)' }} />
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-primary px-4 py-2 fw-bold" onClick={guardar}>
          <i className="bi bi-floppy me-2"></i>Guardar configuración
        </button>
      </div>
    </StaffLayout>
  )
}

// ── Wrappers con Toast ────────────────────────────────────────────────────────
export function FloorPlanPage() { return <ToastProvider staff><FloorPlan /></ToastProvider> }
export function MenuManagerPage() { return <ToastProvider staff><MenuManager /></ToastProvider> }
export function EmpleadosPage() { return <ToastProvider staff><Empleados /></ToastProvider> }
export function ReportesPage() { return <ToastProvider staff><Reportes /></ToastProvider> }
export function ConfiguracionPage() { return <ToastProvider staff><Configuracion /></ToastProvider> }
