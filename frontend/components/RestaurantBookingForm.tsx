"use client";

import { useEffect, useState } from "react";

import {
  createRestaurantBooking,
  getRestaurantBookingEventsByReservation,
  getRestaurantBookingsByReservation,
  type RestaurantBooking,
  type RestaurantBookingEvent,
} from "../lib/api";
import {
  formatRestaurantBookingEventDateTime,
  getRestaurantBookingEventLabel,
  getRestaurantBookingStatusClass,
  getRestaurantBookingStatusLabel,
} from "../lib/restaurantBookingUi";

type Lang = "en" | "ru";

type Props = {
  reservationId: number;
  restaurantId: number;
  guestEmail: string;
  accessToken?: string;
  lang: Lang;
};

const t = {
  en: {
    title: "Reserve a table",
    date: "Date",
    time: "Time",
    guests: "Guests",
    note: "Comment",
    submit: "Reserve table",
    done: "Table booking submitted. We will confirm shortly.",
    myBookings: "My table bookings",
    emptyBookings: "No table bookings yet",
    updatesTitle: "Booking updates",
    emptyUpdates: "No updates yet",
    statusLabel: "Status",
  },
  ru: {
    title: "Бронирование столика",
    date: "Дата",
    time: "Время",
    guests: "Гостей",
    note: "Комментарий",
    submit: "Забронировать столик",
    done: "Бронь столика отправлена. Скоро подтвердим.",
    myBookings: "Мои брони столиков",
    emptyBookings: "Пока нет бронирований столиков",
    updatesTitle: "Обновления по броням",
    emptyUpdates: "Обновлений пока нет",
    statusLabel: "Статус",
  },
} as const;

function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = (error.message || "").toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("network error");
}

function toDisplayEventMessage(event: RestaurantBookingEvent, lang: Lang): string {
  return getRestaurantBookingEventLabel(lang, event.event_type, event.message);
}

export default function RestaurantBookingForm({ reservationId, restaurantId, guestEmail, accessToken, lang }: Props) {
  const tr = t[lang];
  const [bookingDate, setBookingDate] = useState(() => toIsoDay(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [bookingTime, setBookingTime] = useState("19:00");
  const [guests, setGuests] = useState(2);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<RestaurantBooking[]>([]);
  const [events, setEvents] = useState<RestaurantBookingEvent[]>([]);

  async function refreshData() {
    try {
      const [bookingRows, eventRows] = await Promise.all([
        getRestaurantBookingsByReservation(reservationId, guestEmail, accessToken),
        getRestaurantBookingEventsByReservation(reservationId, guestEmail, accessToken),
      ]);
      setBookings(bookingRows.filter((row) => row.restaurant_id === restaurantId));
      setEvents(eventRows.filter((row) => row.restaurant_id === restaurantId));
      return bookingRows;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    void refreshData();
  }, [reservationId, guestEmail, accessToken, restaurantId]);

  async function onSubmit() {
    if (loading) return;
    setStatus("");
    setLoading(true);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await createRestaurantBooking({
          reservation_id: reservationId,
          restaurant_id: restaurantId,
          guest_email: guestEmail,
          access_token: accessToken,
          booking_date: bookingDate,
          booking_time: bookingTime,
          guests,
          note,
        });
        setNote("");
        setStatus(tr.done);
        await refreshData();
        setLoading(false);
        return;
      } catch (error) {
        const rows = await refreshData();
        const bookingExists = rows?.some(
          (row) =>
            row.restaurant_id === restaurantId &&
            row.booking_date === bookingDate &&
            row.booking_time === bookingTime &&
            (row.status === "submitted" || row.status === "confirmed" || row.status === "seated"),
        );
        if (bookingExists) {
          setNote("");
          setStatus(tr.done);
          setLoading(false);
          return;
        }
        if (attempt < 2 && isTransientNetworkError(error)) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          continue;
        }
        setStatus(error instanceof Error ? error.message : "Failed");
        setLoading(false);
        return;
      }
    }
  }

  return (
    <section className="property-detail restaurant-booking-card">
      <h3>{tr.title}</h3>
      <div className="booking-form">
        <label className="field-stack">
          <span>{tr.date}</span>
          <input suppressHydrationWarning type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
        </label>
        <div className="booking-row">
          <label className="field-stack">
            <span>{tr.time}</span>
            <input suppressHydrationWarning type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} />
          </label>
          <label className="field-stack">
            <span>{tr.guests}</span>
            <input
              suppressHydrationWarning
              type="number"
              min={1}
              max={20}
              value={guests}
              onChange={(e) => setGuests(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
        <label className="field-stack">
          <span>{tr.note}</span>
          <input suppressHydrationWarning value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" onClick={() => void onSubmit()} disabled={loading}>
          {tr.submit}
        </button>
      </div>
      {status ? <p className="form-status">{status}</p> : null}

      <h4>{tr.updatesTitle}</h4>
      <div className="manager-list">
        {events.map((event) => (
          <article key={event.id} className="manager-item">
            <div className="manager-item-head">
              <b>{toDisplayEventMessage(event, lang)}</b>
              <span className={`status-pill ${getRestaurantBookingStatusClass(event.status)}`}>
                {getRestaurantBookingStatusLabel(lang, event.status)}
              </span>
            </div>
            <small>{formatRestaurantBookingEventDateTime(lang, event.created_at)}</small>
          </article>
        ))}
        {events.length === 0 ? <p className="desc">{tr.emptyUpdates}</p> : null}
      </div>

      <h4>{tr.myBookings}</h4>
      <div className="manager-list">
        {bookings.map((booking) => (
          <article key={booking.id} className="manager-item">
            <div className="manager-item-head">
              <b>#{booking.id}</b>
              <span className={`status-pill ${getRestaurantBookingStatusClass(booking.status)}`}>
                {getRestaurantBookingStatusLabel(lang, booking.status)}
              </span>
            </div>
            <small>
              {booking.booking_date} {booking.booking_time}
            </small>
            <small>
              {tr.statusLabel}: {getRestaurantBookingStatusLabel(lang, booking.status)}
            </small>
            <small>
              {tr.guests}: {booking.guests}
            </small>
          </article>
        ))}
        {bookings.length === 0 ? <p className="desc">{tr.emptyBookings}</p> : null}
      </div>
    </section>
  );
}
