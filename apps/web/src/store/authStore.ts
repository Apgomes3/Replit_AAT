import { create } from 'zustand';
import { User } from '../types';
import api from '../lib/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('edp_token'),
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('edp_token', res.data.token);
    set({
      user: {
        ...res.data.user,
        moduleAccess: res.data.user.module_access,
      },
      token: res.data.token,
      isLoading: false,
    });
  },

  logout: () => {
    localStorage.removeItem('edp_token');
    set({ user: null, token: null });
    window.location.href = '/login';
  },

  loadUser: async () => {
    const token = localStorage.getItem('edp_token');
    if (!token) return;
    set({ isLoading: true });
    try {
      const res = await api.get('/auth/me');
      set({
        user: {
          id: res.data.id,
          email: res.data.email,
          firstName: res.data.first_name,
          lastName: res.data.last_name,
          role: res.data.role,
          department: res.data.department ?? null,
          departmentName: res.data.department_name ?? null,
          departmentAreas: res.data.department_areas ?? null,
          menus: res.data.menus ?? undefined,
          canSeeAllPos: res.data.can_see_all_pos,
          moduleAccess: res.data.module_access,
        },
        isLoading: false,
      });
    } catch {
      localStorage.removeItem('edp_token');
      set({ user: null, token: null, isLoading: false });
    }
  },
}));
