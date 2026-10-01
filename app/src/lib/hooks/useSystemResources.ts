import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';

function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/** Live CPU/GPU/RAM/VRAM. Polls only while *enabled* and the window is visible. */
export function useSystemResources(enabled: boolean, intervalMs = 2000) {
  const visible = usePageVisible();
  const active = enabled && visible;
  return useQuery({
    queryKey: ['systemResources'],
    queryFn: () => apiClient.getSystemResources(),
    enabled: active,
    refetchInterval: (query) => active ? (query.state.data?.inference?.active ? 1000 : intervalMs) : false,
    staleTime: 0,
  });
}
