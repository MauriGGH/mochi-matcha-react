/**
 * PedidosListos.jsx — bandeja del mesero con pedidos en estado 'listo'.
 * Lista pedidos cuya cocina+bar terminaron y esperan ser llevados a la mesa.
 * Polling 3s + timer en vivo "hace N min". El botón "entregado" marca el
 * pedido como 'entregado' (POST /cocina/marcar-entregado).
 *
 * Ruta: /mesero/listos. Exporta: default PedidosListos().
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import { useToast } from '../../components/Toast';

/** Bandeja de pedidos listos para entregar (mesero). Sin props. */
export default function PedidosListos() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pedidos, setPedidos]   = useState([]);
  const [now, setNow]           = useState(Date.now());
  const [entregando, setEntregando] = useState(null);

  // fix#1 Bug A: usa endpoint con rol 'mesero' (antes los 2 fetchs a /cocina/pedidos
  // requerían rol 'cocina' y devolvían 403 para meseros puros).
  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get('/mesero/pedidos-listos');
      const arr = data?.pedidos || [];
      setPedidos([...arr].sort((a, b) => new Date(a.fecha) - new Date(b.fecha)));
    } catch { /* network hiccup */ }
  }, []);

  // Doble interval: cargar() refresca la lista cada 3s, `now` recalcula los
  // minutos transcurridos cada 1s (badge "hace N min" siempre fresco).
  useEffect(() => {
    cargar();
    const id = setInterval(cargar, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [cargar]);

  // Marca el pedido como entregado y lo quita optimistamente del listado.
  const entregar = async (pedidoId) => {
    setEntregando(pedidoId);
    try {
      await api.post('/cocina/marcar-entregado', { pedido_id: pedidoId });
      setPedidos((prev) => prev.filter((p) => p.id !== pedidoId));
      toast.success(`Pedido #${pedidoId} entregado`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al marcar como entregado');
    } finally { setEntregando(null); }
  };

  const sidebarNav = (
    <>
      <a onClick={() => navigate('/mesero')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Mesas</a>
      <a className="active"><i className="bi bi-bag-check-fill" /> Pedidos listos</a>
      <a onClick={() => navigate('/mesero/alertas')} style={{ cursor: 'pointer' }}><i className="bi bi-bell-fill" /> Alertas</a>
    </>
  );

  return (
    <StaffLayout title="Pedidos Listos" sidebarNav={sidebarNav}>
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div>
          <h5 className="fw-bold mb-0">Pedidos listos para entregar</h5>
          <p style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)', margin: 0 }}>
            {pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'} esperando entrega
          </p>
        </div>
        <button className="btn btn-sm" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => navigate('/mesero')}>
          <i className="bi bi-arrow-left me-1" />Volver al mapa
        </button>
      </div>

      {pedidos.length === 0 ? (
        <div className="text-center py-5" style={{ color: 'var(--mm-text-muted)' }}>
          <i className="bi bi-check-circle-fill" style={{ fontSize: '3rem', display: 'block', marginBottom: '1rem', color: 'var(--mm-green)' }} />
          <h6 className="fw-bold">No hay pedidos listos por entregar</h6>
          <p style={{ fontSize: '.875rem' }}>Todos los pedidos han sido entregados</p>
          <button className="btn btn-primary mt-2" onClick={() => navigate('/mesero')}>Ver mapa de mesas</button>
        </div>
      ) : (
        <div className="row g-3">
          {pedidos.map((pedido) => {
            const elapsed = now - new Date(pedido.fecha).getTime();
            const minutos = Math.floor(elapsed / 60000);
            return (
              <div key={pedido.id} className="col-md-6 col-lg-4">
                <div style={{ border: '2px solid var(--mm-green)', borderRadius: 'var(--radius-md)', background: 'var(--mm-white)', padding: '1.25rem', height: '100%' }}>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div>
                      <span className="fw-bold" style={{ fontSize: '1rem' }}>Mesa {pedido.mesa}</span>
                      <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', marginLeft: '.5rem' }}>· {pedido.alias}</span>
                    </div>
                    <span style={{ background: '#EAFAF1', color: '#1E8449', borderRadius: 99, padding: '.2rem .7rem', fontSize: '.72rem', fontWeight: 700 }}>
                      <i className="bi bi-check-circle-fill me-1" />Listo
                    </span>
                  </div>
                  <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)', marginBottom: '.65rem', fontFamily: 'var(--font-mono)' }}>
                    Pedido #{pedido.id} · hace {minutos} min
                  </div>
                  <div className="mb-3">
                    {(pedido.items || []).map((d, idx) => (
                      <div key={idx} style={{ fontSize: '.85rem', padding: '.25rem 0', borderBottom: '1px solid var(--mm-border)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{d.cantidad}× {d.nombre}</span>
                        {d.notas && <span style={{ color: 'var(--mm-danger)', fontSize: '.7rem' }}>{d.notas}</span>}
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-primary w-100 py-2 fw-bold"
                    onClick={() => entregar(pedido.id)}
                    disabled={entregando === pedido.id}
                  >
                    {entregando === pedido.id
                      ? <span className="spinner-border spinner-border-sm me-2" />
                      : <i className="bi bi-check2 me-2" />}
                    Marcar como entregado
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </StaffLayout>
  );
}
