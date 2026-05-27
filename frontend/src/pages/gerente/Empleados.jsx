/**
 * CRUD de empleados del staff (mesero/cocina/gerente/admin).
 *
 * - Lista activos/inactivos con avatares y color por rol.
 * - Permite crear, editar, cambiar contraseña (opcional al editar) y
 *   activar/desactivar (soft-delete). Los inactivos no pueden iniciar sesión.
 * - Toda escritura va contra /gerente/empleados y refresca la tabla con cargar().
 *
 * Export único: <Empleados /> — montado en /gerente/empleados.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import StaffLayout from '../../components/StaffLayout';
import { useToast } from '../../components/Toast';
import { usePageTitle } from '../../hooks/usePageTitle';
import CharCounter from '../../components/forms/CharCounter';

const ROLES = [
  { value: 'mesero',  label: 'Mesero'  },
  { value: 'cocina',  label: 'Cocina'  },
  { value: 'gerente', label: 'Gerente' },
  { value: 'admin',   label: 'Admin'   },
];

const ROL_LABEL = { mesero: 'Mesero', cocina: 'Cocina', gerente: 'Gerente', admin: 'Admin' };

const rolColor = {
  gerente: { bg: 'var(--mm-gold-pale)',  color: 'var(--mm-gold)'   },
  admin:   { bg: 'var(--mm-gold-pale)',  color: 'var(--mm-gold)'   },
  cajero:  { bg: 'var(--mm-gold-pale)',  color: 'var(--mm-gold)'   },
  cocina:  { bg: '#FEF3E7',             color: '#e67e22'           },
  mesero:  { bg: 'var(--mm-green-pale)', color: 'var(--mm-green)'  },
};
const avatarBg = { gerente: 'var(--mm-gold)', admin: 'var(--mm-gold)', cajero: 'var(--mm-gold)', cocina: '#e67e22', mesero: 'var(--mm-green)' };

function initials(nombre) {
  if (!nombre) return '??';
  const parts = nombre.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return nombre.slice(0, 2).toUpperCase();
}

function fmtFecha(str) {
  if (!str) return null;
  return new Date(str).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Página principal de gestión de empleados.
 * @returns {JSX.Element}
 */
export default function Empleados() {
  usePageTitle('Empleados');
  const navigate = useNavigate();
  const toast = useToast();
  const [empleados, setEmpleados] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nombre: '', usuario: '', password: '', rol: 'mesero' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');

  const cargar = async () => {
    setLoadError(false);
    try {
      const { data } = await api.get('/gerente/empleados');
      setEmpleados(data);
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => { cargar(); }, []);

  const activos   = empleados.filter(e => e.activo);
  const inactivos = empleados.filter(e => !e.activo);

  const abrirNuevo = () => {
    setForm({ nombre: '', usuario: '', password: '', rol: 'mesero' });
    setShowPass(false); setError(''); setModal('nuevo');
  };
  const abrirEditar = (emp) => {
    setForm({ nombre: emp.nombre, usuario: emp.usuario, password: '', rol: emp.rol });
    setShowPass(false); setError(''); setModal(emp);
  };

  const validarForm = () => {
    const nombre = form.nombre.trim();
    const usuario = form.usuario.trim();
    if (!nombre) return 'El nombre completo es requerido';
    if (nombre.length < 3) return 'El nombre debe tener al menos 3 caracteres';
    if (nombre.length > 100) return 'El nombre no puede superar 100 caracteres';
    if (modal === 'nuevo') {
      if (!usuario) return 'El usuario es requerido';
      if (usuario.length < 3) return 'El usuario debe tener al menos 3 caracteres';
      if (usuario.length > 50) return 'El usuario no puede superar 50 caracteres';
      if (!/^[a-zA-Z0-9._-]+$/.test(usuario)) return 'El usuario solo puede contener letras, números, puntos, guiones y guiones bajos';
      if (!form.password) return 'La contraseña es requerida';
      if (form.password.length < 6) return 'La contraseña debe tener al menos 6 caracteres';
    }
    if (form.password && form.password.length < 6) return 'La contraseña debe tener al menos 6 caracteres';
    return null;
  };

  const guardar = async (e) => {
    e.preventDefault();
    const validationError = validarForm();
    if (validationError) { setError(validationError); return; }
    setLoading(true); setError('');
    try {
      if (modal === 'nuevo') {
        await api.post('/gerente/empleados', { ...form, nombre: form.nombre.trim(), usuario: form.usuario.trim() });
        toast.success(`Empleado "${form.nombre}" creado`);
      } else {
        const body = { nombre: form.nombre.trim(), rol: form.rol };
        if (form.password) body.password = form.password;
        await api.put(`/gerente/empleados/${modal.id_empleado}`, body);
        toast.success(`Empleado "${form.nombre}" actualizado`);
      }
      setModal(null); cargar();
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al guardar';
      setError(msg);
      toast.error(msg);
    } finally { setLoading(false); }
  };

  const toggleActivo = async (id, activo) => {
    const ok = await toast.confirm({
      title: activo ? 'Desactivar empleado' : 'Reactivar empleado',
      message: activo
        ? '¿Desactivar este empleado? Ya no podrá iniciar sesión.'
        : '¿Reactivar este empleado? Podrá volver a iniciar sesión.',
      confirmText: activo ? 'Desactivar' : 'Reactivar',
      tone: activo ? 'danger' : 'success',
    });
    if (!ok) return;
    try {
      await api.put(`/gerente/empleados/${id}/toggle`);
      cargar();
      toast.success(activo ? 'Empleado desactivado' : 'Empleado reactivado');
    } catch {
      toast.error('No se pudo actualizar el empleado');
    }
  };

  const sidebarNav = (
    <>
      <a onClick={() => navigate('/gerente')} style={{ cursor: 'pointer' }}><i className="bi bi-grid-fill" /> Floor Plan</a>
      <div className="nav-section-label">Gestión</div>
      <a onClick={() => navigate('/gerente/menu')} style={{ cursor: 'pointer' }}><i className="bi bi-basket-fill" /> Gestión de Menú</a>
      <div className="nav-section-label">Reportes</div>
      <a onClick={() => navigate('/gerente/reportes')} style={{ cursor: 'pointer' }}><i className="bi bi-bar-chart-fill" /> Reportes</a>
      <div className="nav-section-label">Admin</div>
      <a className="active"><i className="bi bi-people-fill" /> Empleados</a>
      <a onClick={() => navigate('/gerente/configuracion')} style={{ cursor: 'pointer' }}><i className="bi bi-gear-fill" /> Configuración</a>
    </>
  );

  return (
    <StaffLayout title="Empleados" sidebarNav={sidebarNav}>
      {loadError && (
        <div className="alert alert-danger d-flex align-items-center gap-2 mb-4" role="alert">
          <i className="bi bi-exclamation-circle-fill" />
          No se pudo cargar la lista de empleados.
          <button className="btn btn-sm btn-outline-danger ms-auto" onClick={cargar}>Reintentar</button>
        </div>
      )}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h5 className="fw-bold mb-0">Empleados</h5>
          <p style={{ fontSize: '.8rem', color: 'var(--mm-text-muted)', margin: 0 }}>{activos.length} activos · {inactivos.length} inactivos</p>
        </div>
        <button className="btn btn-primary rounded-pill px-3" onClick={abrirNuevo}>
          <i className="bi bi-person-plus me-1" />Nuevo empleado
        </button>
      </div>

      {activos.length > 0 && (
        <>
          <div style={{ fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--mm-text-muted)', marginBottom: '.4rem' }}>Activos ({activos.length})</div>
          <div className="mb-4">
            {activos.map(emp => (
              <div key={emp.id_empleado} style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1rem 1.25rem', marginBottom: '.5rem', background: 'var(--mm-white)' }} className="d-flex align-items-center gap-3">
                <div style={{ width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1rem', color: '#fff', flexShrink: 0, background: avatarBg[emp.rol] || 'var(--mm-green)' }}>
                  {initials(emp.nombre)}
                </div>
                <div className="flex-grow-1">
                  <div style={{ fontWeight: 600, fontSize: '.95rem' }}>{emp.nombre}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>
                    @{emp.usuario}
                    {emp.last_login && ` · Desde ${fmtFecha(emp.last_login)}`}
                  </div>
                </div>
                <span style={{ background: (rolColor[emp.rol] || {}).bg || 'var(--mm-cream)', color: (rolColor[emp.rol] || {}).color || 'var(--mm-text-muted)', borderRadius: 99, padding: '.2rem .75rem', fontSize: '.75rem', fontWeight: 700 }}>
                  {ROL_LABEL[emp.rol] || emp.rol}
                </span>
                <div className="d-flex gap-1">
                  <button className="btn btn-link btn-sm p-1" onClick={() => abrirEditar(emp)} title="Editar">
                    <i className="bi bi-pencil" style={{ color: 'var(--mm-text-muted)' }} />
                  </button>
                  <button className="btn btn-link btn-sm p-1" onClick={() => toggleActivo(emp.id_empleado, true)} title="Desactivar">
                    <i className="bi bi-person-x" style={{ color: 'var(--mm-danger)' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {inactivos.length > 0 && (
        <>
          <div style={{ fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--mm-text-muted)', marginBottom: '.4rem' }}>Inactivos ({inactivos.length})</div>
          <div>
            {inactivos.map(emp => (
              <div key={emp.id_empleado} style={{ border: '1px solid var(--mm-border)', borderRadius: 'var(--radius-md)', padding: '1rem 1.25rem', marginBottom: '.5rem', background: 'var(--mm-white)', opacity: .6 }} className="d-flex align-items-center gap-3">
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1rem', color: '#fff', flexShrink: 0 }}>
                  {initials(emp.nombre)}
                </div>
                <div className="flex-grow-1">
                  <div style={{ fontWeight: 600, fontSize: '.95rem', color: 'var(--mm-text-muted)' }}>{emp.nombre}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--mm-text-muted)' }}>@{emp.usuario}</div>
                </div>
                <span style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text-muted)', borderRadius: 99, padding: '.2rem .75rem', fontSize: '.75rem', fontWeight: 700 }}>{ROL_LABEL[emp.rol] || emp.rol}</span>
                <button className="btn btn-link btn-sm p-1" onClick={() => toggleActivo(emp.id_empleado, false)} title="Reactivar">
                  <i className="bi bi-person-check" style={{ color: 'var(--mm-green)' }} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal */}
      {modal !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--mm-white)', borderRadius: 'var(--radius-lg)', padding: '2rem', width: '100%', maxWidth: 440 }}>
            <div className="d-flex align-items-center justify-content-between mb-4">
              <h5 className="fw-bold mb-0">{modal === 'nuevo' ? 'Nuevo empleado' : 'Editar empleado'}</h5>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--mm-text-muted)' }}>×</button>
            </div>
            <form onSubmit={guardar}>
              <div className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Nombre completo</label>
                <input className="form-control" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} required maxLength={100} style={{ borderColor: 'var(--mm-border)' }} />
                <CharCounter value={form.nombre} max={100} />
              </div>
              {modal === 'nuevo' && (
                <div className="mb-3">
                  <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Usuario</label>
                  <input className="form-control" value={form.usuario} onChange={e => setForm(p => ({ ...p, usuario: e.target.value }))} required maxLength={50} style={{ borderColor: 'var(--mm-border)' }} />
                  <CharCounter value={form.usuario} max={50} />
                </div>
              )}
              <div className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>
                  Contraseña{modal === 'nuevo' ? <span className="text-danger"> *</span> : <span style={{ fontSize: '.75rem', color: 'var(--mm-text-muted)', fontWeight: 400 }}> (vacío = sin cambio)</span>}
                </label>
                <div className="input-group">
                  <input type={showPass ? 'text' : 'password'} className="form-control" value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    required={modal === 'nuevo'} style={{ borderColor: 'var(--mm-border)', borderRight: 'none' }}
                    placeholder="••••••••" autoComplete="new-password" />
                  <button type="button" className="input-group-text btn" style={{ background: 'var(--mm-cream)', borderColor: 'var(--mm-border)', cursor: 'pointer' }}
                    onClick={() => setShowPass(v => !v)}>
                    <i className={`bi bi-${showPass ? 'eye-slash' : 'eye'}`} />
                  </button>
                </div>
              </div>
              <div className="mb-4">
                <label className="form-label fw-semibold" style={{ fontSize: '.875rem' }}>Rol <span className="text-danger">*</span></label>
                <select className="form-select" value={form.rol} onChange={e => setForm(p => ({ ...p, rol: e.target.value }))} style={{ borderColor: 'var(--mm-border)' }}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              {error && <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: '.875rem' }}>{error}</div>}
              <div className="d-flex gap-2">
                <button type="button" className="btn flex-grow-1 py-2" style={{ background: 'var(--mm-cream-dark)', color: 'var(--mm-text-muted)' }} onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary flex-grow-1 py-2" disabled={loading}>
                  {loading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </StaffLayout>
  );
}
