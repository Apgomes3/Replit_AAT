import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

type EntityType = 'design_book' | 'enquiry' | 'project' | 'purchase_order';

/** Mount only once the record itself has loaded; the API independently checks access. */
export default function FollowRecordButton({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const url = `/notifications/subscriptions/${entityType}/${entityId}`;
  const key = ['record-follow', entityType, entityId];
  const status = useQuery<{ following: boolean }>({
    queryKey: key,
    queryFn: () => api.get(url).then(r => r.data),
    retry: false,
    staleTime: 0,
  });

  if (status.error && (status.error as any)?.response?.status === 404) return null;
  const following = status.data?.following;
  const toggle = async () => {
    if (pending || following === undefined) return;
    setPending(true);
    try {
      const result = following ? await api.delete(url) : await api.put(url);
      qc.setQueryData(key, { following: result.data.following });
    } catch {
      await status.refetch();
    } finally {
      setPending(false);
    }
  };

  return <button type="button" onClick={toggle} disabled={pending || status.isLoading || status.isError}
    aria-pressed={following ?? false}
    title={status.isError ? 'Could not load follow status' : 'Receive future updates about this record'}
    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
    {status.isError ? 'Follow unavailable' : pending ? 'Saving…' : following ? 'Unfollow' : 'Follow'}
  </button>;
}