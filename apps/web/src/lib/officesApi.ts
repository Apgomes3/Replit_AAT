// Offices (admin): where people work, with an address, a time zone and a working calendar.
import { useQuery } from '@tanstack/react-query';
import api from './api';

export type Office = {
  id: string; name: string; address: string | null; time_zone: string | null;
  calendar_id: string | null; calendar_name: string | null; people: number;
};
export type OfficesResponse = { data: Office[]; calendars: Array<{ id: string; name: string }> };
export type OfficeInput = { name: string; address: string | null; time_zone: string | null; calendar_id: string | null };

export const OFFICES_KEY = ['admin-offices'] as const;
export const useOffices = (enabled = true) => useQuery({
  queryKey: OFFICES_KEY, enabled,
  queryFn: () => api.get('/admin/offices').then(r => r.data as OfficesResponse),
});
