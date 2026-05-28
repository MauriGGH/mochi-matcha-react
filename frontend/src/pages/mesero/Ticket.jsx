/**
 * Ticket.jsx — comprobante de pago/cobro generado por el mesero.
 * Renderiza el ticket completo (header restaurante, meta, items con
 * modificadores/notas/promos, totales, método de pago) y ofrece imprimir
 * o descargar PDF. Se llega aquí tras confirmar un cobro en Pago.jsx.
 *
 * Ruta: /mesero/ticket?mesa_id=...&sol_id=...
 * Exporta: default Ticket().
 */
import { Fragment, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import '../../styles/ticket.css';

/** Vista del ticket impreso/PDF. Sin props (mesa_id y sol_id van por query). */
export default function Ticket() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mesaId = params.get('mesa_id');
  const solId  = params.get('sol_id');

  const [ticket, setTicket]   = useState(null);
  const [loading, setLoading] = useState(true);

  // Carga única del ticket. Prefiere sol_id (URL canónica) y cae a mesa_id si
  // no viene; el backend devuelve el ticket más reciente para esa mesa.
  useEffect(() => {
    const url = solId ? `/mesero/ticket/${solId}` : `/mesero/ticket?mesa_id=${mesaId}`;
    api.get(url)
      .then(({ data }) => setTicket(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mesaId, solId]);

  if (loading) {
    return (
      <div className="ticket-page" style={{ justifyContent: 'center' }}>
        <div className="spinner-border" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="ticket-page" style={{ justifyContent: 'center' }}>
        <div className="text-center">
          <h6>Ticket no encontrado</h6>
          <button className="btn-action btn-back mt-3" onClick={() => navigate('/mesero/mapa')}>
            ← Volver al mapa
          </button>
        </div>
      </div>
    );
  }

  const { sol, mesa, mesero, pedidos, subtotal, descuento_total, total_final } = ticket;
  const restaurante = ticket.restaurante || {};
  const detalle = (sol?.detalle_pago || '').toUpperCase();
  const isMixto   = detalle.includes('MIXTO');
  const isTarjeta = !isMixto && (detalle.includes('TARJETA') || detalle.includes('TERMINAL'));
  const isPaypal  = !isMixto && !isTarjeta && detalle.includes('PAYPAL');
  const propina   = parseFloat(sol?.propina_sugerida || 0);

  const fmtFecha = sol?.fecha_hora ? new Date(sol.fecha_hora).toLocaleDateString('es-MX') : '—';
  const fmtHora  = sol?.fecha_hora ? new Date(sol.fecha_hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtFooter = sol?.fecha_hora ? new Date(sol.fecha_hora).toLocaleString('es-MX') : '';
  const folio = String(sol?.id || '').padStart(6, '0');

  return (
    <div className="ticket-page">
      {/* ── Barra de acciones (oculta en print) ── */}
      <div className="ticket-actions">
        <button className="btn-action btn-print" onClick={() => window.print()}>
          <i className="bi bi-printer-fill" /> Imprimir ticket
        </button>
        {sol?.id && (
          <a
            className="btn-action btn-pdf"
            href={`/api/mesero/ticket/${sol.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <i className="bi bi-file-earmark-pdf-fill" /> Descargar PDF
          </a>
        )}
        <button className="btn-action btn-back" onClick={() => navigate('/mesero/mapa')}>
          ← Volver al mapa
        </button>
      </div>

      <div className="ticket">
        {/* HEADER */}
        <div className="t-header">
          <div className="t-logo"><i className="bi bi-cup-hot-fill" /></div>
          <div className="t-nombre">{restaurante.nombre || 'Mochi Matcha'}</div>
          {restaurante.direccion && <div className="t-sub">{restaurante.direccion}</div>}
          {restaurante.telefono && <div className="t-sub">Tel: {restaurante.telefono}</div>}
          {restaurante.rfc      && <div className="t-sub">RFC: {restaurante.rfc}</div>}
          <div className="t-folio">FOLIO #{folio}</div>
        </div>

        <div className="t-body">
          {/* META */}
          <div className="t-meta">
            <div><strong>Fecha</strong>{fmtFecha}</div>
            <div><strong>Hora</strong>{fmtHora}</div>
            {mesa   && <div><strong>Mesa</strong>{mesa.numero_mesa}</div>}
            {mesero && <div><strong>Mesero</strong>{mesero.nombre || mesero.usuario}</div>}
            {sol?.sesion?.alias && (
              <div className="t-meta-full"><strong>Sesión:</strong> {sol.sesion.alias}</div>
            )}
          </div>

          <hr className="sep" />

          {/* PRODUCTOS */}
          <table className="t-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Descripción</th>
                <th style={{ width: 55 }}>P.U.</th>
                <th style={{ width: 60 }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {(pedidos || []).flatMap((p) =>
                (p.detalles || []).map((d) => (
                  <Fragment key={`d-${d.id}`}>
                    <tr>
                      <td style={{ color: '#888' }}>{d.cantidad}×</td>
                      <td className="td-name">{d.producto?.nombre}</td>
                      <td>${parseFloat(d.producto?.precio || 0).toFixed(2)}</td>
                      <td style={{ fontWeight: 700 }}>${parseFloat(d.subtotal_calculado || 0).toFixed(2)}</td>
                    </tr>
                    {(d.modificadores || []).map((m) => {
                      const extra = parseFloat(m.precio_extra_aplicado || m.opcion?.precio_extra || 0);
                      const nombre = m.opcion?.nombre_opcion || m.nombre_opcion_historico || m.nombre_display;
                      return (
                        <tr key={`m-${m.id}`}>
                          <td />
                          <td colSpan={3} className="td-mod">
                            + {nombre}{extra > 0 && ` ($${extra.toFixed(2)})`}
                          </td>
                        </tr>
                      );
                    })}
                    {d.notas && (
                      <tr>
                        <td />
                        <td colSpan={3} className="td-note">
                          <i className="bi bi-pencil-square" /> {d.notas}
                        </td>
                      </tr>
                    )}
                    {(d.promocion_id || d.promocion) && (
                      <tr>
                        <td />
                        <td colSpan={3} className="td-promo">
                          <i className="bi bi-tag-fill" /> {d.promocion?.titulo || 'Promo aplicada'}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>

          <hr className="sep-solid" />

          {/* TOTALES */}
          <div className="t-totals">
            <div className="t-totals-row"><span>Subtotal</span><span>${parseFloat(subtotal || 0).toFixed(2)}</span></div>
            {parseFloat(descuento_total || 0) > 0 && (
              <div className="t-totals-row descuento">
                <span><i className="bi bi-tag-fill" /> Descuento (promos)</span>
                <span>−${parseFloat(descuento_total).toFixed(2)}</span>
              </div>
            )}
            {propina > 0 && (
              <div className="t-totals-row propina"><span>Propina</span><span>${propina.toFixed(2)}</span></div>
            )}
            <div className="t-totals-row grand"><span>TOTAL</span><span>${parseFloat(total_final || 0).toFixed(2)}</span></div>
          </div>

          {/* PAGO */}
          <div className="t-pago">
            <div className="t-pago-label">Método de pago</div>
            {sol?.detalle_pago ? (
              isMixto ? (
                <>
                  <div className="t-pago-row"><span><i className="bi bi-cash" /> Efectivo</span><span>${parseFloat(sol.monto_efectivo || 0).toFixed(2)}</span></div>
                  <div className="t-pago-row"><span><i className="bi bi-credit-card" /> Tarjeta</span><span>${parseFloat(sol.monto_tarjeta || 0).toFixed(2)}</span></div>
                </>
              ) : isTarjeta ? (
                <div className="t-pago-row"><span><i className="bi bi-credit-card" /> Pago con terminal</span><span>${parseFloat(total_final || 0).toFixed(2)}</span></div>
              ) : isPaypal ? (
                <>
                  <div className="t-pago-row"><span><i className="bi bi-paypal" /> PayPal</span><span>${parseFloat(total_final || 0).toFixed(2)}</span></div>
                  {sol.referencia_externa && (
                    <div className="t-pago-row" style={{ fontSize: '.67rem', color: '#888' }}>
                      <span>Ref. PayPal</span><span>{sol.referencia_externa}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="t-pago-row"><span><i className="bi bi-cash" /> Efectivo</span><span /></div>
                  {sol.monto_recibido > 0 && (
                    <div className="t-pago-row"><span>Recibido</span><span>${parseFloat(sol.monto_recibido).toFixed(2)}</span></div>
                  )}
                  {sol.cambio != null && parseFloat(sol.cambio) >= 0 && sol.monto_recibido > 0 && (
                    <div className="t-pago-row cambio"><span><i className="bi bi-cash-coin" /> Cambio</span><span>${parseFloat(sol.cambio).toFixed(2)}</span></div>
                  )}
                </>
              )
            ) : (
              <div className="t-pago-row"><span>{sol?.metodo_pago?.descripcion || sol?.metodo_pago || '—'}</span><span /></div>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="t-footer">
          <strong>¡Gracias por su visita!</strong><br />
          Regresen pronto <i className="bi bi-cup-hot-fill" /><br />
          {fmtFooter} — Folio #{folio}
        </div>
      </div>
    </div>
  );
}
