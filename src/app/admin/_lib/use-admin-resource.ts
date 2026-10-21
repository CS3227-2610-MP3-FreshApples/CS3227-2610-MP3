"use client";

import { useCallback, useEffect, useState } from "react";

import type { AdminFailure, AdminResult } from "./admin-http";

export type ResourceState<T> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; failure: AdminFailure }>
  | Readonly<{ status: "ready"; value: T }>;

/**
 * Loads one Admin resource on mount and whenever `load` changes; `reload` fetches it again. A response
 * that arrives after a newer request started is discarded. `replace` installs a value returned by a
 * mutation without another round trip.
 */
export function useAdminResource<T>(load: () => Promise<AdminResult<T>>) {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let current = true;
    load().then((result) => {
      if (!current) return;
      setState(result.ok ? { status: "ready", value: result.value } : { status: "error", failure: result });
    });
    return () => {
      current = false;
    };
  }, [load, generation]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setGeneration((value) => value + 1);
  }, []);

  const replace = useCallback((value: T) => setState({ status: "ready", value }), []);

  return { state, reload, replace } as const;
}
