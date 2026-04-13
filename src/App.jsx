import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CartProvider } from './context/CartContext'

// Pages
import Login from './pages/Login'

// Cliente
import Bienvenida from './pages/cliente/Bienvenida'
import Menu from './pages/cliente/Menu'
import Carrito from './pages/cliente/Carrito'
import Pedidos from './pages/cliente/Pedidos'

// Mesero
import MapaMesas from './pages/mesero/MapaMesas'
import {
  PedidosListosPage,
  AlertasPage,
  PedidoAsistidoPage,
  PagoPage,
} from './pages/mesero/MeseroPages'

// Cocina
import KDS from './pages/cocina/KDS'

// Gerente
import {
  FloorPlanPage,
  MenuManagerPage,
  EmpleadosPage,
  ReportesPage,
  ConfiguracionPage,
} from './pages/gerente/GerentePages'

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            {/* Raíz */}
            <Route path="/" element={<Navigate to="/bienvenida" replace />} />

            {/* Login por rol */}
            <Route path="/login/:rol" element={<Login />} />
            <Route path="/login" element={<Navigate to="/login/mesero" replace />} />

            {/* ── Cliente ── */}
            <Route path="/bienvenida" element={<Bienvenida />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/carrito" element={<Carrito />} />
            <Route path="/pedidos" element={<Pedidos />} />

            {/* ── Mesero ── */}
            <Route path="/mesero/mesas" element={<MapaMesas />} />
            <Route path="/mesero/listos" element={<PedidosListosPage />} />
            <Route path="/mesero/asistido" element={<PedidoAsistidoPage />} />
            <Route path="/mesero/alertas" element={<AlertasPage />} />
            <Route path="/mesero/pago" element={<PagoPage />} />
            {/* Alias de entrada */}
            <Route path="/mesero" element={<Navigate to="/mesero/mesas" replace />} />

            {/* ── Cocina ── */}
            <Route path="/cocina/kds" element={<KDS />} />
            <Route path="/cocina" element={<Navigate to="/cocina/kds" replace />} />

            {/* ── Gerente ── */}
            <Route path="/gerente/floor-plan" element={<FloorPlanPage />} />
            <Route path="/gerente/menu" element={<MenuManagerPage />} />
            <Route path="/gerente/empleados" element={<EmpleadosPage />} />
            <Route path="/gerente/reportes" element={<ReportesPage />} />
            <Route path="/gerente/configuracion" element={<ConfiguracionPage />} />
            <Route path="/gerente" element={<Navigate to="/gerente/floor-plan" replace />} />

            {/* 404 */}
            <Route path="*" element={
              <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)' }}>
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🍵</div>
                <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--mm-green)' }}>Página no encontrada</h2>
                <p style={{ color: 'var(--mm-text-muted)' }}>La ruta que buscas no existe</p>
                <a href="/" className="btn btn-primary mt-2">Ir al inicio</a>
              </div>
            } />
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  )
}
