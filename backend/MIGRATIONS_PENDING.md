# Migraciones pendientes

Estas columnas se aplican automáticamente en dev con `sequelize.sync({ alter: true })`.
En producción requieren migración manual o Sequelize CLI (ver notas al pie).

---

## Empleado — pendiente migración
Fecha: 2026-05-17
Cambios:
```sql
ALTER TABLE empleados ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE empleados ADD COLUMN is_staff  BOOLEAN NOT NULL DEFAULT false;
UPDATE empleados SET is_staff = true WHERE rol IN ('gerente', 'admin');
```
Endpoint asociado: #1 (auth — login/logout staff)

---

## SolicitudPago — tabla M2M `solicitud_sesiones_cubiertas`
Fecha: 2026-05-18 (fix #3 ticket parcial)

La M2M existe en código (`SolicitudPago.belongsToMany(SesionCliente, { through: 'solicitud_sesiones_cubiertas', as: 'sesiones_cubiertas' })`). En dev se crea sola con `sequelize.sync({ alter: true })`. En prod:
```sql
CREATE TABLE solicitud_sesiones_cubiertas (
  id_solicitud BIGINT NOT NULL,
  id_sesion    BIGINT NOT NULL,
  createdAt    DATETIME NULL,
  updatedAt    DATETIME NULL,
  PRIMARY KEY (id_solicitud, id_sesion),
  FOREIGN KEY (id_solicitud) REFERENCES solicitudes_pago(id) ON DELETE CASCADE,
  FOREIGN KEY (id_sesion)    REFERENCES sesiones_cliente(id) ON DELETE CASCADE
);
```

### Backfill para data legacy (solicitudes anteriores al fix)
```sql
-- Individuales: la sesión cubierta es la propia sesión de la solicitud.
INSERT INTO solicitud_sesiones_cubiertas (id_solicitud, id_sesion, createdAt, updatedAt)
SELECT s.id, s.id_sesion, NOW(), NOW()
FROM solicitudes_pago s
WHERE s.tipo = 'individual' AND s.id_sesion IS NOT NULL
ON DUPLICATE KEY UPDATE updatedAt = NOW();

-- Grupales: heurística — todas las sesiones de la mesa con estado pagada/cerrada
-- cuyo fecha_inicio <= solicitud.fecha_hora. Revisar caso por caso si hay datos críticos.
INSERT INTO solicitud_sesiones_cubiertas (id_solicitud, id_sesion, createdAt, updatedAt)
SELECT s.id, sc.id, NOW(), NOW()
FROM solicitudes_pago s
JOIN sesiones_cliente sc
  ON sc.id_mesa = s.id_mesa
 AND sc.estado IN ('pagada', 'cerrada')
 AND sc.fecha_inicio <= s.fecha_hora
WHERE s.tipo = 'grupal'
ON DUPLICATE KEY UPDATE updatedAt = NOW();
```

Endpoint asociado: `POST /api/mesero/pago/procesar` + `GET /api/mesero/ticket/:sol_id`.
Fix prompt: `mochi-tools/contracts/fix-prompts/03-ticket-parcial.md`.

---

<!-- Al llegar al prompt #22+ (CRUD gerente) evaluar setup sequelize-cli + baseline completo de todos los modelos. -->
