/**
 * Test de UI prompt 01 — Login.
 *
 * NOTA: este archivo es un scaffold que requiere vitest + @testing-library/react
 *       (no instalados todavía — pedir autorización para `npm i -D vitest jsdom
 *       @testing-library/react @testing-library/jest-dom @testing-library/user-event`).
 *
 * Cubre lo que el prompt 01-login.md exige:
 *   - rol="mesero"  → .brand-role-pill contiene "Mesero" e icono bi-person-badge-fill
 *   - click en .btn-toggle-pass alterna el type del input de password
 *   - submit con credenciales válidas → navigate('/mesero/mapa')
 *   - submit con error → renderiza .login-alert con el texto del error
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../src/pages/auth/Login';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockLogin = vi.fn();
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ empleado: null, login: mockLogin }),
}));

const renderLogin = (rol = 'staff') =>
  render(
    <MemoryRouter>
      <Login rol={rol} />
    </MemoryRouter>
  );

describe('Login UI (prompt 01)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogin.mockReset();
  });

  it('rol="mesero" renderiza pill con "Mesero" y bi-person-badge-fill', () => {
    const { container } = renderLogin('mesero');
    const pill = container.querySelector('.brand-role-pill');
    expect(pill).toBeTruthy();
    expect(pill.textContent).toMatch(/Mesero/);
    expect(pill.querySelector('i.bi-person-badge-fill')).toBeTruthy();
  });

  it('btn-toggle-pass alterna el type del input password', () => {
    const { container } = renderLogin('mesero');
    const pass = container.querySelector('#passInput');
    const btn  = container.querySelector('.btn-toggle-pass');
    expect(pass.type).toBe('password');
    fireEvent.click(btn);
    expect(pass.type).toBe('text');
    fireEvent.click(btn);
    expect(pass.type).toBe('password');
  });

  it('submit con credenciales válidas → navigate("/mesero/mapa")', async () => {
    mockLogin.mockResolvedValueOnce({ rol: 'mesero', usuario: 'maria' });
    const { container } = renderLogin('mesero');
    fireEvent.change(container.querySelector('#usuarioInput'), { target: { value: 'maria' } });
    fireEvent.change(container.querySelector('#passInput'),    { target: { value: 'mesero123' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/mesero/mapa'));
  });

  it('submit con error → muestra .login-alert', async () => {
    mockLogin.mockRejectedValueOnce(new Error('401'));
    const { container } = renderLogin('mesero');
    fireEvent.change(container.querySelector('#usuarioInput'), { target: { value: 'x' } });
    fireEvent.change(container.querySelector('#passInput'),    { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));
    await waitFor(() => {
      const alert = container.querySelector('.login-alert');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toMatch(/incorrectos/);
    });
  });
});
