import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ClientLayout from '../../components/ClientLayout'

const ESTADOS = {
  recibido:   { label: 'Recibido',   class: 'status-recibido' },
  preparando: { label: 'Preparando', class: 'status-preparando' },
  listo:      { label: 'Listo ✓',   class: 'status-listo' },
  entregado:  { label: 'Entregado',  class: 'status-entregado' },
  cancelado:  { label: 'Cancelado',  class: 'status-cancelado' },
}

const MOCK_PEDIDOS = [
  {
    pk: 101, estado: 'preparando', fecha: '14:35',
    detalles: [
      { nombre: 'Matcha Latte (Mediano)', cantidad: 1, subtotal: 95 },
      { nombre: 'Mochi Matcha', cantidad: 2, subtotal: 110 },
    ]
  },
  {
    pk: 99, estado: 'entregado', fecha: '14:10',
    detalles: [
      { nombre: 'Iced Hojicha', cantidad: 1, subtotal: 85 },
    ]
  },
]

function StepDot({ estado, steps, stepKey }) {
  const ordered = ['recibido', 'preparando', 'listo', 'entregado']
  const currentIdx = ordered.indexOf(estado)
  const stepIdx = ordered.indexOf(stepKey)
  const done = stepIdx < currentIdx || estado === 'entregado'
  const current = stepIdx === currentIdx && estado !== 'entregado'
  return (
    <div className={`step-dot ${done ? 'done' : current ? 'current' : ''}`}>
      {done ? <i className="bi bi-check" style={{ fontSize: '.6rem' }}></i> : steps[stepKey]}
    </div>
  )
}

export default function Pedidos() {
  const { sesionCliente } = useAuth()
  const navigate = useNavigate()
  const [pedidos, setPedidos] = useState(MOCK_PEDIDOS)

  // TODO: polling real con la API
  // useEffect(() => {
  //   const id = setInterval(() => fetchPedidos(), 10000)
  //   return () => clearInterval(id)
  // }, [])

  const mesa = sesionCliente?.mesa
  const pinMesa = sesionCliente?.pin

  const header = (
    <header className="px-3 py-3 d-flex align-items-center justify-content-between"
      style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', position: 'sticky', top: 0, zIndex: 50 }}>
      <div className="d-flex align-items-center gap-2">
        <button onClick={() => navigate('/menu')} className="btn btn-link p-0" style={{ color: 'var(--mm-text)' }}>
          <i className="bi bi-arrow-left fs-5"></i>
        </button>
        <span className="fw-bold" style={{ fontSize: '1rem' }}>Mis pedidos</span>
      </div>
      {mesa && (
        <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)' }}>
          Mesa {mesa.numero_mesa} · <span className="fw-bold" style={{ fontFamily: 'var(--font-mono)' }}>PIN: {pinMesa}</span>
        </span>
      )}
    </header>
  )

  const steps = { recibido: '1', preparando: '🍳', listo: '✓' }

  return (
    <ClientLayout header={header}>
      <div className="px-3 pt-3 pb-2">
        {!pedidos.length ? (
          <div className="text-center py-5">
            <div style={{ fontSize: '3rem', color: 'var(--mm-border)', marginBottom: '1rem' }}>📋</div>
            <h6 className="fw-bold mb-1" style={{ color: 'var(--mm-text-muted)' }}>Aún no tienes pedidos</h6>
            <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)' }}>Explora el menú y haz tu primer pedido</p>
            <button onClick={() => navigate('/menu')} className="btn btn-primary mt-2">Ver el menú</button>
          </div>
        ) : (
          <div id="ordersList">
            {pedidos.map(pedido => (
              <div key={pedido.pk} className="order-card mb-3">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-bold" style={{ fontSize: '.875rem' }}>Pedido #{pedido.pk}</span>
                  <span className={`order-status-badge ${ESTADOS[pedido.estado]?.class}`}>
                    {ESTADOS[pedido.estado]?.label}
                  </span>
                </div>

                {/* Stepper */}
                {pedido.estado !== 'cancelado' && (
                  <>
                    <div className="order-steps mb-2">
                      <StepDot estado={pedido.estado} steps={steps} stepKey="recibido" />
                      <div className={`step-line ${['preparando','listo','entregado'].includes(pedido.estado) ? 'done' : ''}`} />
                      <StepDot estado={pedido.estado} steps={steps} stepKey="preparando" />
                      <div className={`step-line ${['listo','entregado'].includes(pedido.estado) ? 'done' : ''}`} />
                      <StepDot estado={pedido.estado} steps={steps} stepKey="listo" />
                    </div>
                    <div className="d-flex justify-content-between mb-2" style={{ fontSize: '.68rem', color: 'var(--mm-text-muted)', padding: '0 2px' }}>
                      <span>Recibido</span><span>Preparando</span><span>Listo</span>
                    </div>
                  </>
                )}

                {/* Items */}
                <div className="mt-2">
                  {pedido.detalles.map((d, i) => (
                    <div key={i} style={{ fontSize: '.85rem', padding: '.25rem 0', borderBottom: '1px solid var(--mm-border)' }} className="d-flex justify-content-between">
                      <span>{d.cantidad}× {d.nombre}</span>
                      <span style={{ color: 'var(--mm-text-muted)' }}>${d.subtotal.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Subtotal */}
                <div className="d-flex justify-content-between mt-2 fw-bold" style={{ fontSize: '.875rem' }}>
                  <span>Total</span>
                  <span style={{ color: 'var(--mm-green)' }}>
                    ${pedido.detalles.reduce((s, d) => s + d.subtotal, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ClientLayout>
  )
}
