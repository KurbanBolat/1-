import Link from "next/link";
import { redirect } from "next/navigation";

import { PaymentResultTracker } from "../../../components/AnalyticsTrackers";
import StayPilotShell from "../../../components/StayPilotShell";
import { getReservationCancellationTerms } from "../../../lib/api";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

const USD_RATE = 500;

const t = {
  en: {
    title: "Booking confirmed",
    subtitle: "Your reservation has been created successfully.",
    titleFailed: "Payment failed",
    subtitleFailed: "Reservation draft is saved. You can retry payment.",
    titlePending: "Payment pending",
    subtitlePending: "Reservation is waiting for provider confirmation.",
    resultPaidTitle: "Payment completed",
    resultPaidCopy: "Your reservation, account access, and in-stay services are ready.",
    resultFailedTitle: "Payment needs attention",
    resultFailedCopy: "The reservation draft is still saved. Retry payment or adjust booking details.",
    resultPendingTitle: "Waiting for payment confirmation",
    resultPendingCopy: "Your payment attempt is pending. The final status will update after the provider webhook arrives.",
    summaryTitle: "Reservation summary",
    reservationId: "Reservation ID",
    stay: "Stay",
    room: "Room",
    period: "Dates",
    guests: "Guests",
    total: "Total",
    backHome: "Back to search",
    backStay: "Open stay page",
    account: "Open account",
    payment: "Payment",
    retryPayment: "Retry payment",
    editBooking: "Edit booking details",
    resultActionsTitle: "Next step",
    failedActionTitle: "Complete payment",
    pendingActionTitle: "Track reservation",
    nextTitle: "During your stay",
    nextSubtitle: "Your AI concierge can help with hotel restaurants and room service using this confirmed reservation.",
    openConcierge: "Open AI concierge",
    showRestaurants: "Show hotel restaurants",
    reservationState: "Reservation state",
    attemptState: "Attempt state",
    statusPaid: "Paid",
    statusFailed: "Failed",
    statusPending: "Pending",
    methodCard: "Bank card",
    methodKaspi: "Kaspi Pay",
    methodApplePay: "Apple Pay",
    methodUnknown: "Unknown method",
    reservationDraft: "Draft",
    reservationPendingPayment: "Pending payment",
    reservationConfirmed: "Confirmed",
    reservationCheckedIn: "Checked-in",
    reservationCheckedOut: "Checked-out",
    reservationCancelled: "Cancelled",
    reservationExpired: "Expired",
    flowTitle: "Booking flow",
    flowDetails: "1. Details",
    flowDraft: "2. Draft",
    flowPayment: "3. Payment",
    flowConfirmed: "4. Confirmed",
    flowFailed: "4. Failed",
    cancellationTerms: "Cancellation terms",
    penalty: "Penalty",
    refund: "Refund",
    daysBeforeCheckIn: "Days before check-in",
    cancellationRule: "Rule",
    cancellationRuleStrict: "Strict cancellation policy",
    cancellationRuleFlexible: "Flexible cancellation policy",
    cancellationRuleStandard: "Standard cancellation policy",
  },
  ru: {
    title: "Бронирование подтверждено",
    subtitle: "Ваше бронирование успешно создано.",
    titleFailed: "Оплата не прошла",
    subtitleFailed: "Черновик брони сохранен. Вы можете повторить оплату.",
    titlePending: "Оплата ожидает подтверждения",
    subtitlePending: "Бронь ждет подтверждение от платежного провайдера.",
    resultPaidTitle: "Оплата завершена",
    resultPaidCopy: "Бронь, доступ в кабинет и сервисы проживания готовы.",
    resultFailedTitle: "Оплата требует внимания",
    resultFailedCopy: "Черновик брони сохранен. Повторите оплату или измените параметры брони.",
    resultPendingTitle: "Ждем подтверждение оплаты",
    resultPendingCopy: "Платежная попытка в обработке. Финальный статус обновится после ответа платежного провайдера.",
    summaryTitle: "Сводка бронирования",
    reservationId: "Номер брони",
    stay: "Объект",
    room: "Категория",
    period: "Даты",
    guests: "Гости",
    total: "Итого",
    backHome: "Вернуться к поиску",
    backStay: "Открыть объект",
    account: "Открыть кабинет",
    payment: "Оплата",
    retryPayment: "Повторить оплату",
    editBooking: "Изменить параметры брони",
    resultActionsTitle: "Следующий шаг",
    failedActionTitle: "Завершить оплату",
    pendingActionTitle: "Следить за бронью",
    nextTitle: "Во время проживания",
    nextSubtitle: "AI-консьерж уже видит эту бронь и поможет с ресторанами отеля и заказами в номер.",
    openConcierge: "Открыть AI-консьержа",
    showRestaurants: "Показать рестораны отеля",
    reservationState: "Статус брони",
    attemptState: "Статус попытки",
    statusPaid: "Оплачено",
    statusFailed: "Ошибка",
    statusPending: "В обработке",
    methodCard: "Банковская карта",
    methodKaspi: "Kaspi Pay",
    methodApplePay: "Apple Pay",
    methodUnknown: "Способ не указан",
    reservationDraft: "Черновик",
    reservationPendingPayment: "Ожидает оплаты",
    reservationConfirmed: "Подтверждена",
    reservationCheckedIn: "Заезд",
    reservationCheckedOut: "Выезд",
    reservationCancelled: "Отменена",
    reservationExpired: "Истекла",
    flowTitle: "Этапы бронирования",
    flowDetails: "1. Данные",
    flowDraft: "2. Черновик",
    flowPayment: "3. Оплата",
    flowConfirmed: "4. Подтверждено",
    flowFailed: "4. Ошибка",
    cancellationTerms: "Условия отмены",
    penalty: "Штраф",
    refund: "К возврату",
    daysBeforeCheckIn: "Дней до заезда",
    cancellationRule: "Правило",
    cancellationRuleStrict: "Строгая политика отмены",
    cancellationRuleFlexible: "Гибкая политика отмены",
    cancellationRuleStandard: "Стандартная политика отмены",
  },
} as const;

function formatPrice(valueKzt: number, currency: Currency, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (currency === "USD") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      valueKzt / USD_RATE,
    );
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(valueKzt);
}

function formatIsoDate(isoDate: string, lang: Lang): string {
  if (!isoDate) return "";
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const value = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(value);
}

function paymentStatusLabel(status: string, tr: (typeof t)["en"] | (typeof t)["ru"]): string {
  if (status === "paid") return tr.statusPaid;
  if (status === "failed") return tr.statusFailed;
  return tr.statusPending;
}

function paymentMethodLabel(method: string, tr: (typeof t)["en"] | (typeof t)["ru"]): string {
  if (method === "card") return tr.methodCard;
  if (method === "kaspi") return tr.methodKaspi;
  if (method === "apple_pay") return tr.methodApplePay;
  return tr.methodUnknown;
}

function reservationStatusLabel(status: string, tr: (typeof t)["en"] | (typeof t)["ru"]): string {
  if (status === "draft") return tr.reservationDraft;
  if (status === "pending_payment") return tr.reservationPendingPayment;
  if (status === "confirmed") return tr.reservationConfirmed;
  if (status === "checked_in") return tr.reservationCheckedIn;
  if (status === "checked_out") return tr.reservationCheckedOut;
  if (status === "cancelled") return tr.reservationCancelled;
  return tr.reservationExpired;
}

function cancellationReasonLabel(reason: string, tr: (typeof t)["en"] | (typeof t)["ru"]): string {
  if (reason.startsWith("basic_")) return tr.cancellationRuleStrict;
  if (reason.startsWith("flex_")) return tr.cancellationRuleFlexible;
  return tr.cancellationRuleStandard;
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: {
    reservation_id?: string;
    listing_id?: string;
    title?: string;
    check_in?: string;
    check_out?: string;
    guests?: string;
    guest_email?: string;
    total?: string;
    room_type_id?: string;
    room_type_name?: string;
    payment_status?: string;
    payment_method?: string;
    reservation_status?: string;
    attempt_status?: string;
    lang?: string;
    currency?: string;
    exp_variant?: string;
    access_token?: string;
  };
}) {
  const reservationId = searchParams.reservation_id || "";
  const listingId = Number(searchParams.listing_id || "0");
  const listingTitle = searchParams.title || "";
  const checkIn = searchParams.check_in || "";
  const checkOut = searchParams.check_out || "";
  const guests = Number(searchParams.guests || "0");
  const guestEmail = searchParams.guest_email || "";
  const total = Number(searchParams.total || "0");
  const roomTypeId = searchParams.room_type_id || "";
  const roomTypeName = searchParams.room_type_name || "";
  const paymentStatus = searchParams.payment_status || "";
  const paymentMethod = searchParams.payment_method || "";
  const reservationStatus = searchParams.reservation_status || "";
  const attemptStatus = searchParams.attempt_status || "";
  const lang: Lang = searchParams.lang === "ru" ? "ru" : "en";
  const currency: Currency = searchParams.currency === "KZT" ? "KZT" : "USD";
  const expVariant = searchParams.exp_variant === "b" ? "b" : "a";
  const accessToken = searchParams.access_token || "";

  if (!reservationId || !listingId) {
    redirect(`/?lang=${lang}&currency=${currency}`);
  }

  const tr = t[lang];
  const isPaid = paymentStatus === "paid";
  const isPending = paymentStatus === "pending" || reservationStatus === "pending_payment";
  const isFailed = paymentStatus === "failed";
  const resultState = isPaid ? "paid" : isPending ? "pending" : "failed";
  const resultMark = isPaid ? "OK" : isPending ? "..." : "!";
  const resultTitle = isPaid ? tr.resultPaidTitle : isPending ? tr.resultPendingTitle : tr.resultFailedTitle;
  const resultCopy = isPaid ? tr.resultPaidCopy : isPending ? tr.resultPendingCopy : tr.resultFailedCopy;
  const paymentStatusText = paymentStatus ? paymentStatusLabel(paymentStatus, tr) : "";
  const paymentMethodText = paymentMethod ? paymentMethodLabel(paymentMethod, tr) : "";
  const reservationStatusText = reservationStatus ? reservationStatusLabel(reservationStatus, tr) : "";
  const attemptStatusText = attemptStatus ? paymentStatusLabel(attemptStatus, tr) : "";
  const periodLabel =
    checkIn && checkOut
      ? `${formatIsoDate(checkIn, lang)} - ${formatIsoDate(checkOut, lang)}`
      : "";
  const detailsActive = true;
  const draftActive = Boolean(reservationStatus || paymentStatus);
  const paymentActive = paymentStatus === "paid" || paymentStatus === "failed" || paymentStatus === "pending";
  const confirmedActive = isPaid || reservationStatus === "confirmed";
  const failedActive = isFailed;
  const paymentRetryParams = new URLSearchParams({
    reservation_id: String(reservationId),
    listing_id: String(listingId),
    title: listingTitle,
    check_in: checkIn,
    check_out: checkOut,
    guests: String(guests),
    guest_email: guestEmail,
    total: String(total),
    lang,
    currency,
    exp_variant: expVariant,
  });
  if (accessToken) paymentRetryParams.set("access_token", accessToken);
  if (roomTypeId) paymentRetryParams.set("room_type_id", roomTypeId);
  if (roomTypeName) paymentRetryParams.set("room_type_name", roomTypeName);
  const paymentRetryQuery = paymentRetryParams.toString();
  const editBookingParams = new URLSearchParams({
    listing_id: String(listingId),
    check_in: checkIn,
    check_out: checkOut,
    guests: String(guests),
    lang,
    currency,
    exp_variant: expVariant,
  });
  if (roomTypeId) editBookingParams.set("room_type_id", roomTypeId);
  if (roomTypeName) editBookingParams.set("room_type_name", roomTypeName);
  const editBookingQuery = editBookingParams.toString();
  const stayParams = new URLSearchParams({
    lang,
    currency,
    exp_variant: expVariant,
    reservation_id: String(reservationId),
    check_in: checkIn,
    check_out: checkOut,
    guests: String(guests),
  });
  if (roomTypeId) stayParams.set("room_type_id", roomTypeId);
  if (roomTypeName) stayParams.set("room_type_name", roomTypeName);
  if (guestEmail) stayParams.set("guest_email", guestEmail);
  if (accessToken) stayParams.set("access_token", accessToken);
  const stayQuery = stayParams.toString();
  const stayHref = `/stays/${listingId}?${stayQuery}`;
  const accountParams = new URLSearchParams({
    lang,
    currency,
    reservation_id: String(reservationId),
  });
  if (guestEmail) accountParams.set("guest_email", guestEmail);
  if (accessToken) accountParams.set("access_token", accessToken);
  const accountHref = `/account?${accountParams.toString()}`;
  const conciergeHref = `/stays/${listingId}?${new URLSearchParams({
    ...Object.fromEntries(stayParams.entries()),
    from_payment: "1",
    concierge: "1",
  }).toString()}#in-stay-concierge`;
  const restaurantsHref = `${stayHref}#hotel-restaurants`;

  let cancellationTerms: Awaited<ReturnType<typeof getReservationCancellationTerms>> | null = null;
  try {
    cancellationTerms = await getReservationCancellationTerms(Number(reservationId), accessToken);
  } catch {
    cancellationTerms = null;
  }

  return (
    <StayPilotShell lang={lang} currency={currency} active="checkout" accountHref={accountHref}>
      <div className="sp-transaction-page sp-success-page">
        <section className="property-detail checkout-main sp-success-panel">
        <PaymentResultTracker
          listingId={listingId}
          reservationId={Number(reservationId)}
          lang={lang}
          currency={currency}
          variant={expVariant}
          paymentStatus={paymentStatus === "paid" || paymentStatus === "failed" || paymentStatus === "pending" ? paymentStatus : ""}
        />
        <h1>{isPaid ? tr.title : isPending ? tr.titlePending : tr.titleFailed}</h1>
        <p className="desc">{isPaid ? tr.subtitle : isPending ? tr.subtitlePending : tr.subtitleFailed}</p>
        <section className={`success-result-card ${resultState}`}>
          <div className="success-result-mark" aria-hidden="true">
            {resultMark}
          </div>
          <div>
            <p className="success-next-kicker">{tr.payment}</p>
            <h2>{resultTitle}</h2>
            <p className="desc">{resultCopy}</p>
          </div>
          <div className="success-result-meta">
            <span>{tr.reservationId}</span>
            <b>#{reservationId}</b>
          </div>
        </section>
        <section className={`success-priority-card ${resultState}`} aria-label={tr.resultActionsTitle}>
          <div>
            <p className="success-next-kicker">{isPaid ? tr.nextTitle : tr.resultActionsTitle}</p>
            <h2>{isPaid ? tr.openConcierge : isFailed ? tr.failedActionTitle : tr.pendingActionTitle}</h2>
            <p className="desc">{isPaid ? tr.nextSubtitle : isFailed ? tr.resultFailedCopy : tr.resultPendingCopy}</p>
          </div>
          <div className="success-priority-actions">
            {isPaid ? (
              <>
                <Link className="primary" href={conciergeHref}>{tr.openConcierge}</Link>
                <Link href={accountHref}>{tr.account}</Link>
                <Link href={restaurantsHref}>{tr.showRestaurants}</Link>
              </>
            ) : isFailed ? (
              <>
                <Link className="primary" href={`/checkout/payment?${paymentRetryQuery}`}>{tr.retryPayment}</Link>
                <Link href={`/checkout?${editBookingQuery}`}>{tr.editBooking}</Link>
                <Link href={accountHref}>{tr.account}</Link>
              </>
            ) : (
              <>
                <Link className="primary" href={accountHref}>{tr.account}</Link>
                <Link href={stayHref}>{tr.backStay}</Link>
              </>
            )}
          </div>
        </section>
        <section className="booking-flow-card" style={{ marginTop: 8 }}>
          <p className="desc"><b>{tr.flowTitle}</b></p>
          <div className="pill-row">
            <span className={detailsActive ? "flow-pill active" : "flow-pill"}>{tr.flowDetails}</span>
            <span className={draftActive ? "flow-pill active" : "flow-pill"}>{tr.flowDraft}</span>
            <span className={paymentActive ? "flow-pill active" : "flow-pill"}>{tr.flowPayment}</span>
            {failedActive ? (
              <span className="flow-pill active">{tr.flowFailed}</span>
            ) : (
              <span className={confirmedActive ? "flow-pill active" : "flow-pill"}>{tr.flowConfirmed}</span>
            )}
          </div>
        </section>
        <section className="success-booking-summary">
          <h2>{tr.summaryTitle}</h2>
          <div className="success-booking-grid">
            <div>
              <span>{tr.stay}</span>
              <b>{listingTitle || `#${listingId}`}</b>
            </div>
            {roomTypeName ? (
              <div>
                <span>{tr.room}</span>
                <b>{roomTypeName}</b>
              </div>
            ) : null}
            {periodLabel ? (
              <div>
                <span>{tr.period}</span>
                <b>{periodLabel}</b>
              </div>
            ) : null}
            {guests > 0 ? (
              <div>
                <span>{tr.guests}</span>
                <b>{guests}</b>
              </div>
            ) : null}
            {total > 0 ? (
              <div>
                <span>{tr.total}</span>
                <b>{formatPrice(total, currency, lang)}</b>
              </div>
            ) : null}
            {paymentStatus ? (
              <div>
                <span>{tr.payment}</span>
                <b>{paymentStatusText} {paymentMethodText ? `- ${paymentMethodText}` : ""}</b>
              </div>
            ) : null}
            {reservationStatusText ? (
              <div>
                <span>{tr.reservationState}</span>
                <b>{reservationStatusText}</b>
              </div>
            ) : null}
            {attemptStatusText ? (
              <div>
                <span>{tr.attemptState}</span>
                <b>{attemptStatusText}</b>
              </div>
            ) : null}
          </div>
        </section>

        {cancellationTerms ? (
          <section className="ui-card cancellation-terms-card">
            <p className="desc"><b>{tr.cancellationTerms}</b></p>
            <div className="pill-row">
              <span>{tr.penalty}: {formatPrice(cancellationTerms.penalty_amount, currency, lang)} ({cancellationTerms.penalty_percent}%)</span>
              <span>{tr.refund}: {formatPrice(cancellationTerms.refund_amount, currency, lang)}</span>
              <span>{tr.daysBeforeCheckIn}: {cancellationTerms.days_before_check_in}</span>
            </div>
            <p className="desc" style={{ marginBottom: 0 }}>
              <b>{tr.cancellationRule}:</b> {cancellationReasonLabel(cancellationTerms.reason, tr)}
            </p>
          </section>
        ) : null}

        <div className="actions actions-modern">
          {isFailed ? <Link href={`/checkout/payment?${paymentRetryQuery}`}>{tr.retryPayment}</Link> : null}
          {isFailed ? <Link href={`/checkout?${editBookingQuery}`}>{tr.editBooking}</Link> : null}
          <Link href={accountHref}>{tr.account}</Link>
          <Link href={stayHref}>{tr.backStay}</Link>
          <Link href={`/?lang=${lang}&currency=${currency}&exp_variant=${expVariant}`}>{tr.backHome}</Link>
        </div>
        </section>
      </div>
    </StayPilotShell>
  );
}
