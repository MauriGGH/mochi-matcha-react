import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import ClientLayout from '../../components/ClientLayout'

// Mock data — reemplazar con llamadas API
const MOCK_CATEGORIAS = [
  {
    id: 1, nombre: 'Bebidas calientes',
    productos: [
      { id: 1, nombre: 'Matcha Latte', descripcion: 'Matcha ceremonial con leche de avena', precio: 85, imagen_url: '', disponible: true,
        grupos: [{ id: 1, nombre: 'Tamaño', tipo: 'radio', requerido: true, opciones: [
          { id: 1, nombre: 'Chico (8oz)', precio_extra: 0 },
          { id: 2, nombre: 'Mediano (12oz)', precio_extra: 10 },
          { id: 3, nombre: 'Grande (16oz)', precio_extra: 20 },
        ]}]},
      { id: 2, nombre: 'Hojicha Latte', descripcion: 'Té tostado japonés con leche de almendra', precio: 80, imagen_url: '', disponible: true, grupos: [] },
      { id: 3, nombre: 'Chai Especiado', descripcion: 'Mezcla aromática de especias', precio: 75, imagen_url: '', disponible: false, grupos: [] },
    ]
  },
  {
    id: 2, nombre: 'Mochis',
    productos: [
      { id: 4, nombre: 'Mochi Matcha', descripcion: 'Relleno de ganache de matcha', precio: 55, imagen_url: '', disponible: true,
        grupos: [{ id: 2, nombre: 'Cantidad', tipo: 'radio', requerido: false, opciones: [
          { id: 4, nombre: '1 pieza', precio_extra: 0 },
          { id: 5, nombre: '3 piezas', precio_extra: 100 },
          { id: 6, nombre: '6 piezas', precio_extra: 200 },
        ]}]},
      { id: 5, nombre: 'Mochi Fresa', descripcion: 'Relleno de crema de fresa', precio: 55, imagen_url: '', disponible: true, grupos: [] },
      { id: 6, nombre: 'Mochi Yuzu', descripcion: 'Cítrico japonés con crema', precio: 60, imagen_url: '', disponible: true, grupos: [] },
    ]
  },
  {
    id: 3, nombre: 'Bebidas frías',
    productos: [
      { id: 7, nombre: 'Matcha Frappé', descripcion: 'Blended con hielo y leche de coco', precio: 95, imagen_url: '', disponible: true, grupos: [] },
      { id: 8, nombre: 'Iced Hojicha', descripcion: 'Frío con leche de avena', precio: 85, imagen_url: '', disponible: true, grupos: [] },
    ]
  },
]

function ProductModal({ producto, onClose, onAdd }) {
  const [qty, setQty] = useState(1)
  const [selecciones, setSelecciones] = useState({})
  const [notas, setNotas] = useState('')
  const [validationMsg, setValidationMsg] = useState('')

  const precioBase = parseFloat(producto.precio)
  const extraMods = Object.values(selecciones).reduce((s, op) => s + (op?.precio_extra || 0), 0)
  const precioTotal = (precioBase + extraMods) * qty

  const seleccionarOpcion = (grupoId, opcion) => {
    setSelecciones(prev => ({ ...prev, [grupoId]: opcion }))
    setValidationMsg('')
  }

  const handleAdd = () => {
    // Validar requeridos
    for (const g of producto.grupos) {
      if (g.requerido && !selecciones[g.id]) {
        setValidationMsg(`Selecciona una opción en "${g.nombre}"`)
        return
      }
    }
    const mods = Object.values(selecciones).filter(Boolean)
    onAdd({
      producto_id: producto.id,
      nombre: producto.nombre,
      precio_unitario: precioBase + extraMods,
      cantidad: qty,
      subtotal: precioTotal,
      modificadores: mods,
      notas,
    })
    onClose()
  }

  return (
    <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1055 }}>
      <div className="modal-dialog m-0 w-100" style={{ maxWidth: 430, margin: '0 auto !important', position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}>
        <div className="modal-content rounded-top-4 rounded-bottom-0 border-0">
          {/* Imagen */}
          <div style={{ position: 'relative' }}>
            {producto.imagen_url
              ? <img src={producto.imagen_url} alt={producto.nombre} style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }} />
              : <div style={{ width: '100%', height: 180, background: 'var(--mm-cream-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}>🍵</div>
            }
            <button type="button" onClick={onClose} className="btn-close position-absolute"
              style={{ top: '.75rem', right: '.75rem', background: 'rgba(255,255,255,.9)', borderRadius: '50%', padding: '.5rem' }} />
          </div>

          <div className="modal-body px-4 pt-3 pb-2">
            <h5 className="fw-bold mb-1">{producto.nombre}</h5>
            {producto.descripcion && <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '.5rem' }}>{producto.descripcion}</p>}
            <div className="fw-bold mb-3" style={{ color: 'var(--mm-green)', fontSize: '1rem' }}>${precioBase.toFixed(2)}</div>

            {/* Modificadores */}
            {producto.grupos.map(g => (
              <div key={g.id} className="mb-3">
                <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  {g.nombre} {g.requerido && <span style={{ fontSize: '.7rem', color: 'var(--mm-danger)' }}>*Requerido</span>}
                </div>
                {g.opciones.map(op => (
                  <div
                    key={op.id}
                    className={`modifier-option ${selecciones[g.id]?.id === op.id ? 'selected' : ''}`}
                    onClick={() => seleccionarOpcion(g.id, op)}
                  >
                    <span style={{ fontSize: '.875rem' }}>{op.nombre}</span>
                    {op.precio_extra > 0 && <span className="modifier-extra">+${op.precio_extra}</span>}
                  </div>
                ))}
              </div>
            ))}

            {/* Notas */}
            <div className="mb-3">
              <label className="form-label fw-semibold" style={{ fontSize: '.85rem' }}>Notas especiales</label>
              <textarea
                value={notas} onChange={e => setNotas(e.target.value)}
                className="form-control rounded-3" rows={2} maxLength={100}
                placeholder="ej. sin hielo, extra caliente…"
                style={{ fontSize: '.875rem', borderColor: 'var(--mm-border)', resize: 'none' }}
              />
            </div>

            {/* Cantidad */}
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="fw-semibold" style={{ fontSize: '.875rem' }}>Cantidad</span>
              <div className="qty-control">
                <button className="qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                <span className="qty-value">{qty}</span>
                <button className="qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
              </div>
            </div>
          </div>

          <div className="modal-footer border-0 px-4 pb-4 pt-0 flex-column">
            {validationMsg && <p className="text-danger mb-2 w-100" style={{ fontSize: '.8rem' }}>{validationMsg}</p>}
            <button className="btn btn-primary w-100 py-3 fw-bold" onClick={handleAdd}>
              Añadir — ${precioTotal.toFixed(2)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Menu() {
  const { sesionCliente } = useAuth()
  const { addItem, count } = useCart()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState('todos')
  const [productoModal, setProductoModal] = useState(null)

  const mesa = sesionCliente?.mesa
  const pinMesa = sesionCliente?.pin

  const categorias = MOCK_CATEGORIAS
  const disponibles = categorias.map(c => ({ ...c, productos: c.productos.filter(p => p.disponible) })).filter(c => c.productos.length)

  const filterCat = (catId) => {
    setActiveTab(catId)
    if (catId !== 'todos') {
      document.getElementById(`cat-${catId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const header = (
    <header className="px-3 py-2 d-flex align-items-center justify-content-between"
      style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', position: 'sticky', top: 0, zIndex: 50 }}>
      <span className="fw-semibold" style={{ fontSize: '1rem', color: 'var(--mm-green)', fontFamily: 'var(--font-display)' }}>🍵 Mochi Matcha</span>
      <div className="d-flex align-items-center gap-2">
        {mesa && (
          <span style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
            Mesa {mesa.numero_mesa} · <span className="fw-bold" style={{ fontFamily: 'var(--font-mono)', color: 'var(--mm-text)' }}>PIN: {pinMesa}</span>
          </span>
        )}
        <button onClick={() => navigate('/carrito')} className="btn btn-link p-0 position-relative" style={{ color: 'var(--mm-text)' }}>
          <i className="bi bi-bag-fill" style={{ fontSize: '1.4rem' }}></i>
          {count > 0 && <span className="nav-badge">{count}</span>}
        </button>
      </div>
    </header>
  )

  return (
    <ClientLayout header={header}>
      {/* Category Tabs */}
      <div className="category-tabs" id="catTabs">
        <button className={`cat-tab ${activeTab === 'todos' ? 'active' : ''}`} onClick={() => filterCat('todos')}>Todo</button>
        {disponibles.map(cat => (
          <button key={cat.id} className={`cat-tab ${activeTab === cat.id ? 'active' : ''}`} onClick={() => filterCat(cat.id)}>
            {cat.nombre}
          </button>
        ))}
      </div>

      {/* Products */}
      <div className="px-3 pb-4" id="productsContainer">
        {disponibles.map(cat => (
          (activeTab === 'todos' || activeTab === cat.id) && (
            <div key={cat.id} className="category-section mb-4" id={`cat-${cat.id}`}>
              <h6 className="fw-bold mb-2 mt-2" style={{ color: 'var(--mm-text-muted)', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                {cat.nombre}
              </h6>
              <div className="row g-2">
                {cat.productos.map(prod => (
                  <div key={prod.id} className="col-6">
                    <div className="product-card" onClick={() => setProductoModal(prod)}>
                      <div className="product-img-placeholder">🍵</div>
                      <div className="product-body">
                        <div className="product-name">{prod.nombre}</div>
                        {prod.descripcion && <div className="product-desc">{prod.descripcion}</div>}
                        <div className="d-flex align-items-center justify-content-between mt-1">
                          <span className="product-price">${prod.precio}</span>
                          <button className="add-btn" onClick={e => { e.stopPropagation(); setProductoModal(prod) }}>+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ))}
      </div>

      {/* Modal */}
      {productoModal && (
        <ProductModal
          producto={productoModal}
          onClose={() => setProductoModal(null)}
          onAdd={(item) => { addItem(item); setProductoModal(null) }}
        />
      )}
    </ClientLayout>
  )
}
