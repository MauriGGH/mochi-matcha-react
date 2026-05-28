/**
 * MeseroPanel.jsx — panel simplificado del mesero (vista legacy/básica).
 * Muestra todas las mesas como cards Bootstrap con badges de estado y
 * permite atender alertas y cerrar mesas. MapaMesas.jsx es la vista principal
 * más completa; este componente queda como fallback minimal.
 *
 * Exporta: default MeseroPanel().
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const POLL_MS = 3000;

/** Panel básico del mesero (vista legacy). Sin props. */
export default function MeseroPanel() {
  const { empleado, logout } = useAuth();
  const [mesas, setMesas] = useState([]);

  // Carga listado de mesas (mismo endpoint que MapaMesas).
  const cargarMesas = useCallback(async () => {
    const { data } = await api.get('/mesas');
    setMesas(data);
  }, []);

  // Polling cada POLL_MS.
  useEffect(() => {
    cargarMesas();
    const id = setInterval(cargarMesas, POLL_MS);
    return () => clearInterval(id);
  }, [cargarMesas]);

  // Cierra la mesa y recarga listado (sin confirm — vista legacy).
  const cerrarMesa = async (id) => {
    await api.put(`/mesas/${id}/cerrar`);
    cargarMesas();
  };

  // Marca alerta como atendida y refresca.
  const atenderAlerta = async (mesaId, alertaId) => {
    await api.put(`/mesas/${mesaId}/alerta/${alertaId}/atender`);
    cargarMesas();
  };

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0">Panel Mesero — {empleado?.nombre}</h5>
        <button className="btn btn-outline-secondary btn-sm" onClick={logout}>
          <i className="bi bi-box-arrow-right me-1" />Salir
        </button>
      </div>

      <div className="row g-3">
        {mesas.map((mesa) => (
          <div key={mesa.id} className="col-6 col-md-4 col-lg-3">
            <div className={`card h-100 border-${mesa.estado === 'ocupada' ? 'danger' : 'success'}`}>
              <div className="card-body">
                <h6 className="card-title">Mesa {mesa.numero_mesa}</h6>
                <span className={`badge bg-${mesa.estado === 'ocupada' ? 'danger' : 'success'} mb-2`}>
                  {mesa.estado}
                </span>
                {mesa.ubicacion && <p className="small text-muted mb-1">{mesa.ubicacion.nombre}</p>}

                {mesa.alertas?.map((a) => (
                  <div key={a.id} className="alert alert-warning py-1 px-2 mb-1 d-flex justify-content-between align-items-center">
                    <small><i className="bi bi-bell-fill me-1" />{a.tipo}</small>
                    <button
                      className="btn btn-sm btn-warning py-0 px-1"
                      onClick={() => atenderAlerta(mesa.id, a.id)}
                    >
                      <i className="bi bi-check" />
                    </button>
                  </div>
                ))}

                {mesa.estado === 'ocupada' && (
                  <button
                    className="btn btn-outline-danger btn-sm w-100 mt-2"
                    onClick={() => cerrarMesa(mesa.id)}
                  >
                    Cerrar mesa
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
