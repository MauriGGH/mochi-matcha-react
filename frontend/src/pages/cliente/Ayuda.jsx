/**
 * Ayuda.jsx — pantalla cliente para llamar al mesero.
 * Ofrece 3 alertas rápidas (servilletas/agua/asistencia) y un mensaje libre.
 * Ruta: /menu/:id_sesion/ayuda. Llega aquí desde el bottom nav del ClienteLayout.
 *
 * Exporta: default Ayuda().
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';
import ClienteLayout from '../../components/ClienteLayout';
import CharCounter from '../../components/forms/CharCounter';

/** Pantalla "Llama al mesero" del cliente. Sin props (toma id_sesion de la URL). */
export default function Ayuda() {
  const { id_sesion } = useParams();
  const token_sesion = sessionStorage.getItem('token_sesion');
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);

  const carrito = JSON.parse(sessionStorage.getItem('carrito') || '[]');
  const countCarrito = carrito.reduce((s, i) => s + i.cantidad, 0);

  // Envía la alerta al backend; solo incluye `mensaje` cuando es alerta tipo 'ayuda'
  // (las rápidas servilletas/agua usan plantillas server-side).
  const llamarMesero = async (tipo) => {
    if (!token_sesion) return;
    setEnviando(true); setOk(false);
    try {
      await api.post('/cliente/alerta', { token_sesion, tipo, mensaje: tipo === 'ayuda' ? mensaje : '' });
      setOk(true);
      setMensaje('');
      setTimeout(() => setOk(false), 3000);
    } catch { /* el banner OK no aparece y el botón se reactiva — feedback mínimo intencional */ }
    finally { setEnviando(false); }
  };

  return (
    <ClienteLayout idSesion={id_sesion} carritoCount={countCarrito}>
      <div style={{ background: 'var(--mm-white)', borderBottom: '1px solid var(--mm-border)', padding: '1rem 1.25rem' }}>
        <h6 className="mb-0 fw-bold"><i className="bi bi-bell-fill me-2" style={{ color: 'var(--mm-gold)' }} />Llama al mesero</h6>
      </div>

      <div style={{ padding: '1rem' }}>
        {ok && (
          <div style={{ background: 'var(--mm-green-pale)', color: 'var(--mm-success)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1rem', fontWeight: 600, fontSize: '.875rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <i className="bi bi-check-circle-fill" />Mesero notificado
          </div>
        )}

        <p style={{ fontSize: '.875rem', color: 'var(--mm-text-muted)', marginBottom: '1.5rem' }}>
          Selecciona el tipo de ayuda que necesitas y el mesero llegará en breve.
        </p>

        {/* Quick alerts */}
        <div className="d-flex flex-column gap-2 mb-4">
          {[
            { tipo: 'servilletas', icon: 'bi-square', label: 'Servilletas / Utensilios', desc: 'Necesito servilletas o cubiertos' },
            { tipo: 'agua', icon: 'bi-droplet-fill', label: 'Agua', desc: 'Por favor trae agua' },
            { tipo: 'ayuda', icon: 'bi-question-circle-fill', label: 'Asistencia general', desc: 'El mesero viene a atenderte' },
          ].map(a => (
            <button
              key={a.tipo}
              onClick={() => llamarMesero(a.tipo)}
              disabled={enviando}
              style={{
                background: 'var(--mm-white)', border: '1.5px solid var(--mm-border)',
                borderRadius: 'var(--radius-md)', padding: '1rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '.75rem', textAlign: 'left', transition: 'all .15s'
              }}
            >
              <i className={`bi ${a.icon}`} style={{ fontSize: '1.25rem', color: 'var(--mm-green)', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{a.label}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)' }}>{a.desc}</div>
              </div>
              <i className="bi bi-chevron-right ms-auto" style={{ color: 'var(--mm-text-muted)', fontSize: '.875rem' }} />
            </button>
          ))}
        </div>

        {/* Message */}
        <div style={{ background: 'var(--mm-white)', border: '1.5px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem' }}>
          <label style={{ fontWeight: 600, fontSize: '.875rem', display: 'block', marginBottom: '.5rem' }}>Mensaje personalizado</label>
          <textarea
            className="form-control"
            rows={3}
            placeholder="¿En qué podemos ayudarte?"
            value={mensaje}
            onChange={e => setMensaje(e.target.value)}
            maxLength={200}
            style={{ borderColor: 'var(--mm-border)', borderRadius: 'var(--radius-sm)', resize: 'none', fontSize: '.875rem' }}
          />
          <CharCounter value={mensaje} max={200} />
          <div className="mb-3" />
          <button
            className="btn btn-primary w-100 py-2 fw-bold"
            onClick={() => llamarMesero('ayuda')}
            disabled={enviando || !mensaje.trim()}
          >
            {enviando ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-send me-2" />}
            Enviar mensaje
          </button>
        </div>
      </div>
    </ClienteLayout>
  );
}
