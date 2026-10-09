import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiClient } from '@/lib/api/client';
import type { EngineInfo, EngineVariant, ModelStatus } from '@/lib/api/types';
import { queryClient } from '@/lib/queryClient';

const ENGINES_KEY = ['engines'] as const;
const MODEL_STATUS_KEY = ['modelStatus'] as const;

/** Static engine registry from the backend (`GET /engines`). */
export function useEngines() {
  return useQuery({
    queryKey: ENGINES_KEY,
    queryFn: () => apiClient.listEngines(),
    staleTime: Infinity,
  });
}

/** Download/loaded state for every model. Shares the Models tab cache key. */
export function useModelStatus(refetchInterval: number | false = 5000) {
  return useQuery({
    queryKey: MODEL_STATUS_KEY,
    queryFn: () => apiClient.getModelStatus(),
    refetchInterval,
  });
}

export type VariantState = 'ready' | 'loaded' | 'downloading' | 'missing';

export interface EngineWithStatus extends EngineInfo {
  variantStatus: Record<string, ModelStatus | undefined>;
  /** Best state across the engine's variants. */
  state: VariantState;
}

export function variantState(status?: ModelStatus): VariantState {
  if (!status) return 'missing';
  if (status.loaded) return 'loaded';
  if (status.downloading) return 'downloading';
  return status.downloaded ? 'ready' : 'missing';
}

const STATE_RANK: Record<VariantState, number> = { loaded: 3, ready: 2, downloading: 1, missing: 0 };

/** Engines joined with live model status. */
export function useEnginesWithStatus() {
  const engines = useEngines();
  const status = useModelStatus();

  const data = useMemo<EngineWithStatus[] | undefined>(() => {
    if (!engines.data) return undefined;
    const byName = new Map((status.data?.models ?? []).map((m) => [m.model_name, m]));
    return engines.data.map((engine) => {
      const variantStatus: Record<string, ModelStatus | undefined> = {};
      let state: VariantState = 'missing';
      for (const v of engine.variants) {
        const s = byName.get(v.model_name);
        variantStatus[v.model_name] = s;
        const vs = variantState(s);
        if (STATE_RANK[vs] > STATE_RANK[state]) state = vs;
      }
      return { ...engine, variantStatus, state };
    });
  }, [engines.data, status.data]);

  return { data, isLoading: engines.isLoading, refetchStatus: status.refetch };
}

export function hasModelSizes(engine?: EngineInfo): boolean {
  return !!engine && engine.variants.length > 1;
}

/** The variant matching *modelSize*, or the engine's first variant. */
export function resolveVariant(engine: EngineInfo | undefined, modelSize?: string): EngineVariant | undefined {
  if (!engine) return undefined;
  return engine.variants.find((v) => v.model_size === modelSize) ?? engine.variants[0];
}

/** Imperative lookup for code paths outside React render (submit handlers). */
export async function fetchEngines(): Promise<EngineInfo[]> {
  return queryClient.fetchQuery({
    queryKey: ENGINES_KEY,
    queryFn: () => apiClient.listEngines(),
    staleTime: Infinity,
  });
}
