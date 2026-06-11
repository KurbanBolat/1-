"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { CSSProperties } from "react";

import { fireAnalyticsEvent } from "../lib/analyticsClient";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

export function SearchExposureTracker({
  lang,
  currency,
  variant,
  total,
}: {
  lang: Lang;
  currency: Currency;
  variant: "a" | "b";
  total: number;
}) {
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    void fireAnalyticsEvent({
      event_name: "ab_variant_exposed",
      lang,
      currency,
      metadata: { variant, total },
    });
  }, [lang, currency, variant, total]);
  return null;
}

export function CheckoutExposureTracker({
  listingId,
  lang,
  currency,
  variant,
}: {
  listingId: number;
  lang: Lang;
  currency: Currency;
  variant: "a" | "b";
}) {
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    void fireAnalyticsEvent({
      event_name: "checkout_clicked",
      listing_id: listingId,
      lang,
      currency,
      metadata: { variant },
    });
  }, [listingId, lang, currency, variant]);
  return null;
}

export function PaymentResultTracker({
  listingId,
  reservationId,
  lang,
  currency,
  variant,
  paymentStatus,
}: {
  listingId: number;
  reservationId: number;
  lang: Lang;
  currency: Currency;
  variant: "a" | "b";
  paymentStatus: "paid" | "failed" | "pending" | "";
}) {
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    void fireAnalyticsEvent({
      event_name: paymentStatus === "paid" ? "paid" : paymentStatus === "failed" ? "payment_failed" : "payment_result_viewed",
      listing_id: listingId,
      reservation_id: reservationId,
      lang,
      currency,
      metadata: { variant, payment_status: paymentStatus || "unknown" },
    });
  }, [listingId, reservationId, lang, currency, variant, paymentStatus]);
  return null;
}

export function TrackedStayLink({
  href,
  listingId,
  position,
  variant,
  lang,
  currency,
  className,
  style,
  title,
  children,
}: {
  href: string;
  listingId: number;
  position: number;
  variant: "a" | "b";
  lang: Lang;
  currency: Currency;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      style={style}
      title={title}
      onClick={() => {
        void fireAnalyticsEvent({
          event_name: "listing_open_clicked",
          listing_id: listingId,
          lang,
          currency,
          metadata: { position, variant },
        });
      }}
    >
      {children}
    </Link>
  );
}
