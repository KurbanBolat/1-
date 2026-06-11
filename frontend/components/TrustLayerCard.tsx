"use client";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

const USD_RATE = 500;

function formatPrice(valueKzt: number, currency: Currency, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (currency === "USD") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(valueKzt / USD_RATE);
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(valueKzt);
}

function humanPolicyLabel(policy: string, lang: Lang): string {
  const value = (policy || "").trim().toLowerCase();
  if (!value) return policy;
  if (lang === "ru") {
    if (value === "strict") return "Строгая";
    if (value === "moderate") return "Умеренная";
    if (value === "flexible") return "Гибкая";
    return policy;
  }
  if (value === "strict") return "Strict";
  if (value === "moderate") return "Moderate";
  if (value === "flexible") return "Flexible";
  return policy;
}

export default function TrustLayerCard({
  lang,
  currency,
  title,
  note,
  nights,
  nightlyPriceKzt,
  cleaningFeeKzt,
  serviceFeeKzt,
  totalKzt,
  cancellationText,
  checkInWindow,
  checkOutWindow,
}: {
  lang: Lang;
  currency: Currency;
  title: string;
  note?: string;
  nights: number;
  nightlyPriceKzt: number;
  cleaningFeeKzt: number;
  serviceFeeKzt: number;
  totalKzt: number;
  cancellationText: string;
  checkInWindow: string;
  checkOutWindow: string;
}) {
  const text =
    lang === "ru"
      ? {
          nightly: "Цена за ночь",
          nights: "Ночей",
          cleaning: "Уборка",
          service: "Сервисный сбор",
          total: "К оплате",
          noHidden: "Без скрытых платежей",
          policy: "Условия отмены",
          checkIn: "Заезд",
          checkOut: "Выезд",
        }
      : {
          nightly: "Nightly rate",
          nights: "Nights",
          cleaning: "Cleaning fee",
          service: "Service fee",
          total: "Total to pay",
          noHidden: "No hidden fees",
          policy: "Cancellation terms",
          checkIn: "Check-in",
          checkOut: "Check-out",
        };

  return (
    <section className="trust-layer-card">
      <h3>{title}</h3>
      <p className="trust-layer-kicker">{text.noHidden}</p>
      {note ? <p className="trust-layer-note">{note}</p> : null}
      <div className="summary-row">
        <span>{text.nightly}</span>
        <b>{formatPrice(nightlyPriceKzt, currency, lang)}</b>
      </div>
      <div className="summary-row">
        <span>{text.nights}</span>
        <b>{nights}</b>
      </div>
      <div className="summary-row">
        <span>{text.cleaning}</span>
        <b>{formatPrice(cleaningFeeKzt, currency, lang)}</b>
      </div>
      <div className="summary-row">
        <span>{text.service}</span>
        <b>{formatPrice(serviceFeeKzt, currency, lang)}</b>
      </div>
      <div className="summary-row total">
        <span>{text.total}</span>
        <b>{formatPrice(totalKzt, currency, lang)}</b>
      </div>
      <div className="trust-layer-meta">
        <p>
          <b>{text.policy}:</b> {humanPolicyLabel(cancellationText, lang)}
        </p>
        <p>
          <b>{text.checkIn}:</b> {checkInWindow}
        </p>
        <p>
          <b>{text.checkOut}:</b> {checkOutWindow}
        </p>
      </div>
    </section>
  );
}
