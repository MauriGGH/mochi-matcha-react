/**
 * TicketCliente.jsx — comprobante de pago para el cliente tras cerrar la cuenta.
 * Solo accesible si la sesión está marcada como 'pagada'. Soporta impresión
 * vía window.print() con CSS @media print que oculta los botones.
 *
 * Ruta: /menu/:id_sesion/ticket. Exporta: default TicketCliente().
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';

/** Vista de ticket / recibo del cliente. Sin props (id_sesion viene de la URL). */
export default function TicketCliente() {
  const { id_sesion } = useParams();
  const navigate = useNavigate();
  const token_sesion = sessionStorage.getItem('token_sesion');

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  // Carga única del ticket. Solo lo poblamos si la sesión está marcada 'pagada'
  // por el backend; en caso contrario el componente muestra estado de error.
  useEffect(() => {
    if (!token_sesion) { navigate('/'); return; }
    api.get(`/cliente/estado-sesion?token_sesion=${token_sesion}`)
      .then(({ data }) => {
        if (data.pagada && data.ticket) {
          setTicket(data.ticket);
        } else {
          setError('Tu cuenta aún no ha sido pagada.');
        }
      })
      .catch(() => setError('No se pudo cargar el ticket.'))
      .finally(() => setLoading(false));
  }, [token_sesion]);

  // Imprime el ticket (el CSS @media print esconde la barra de acciones).
  const handlePrint = () => window.print();

  // Cierra sesión cliente y vuelve a /.
  const salir = () => {
    sessionStorage.clear();
    navigate('/');
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner-border" style={{ color: 'var(--mm-green)' }} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <div className="text-center">
          <i className="bi bi-exclamation-circle" style={{ fontSize: '3rem', color: '#aaa', display: 'block', marginBottom: '1rem' }} />
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>{error || 'Ticket no disponible'}</p>
          <button className="btn btn-primary" onClick={() => navigate(`/menu/${id_sesion}/pedidos`)}>
            Volver a mis pedidos
          </button>
        </div>
      </div>
    );
  }

  const { alias, mesa, metodo, items, subtotal_sesion, total_pagado } = ticket;
  const ahora = new Date();

  return (
    <div style={{ fontFamily: "'Courier New', Courier, monospace", background: '#f5f0e8', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 1rem' }}>

      {/* Actions (hidden on print) */}
      <div className="no-print" style={{ display: 'flex', gap: '.65rem', marginBottom: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={handlePrint}
          style={{ padding: '.6rem 1.4rem', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', background: '#3D6B4F', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}
        >
          <i className="bi bi-download" /> Descargar ticket
        </button>
        <button
          onClick={() => navigate(`/menu/${id_sesion}/pedidos`)}
          style={{ padding: '.6rem 1.4rem', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', background: '#e8e0d0', color: '#555', display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}
        >
          ← Mis pedidos
        </button>
        <button
          onClick={salir}
          style={{ padding: '.6rem 1.4rem', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', background: '#e8e0d0', color: '#555', display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}
        >
          <i className="bi bi-box-arrow-right" /> Salir
        </button>
      </div>

      {/* Ticket */}
      <div style={{ background: '#fff', width: '100%', maxWidth: 380, borderRadius: 4, boxShadow: '0 4px 24px rgba(0,0,0,.13)', padding: 0, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ background: '#3D6B4F', color: '#fff', padding: '1.1rem 1.25rem .9rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.2rem' }}>
            <i className="bi bi-cup-hot-fill" />
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '.04em' }}>Mochi Matcha</div>
          <div style={{ fontSize: '.68rem', opacity: .8, lineHeight: 1.5, marginTop: '.2rem' }}>
            Av. Tecnológico 123, Colima
          </div>
          <div style={{ fontSize: '.65rem', opacity: .65, marginTop: '.35rem', letterSpacing: '.08em' }}>
            COMPROBANTE DE PAGO
          </div>
        </div>

        <div style={{ padding: '.85rem 1.1rem' }}>
          {/* Meta */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.55rem .5rem', fontSize: '.72rem', color: '#555', marginBottom: '.7rem', lineHeight: 1.3 }}>
            <div>
              <strong style={{ color: '#222', display: 'block', marginBottom: '.1rem' }}>Fecha</strong>
              {ahora.toLocaleDateString('es-MX')}
            </div>
            <div>
              <strong style={{ color: '#222', display: 'block', marginBottom: '.1rem' }}>Hora</strong>
              {ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {mesa && (
              <div>
                <strong style={{ color: '#222', display: 'block', marginBottom: '.1rem' }}>Mesa</strong>
                {mesa}
              </div>
            )}
            {alias && (
              <div>
                <strong style={{ color: '#222', display: 'block', marginBottom: '.1rem' }}>Cliente</strong>
                {alias}
              </div>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px dashed #bbb', margin: '.6rem 0' }} />

          {/* Items */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.76rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: '.65rem', color: '#888', fontWeight: 700, padding: '.15rem 0', textTransform: 'uppercase', letterSpacing: '.04em', width: 24 }}>#</th>
                <th style={{ textAlign: 'left', fontSize: '.65rem', color: '#888', fontWeight: 700, padding: '.15rem 0', textTransform: 'uppercase', letterSpacing: '.04em' }}>Producto</th>
                <th style={{ textAlign: 'right', fontSize: '.65rem', color: '#888', fontWeight: 700, padding: '.15rem 0', textTransform: 'uppercase', letterSpacing: '.04em', width: 65 }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).map((item, i) => (
                <tr key={i}>
                  <td style={{ color: '#888', padding: '.22rem 0', verticalAlign: 'top' }}>{item.cantidad}×</td>
                  <td style={{ fontWeight: 600, padding: '.22rem 0', color: '#222', verticalAlign: 'top' }}>{item.nombre}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, padding: '.22rem 0', color: '#222', verticalAlign: 'top' }}>${parseFloat(item.subtotal || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <hr style={{ border: 'none', borderTop: '2px solid #222', margin: '.6rem 0' }} />

          {/* Totals */}
          <div style={{ fontSize: '.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0', color: '#333' }}>
              <span>Subtotal</span>
              <span>${parseFloat(subtotal_sesion || total_pagado || 0).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.5rem 0 .2rem', marginTop: '.25rem', fontSize: '1.1rem', fontWeight: 800, color: '#222', borderTop: '2px solid #222' }}>
              <span>TOTAL</span>
              <span>${parseFloat(total_pagado || 0).toFixed(2)}</span>
            </div>
          </div>

          {/* Payment method */}
          {metodo && (
            <div style={{ background: '#f7f7f7', borderRadius: 4, padding: '.65rem .75rem', fontSize: '.73rem', marginTop: '.5rem' }}>
              <div style={{ fontWeight: 700, fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: '.3rem' }}>Método de pago</div>
              <div style={{ color: '#333' }}>
                <i className="bi bi-check-circle-fill me-1" style={{ color: '#3D6B4F' }} />
                {metodo}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '.75rem 1.1rem 1.2rem', fontSize: '.67rem', color: '#aaa', lineHeight: 1.8, borderTop: '1px dashed #ddd' }}>
          <strong style={{ color: '#888' }}>¡Gracias por su visita!</strong><br />
          Regresen pronto <i className="bi bi-cup-hot-fill" /><br />
          {ahora.toLocaleString('es-MX')}
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}
