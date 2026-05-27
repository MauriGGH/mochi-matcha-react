/**
 * vite.config.js — Configuración de Vite para el frontend.
 * Dev server en :5173 con proxy de /api y /media hacia el backend Express en :3001
 * para evitar problemas de CORS en desarrollo (el browser ve todo en el mismo origen).
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Todas las llamadas a la API REST se reenvian al backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Archivos servidos por el backend (imágenes de productos, QRs, etc.)
      '/media': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
