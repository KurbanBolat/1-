"use client";

import { trackAnalyticsEvent } from "./api";

const SESSION_KEY = "findapart_analytics_session_id";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateAnalyticsSessionId(): string {
  if (typeof window === "undefined") return "server_session";
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const next = randomId();
  window.localStorage.setItem(SESSION_KEY, next);
  return next;
}

export async function fireAnalyticsEvent(payload: {
  event_name: string;
  listing_id?: number | null;
  reservation_id?: number | null;
  lang?: "ru" | "en";
  currency?: "KZT" | "USD";
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const sessionId = getOrCreateAnalyticsSessionId();
  await trackAnalyticsEvent({
    event_name: payload.event_name,
    session_id: sessionId,
    listing_id: payload.listing_id ?? null,
    reservation_id: payload.reservation_id ?? null,
    lang: payload.lang,
    currency: payload.currency,
    metadata: payload.metadata,
  });
}
