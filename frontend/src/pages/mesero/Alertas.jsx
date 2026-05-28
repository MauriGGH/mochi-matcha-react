/**
 * Alertas.jsx — bandeja del mesero con alertas de mesa y solicitudes de cobro.
 * Polling 3s a /mesas/alertas y /mesas/solicitudes. Permite atender alertas
 * directamente y navegar a /mesero/pago para cobrar una solicitud.
 *
 * Ruta: /mesero/alertas. Exporta: default Alertas().
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';

/** Vista de alertas + solicitudes de cobro del mesero. Sin props. */
export default function Alertas() {
  const navigate = useNavigate();
  const [alertas, setAlertas] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);

  // Carga paralela de alertas y solicitudes. Silenciosa: si una falla,
  // el siguiente tick lo reintenta.
  const cargar = useCallback(async () => {
    try {
      const [ra, rs] = await Promise.all([
        api.get('/mesas/alertas'),
        api.get('/mesas/solicitudes'),
      ]);
      setAlertas(ra.data || []);
      setSolicitudes(rs.data || []);
    } catch { /* ignore */ }
  }, []);

  // Polling cada 3s mientras la vista esté montada.
  useEffect(() => {
    cargar();
    const id = setInterval(cargar, 3000);
    return () => clearInterval(id);
  }, [cargar]);

  // Atiende una alerta y la quita optimistamente del listado local
  // (el siguiente poll re-sincronizará si el servidor falla).
  const atenderAlerta = async (mesaId, alertaId) => {
    await api.put(`/mesas/${mesaId}/alerta/${alertaId}/atender`);
    setAlertas(prev => prev.filter(a => a.id !== alertaId));
  };

  const sidebarNav = (
    <>
      <a onClick={() => navigate('/mesero')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Mesas</a>
      <a onClick={() => navigate('/mesero/listos')} style={{ cursor: 'pointer' }}><i className="bi bi-bag-check-fill" /> Pedidos listos</a>
      <a className="active"><i className="bi bi-bell-fill" /> Alertas</a>
    </>
  );

  return (
    <StaffLayout title="Alertas" sidebarNav={sidebarNav}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="fw-bold mb-0"><i className="bi bi-bell-fill me-2" style={{ color: 'var(--mm-danger)' }} />Alertas y solicitudes</h5>
        <button className="btn btn-sm" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => navigate('/mesero')}>
          <i className="bi bi-arrow-left me-1" />Volver al mapa
        </button>
      </div>

      {/* Solicitudes de atención */}
      <h6 className="fw-bold mb-2" style={{ fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--mm-text-muted)' }}>
        <i className="bi bi-hand-raised-fill me-1" style={{ color: 'var(--mm-danger)' }} />Solicitudes de atención
      </h6>
      {alertas.length > 0 ? (
        <div className="row g-2 mb-4">
          {alertas.map(a => (
            <div key={a.id} className="col-md-6 col-lg-4">
              <div style={{ border: '2px solid var(--mm-danger)', borderRadius: 'var(--radius-md)', background: 'var(--mm-white)', padding: '1rem' }}>
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <div>
                    <span className="fw-bold" style={{ fontSize: '.95rem' }}>Mesa {a.mesa?.numero_mesa}</span>
                    {a.sesion && <span style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', marginLeft: '.4rem' }}>{a.sesion.alias}</span>}
                  </div>
                  <span style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)' }}>{new Date(a.fecha_creacion).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {a.mensaje && <p style={{ fontSize: '.85rem', margin: '.25rem 0 .75rem', color: '#444' }}>{a.mensaje}</p>}
                <button
                  className="btn btn-sm w-100 fw-semibold"
                  style={{ background: 'var(--mm-danger)', color: '#fff', borderRadius: 'var(--radius-pill)' }}
                  onClick={() => atenderAlerta(a.mesa?.id, a.id)}
                >
                  <i className="bi bi-check2 me-1" />Marcar como atendida
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 mb-4" style={{ background: 'var(--mm-cream)', borderRadius: 'var(--radius-md)', color: 'var(--mm-text-muted)' }}>
          <i className="bi bi-hand-thumbs-up-fill" style={{ fontSize: '2rem', color: 'var(--mm-green)' }} />
          <p style={{ fontSize: '.85rem', margin: '.5rem 0 0' }}>Sin solicitudes de atención pendientes</p>
        </div>
      )}

      {/* Solicitudes de cobro */}
      <h6 className="fw-bold mb-2" style={{ fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--mm-text-muted)' }}>
        <i className="bi bi-receipt me-1" style={{ color: 'var(--mm-gold)' }} />Solicitudes de cobro
      </h6>
      {solicitudes.length > 0 ? (
        <div className="row g-2">
          {solicitudes.map(sol => (
            <div key={sol.id} className="col-md-6 col-lg-4">
              <div style={{ border: '2px solid var(--mm-gold)', borderRadius: 'var(--radius-md)', background: 'var(--mm-white)', padding: '1rem' }}>
                <div className="d-flex justify-content-between align-items-start mb-1">
                  <span className="fw-bold" style={{ fontSize: '.95rem' }}>Mesa {sol.mesa?.numero_mesa}</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--mm-text-muted)' }}>{new Date(sol.fecha_hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', marginBottom: '.5rem' }}>
                  {sol.tipo === 'grupal' ? <><i className="bi bi-people-fill me-1" />Toda la mesa</> : sol.sesion?.alias}
                </div>
                <div style={{ fontSize: '.85rem', marginBottom: '.75rem' }}>
                  <span style={{ background: 'var(--mm-cream-dark)', color: '#333', borderRadius: 99, padding: '.2rem .6rem', fontSize: '.75rem' }}>{sol.tipo}</span>
                  {sol.metodo_pref && (
                    <span style={{ background: '#e8f5e9', color: '#2e7d32', borderRadius: 99, padding: '.2rem .6rem', fontSize: '.75rem', marginLeft: '.35rem', fontWeight: 600 }}>{sol.metodo_pref}</span>
                  )}
                  <span className="fw-bold ms-2">${parseFloat(sol.tipo === 'grupal' ? sol.total_mesa : sol.total_individual || 0).toFixed(2)}</span>
                </div>
                <button
                  className="btn btn-sm w-100 fw-semibold"
                  style={{ background: 'var(--mm-gold)', color: '#fff', borderRadius: 'var(--radius-pill)' }}
                  onClick={() => navigate(`/mesero/pago?mesa_id=${sol.id_mesa}&sol_id=${sol.id}`)}
                >
                  <i className="bi bi-cash-coin me-1" />Ir a cobrar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4" style={{ background: 'var(--mm-cream)', borderRadius: 'var(--radius-md)', color: 'var(--mm-text-muted)' }}>
          <i className="bi bi-bell-fill" style={{ fontSize: '2rem', color: 'var(--mm-text-muted)' }} />
          <p style={{ fontSize: '.85rem', margin: '.5rem 0 0' }}>Sin solicitudes de cobro pendientes</p>
        </div>
      )}
    </StaffLayout>
  );
}
