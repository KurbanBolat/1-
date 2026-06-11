"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UseSoftRedirectParams = {
  delayMs?: number;
  onNavigate: (targetUrl: string) => void;
};

export function useSoftRedirect({ delayMs = 2500, onNavigate }: UseSoftRedirectParams) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const onNavigateRef = useRef(onNavigate);

  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    if (!pendingUrl) return;
    const timer = window.setTimeout(() => {
      const target = pendingUrl;
      setPendingUrl(null);
      onNavigateRef.current(target);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [pendingUrl, delayMs]);

  const scheduleRedirect = useCallback((targetUrl: string) => {
    setPendingUrl(targetUrl);
  }, []);

  const cancelRedirect = useCallback(() => {
    setPendingUrl(null);
  }, []);

  const redirectNow = useCallback(() => {
    if (!pendingUrl) return;
    const target = pendingUrl;
    setPendingUrl(null);
    onNavigateRef.current(target);
  }, [pendingUrl]);

  return {
    pendingUrl,
    hasPendingRedirect: Boolean(pendingUrl),
    scheduleRedirect,
    cancelRedirect,
    redirectNow,
  };
}
