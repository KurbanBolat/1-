"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { getListingQuote, type Quote } from "../lib/api";
import { CheckoutExposureTracker } from "./AnalyticsTrackers";
import DateRangePicker from "./DateRangePicker";
import ReservationForm from "./ReservationForm";
import TrustLayerCard from "./TrustLayerCard";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";
type Tariff = "basic" | "smart" | "flex";

type TariffOption = {
  key: Tariff;
  label: string;
  hint: string;
};

type Copy = {
  unavailable: string;
  unavailableAction: string;
  summary: string;
  nights: string;
  subtotal: string;
  cleaning: string;
  service: string;
  total: string;
  dynamicPricing: string;
  dynamicPricingHint: string;
  policy: string;
  bookingDetails: string;
  tariff: string;
  guests: string;
  completeBooking: string;
  included: string;
  support: string;
  instant: string;
  secure: string;
  trustTitle: string;
  checkInWindow: string;
  checkOutWindow: string;
  lockTitle: string;
  lockExpired: string;
  lockActive: string;
  lockExpiredAction: string;
  refreshQuote: string;
  refreshingQuote: string;
  quoteRefreshed: string;
  quoteAutoRefreshed: string;
  quoteRefreshFailed: string;
  adjustTitle: string;
  applyAdjustments: string;
  checkInLabel: string;
  checkOutLabel: string;
  guestsLabel: string;
  selectedRoom: string;
  selectedDates: string;
  selectedTariff: string;
  roomFallback: string;
};

const TZ_SUFFIX_PATTERN = /[zZ]|[+\-]\d{2}:\d{2}$/;
const MAX_BOOKING_HORIZON_DAYS = 365;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayKey(): string {
  return isoFromDate(new Date());
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

function parseQuoteTimeToMs(value: string | null): number {
  if (!value) return Number.NaN;
  const normalized = TZ_SUFFIX_PATTERN.test(value) ? value : `${value}Z`;
  return Date.parse(normalized);
}

function getLockState(expiresAt: string | null, lang: Lang, nowMs: number): { label: string; expired: boolean } {
  if (!expiresAt) return { label: "--:--", expired: false };
  const expiresMs = parseQuoteTimeToMs(expiresAt);
  if (Number.isNaN(expiresMs)) return { label: "--:--", expired: false };
  const remainingSec = Math.floor((expiresMs - nowMs) / 1000);
  if (remainingSec <= 0) return { label: lang === "ru" ? "истекло" : "expired", expired: true };
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  return {
    label: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    expired: false,
  };
}

export default function CheckoutShell({
  listingId,
  checkIn,
  checkOut,
  guests,
  roomTypeId,
  lang,
  currency,
  initialQuote,
  listingTitle,
  expVariant,
  tariffOptions,
  recoveryNotice,
  copy,
}: {
  listingId: number;
  checkIn: string;
  checkOut: string;
  guests: number;
  roomTypeId?: number;
  lang: Lang;
  currency: Currency;
  initialQuote: Quote;
  listingTitle: string;
  expVariant: "a" | "b";
  tariffOptions: TariffOption[];
  recoveryNotice?: string;
  copy: Copy;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote>(initialQuote);
  const [stayCheckIn, setStayCheckIn] = useState<string>(checkIn);
  const [stayCheckOut, setStayCheckOut] = useState<string>(checkOut);
  const [stayGuests, setStayGuests] = useState<number>(guests);
  const [nowMs, setNowMs] = useState<number>(0);
  const [isClientReady, setIsClientReady] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const autoRefreshMarkRef = useRef("");
  const lockState = isClientReady ? getLockState(quote.quote_expires_at, lang, nowMs) : { label: "--:--", expired: false };
  const lockTimer = lockState.label;
  const quoteExpired = lockState.expired;
  const safeToast = toast && toast.text.trim() ? toast : null;
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const formatBadgeDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const checkInBadge = formatBadgeDate(quote.check_in);
  const checkOutBadge = formatBadgeDate(quote.check_out);
  const minBookDate = useMemo(() => todayKey(), []);
  const maxBookDate = useMemo(() => addDays(minBookDate, MAX_BOOKING_HORIZON_DAYS), [minBookDate]);
  const mobileCopy =
    lang === "ru"
      ? {
          total: "Итого",
          cta: "Продолжить",
          unavailable: "Номер недоступен",
        }
      : {
          total: "Total",
          cta: "Continue",
          unavailable: "Room unavailable",
        };
  const mobileTotal = useMemo(() => {
    if (currency === "USD") {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(quote.total / 500);
    }
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(Math.round(quote.total));
  }, [currency, quote.total]);
  const adjustValid =
    Boolean(stayCheckIn) &&
    Boolean(stayCheckOut) &&
    stayCheckOut > stayCheckIn &&
    Number.isFinite(stayGuests) &&
    stayGuests >= 1 &&
    stayGuests <= 12;

  useEffect(() => {
    setStayCheckIn(checkIn);
    setStayCheckOut(checkOut);
    setStayGuests(guests);
  }, [checkIn, checkOut, guests]);

  useEffect(() => {
    setIsClientReady(true);
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function refreshQuote(reason: "manual" | "auto" | "retry" = "manual") {
    const nextQuote = await getListingQuote({
      listing_id: listingId,
      check_in: stayCheckIn,
      check_out: stayCheckOut,
      guests: stayGuests,
      tariff: quote.tariff_plan,
      room_type_id: roomTypeId,
    });
    setQuote(nextQuote);
    const params = new URLSearchParams({
      listing_id: String(listingId),
      check_in: stayCheckIn,
      check_out: stayCheckOut,
      guests: String(stayGuests),
      lang,
      currency,
      tariff: nextQuote.tariff_plan,
      exp_variant: expVariant,
    });
    if (roomTypeId) params.set("room_type_id", String(roomTypeId));
    router.replace(`/checkout?${params.toString()}`, { scroll: false });
    if (reason === "manual") setToast({ kind: "success", text: copy.quoteRefreshed });
    if (reason === "auto") setToast({ kind: "info", text: copy.quoteAutoRefreshed });
  }

  function handleRefreshClick() {
    startTransition(() => {
      refreshQuote("manual").catch(() => {
        setToast({ kind: "error", text: copy.quoteRefreshFailed });
      });
    });
  }

  useEffect(() => {
    if (!quote.quote_expires_at) return;
    const expiresAtMs = parseQuoteTimeToMs(quote.quote_expires_at);
    if (Number.isNaN(expiresAtMs)) return;
    const remainingMs = expiresAtMs - nowMs;
    const refreshKey = quote.quote_token || quote.quote_expires_at;
    if (remainingMs > 0 && remainingMs <= 10000 && autoRefreshMarkRef.current !== refreshKey && !autoRefreshing) {
      autoRefreshMarkRef.current = refreshKey;
      setAutoRefreshing(true);
      refreshQuote("auto")
        .catch(() => {
          setToast({ kind: "error", text: copy.quoteRefreshFailed });
          autoRefreshMarkRef.current = "";
        })
        .finally(() => setAutoRefreshing(false));
    }
  }, [quote.quote_expires_at, quote.quote_token, nowMs, autoRefreshing]);

  function buildTariffHref(tariff: Tariff) {
    const params = new URLSearchParams({
      listing_id: String(listingId),
      check_in: stayCheckIn,
      check_out: stayCheckOut,
      guests: String(stayGuests),
      lang,
      currency,
      tariff,
      exp_variant: expVariant,
    });
    if (roomTypeId) params.set("room_type_id", String(roomTypeId));
    return `/checkout?${params.toString()}`;
  }
  const selectedTariffLabel = tariffOptions.find((item) => item.key === quote.tariff_plan)?.label || quote.tariff_plan;
  const availableRoomsParams = useMemo(() => {
    const params = new URLSearchParams({
      lang,
      currency,
      exp_variant: expVariant,
      check_in: stayCheckIn,
      check_out: stayCheckOut,
      guests: String(stayGuests),
    });
    if (roomTypeId) params.set("room_type_id", String(roomTypeId));
    return params.toString();
  }, [lang, currency, expVariant, stayCheckIn, stayCheckOut, stayGuests, roomTypeId]);
  const dynamicPercent = Math.max(0, Math.round((quote.dynamic_multiplier - 1) * 100));

  return (
    <section className="checkout-grid">
      <CheckoutExposureTracker listingId={listingId} lang={lang} currency={currency} variant={expVariant} />
      <article className="property-detail checkout-main">
        <h1>{copy.completeBooking}</h1>
        <p className="detail-location">{quote.room_type_name ? `${listingTitle} · ${quote.room_type_name}` : listingTitle}</p>
        {recoveryNotice ? (
          <div className="checkout-room-recovery" role="status">
            {recoveryNotice}
            <Link href={`/stays/${listingId}?${availableRoomsParams}#available-rooms`}>{copy.unavailableAction}</Link>
          </div>
        ) : null}

        <section className="checkout-room-summary">
          <div className="checkout-room-summary-head">
            <h3>{copy.selectedRoom}</h3>
            {!quote.available ? (
              <Link href={`/stays/${listingId}?${availableRoomsParams}#available-rooms`} className="checkout-room-change-link">
                {copy.unavailableAction}
              </Link>
            ) : null}
          </div>
          <div className="checkout-room-summary-grid">
            <div>
              <span>{copy.roomFallback}</span>
              <b>{quote.room_type_name || copy.roomFallback}</b>
            </div>
            <div>
              <span>{copy.selectedDates}</span>
              <b suppressHydrationWarning>
                {checkInBadge}
                {" -> "}
                {checkOutBadge}
              </b>
            </div>
            <div>
              <span>{copy.guestsLabel}</span>
              <b>
                {quote.guests} {copy.guests}
              </b>
            </div>
            <div>
              <span>{copy.selectedTariff}</span>
              <b>{selectedTariffLabel}</b>
            </div>
          </div>
          {!quote.available ? <p className="warn-text checkout-room-warning">{copy.unavailable}</p> : null}
        </section>

        <h3>{copy.tariff}</h3>
        <div className="tariff-grid">
          {tariffOptions.map((item) => (
            <Link
              key={item.key}
              href={buildTariffHref(item.key)}
              className={`tariff-card ${item.key === quote.tariff_plan ? "active" : ""}`}
            >
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </Link>
          ))}
        </div>

        <div id="checkout-reservation">
          <ReservationForm
            listingId={listingId}
            listingTitle={listingTitle}
            lang={lang}
            currency={currency}
            lockedBooking={{ checkIn: quote.check_in, checkOut: quote.check_out, guests: quote.guests }}
            roomTypeId={quote.room_type_id || undefined}
            tariffPlan={quote.tariff_plan}
            quoteToken={quote.quote_token || undefined}
            expVariant={expVariant}
            quoteExpired={quoteExpired}
            bookingUnavailable={!quote.available}
            bookingUnavailableMessage={copy.unavailable}
            quoteRefreshing={isPending || autoRefreshing}
            onRefreshQuote={() => refreshQuote("retry")}
          />
        </div>

        <section className="checkout-adjust-card">
          <h3>{copy.adjustTitle}</h3>
          <DateRangePicker
            lang={lang}
            variant="booking"
            value={{ checkIn: stayCheckIn, checkOut: stayCheckOut }}
            onChange={(range) => {
              setStayCheckIn(range.checkIn);
              setStayCheckOut(range.checkOut);
            }}
            minDate={minBookDate}
            maxDate={maxBookDate}
            checkInLabel={copy.checkInLabel}
            checkOutLabel={copy.checkOutLabel}
          />
          <label className="field-stack">
            <span>{copy.guestsLabel}</span>
            <input
              type="number"
              min={1}
              max={12}
              value={stayGuests}
              suppressHydrationWarning
              onChange={(event) => setStayGuests(Number(event.target.value) || 1)}
            />
          </label>
          <button
            type="button"
            className="ghost-btn quote-refresh-btn"
            disabled={isPending || autoRefreshing || !adjustValid}
            onClick={handleRefreshClick}
          >
            {isPending || autoRefreshing ? copy.refreshingQuote : copy.applyAdjustments}
          </button>
        </section>

        <div className={`quote-lock-card ${quoteExpired ? "expired" : ""}`}>
          <div className="quote-lock-meta">
            <span>{copy.lockTitle}</span>
            <b>{lockTimer}</b>
          </div>
          {safeToast ? <div className={`checkout-toast ${safeToast.kind}`}>{safeToast.text}</div> : null}
          <p>{quoteExpired ? copy.lockExpired : copy.lockActive}</p>
          <button
            type="button"
            className="ghost-btn quote-refresh-btn"
            disabled={isPending || autoRefreshing}
            onClick={handleRefreshClick}
          >
            {isPending || autoRefreshing ? copy.refreshingQuote : quoteExpired ? copy.lockExpiredAction : copy.refreshQuote}
          </button>
        </div>
      </article>

      <aside className="checkout-summary">
        <TrustLayerCard
          lang={lang}
          currency={currency}
          title={copy.trustTitle}
          nights={quote.nights}
          nightlyPriceKzt={quote.nightly_price}
          cleaningFeeKzt={quote.cleaning_fee}
          serviceFeeKzt={quote.service_fee}
          totalKzt={quote.total}
          cancellationText={quote.cancellation_text}
          checkInWindow={copy.checkInWindow}
          checkOutWindow={copy.checkOutWindow}
        />
        {dynamicPercent > 0 ? (
          <div className="dynamic-pricing-note">
            <span>
              {copy.dynamicPricing}: +{dynamicPercent}%
            </span>
            <small>{copy.dynamicPricingHint}</small>
          </div>
        ) : null}
        <div className="checkout-trust">
          <p>
            <b>{copy.included}:</b>
          </p>
          <ul>
            <li>{copy.instant}</li>
            <li>{copy.support}</li>
            <li>{copy.secure}</li>
          </ul>
        </div>
      </aside>

      <a href="#checkout-reservation" className="checkout-mobile-action">
        <span>
          <small>{quote.available ? mobileCopy.total : mobileCopy.unavailable}</small>
          <b>{mobileTotal}</b>
        </span>
        <strong>{mobileCopy.cta}</strong>
      </a>
    </section>
  );
}

