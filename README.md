# 🍵 Mochi Matcha — Frontend React + Vite


---

## 📁 Estructura del proyecto

```
mochi-matcha-react/
├── index.html                    # HTML raíz con Bootstrap + Fonts CDN
├── vite.config.js                # Configuración Vite + proxy a Django
├── package.json                  # Dependencias
└── src/
    ├── main.jsx                  # Punto de entrada
    ├── App.jsx                   # Router con todas las rutas
    ├── styles/
    │   ├── mochi.css             # Tokens de diseño y estilos globales
    │   ├── cliente.css           # Estilos del módulo cliente (móvil)
    │   └── staff.css             # Estilos del módulo staff (tablet/PC)
    ├── context/
    │   ├── AuthContext.jsx       # Estado de autenticación (user + sesión cliente)
    │   └── CartContext.jsx       # Estado del carrito de compras
    ├── components/
    │   ├── StaffLayout.jsx       # Layout con sidebar + topbar (mesero/cocina/gerente)
    │   ├── ClientLayout.jsx      # Layout móvil con bottom nav (cliente)
    │   └── Toast.jsx             # Sistema de notificaciones toast
    └── pages/
        ├── Login.jsx             # Login unificado por rol (/login/:rol)
        ├── cliente/
        │   ├── Bienvenida.jsx    # Onboarding del cliente (QR + alias + PIN)
        │   ├── Menu.jsx          # Catálogo de productos con modal
        │   ├── Carrito.jsx       # Carrito de compras
        │   └── Pedidos.jsx       # Seguimiento de pedidos (stepper)
        ├── mesero/
        │   ├── MapaMesas.jsx     # Mapa de mesas con panel de detalle
        │   └── MeseroPages.jsx   # PedidosListos, Alertas, PedidoAsistido, Pago
        ├── cocina/
        │   └── KDS.jsx           # Kitchen Display System (semáforo + timers)
        └── gerente/
            └── GerentePages.jsx  # FloorPlan, MenuManager, Empleados, Reportes, Config
```

---

## 🚀 Cómo iniciarlo

### 1. Instalar dependencias

```bash
cd mochi-matcha-react
npm install
```

### 2. Iniciar el servidor de desarrollo

```bash
npm run dev
```

Abre **http://localhost:5173** en tu navegador.

### 3. Construir para producción

```bash
npm run build
```

---

## 🗺️ Rutas disponibles

| Ruta | Vista | Rol |
|------|-------|-----|
| `/bienvenida?mesa=1` | Bienvenida cliente | Cliente |
| `/menu` | Catálogo de productos | Cliente |
| `/carrito` | Carrito de compras | Cliente |
| `/pedidos` | Seguimiento de pedidos | Cliente |
| `/login/mesero` | Login mesero | Mesero |
| `/login/gerente` | Login gerente | Gerente |
| `/login/cocina` | Login cocina | Cocina |
| `/mesero/mesas` | Mapa de mesas | Mesero |
| `/mesero/listos` | Pedidos listos para entregar | Mesero |
| `/mesero/asistido` | Pedido asistido | Mesero |
| `/mesero/alertas` | Solicitudes de clientes | Mesero |
| `/mesero/pago` | Procesar pago | Mesero |
| `/cocina/kds` | Kitchen Display System | Cocina |
| `/gerente/floor-plan` | Mapa de mesas (gerente) | Gerente |
| `/gerente/menu` | Gestión del menú | Gerente |
| `/gerente/empleados` | Gestión de empleados | Gerente |
| `/gerente/reportes` | Reportes y auditoría | Gerente |
| `/gerente/configuracion` | Configuración del sistema | Gerente |

---

## 🔐 Credenciales demo

| Rol | Usuario | Contraseña |
|-----|---------|------------|
| Mesero | `mesero1` | `mesero123` |
| Gerente | `gerente1` | `gerente123` |
| Cocina | `cocina1` | `cocina123` |

---

## 📦 Dependencias instaladas

| Paquete | Versión | Uso |
|---------|---------|-----|
| `react` + `react-dom` | ^18 | Framework UI |
| `react-router-dom` | ^6 | Ruteo SPA |
| `chart.js` + `react-chartjs-2` | ^4 / ^5 | Gráficas en Reportes |
| `dayjs` | ^1 | Manejo de fechas |
| `@vitejs/plugin-react` | ^4 | Plugin de React para Vite |

Bootstrap 5, Bootstrap Icons y Google Fonts se cargan desde CDN en `index.html`.
