import Link from "next/link";
import { redirect } from "next/navigation";

import PaymentStepForm from "../../../components/PaymentStepForm";
import StayPilotShell from "../../../components/StayPilotShell";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

const USD_RATE = 500;

const t = {
  en: {
    title: "Payment",
    subtitle: "Complete payment to finalize your reservation.",
    reservationId: "Reservation ID",
    period: "Dates",
    guests: "Guests",
    room: "Room",
    total: "Total",
    amountDue: "Amount due",
    paymentSummary: "Payment summary",
    bookingSummary: "Booking",
    secureTitle: "Protected payment",
    secureCopy: "Reservation access token is kept in the payment link and reused for account and in-stay services.",
    editBooking: "Edit dates and guests",
    back: "Back to stay",
  },
  ru: {
    title: "Оплата бронирования",
    subtitle: "Завершите оплату, чтобы финализировать бронь.",
    reservationId: "Номер брони",
    period: "Даты",
    guests: "Гости",
    room: "Категория",
    total: "Итого",
    amountDue: "К оплате",
    paymentSummary: "Сводка оплаты",
    bookingSummary: "Бронь",
    secureTitle: "Защищенная оплата",
    secureCopy: "Токен доступа к брони сохраняется в платежной ссылке и используется для кабинета и сервисов проживания.",
    editBooking: "Изменить даты и гостей",
    back: "Назад к объекту",
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
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default function CheckoutPaymentPage({
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
    lang?: string;
    currency?: string;
    exp_variant?: string;
    access_token?: string;
  };
}) {
  const reservationId = Number(searchParams.reservation_id || "0");
  const listingId = Number(searchParams.listing_id || "0");
  const listingTitle = searchParams.title || "";
  const checkIn = searchParams.check_in || "";
  const checkOut = searchParams.check_out || "";
  const guests = Number(searchParams.guests || "0");
  const guestEmail = searchParams.guest_email || "";
  const total = Number(searchParams.total || "0");
  const roomTypeId = searchParams.room_type_id || "";
  const roomTypeName = searchParams.room_type_name || "";
  const lang: Lang = searchParams.lang === "ru" ? "ru" : "en";
  const currency: Currency = searchParams.currency === "KZT" ? "KZT" : "USD";
  const expVariant = searchParams.exp_variant === "b" ? "b" : "a";
  const accessToken = searchParams.access_token || "";
  const tr = t[lang];
  const periodLabel = checkIn && checkOut ? `${formatIsoDate(checkIn, lang)} - ${formatIsoDate(checkOut, lang)}` : "";
  const editCheckoutParams = new URLSearchParams({
    listing_id: String(listingId),
    check_in: checkIn,
    check_out: checkOut,
    guests: String(guests),
    lang,
    currency,
    exp_variant: expVariant,
  });
  if (roomTypeId) editCheckoutParams.set("room_type_id", roomTypeId);
  if (roomTypeName) editCheckoutParams.set("room_type_name", roomTypeName);
  const editCheckoutHref = `/checkout?${editCheckoutParams.toString()}`;
  const stayBackParams = new URLSearchParams({
    lang,
    currency,
    exp_variant: expVariant,
    check_in: checkIn,
    check_out: checkOut,
    guests: String(guests),
  });
  if (roomTypeId) stayBackParams.set("room_type_id", roomTypeId);
  const accountParams = new URLSearchParams({
    lang,
    currency,
    reservation_id: String(reservationId),
  });
  if (guestEmail) accountParams.set("guest_email", guestEmail);
  if (accessToken) accountParams.set("access_token", accessToken);
  const accountHref = `/account?${accountParams.toString()}`;

  if (!reservationId || !listingId) {
    redirect(`/?lang=${lang}&currency=${currency}`);
  }

  return (
    <StayPilotShell lang={lang} currency={currency} active="checkout" accountHref={accountHref}>
      <div className="sp-transaction-page sp-payment-page">
        <Link href={`/stays/${listingId}?${stayBackParams.toString()}#available-rooms`} className="sp-back-link">
          {tr.back}
        </Link>
        <section className="property-detail checkout-main sp-payment-panel">
          <h1>{tr.title}</h1>
          <p className="desc">{tr.subtitle}</p>

          <section className="payment-booking-summary">
            <div className="payment-booking-summary-head">
              <div>
                <span>{tr.paymentSummary}</span>
                <b>{tr.reservationId}: #{reservationId}</b>
              </div>
              <div className="payment-booking-total">
                <span>{tr.amountDue}</span>
                <strong>{formatPrice(total, currency, lang)}</strong>
              </div>
            </div>
            <div className="payment-booking-grid">
              <div>
                <span>{tr.bookingSummary}</span>
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
            </div>
            <p className="payment-secure-note">
              <b>{tr.secureTitle}.</b> {tr.secureCopy}
            </p>
          </section>

          <div className="actions actions-modern">
            <Link href={editCheckoutHref}>{tr.editBooking}</Link>
          </div>
          <PaymentStepForm
            reservationId={reservationId}
            listingId={listingId}
            listingTitle={listingTitle}
            roomTypeId={roomTypeId}
            roomTypeName={roomTypeName}
            checkIn={checkIn}
            checkOut={checkOut}
            guests={guests}
            guestEmail={guestEmail}
            total={total}
            accessToken={accessToken}
            lang={lang}
            currency={currency}
            expVariant={expVariant}
          />
        </section>
      </div>
    </StayPilotShell>
  );
}

