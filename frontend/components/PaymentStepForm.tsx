"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, attemptReservationPayment, getReservationPayment, type ReservationPayment } from "../lib/api";
import { fireAnalyticsEvent } from "../lib/analyticsClient";
import { getReservationAccessToken } from "../lib/guestAccess";
import { useSoftRedirect } from "../hooks/useSoftRedirect";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";
const PAYMENT_MODE = (process.env.NEXT_PUBLIC_PAYMENT_MODE || "mock").trim().toLowerCase();

export default function PaymentStepForm({
  reservationId,
  listingId,
  listingTitle,
  roomTypeId,
  roomTypeName,
  checkIn,
  checkOut,
  guests,
  guestEmail,
  total,
  accessToken,
  lang,
  currency,
  expVariant,
}: {
  reservationId: number;
  listingId: number;
  listingTitle: string;
  roomTypeId?: string;
  roomTypeName?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  guestEmail?: string;
  total: number;
  accessToken?: string;
  lang: Lang;
  currency: Currency;
  expVariant: "a" | "b";
}) {
  const router = useRouter();
  const [method, setMethod] = useState<"card" | "kaspi" | "apple_pay">("card");
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"idle" | "error" | "progress">("idle");
  const [paymentSnapshot, setPaymentSnapshot] = useState<ReservationPayment | null>(null);
  const {
    pendingUrl: pendingResultRedirect,
    hasPendingRedirect: hasPendingResultRedirect,
    scheduleRedirect: scheduleResultRedirect,
    cancelRedirect: cancelResultRedirect,
    redirectNow: redirectResultNow,
  } = useSoftRedirect({
    delayMs: 2500,
    onNavigate: (targetUrl) => router.push(targetUrl),
  });

  const text =
    lang === "ru"
      ? {
          method: "Способ оплаты",
          methodTitle: "Выберите способ оплаты",
          methodHint: "Платеж привязан к текущей брони и выбранной категории номера.",
          demoPaymentTitle: "Демо-режим оплаты",
          demoPaymentHint: "Провайдер оплаты пока заглушен: попытка проходит через внутренний mock и подтверждает бронь для демонстрации.",
          livePaymentTitle: "Платежный провайдер",
          livePaymentHint: "Платеж будет обработан через настроенный provider, а финальный статус придет через webhook.",
          card: "Банковская карта",
          cardHint: "Visa, Mastercard или локальная карта",
          kaspi: "Kaspi Pay",
          kaspiHint: "Оплата через Kaspi для гостей из Казахстана",
          apple: "Apple Pay",
          appleHint: "Быстрая оплата через сохраненный кошелек",
          payNow: "Оплатить сейчас",
          paying: "Обработка платежа...",
          failed: "Оплата не прошла, попробуйте снова.",
          unavailableDates: "Выбранные даты уже недоступны. Обновите объект и выберите другие даты.",
          paymentNotAllowed: "Оплата сейчас недоступна для этого статуса брони.",
          retryDetected: "Повторный запрос обнаружен: использована существующая попытка оплаты.",
          declineHint: "Попробуйте другой способ оплаты или повторите попытку через 1-2 минуты.",
          datesUnavailableHint: "Выберите другие даты и пересчитайте стоимость перед оплатой.",
          reservationNotFoundHint: "Проверьте ссылку или вернитесь в карточку объекта и начните оплату заново.",
          paymentNotAllowedHint: "Бронь уже завершена, отменена или истекла. Создайте новую бронь для оплаты.",
          flowState: "Состояние платежа",
          bookingState: "Статус брони",
          attemptState: "Статус попытки",
          paymentState: "Статус оплаты",
          noData: "нет данных",
          stateDraft: "Черновик",
          statePendingPayment: "Ожидает оплаты",
          stateConfirmed: "Подтверждена",
          stateCheckedIn: "Заезд",
          stateCheckedOut: "Выезд",
          stateCancelled: "Отменена",
          stateExpired: "Истекла",
          statePaid: "Оплачено",
          stateFailed: "Ошибка",
          statePending: "В процессе",
          paymentFailedRedirect: "Оплата не прошла. Перенаправляем к результату...",
          paymentPendingRedirect: "Оплата еще обрабатывается. Перенаправляем к результату...",
          paymentSuccessRedirect: "Оплата прошла. Перенаправляем к результату...",
          providerPendingHint: "Финальный статус обновится после webhook от платежного провайдера.",
          reservationNotFound: "Бронирование не найдено.",
          stayHere: "Остаться на странице",
          goNow: "Перейти сейчас",
        }
      : {
          method: "Payment method",
          methodTitle: "Choose payment method",
          methodHint: "Payment is attached to the current reservation and selected room category.",
          demoPaymentTitle: "Demo payment mode",
          demoPaymentHint: "The payment provider is stubbed: this attempt uses the internal mock flow and confirms the booking for demo use.",
          livePaymentTitle: "Payment provider",
          livePaymentHint: "Payment will be handled by the configured provider and finalized by webhook.",
          card: "Bank card",
          cardHint: "Visa, Mastercard, or local card",
          kaspi: "Kaspi Pay",
          kaspiHint: "Kaspi payment for Kazakhstan guests",
          apple: "Apple Pay",
          appleHint: "Fast payment through saved wallet",
          payNow: "Pay now",
          paying: "Processing payment...",
          failed: "Payment failed, please retry.",
          unavailableDates: "Selected dates are no longer available. Refresh and pick new dates.",
          paymentNotAllowed: "Payment is not allowed for the current reservation status.",
          retryDetected: "Duplicate request detected: reused existing payment attempt.",
          declineHint: "Try another payment method or retry in 1-2 minutes.",
          datesUnavailableHint: "Pick new dates and refresh price before payment.",
          reservationNotFoundHint: "Check the link or return to stay page and start payment again.",
          paymentNotAllowedHint: "Reservation is already finalized, cancelled, or expired. Create a new booking to pay.",
          flowState: "Payment flow state",
          bookingState: "Reservation status",
          attemptState: "Attempt status",
          paymentState: "Payment status",
          noData: "no data",
          stateDraft: "Draft",
          statePendingPayment: "Pending payment",
          stateConfirmed: "Confirmed",
          stateCheckedIn: "Checked-in",
          stateCheckedOut: "Checked-out",
          stateCancelled: "Cancelled",
          stateExpired: "Expired",
          statePaid: "Paid",
          stateFailed: "Failed",
          statePending: "Pending",
          paymentFailedRedirect: "Payment failed. Redirecting to result...",
          paymentPendingRedirect: "Payment is still processing. Redirecting to result...",
          paymentSuccessRedirect: "Payment successful. Redirecting to result...",
          providerPendingHint: "The final status will update after the payment provider webhook arrives.",
          reservationNotFound: "Reservation not found.",
          stayHere: "Stay on page",
          goNow: "Go now",
        };
  const methodOptions: Array<{ value: "card" | "kaspi" | "apple_pay"; label: string; hint: string }> = [
    { value: "card", label: text.card, hint: text.cardHint },
    { value: "kaspi", label: text.kaspi, hint: text.kaspiHint },
    { value: "apple_pay", label: text.apple, hint: text.appleHint },
  ];
  const isMockPaymentMode = PAYMENT_MODE === "mock";

  function generateIdempotencyKey(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `payment_${reservationId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function resolveAccessToken(): string {
    return accessToken || getReservationAccessToken(reservationId) || "";
  }

  function reservationStatusLabel(value?: ReservationPayment["reservation_status"]): string {
    if (!value) return text.noData;
    if (value === "draft") return text.stateDraft;
    if (value === "pending_payment") return text.statePendingPayment;
    if (value === "confirmed") return text.stateConfirmed;
    if (value === "checked_in") return text.stateCheckedIn;
    if (value === "checked_out") return text.stateCheckedOut;
    if (value === "cancelled") return text.stateCancelled;
    return text.stateExpired;
  }

  function paymentStatusLabel(value?: ReservationPayment["payment_status"]): string {
    if (!value) return text.noData;
    if (value === "paid") return text.statePaid;
    if (value === "failed") return text.stateFailed;
    return text.statePending;
  }

  function attemptStatusLabel(value?: ReservationPayment["attempt_status"]): string {
    if (!value) return text.noData;
    if (value === "paid") return text.statePaid;
    if (value === "failed") return text.stateFailed;
    return text.statePending;
  }

  function localizePaymentError(message: string, code?: string): string {
    if (code === "PAYMENT_DATES_UNAVAILABLE") return `${text.unavailableDates} ${text.datesUnavailableHint}`;
    if (code === "PAYMENT_NOT_ALLOWED") return `${text.paymentNotAllowed} ${text.paymentNotAllowedHint}`;
    if (code === "RESERVATION_NOT_FOUND") return `${text.reservationNotFound} ${text.reservationNotFoundHint}`;
    if (message.includes("Selected dates are unavailable")) return text.unavailableDates;
    if (message.includes("Payment is not allowed for this reservation status")) return text.paymentNotAllowed;
    if (message.includes("Reservation not found")) return text.reservationNotFound;
    if (message.includes("Validation failed")) return text.failed;
    return message;
  }

  async function waitForFinalPayment(reservationIdToCheck: number, maxChecks = 12, intervalMs = 500) {
    for (let i = 0; i < maxChecks; i += 1) {
      const current = await getReservationPayment(reservationIdToCheck, resolveAccessToken());
      setPaymentSnapshot(current);
      if (current.payment_status === "paid" || current.payment_status === "failed") {
        return current;
      }
      await sleep(intervalMs);
    }
    const latest = await getReservationPayment(reservationIdToCheck, resolveAccessToken());
    setPaymentSnapshot(latest);
    return latest;
  }

  async function onPay() {
    setProcessing(true);
    setStatus(text.paying);
    setStatusKind("progress");
    void fireAnalyticsEvent({
      event_name: "payment_started",
      listing_id: listingId,
      reservation_id: reservationId,
      lang,
      currency,
      metadata: { method, variant: expVariant },
    });
    try {
      const idempotencyKey = generateIdempotencyKey();
      const effectiveAccessToken = resolveAccessToken();
      const started: ReservationPayment = await attemptReservationPayment(reservationId, method, idempotencyKey, effectiveAccessToken);
      setPaymentSnapshot(started);
      if (started.idempotency_reused) {
        setStatus(text.retryDetected);
        setStatusKind("progress");
      }
      const payment = started.payment_status === "pending" ? await waitForFinalPayment(reservationId) : started;

      const query = new URLSearchParams({
        reservation_id: String(reservationId),
        listing_id: String(listingId),
        title: listingTitle,
        check_in: checkIn,
        check_out: checkOut,
        guests: String(guests),
        guest_email: guestEmail || "",
        total: String(total),
        lang,
        currency,
        payment_status: payment.payment_status,
        payment_method: payment.payment_method || "",
        reservation_status: payment.reservation_status || "",
        attempt_status: payment.attempt_status || "",
        exp_variant: expVariant,
      });
      if (roomTypeId) query.set("room_type_id", roomTypeId);
      if (roomTypeName) query.set("room_type_name", roomTypeName);
      if (effectiveAccessToken) query.set("access_token", effectiveAccessToken);
      const target = `/checkout/success?${query.toString()}`;
      scheduleResultRedirect(target);
      if (payment.payment_status === "failed") {
        setStatus(`${text.paymentFailedRedirect} ${text.declineHint}`);
        setStatusKind("error");
        return;
      }
      if (payment.payment_status === "pending") {
        setStatus(`${text.paymentPendingRedirect} ${isMockPaymentMode ? "" : text.providerPendingHint}`.trim());
        setStatusKind("progress");
        return;
      }
      setStatus(text.paymentSuccessRedirect);
      setStatusKind("progress");
    } catch (error) {
      if (error instanceof ApiError) {
        setStatus(localizePaymentError(error.message, error.code));
        setStatusKind("error");
      } else if (error instanceof Error) {
        setStatus(localizePaymentError(error.message));
        setStatusKind("error");
      } else {
        setStatus(text.failed);
        setStatusKind("error");
      }
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="booking-form">
      <section className={`payment-provider-note ${isMockPaymentMode ? "demo" : "live"}`}>
        <b>{isMockPaymentMode ? text.demoPaymentTitle : text.livePaymentTitle}</b>
        <span>{isMockPaymentMode ? text.demoPaymentHint : text.livePaymentHint}</span>
      </section>
      <fieldset className="payment-method-panel" disabled={processing}>
        <legend>{text.methodTitle}</legend>
        <p className="desc">{text.methodHint}</p>
        <div className="payment-method-grid" role="radiogroup" aria-label={text.method}>
          {methodOptions.map((option) => (
            <label key={option.value} className={`payment-method-card ${method === option.value ? "active" : ""}`}>
              <input
                type="radio"
                name="payment_method"
                value={option.value}
                checked={method === option.value}
                onChange={() => {
                  setMethod(option.value);
                  if (statusKind === "error") {
                    setStatus("");
                    setStatusKind("idle");
                  }
                }}
              />
              <span className="payment-method-copy">
                <b>{option.label}</b>
                <small>{option.hint}</small>
              </span>
              <span className="payment-method-dot" aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className={processing ? "btn-loading" : ""} onClick={onPay} disabled={processing}>
        {processing ? text.paying : text.payNow}
      </button>
      {paymentSnapshot ? (
        <section className="payment-flow-state">
          <p className="desc">{text.flowState}</p>
          <div className="pill-row">
            <span>
              {text.bookingState}: {reservationStatusLabel(paymentSnapshot.reservation_status)}
            </span>
            <span>
              {text.paymentState}: {paymentStatusLabel(paymentSnapshot.payment_status)}
            </span>
            <span>
              {text.attemptState}: {attemptStatusLabel(paymentSnapshot.attempt_status)}
            </span>
          </div>
        </section>
      ) : null}
      {hasPendingResultRedirect ? (
        <div className="ai-followups">
          <button type="button" className="ai-followup-chip" onClick={cancelResultRedirect}>
            {text.stayHere}
          </button>
          <button type="button" className="ai-followup-chip" onClick={redirectResultNow}>
            {text.goNow}
          </button>
        </div>
      ) : null}
      {status ? <p className={`form-status ${statusKind === "error" ? "error" : ""}`}>{status}</p> : null}
    </div>
  );
}

