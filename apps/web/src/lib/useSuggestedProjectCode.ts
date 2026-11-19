import { useQuery } from '@tanstack/react-query';
import api from './api';

/**
 * The suggested `CCC-NNN` project code for a country (calling-code prefix + next free number),
 * or null when no country is set or its calling code is unknown. A default, never a lock.
 */
export function useSuggestedProjectCode(country: string | null | undefined): string | null {
  const name = (country ?? '').trim();
  const { data } = useQuery({
    queryKey: ['projects', 'next-code', name],
    enabled: !!name,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      try {
        const res = await api.get('/projects/next-code', { params: { country: name } });
        return (res.data?.code as string) ?? null;
      } catch {
        return null;
      }
    },
  });
  return name ? data ?? null : null;
}
