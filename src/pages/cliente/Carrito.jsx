import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import ClientLayout from '../../components/ClientLayout'

export default function Carrito() {
  const { sesionCliente } = useAuth()
  const { items, removeItem, clearCart, total } = useCart()
  const navigate = useNavigate()

  const mesa = sesionCliente?.mesa
  const pinMesa = sesionCliente?.pin

  const enviarACocina = async () => {
    if (!items.length) return
    try {
      // TODO: llamada real a la API
      // await api.post('/cliente/pedido/', { items, sesion_id: sesionCliente.id })
      clearCart()
      navigate('/pedidos')
    } catch {
      alert('Error al enviar el pedido')
    }
  }

  const header = (
    <header className="px-3 py-3 d-flex align-items-center justify-content-between"
      style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', position: 'sticky', top: 0, zIndex: 50 }}>
      <div className="d-flex align-items-center gap-2">
        <button onClick={() => navigate('/menu')} className="btn btn-link p-0" style={{ color: 'var(--mm-text)' }}>
          <i className="bi bi-arrow-left fs-5"></i>
        </button>
        <span className="fw-bold" style={{ fontSize: '1rem' }}>Tu pedido</span>
      </div>
      {mesa && (
        <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
          Mesa {mesa.numero_mesa} · <span className="fw-bold" style={{ fontFamily: 'var(--font-mono)' }}>PIN: {pinMesa}</span>
        </span>
      )}
    </header>
  )

  return (
    <ClientLayout header={header}>
      <div className="px-3 pt-3 pb-2">
        {!items.length ? (
          // Carrito vacío
          <div className="text-center py-5">
            <div style={{ fontSize: '3rem', color: 'var(--mm-border)', marginBottom: '1rem' }}>🛒</div>
            <h6 className="fw-bold mb-1" style={{ color: 'var(--mm-text-muted)' }}>Tu carrito está vacío</h6>
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>Agrega productos desde el menú</p>
            <button onClick={() => navigate('/menu')} className="btn btn-primary mt-2">Ver el menú</button>
          </div>
        ) : (
          <>
            {/* Items */}
            <div id="cartItems">
              {items.map((item, idx) => (
                <div key={idx} className="cart-item">
                  <div className="d-flex align-items-start justify-content-between gap-2">
                    <div className="d-flex align-items-center gap-2 flex-grow-1">
                      <span className="fw-bold" style={{ minWidth: 28, color: 'var(--mm-text-muted)', fontSize: '.875rem' }}>
                        {item.cantidad}×
                      </span>
                      <div className="flex-grow-1">
                        <div className="cart-item-name">{item.nombre}</div>
                        {item.modificadores?.length > 0 && (
                          <div className="cart-item-mods">{item.modificadores.map(m => m.nombre).join(' · ')}</div>
                        )}
                        {item.notas && (
                          <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', fontStyle: 'italic', marginTop: '.2rem' }}>
                            {item.notas}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="cart-item-price">${item.subtotal.toFixed(2)}</span>
                      <button onClick={() => removeItem(idx)} className="btn btn-link p-0" style={{ color: 'var(--mm-text-muted)', fontSize: '1rem' }}>
                        <i className="bi bi-trash3"></i>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="cart-total-bar mt-3 mb-4">
              <div className="d-flex justify-content-between mb-1" style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>
                <span>Subtotal</span>
                <span>${total.toFixed(2)}</span>
              </div>
              <div className="d-flex justify-content-between fw-bold" style={{ fontSize: '1.05rem' }}>
                <span>Total</span>
                <span style={{ color: 'var(--mm-green)' }}>${total.toFixed(2)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="d-flex flex-column gap-2">
              <button className="btn btn-primary py-3 fw-bold" style={{ fontSize: '1rem' }} onClick={enviarACocina}>
                <i className="bi bi-send-fill me-2"></i>Enviar a cocina
              </button>
              <button onClick={() => navigate('/menu')} className="btn py-2" style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text)', fontSize: '.9rem' }}>
                Seguir agregando
              </button>
            </div>
          </>
        )}
      </div>
    </ClientLayout>
  )
}
