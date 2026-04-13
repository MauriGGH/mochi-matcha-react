import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // sesion_cliente: { alias, mesa_id, pin }
  const [sesionCliente, setSesionCliente] = useState(null)

  const login = (userData) => setUser(userData)
  const logout = () => setUser(null)

  const crearSesionCliente = (data) => setSesionCliente(data)
  const cerrarSesionCliente = () => setSesionCliente(null)

  return (
    <AuthContext.Provider value={{ user, login, logout, sesionCliente, crearSesionCliente, cerrarSesionCliente }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
