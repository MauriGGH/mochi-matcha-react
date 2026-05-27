/**
 * CRUD de mesas físicas del local.
 *
 * - Lista todas las mesas con número, capacidad, ubicación y mesero asignado.
 * - Modal de alta/edición + modal de visualización de QR (descarga PNG).
 * - El código QR se renderiza vía backend (services/qr.js) y se descarga
 *   como dataURL.
 * - Eliminación restringida: backend rechaza si la mesa tiene sesiones o
 *   pedidos asociados (FK RESTRICT).
 *
 * Export único: <Mesas /> — montado en /gerente/mesas.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import StaffLayout from '../../components/StaffLayout';
import { useToast } from '../../components/Toast';
import { numberInputHandlers } from '../../utils/numberInput';

/**
 * Página principal de gestión de mesas.
 * @returns {JSX.Element}
 */
export default function Mesas() {
  usePageTitle('Gestión de Mesas');
  const navigate = useNavigate();
  const toast = useToast();
  const [mesas, setMesas] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal CRUD
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    numero_mesa: '', capacidad: 4, id_ubicacion: '', id_mesero_asignado: '',
  });

  // Modal QR
  const [qrMesa, setQrMesa] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrUrl, setQrUrl] = useState('');

  const [error, setError] = useState('');

  const cargarTodo = async () => {
    setLoading(true);
    try {
      const [rm, ru, re] = await Promise.all([
        api.get('/gerente/mesas'),
        api.get('/gerente/ubicaciones'),
        api.get('/gerente/empleados'),
      ]);
      setMesas(rm.data || []);
      setUbicaciones(ru.data || []);
      setEmpleados((re.data || []).filter((e) => e.rol === 'mesero'));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { cargarTodo(); }, []);

  const abrirCrear = () => {
    setEditing(null);
    setForm({ numero_mesa: '', capacidad: 4, id_ubicacion: '', id_mesero_asignado: '' });
    setError('');
    setShowModal(true);
  };

  const abrirEditar = (mesa) => {
    setEditing(mesa);
    setForm({
      numero_mesa: mesa.numero_mesa,
      capacidad: mesa.capacidad,
      id_ubicacion: mesa.id_ubicacion || '',
      id_mesero_asignado: mesa.id_mesero_asignado || '',
    });
    setError('');
    setShowModal(true);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        numero_mesa: parseInt(form.numero_mesa, 10),
        capacidad: parseInt(form.capacidad, 10),
        id_ubicacion: form.id_ubicacion || null,
        id_mesero_asignado: form.id_mesero_asignado || null,
      };
      if (editing) {
        await api.put(`/gerente/mesas/${editing.id}`, payload);
      } else {
        await api.post('/gerente/mesas', payload);
      }
      setShowModal(false);
      cargarTodo();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    }
  };

  const eliminar = async (mesa) => {
    const ok = await toast.confirm({
      title: 'Eliminar mesa',
      message: `¿Eliminar Mesa ${mesa.numero_mesa}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/gerente/mesas/${mesa.id}`);
      cargarTodo();
      toast.success(`Mesa ${mesa.numero_mesa} eliminada`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo eliminar (mesa con datos asociados).');
    }
  };

  const verQR = async (mesa) => {
    try {
      const { data } = await api.get(`/gerente/mesas/${mesa.id}/qr?format=dataurl`);
      setQrMesa(mesa);
      setQrDataUrl(data.qr_data_url);
      setQrUrl(data.url);
    } catch {
      toast.error('No se pudo generar el QR');
    }
  };

  const descargarQR = (mesa) => {
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `qr-mesa-${mesa.numero_mesa}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const imprimirQR = () => {
    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) return;
    w.document.write(`
      <!doctype html>
      <html><head><title>QR Mesa ${qrMesa.numero_mesa}</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 2rem; }
        h2 { color: #3D6B4F; margin-bottom: .5rem; }
        .small { color: #666; font-size: .85rem; margin-bottom: 1.5rem; }
        img { max-width: 300px; height: auto; }
        .url { word-break: break-all; font-size: .7rem; color: #999; margin-top: 1rem; }
      </style></head>
      <body>
        <h2>Mochi Matcha · Mesa ${qrMesa.numero_mesa}</h2>
        <p class="small">Escanea para hacer tu pedido</p>
        <img src="${qrDataUrl}" alt="QR" />
        <p class="url">${qrUrl}</p>
        <script>setTimeout(() => window.print(), 200);</script>
      </body></html>
    `);
    w.document.close();
  };

  const regenerar = async (mesa) => {
    const ok = await toast.confirm({
      title: 'Regenerar QR',
      message: 'Esto invalidará el código QR anterior. Los QR impresos dejarán de funcionar. ¿Continuar?',
      confirmText: 'Regenerar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/gerente/mesas/${mesa.id}/regenerar-qr`);
      cargarTodo();
      if (qrMesa?.id === mesa.id) verQR(mesa);
      toast.success(`QR de Mesa ${mesa.numero_mesa} regenerado`);
    } catch {
      toast.error('No se pudo regenerar el QR');
    }
  };

  const sidebarNav = (
    <>
      <a onClick={() => navigate('/gerente')} style={{ cursor: 'pointer' }}><i className="bi bi-speedometer2 me-2" />Dashboard</a>
      <a onClick={() => navigate('/gerente/menu')} style={{ cursor: 'pointer' }}><i className="bi bi-egg me-2" />Menú</a>
      <a onClick={() => navigate('/gerente/empleados')} style={{ cursor: 'pointer' }}><i className="bi bi-people me-2" />Empleados</a>
      <a onClick={() => navigate('/gerente/mesas')} className="active" style={{ cursor: 'pointer' }}><i className="bi bi-table me-2" />Mesas</a>
      <a onClick={() => navigate('/gerente/reportes')} style={{ cursor: 'pointer' }}><i className="bi bi-bar-chart me-2" />Reportes</a>
      <a onClick={() => navigate('/gerente/configuracion')} style={{ cursor: 'pointer' }}><i className="bi bi-gear me-2" />Configuración</a>
    </>
  );

  return (
    <StaffLayout title="Mesas y QR" sidebarNav={sidebarNav}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="fw-bold mb-0">Mesas y códigos QR</h4>
        <button className="btn btn-primary" onClick={abrirCrear}>
          <i className="bi bi-plus-lg me-1" />Nueva mesa
        </button>
      </div>

      {loading ? (
        <div className="text-center py-5"><div className="spinner-border" /></div>
      ) : (
        <div className="row g-3">
          {mesas.map((m) => (
            <div key={m.id} className="col-md-6 col-lg-4">
              <div style={{ background: 'var(--mm-white)', border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem', height: '100%' }}>
                <div className="d-flex align-items-center justify-content-between">
                  <div>
                    <h5 className="fw-bold mb-0">Mesa {m.numero_mesa}</h5>
                    {m.ubicacion?.nombre && (
                      <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>{m.ubicacion.nombre}</div>
                    )}
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: m.estado === 'libre' ? 'var(--mm-green-pale)' : 'var(--mm-gold-pale)',
                      color: m.estado === 'libre' ? 'var(--mm-green)' : 'var(--mm-warning)',
                      fontSize: '.7rem',
                      fontWeight: 700,
                    }}
                  >
                    {m.estado}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem', fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
                  <div>👥 Capacidad: {m.capacidad}</div>
                  {m.mesero && <div>Mesero: {m.mesero.nombre.split(' ')[0]}</div>}
                </div>

                <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)', fontFamily: 'var(--font-mono)', background: 'var(--mm-cream)', padding: '.3rem .5rem', borderRadius: 4, wordBreak: 'break-all' }}>
                  {m.codigo_qr}
                </div>

                <div className="d-flex gap-2 mt-auto pt-2">
                  <button className="btn btn-sm" style={{ flex: 1, background: 'var(--mm-green)', color: '#fff' }} onClick={() => verQR(m)}>
                    <i className="bi bi-qr-code me-1" />Ver QR
                  </button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => abrirEditar(m)}>
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => eliminar(m)}>
                    <i className="bi bi-trash" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal CRUD */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 'var(--radius-lg)', padding: '2rem', width: '100%', maxWidth: 460 }}>
            <h5 className="fw-bold mb-3">{editing ? `Editar Mesa ${editing.numero_mesa}` : 'Nueva mesa'}</h5>
            <form onSubmit={guardar}>
              <div className="row g-3">
                <div className="col-6">
                  <label className="form-label fw-semibold" style={{ fontSize: '.82rem' }}>Número</label>
                  <input type="number" min="1" required className="form-control" value={form.numero_mesa} onChange={(e) => setForm({ ...form, numero_mesa: e.target.value })} disabled={!!editing} {...numberInputHandlers({ integerOnly: true })} />
                </div>
                <div className="col-6">
                  <label className="form-label fw-semibold" style={{ fontSize: '.82rem' }}>Capacidad</label>
                  <input type="number" min="1" max="20" required className="form-control" value={form.capacidad} onChange={(e) => setForm({ ...form, capacidad: e.target.value })} {...numberInputHandlers({ integerOnly: true })} />
                </div>
                <div className="col-12">
                  <label className="form-label fw-semibold" style={{ fontSize: '.82rem' }}>Ubicación</label>
                  <select className="form-select" value={form.id_ubicacion} onChange={(e) => setForm({ ...form, id_ubicacion: e.target.value })}>
                    <option value="">(sin ubicación)</option>
                    {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label fw-semibold" style={{ fontSize: '.82rem' }}>Mesero asignado</label>
                  <select className="form-select" value={form.id_mesero_asignado} onChange={(e) => setForm({ ...form, id_mesero_asignado: e.target.value })}>
                    <option value="">(sin asignar)</option>
                    {empleados.map((e) => <option key={e.id_empleado} value={e.id_empleado}>{e.nombre}</option>)}
                  </select>
                </div>
              </div>
              {error && <div className="alert alert-danger mt-3 py-2 px-3" style={{ fontSize: '.82rem' }}>{error}</div>}
              <div className="d-flex gap-2 mt-4">
                <button type="button" className="btn flex-grow-1" style={{ background: 'var(--mm-cream-dark)' }} onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary flex-grow-1">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal QR */}
      {qrMesa && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setQrMesa(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 'var(--radius-lg)', padding: '2rem', width: '100%', maxWidth: 420, textAlign: 'center' }}>
            <h4 className="fw-bold mb-1">Mesa {qrMesa.numero_mesa}</h4>
            <p style={{ fontSize: '.85rem', color: 'var(--mm-text-muted)', marginBottom: '1rem' }}>Los clientes escanean este código para hacer su pedido</p>
            {qrDataUrl && (
              <img src={qrDataUrl} alt={`QR Mesa ${qrMesa.numero_mesa}`} style={{ width: 280, height: 280, border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-sm)', padding: 8, background: '#fff' }} />
            )}
            <div style={{ fontSize: '.7rem', color: 'var(--mm-text-muted)', wordBreak: 'break-all', marginTop: '.75rem' }}>{qrUrl}</div>
            <div className="d-flex gap-2 mt-3 flex-wrap">
              <button className="btn btn-primary flex-grow-1" onClick={() => descargarQR(qrMesa)}>
                <i className="bi bi-download me-1" />Descargar PNG
              </button>
              <button className="btn flex-grow-1" style={{ background: 'var(--mm-cream-dark)' }} onClick={imprimirQR}>
                <i className="bi bi-printer me-1" />Imprimir
              </button>
            </div>
            <div className="d-flex gap-2 mt-2">
              <button className="btn btn-sm btn-outline-warning flex-grow-1" onClick={() => regenerar(qrMesa)}>
                <i className="bi bi-arrow-clockwise me-1" />Regenerar código
              </button>
              <button className="btn btn-sm btn-outline-secondary flex-grow-1" onClick={() => setQrMesa(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </StaffLayout>
  );
}
