import { createContext, useContext, useState } from 'react'

const CartContext = createContext(null)

export function CartProvider({ children }) {
  const [items, setItems] = useState([])

  const addItem = (item) => {
    setItems(prev => [...prev, item])
  }

  const removeItem = (index) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const clearCart = () => setItems([])

  const total = items.reduce((sum, item) => sum + item.subtotal, 0)

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, clearCart, total, count: items.length }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  return useContext(CartContext)
}
