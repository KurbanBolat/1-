"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  cancelReservation,
  getListing,
  getReservationCancellationTerms,
  getReservationPayment,
  getReservationsByEmail,
  getRestaurantBookingEventsByReservation,
  getRestaurantBookingsByReservation,
  getRoomServiceOrdersByReservation,
  type CancellationTerms,
  type Listing,
  type Reservation,
  type ReservationPayment,
  type RestaurantBooking,
  type RestaurantBookingEvent,
  type RoomServiceOrder,
} from "../lib/api";
import {
  getReservationAccessToken,
  getReservationAccessTokensForEmail,
  rememberReservationAccess,
} from "../lib/guestAccess";
import {
  formatRestaurantBookingEventDateTime,
  getRestaurantBookingEventLabel,
  getRestaurantBookingStatusClass,
  getRestaurantBookingStatusLabel,
} from "../lib/restaurantBookingUi";

type Lang = "ru" | "en";
type Currency = "KZT" | "USD";

type ReservationView = Reservation & {
  listing?: Listing | null;
};

type ReservationInStayState = {
  loaded: boolean;
  partial: boolean;
  orders: RoomServiceOrder[];
  tableBookings: RestaurantBooking[];
  bookingEvents: RestaurantBookingEvent[];
};

type Translations = {
  title: string;
  subtitle: string;
  back: string;
  focusKicker: string;
  focusTitle: string;
  focusCopy: string;
  openConcierge: string;
  openStayDetails: string;
  serviceHubTitle: string;
  serviceHubCopy: string;
  serviceHubEmpty: string;
  serviceHubLoading: string;
  profileTitle: string;
  profileHint: string;
  profileName: string;
  profilePhone: string;
  saveProfile: string;
  profileSaved: string;
  email: string;
  load: string;
  loading: string;
  empty: string;
  accessRequired: string;
  noListing: string;
  stayLink: string;
  stayServices: string;
  summaryBookings: string;
  summaryUpcoming: string;
  summaryActive: string;
  summaryTotal: string;
  repeatBooking: string;
  payment: string;
  cancelTerms: string;
  cancel: string;
  checkin: string;
  checkout: string;
  guests: string;
  room: string;
  total: string;
  paymentStatus: string;
  cancellation: string;
  refundable: string;
  penalty: string;
  error: string;
  requiredEmail: string;
  inStayTitle: string;
  inStayLoading: string;
  inStayEmpty: string;
  inStayRefresh: string;
  roomService: string;
  tableBookings: string;
  updates: string;
  activeRequests: string;
  created: string;
  partialInStay: string;
};

const RU_TRANSLATIONS: Translations = {
  title: "Личный кабинет гостя",
  subtitle: "Брони, оплата, отмена и сервисы во время проживания собраны в одном месте.",
  back: "Назад к поиску",
  focusKicker: "Бронь готова",
  focusTitle: "Бронь добавлена в кабинет",
  focusCopy: "Откройте AI-консьержа, чтобы заказать еду в номер, забронировать столик или проверить детали проживания.",
  openConcierge: "Открыть AI-консьержа",
  openStayDetails: "Открыть объект",
  serviceHubTitle: "AI-консьерж во время проживания",
  serviceHubCopy: "Заказы в номер, рестораны и статусы заявок по этой брони.",
  serviceHubEmpty: "Активных заявок пока нет. Можно открыть AI-консьержа и оформить первый запрос.",
  serviceHubLoading: "Загружаю статусы сервисов...",
  profileTitle: "Профиль гостя",
  profileHint: "Эти данные автоматически подставляются в форму бронирования.",
  profileName: "Имя и фамилия",
  profilePhone: "Телефон",
  saveProfile: "Сохранить профиль",
  profileSaved: "Профиль сохранен",
  email: "Email, который указывали при бронировании",
  load: "Показать брони",
  loading: "Загружаю...",
  empty: "По этому email брони не найдены.",
  accessRequired:
    "Для безопасности брони доступны только по ссылке с токеном доступа. Откройте кабинет со страницы подтверждения оплаты или из письма с деталями брони.",
  noListing: "Объект недоступен",
  stayLink: "Открыть объект",
  stayServices: "Сервисы проживания",
  summaryBookings: "Броней",
  summaryUpcoming: "Будущих",
  summaryActive: "Активных",
  summaryTotal: "Сумма",
  repeatBooking: "Повторить бронь",
  payment: "Проверить оплату",
  cancelTerms: "Условия отмены",
  cancel: "Отменить бронь",
  checkin: "Заезд",
  checkout: "Выезд",
  guests: "Гостей",
  room: "Категория",
  total: "Итого",
  paymentStatus: "Оплата",
  cancellation: "Отмена",
  refundable: "К возврату",
  penalty: "Штраф",
  error: "Не удалось загрузить данные",
  requiredEmail: "Введите email",
  inStayTitle: "Сервисы проживания",
  inStayLoading: "Загружаю статусы сервисов...",
  inStayEmpty: "Пока нет заказов в номер и броней столиков.",
  inStayRefresh: "Обновить",
  roomService: "Заказы в номер",
  tableBookings: "Столики",
  updates: "Обновления",
  activeRequests: "Активных заявок",
  created: "Создано",
  partialInStay: "Часть статусов временно недоступна.",
};

const EN_TRANSLATIONS: Translations = {
  title: "Guest account",
  subtitle: "Track bookings, payments, cancellations, and in-stay services in one place.",
  back: "Back to search",
  focusKicker: "Booking ready",
  focusTitle: "Your booking is in your account",
  focusCopy: "Open the AI concierge to order room service, book a table, or check stay details.",
  openConcierge: "Open AI concierge",
  openStayDetails: "Open stay",
  serviceHubTitle: "AI concierge during stay",
  serviceHubCopy: "Room service, restaurants, and request statuses for this reservation.",
  serviceHubEmpty: "No active requests yet. Open the AI concierge to create the first one.",
  serviceHubLoading: "Loading service statuses...",
  profileTitle: "Guest profile",
  profileHint: "These details are auto-filled in the booking form.",
  profileName: "Full name",
  profilePhone: "Phone",
  saveProfile: "Save profile",
  profileSaved: "Profile saved",
  email: "Email used for booking",
  load: "Show bookings",
  loading: "Loading...",
  empty: "No bookings found for this email.",
  accessRequired:
    "For security, bookings are available only through a link with an access token. Open the account from the payment confirmation page or booking email.",
  noListing: "Listing unavailable",
  stayLink: "Open stay",
  stayServices: "Stay services",
  summaryBookings: "Bookings",
  summaryUpcoming: "Upcoming",
  summaryActive: "Active",
  summaryTotal: "Total",
  repeatBooking: "Book again",
  payment: "Check payment",
  cancelTerms: "Cancellation terms",
  cancel: "Cancel booking",
  checkin: "Check-in",
  checkout: "Check-out",
  guests: "Guests",
  room: "Room",
  total: "Total",
  paymentStatus: "Payment",
  cancellation: "Cancellation",
  refundable: "Refund",
  penalty: "Penalty",
  error: "Failed to load data",
  requiredEmail: "Enter email",
  inStayTitle: "Stay services",
  inStayLoading: "Loading service statuses...",
  inStayEmpty: "No room service orders or table bookings yet.",
  inStayRefresh: "Refresh statuses",
  roomService: "Room service",
  tableBookings: "Tables",
  updates: "Updates",
  activeRequests: "Active requests",
  created: "Created",
  partialInStay: "Some service statuses are temporarily unavailable.",
};

const CITY_LABELS_RU: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
  istanbul: "Стамбул",
  vienna: "Вена",
  baku: "Баку",
  tbilisi: "Тбилиси",
  milan: "Милан",
  toronto: "Торонто",
  antalya: "Анталья",
};

const ACTIVE_ORDER_STATUSES = new Set<RoomServiceOrder["status"]>(["submitted", "accepted", "preparing"]);
const ACTIVE_TABLE_STATUSES = new Set<RestaurantBooking["status"]>(["submitted", "confirmed", "seated"]);

function localizeCityName(city: string | undefined, lang: Lang): string {
  const raw = (city || "").trim();
  if (!raw) return "-";
  if (lang !== "ru") return raw;
  return CITY_LABELS_RU[raw.toLowerCase()] || raw;
}

function statusLabel(status: Reservation["status"], lang: Lang): string {
  if (lang === "ru") {
    const map: Record<Reservation["status"], string> = {
      draft: "Черновик",
      pending_payment: "Ожидает оплату",
      confirmed: "Подтверждена",
      checked_in: "Заселен",
      checked_out: "Выселен",
      cancelled: "Отменена",
      expired: "Истекла",
    };
    return map[status];
  }

  const map: Record<Reservation["status"], string> = {
    draft: "Draft",
    pending_payment: "Pending payment",
    confirmed: "Confirmed",
    checked_in: "Checked in",
    checked_out: "Checked out",
    cancelled: "Cancelled",
    expired: "Expired",
  };
  return map[status];
}

function paymentStatusLabel(status: ReservationPayment["payment_status"], lang: Lang): string {
  if (lang === "ru") {
    const map: Record<ReservationPayment["payment_status"], string> = {
      pending: "Ожидает",
      paid: "Оплачено",
      failed: "Ошибка",
      refunded: "Возврат",
    };
    return map[status];
  }

  const map: Record<ReservationPayment["payment_status"], string> = {
    pending: "Pending",
    paid: "Paid",
    failed: "Failed",
    refunded: "Refunded",
  };
  return map[status];
}

function roomOrderStatusLabel(lang: Lang, status: RoomServiceOrder["status"]): string {
  if (lang === "ru") {
    if (status === "submitted") return "Отправлен";
    if (status === "accepted") return "Принят";
    if (status === "preparing") return "Готовится";
    if (status === "delivered") return "Доставлен";
    if (status === "closed") return "Закрыт";
    return "Отменен";
  }
  if (status === "submitted") return "Submitted";
  if (status === "accepted") return "Accepted";
  if (status === "preparing") return "Preparing";
  if (status === "delivered") return "Delivered";
  if (status === "closed") return "Closed";
  return "Cancelled";
}

function roomOrderStatusClass(status: RoomServiceOrder["status"]): string {
  if (status === "submitted") return "status-pill status-pending";
  if (status === "accepted" || status === "preparing") return "status-pill status-event-confirmed";
  if (status === "delivered" || status === "closed") return "status-pill status-confirmed";
  return "status-pill status-cancelled";
}

function formatOrderItems(items: RoomServiceOrder["items"]): string {
  return items.map((item) => `${item.item_name} x${item.quantity}`).join(", ");
}

export default function GuestAccountPage({
  lang,
  currency,
  initialGuestEmail = "",
  initialReservationId,
  initialAccessToken = "",
}: {
  lang: Lang;
  currency: Currency;
  initialGuestEmail?: string;
  initialReservationId?: number;
  initialAccessToken?: string;
}) {
  const tr = useMemo(() => (lang === "ru" ? RU_TRANSLATIONS : EN_TRANSLATIONS), [lang]);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ReservationView[]>([]);
  const [paymentByReservation, setPaymentByReservation] = useState<Record<number, ReservationPayment>>({});
  const [termsByReservation, setTermsByReservation] = useState<Record<number, CancellationTerms>>({});
  const [inStayByReservation, setInStayByReservation] = useState<Record<number, ReservationInStayState>>({});
  const [busyReservationId, setBusyReservationId] = useState<number | null>(null);
  const [inStayBusyReservationId, setInStayBusyReservationId] = useState<number | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const accountSummary = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const activeStatuses = new Set<Reservation["status"]>(["pending_payment", "confirmed", "checked_in"]);
    const upcoming = items.filter((item) => item.check_out >= todayIso && item.status !== "cancelled" && item.status !== "expired").length;
    const active = items.filter((item) => activeStatuses.has(item.status)).length;
    const total = items.reduce((sum, item) => sum + item.total_price, 0);
    return {
      bookings: items.length,
      upcoming,
      active,
      total,
    };
  }, [items]);
  const highlightedReservation = useMemo(() => {
    if (initialReservationId) {
      const matched = items.find((item) => item.id === initialReservationId);
      if (matched) return matched;
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    return (
      items.find((item) => item.status === "checked_in") ||
      items.find((item) => item.status === "confirmed" && item.check_out >= todayIso) ||
      null
    );
  }, [initialReservationId, items]);
  const orderedItems = useMemo(() => {
    if (!highlightedReservation) return items;
    return [highlightedReservation, ...items.filter((item) => item.id !== highlightedReservation.id)];
  }, [highlightedReservation, items]);
  const highlightedInStay = highlightedReservation ? inStayByReservation[highlightedReservation.id] : undefined;
  const highlightedActiveOrders = highlightedInStay?.orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)) ?? [];
  const highlightedActiveTableBookings =
    highlightedInStay?.tableBookings.filter((booking) => ACTIVE_TABLE_STATUSES.has(booking.status)) ?? [];
  const highlightedServiceRows = highlightedInStay
    ? [
        ...highlightedInStay.orders.map((order) => ({
          key: `order-${order.id}`,
          sortMs: Date.parse(order.updated_at || order.created_at),
          title: `${tr.roomService} #${order.id}`,
          detail: formatOrderItems(order.items),
          meta: `${tr.created}: ${formatDateTime(order.created_at)}`,
          status: roomOrderStatusLabel(lang, order.status),
          statusClass: roomOrderStatusClass(order.status),
        })),
        ...highlightedInStay.tableBookings.map((booking) => ({
          key: `table-${booking.id}`,
          sortMs: Date.parse(booking.updated_at || booking.created_at),
          title: `${tr.tableBookings} #${booking.id}`,
          detail: booking.restaurant_name,
          meta: `${booking.booking_date} ${booking.booking_time} - ${tr.guests}: ${booking.guests}`,
          status: getRestaurantBookingStatusLabel(lang, booking.status),
          statusClass: `status-pill ${getRestaurantBookingStatusClass(booking.status)}`,
        })),
        ...highlightedInStay.bookingEvents.map((event) => ({
          key: `event-${event.id}`,
          sortMs: Date.parse(event.created_at),
          title: tr.updates,
          detail: getRestaurantBookingEventLabel(lang, event.event_type, event.message),
          meta: formatRestaurantBookingEventDateTime(lang, event.created_at),
          status: getRestaurantBookingStatusLabel(lang, event.status),
          statusClass: `status-pill ${getRestaurantBookingStatusClass(event.status)}`,
        })),
      ]
        .sort((a, b) => (Number.isFinite(b.sortMs) ? b.sortMs : 0) - (Number.isFinite(a.sortMs) ? a.sortMs : 0))
        .slice(0, 3)
    : [];

  function formatMoney(valueKzt: number): string {
    const value = currency === "USD" ? Math.round((valueKzt / 500) * 100) / 100 : valueKzt;
    const formatted = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
      maximumFractionDigits: currency === "USD" ? 2 : 0,
      minimumFractionDigits: 0,
    }).format(value);
    return currency === "USD" ? `${formatted} $` : `${formatted} ₸`;
  }

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  function formatDateTime(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function canUseInStayServices(reservation: Reservation): boolean {
    return reservation.status === "confirmed" || reservation.status === "checked_in";
  }

  function buildStayHref(reservation: Reservation, preferConcierge = false): string {
    const accessToken = reservation.access_token || getReservationAccessToken(reservation.id) || "";
    const stayServicesReady = canUseInStayServices(reservation);
    const openConcierge = preferConcierge && stayServicesReady;
    const stayQuery = new URLSearchParams({
      lang,
      currency,
      reservation_id: String(reservation.id),
      guest_email: reservation.guest_email,
    });
    if (accessToken) stayQuery.set("access_token", accessToken);
    if (reservation.room_type_id) stayQuery.set("room_type_id", String(reservation.room_type_id));
    if (reservation.room_type_name) stayQuery.set("room_type_name", reservation.room_type_name);
    if (openConcierge) {
      stayQuery.set("from_payment", "1");
      stayQuery.set("concierge", "1");
    }
    return `/stays/${reservation.listing_id}?${stayQuery.toString()}${openConcierge ? "#in-stay-concierge" : ""}`;
  }

  async function fetchInStayState(reservation: Reservation): Promise<ReservationInStayState> {
    const accessToken = reservation.access_token || getReservationAccessToken(reservation.id) || "";
    if (!accessToken) {
      return { loaded: true, partial: true, orders: [], tableBookings: [], bookingEvents: [] };
    }
    const [ordersResult, bookingResult, eventResult] = await Promise.allSettled([
      getRoomServiceOrdersByReservation(reservation.id, reservation.guest_email, accessToken),
      getRestaurantBookingsByReservation(reservation.id, reservation.guest_email, accessToken),
      getRestaurantBookingEventsByReservation(reservation.id, reservation.guest_email, accessToken),
    ]);
    return {
      loaded: true,
      partial: ordersResult.status === "rejected" || bookingResult.status === "rejected" || eventResult.status === "rejected",
      orders: ordersResult.status === "fulfilled" ? ordersResult.value : [],
      tableBookings: bookingResult.status === "fulfilled" ? bookingResult.value : [],
      bookingEvents: eventResult.status === "fulfilled" ? eventResult.value : [],
    };
  }

  async function loadInStayForReservations(reservations: Reservation[]) {
    const eligible = reservations.filter((reservation) => {
      const hasAccess = Boolean(reservation.access_token || getReservationAccessToken(reservation.id));
      return hasAccess && (reservation.status === "confirmed" || reservation.status === "checked_in");
    });
    if (eligible.length === 0) return;
    const pairs = await Promise.all(
      eligible.map(async (reservation) => [reservation.id, await fetchInStayState(reservation)] as const),
    );
    setInStayByReservation((prev) => {
      const next = { ...prev };
      for (const [reservationId, state] of pairs) next[reservationId] = state;
      return next;
    });
  }

  async function loadReservations(guestEmailRaw?: string) {
    const normalized = (guestEmailRaw ?? email).trim().toLowerCase();
    if (!normalized) {
      setError(tr.requiredEmail);
      return;
    }

    const accessTokens = getReservationAccessTokensForEmail(normalized);
    localStorage.setItem("findapart_guest_email", normalized);
    if (accessTokens.length === 0) {
      setItems([]);
      setPaymentByReservation({});
      setTermsByReservation({});
      setInStayByReservation({});
      setError(tr.accessRequired);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const reservations = await getReservationsByEmail(normalized, accessTokens);
      reservations.forEach(rememberReservationAccess);
      const listingIds = Array.from(new Set(reservations.map((x) => x.listing_id)));
      const listingPairs = await Promise.all(
        listingIds.map(async (id) => {
          try {
            const listing = await getListing(id);
            return [id, listing] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      const listingMap = new Map<number, Listing | null>(listingPairs);
      setItems(reservations.map((r) => ({ ...r, listing: listingMap.get(r.listing_id) || null })));
      setPaymentByReservation({});
      setTermsByReservation({});
      setInStayByReservation({});
      void loadInStayForReservations(reservations);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.error);
      setItems([]);
      setInStayByReservation({});
    } finally {
      setLoading(false);
    }
  }

  function accessTokenForReservation(reservationId: number): string {
    const item = items.find((row) => row.id === reservationId);
    return item?.access_token || getReservationAccessToken(reservationId) || "";
  }

  async function onCheckPayment(reservationId: number) {
    setBusyReservationId(reservationId);
    try {
      const payment = await getReservationPayment(reservationId, accessTokenForReservation(reservationId));
      setPaymentByReservation((prev) => ({ ...prev, [reservationId]: payment }));
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.error);
    } finally {
      setBusyReservationId(null);
    }
  }

  async function onLoadTerms(reservationId: number) {
    if (!email.trim()) return;
    setBusyReservationId(reservationId);
    try {
      const terms = await getReservationCancellationTerms(reservationId, accessTokenForReservation(reservationId));
      setTermsByReservation((prev) => ({ ...prev, [reservationId]: terms }));
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.error);
    } finally {
      setBusyReservationId(null);
    }
  }

  async function onCancel(reservationId: number) {
    if (!email.trim()) return;
    setBusyReservationId(reservationId);
    try {
      const updated = await cancelReservation(reservationId, email.trim().toLowerCase(), accessTokenForReservation(reservationId));
      setItems((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setTermsByReservation((prev) => ({ ...prev, [reservationId]: updated.cancellation_terms }));
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.error);
    } finally {
      setBusyReservationId(null);
    }
  }

  async function onRefreshInStay(reservation: Reservation) {
    setInStayBusyReservationId(reservation.id);
    try {
      const state = await fetchInStayState(reservation);
      setInStayByReservation((prev) => ({ ...prev, [reservation.id]: state }));
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.error);
    } finally {
      setInStayBusyReservationId(null);
    }
  }

  useEffect(() => {
    const initialEmail = initialGuestEmail.trim().toLowerCase();
    if (initialEmail) {
      setEmail(initialEmail);
      localStorage.setItem("findapart_guest_email", initialEmail);
      if (initialReservationId && initialAccessToken) {
        rememberReservationAccess({
          id: initialReservationId,
          guest_email: initialEmail,
          access_token: initialAccessToken,
        });
      }
      void loadReservations(initialEmail);
    }

    const remembered = localStorage.getItem("findapart_guest_email");
    if (!initialEmail && remembered) {
      setEmail(remembered);
      void loadReservations(remembered);
    }

    try {
      const raw = localStorage.getItem("findapart_guest_profile");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { name?: string; email?: string; phone?: string } | null;
      if (!parsed) return;
      if (parsed.email && !remembered && !initialEmail) setEmail(parsed.email);
      if (parsed.name) setProfileName(parsed.name);
      if (parsed.phone) setProfilePhone(parsed.phone);
    } catch {
      // ignore malformed local storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccessToken, initialGuestEmail, initialReservationId]);

  function saveProfile() {
    const payload = {
      name: profileName.trim(),
      email: email.trim().toLowerCase(),
      phone: profilePhone.trim(),
    };
    try {
      localStorage.setItem("findapart_guest_profile", JSON.stringify(payload));
      if (payload.email) localStorage.setItem("findapart_guest_email", payload.email);
      setProfileSaved(true);
      setError(null);
      setTimeout(() => setProfileSaved(false), 1800);
    } catch {
      setError(tr.error);
    }
  }

  return (
    <div className="sp-account-page">
      <Link href={`/?lang=${lang}&currency=${currency}`} className="sp-back-link">
        {tr.back}
      </Link>
      <section className="property-detail account-shell sp-account-card">
        <h1>{tr.title}</h1>
        <p className="desc">{tr.subtitle}</p>

        <form
          className="account-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void loadReservations();
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={tr.email}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? tr.loading : tr.load}
          </button>
        </form>

        {error ? <p className="field-error">{error}</p> : null}
        {items.length === 0 && !loading ? <p className="desc">{tr.empty}</p> : null}

        {highlightedReservation ? (
          <section className="account-focus-card">
            <div className="account-focus-main">
              <span className="account-focus-kicker">{tr.focusKicker}</span>
              <h2>{highlightedReservation.listing?.title || `${tr.noListing} #${highlightedReservation.listing_id}`}</h2>
              <p>{tr.focusCopy}</p>
              <div className="account-focus-pills">
                <span>
                  #{highlightedReservation.id}
                </span>
                <span>
                  {formatDate(highlightedReservation.check_in)} - {formatDate(highlightedReservation.check_out)}
                </span>
                <span>
                  {highlightedReservation.room_type_name || tr.room}
                </span>
                <span>
                  {statusLabel(highlightedReservation.status, lang)}
                </span>
              </div>
            </div>
            <div className="account-focus-actions">
              <Link href={buildStayHref(highlightedReservation, true)} className="primary">
                {canUseInStayServices(highlightedReservation) ? tr.openConcierge : tr.openStayDetails}
              </Link>
              <Link href={buildStayHref(highlightedReservation)}>{tr.openStayDetails}</Link>
            </div>
          </section>
        ) : null}

        {highlightedReservation && canUseInStayServices(highlightedReservation) ? (
          <section className="account-service-hub">
            <div className="account-service-hub-head">
              <div>
                <span className="account-focus-kicker">{tr.serviceHubTitle}</span>
                <h3>{tr.stayServices}</h3>
                <p>
                  {tr.serviceHubCopy}
                  {highlightedInStay?.partial ? ` ${tr.partialInStay}` : ""}
                </p>
              </div>
              <div className="account-service-hub-actions">
                <button
                  type="button"
                  onClick={() => void onRefreshInStay(highlightedReservation)}
                  disabled={inStayBusyReservationId === highlightedReservation.id}
                >
                  {tr.inStayRefresh}
                </button>
                <Link href={buildStayHref(highlightedReservation, true)}>{tr.openConcierge}</Link>
              </div>
            </div>

            <div className="account-service-hub-stats" aria-label={tr.serviceHubTitle}>
              <span>
                <b>{highlightedActiveOrders.length}</b>
                {tr.roomService}
              </span>
              <span>
                <b>{highlightedActiveTableBookings.length}</b>
                {tr.tableBookings}
              </span>
              <span>
                <b>{highlightedActiveOrders.length + highlightedActiveTableBookings.length}</b>
                {tr.activeRequests}
              </span>
            </div>

            {!highlightedInStay?.loaded ? <p className="desc">{tr.serviceHubLoading}</p> : null}
            {highlightedInStay?.loaded && highlightedServiceRows.length === 0 ? (
              <div className="account-service-empty">
                <p>{tr.serviceHubEmpty}</p>
                <Link href={buildStayHref(highlightedReservation, true)}>{tr.openConcierge}</Link>
              </div>
            ) : null}
            {highlightedServiceRows.length > 0 ? (
              <div className="account-service-feed">
                {highlightedServiceRows.map((row) => (
                  <article key={row.key} className="account-service-row">
                    <div>
                      <b>{row.title}</b>
                      <small>{row.detail}</small>
                      <small>{row.meta}</small>
                    </div>
                    <span className={row.statusClass}>{row.status}</span>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {items.length > 0 ? (
          <section className="account-summary-grid" aria-label="Booking summary">
            <span>
              <b>{accountSummary.bookings}</b>
              {tr.summaryBookings}
            </span>
            <span>
              <b>{accountSummary.upcoming}</b>
              {tr.summaryUpcoming}
            </span>
            <span>
              <b>{accountSummary.active}</b>
              {tr.summaryActive}
            </span>
            <span>
              <b>{formatMoney(accountSummary.total)}</b>
              {tr.summaryTotal}
            </span>
          </section>
        ) : null}

        <div className="account-bookings-grid">
          {orderedItems.map((item) => {
            const listing = item.listing;
            const payment = paymentByReservation[item.id];
            const terms = termsByReservation[item.id];
            const canCancel = item.status === "pending_payment" || item.status === "confirmed";
            const stayServicesReady = canUseInStayServices(item);
            const inStay = inStayByReservation[item.id];
            const activeOrders = inStay?.orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)) ?? [];
            const activeTableBookings = inStay?.tableBookings.filter((booking) => ACTIVE_TABLE_STATUSES.has(booking.status)) ?? [];
            const activityCount = activeOrders.length + activeTableBookings.length;
            const stayHref = buildStayHref(item, stayServicesReady);
            const repeatParams = new URLSearchParams({
              listing_id: String(item.listing_id),
              check_in: item.check_in,
              check_out: item.check_out,
              guests: String(item.guests),
              lang,
              currency,
              tariff: item.tariff_plan,
              exp_variant: "a",
            });
            if (item.room_type_id) repeatParams.set("room_type_id", String(item.room_type_id));
            if (item.room_type_name) repeatParams.set("room_type_name", item.room_type_name);

            return (
              <article
                key={item.id}
                className={highlightedReservation?.id === item.id ? "account-booking-card highlighted" : "account-booking-card"}
              >
                <div className="account-booking-head">
                  <h3>{listing?.title || `${tr.noListing} #${item.listing_id}`}</h3>
                  <span className={`booking-status-pill booking-status-${item.status.replace("_", "-")}`}>
                    {statusLabel(item.status, lang)}
                  </span>
                </div>
                <p className="desc">
                  #{item.id} | {localizeCityName(listing?.city, lang)}, {listing?.district || "-"}
                </p>
                {item.room_type_name ? (
                  <p className="desc">
                    {tr.room}: <b>{item.room_type_name}</b>
                  </p>
                ) : null}
                <div className="account-booking-meta">
                  <span>
                    {tr.checkin}
                    <b>{formatDate(item.check_in)}</b>
                  </span>
                  <span>
                    {tr.checkout}
                    <b>{formatDate(item.check_out)}</b>
                  </span>
                  <span>
                    {tr.guests}
                    <b>{item.guests}</b>
                  </span>
                  <span>
                    {tr.total}
                    <b>{formatMoney(item.total_price)}</b>
                  </span>
                </div>

                {stayServicesReady ? (
                  <section className="account-instay-card">
                    <div className="account-instay-head">
                      <div>
                        <h4>{tr.inStayTitle}</h4>
                        <p>
                          {tr.serviceHubCopy}
                          {inStay?.partial ? ` · ${tr.partialInStay}` : ""}
                        </p>
                      </div>
                      <button type="button" onClick={() => void onRefreshInStay(item)} disabled={inStayBusyReservationId === item.id}>
                        {tr.inStayRefresh}
                      </button>
                    </div>

                    <div className="account-instay-stats" aria-label={tr.serviceHubTitle}>
                      <span>
                        <b>{activeOrders.length}</b>
                        {tr.roomService}
                      </span>
                      <span>
                        <b>{activeTableBookings.length}</b>
                        {tr.tableBookings}
                      </span>
                      <span>
                        <b>{activityCount}</b>
                        {tr.activeRequests}
                      </span>
                    </div>

                    {!inStay?.loaded ? <p className="desc">{tr.serviceHubLoading}</p> : null}
                    {inStay?.loaded && inStay.orders.length === 0 && inStay.tableBookings.length === 0 && inStay.bookingEvents.length === 0 ? (
                      <div className="account-instay-empty">
                        <p>{tr.serviceHubEmpty}</p>
                        <Link href={stayHref}>{tr.openConcierge}</Link>
                      </div>
                    ) : null}

                    {inStay?.orders.slice(0, 3).map((order) => (
                      <article key={`order-${order.id}`} className="account-instay-row">
                        <div>
                          <b>{tr.roomService} #{order.id}</b>
                          <small>{formatOrderItems(order.items)}</small>
                          <small>{tr.created}: {formatDateTime(order.created_at)}</small>
                        </div>
                        <span className={roomOrderStatusClass(order.status)}>{roomOrderStatusLabel(lang, order.status)}</span>
                      </article>
                    ))}

                    {inStay?.tableBookings.slice(0, 3).map((booking) => (
                      <article key={`table-${booking.id}`} className="account-instay-row">
                        <div>
                          <b>{tr.tableBookings} #{booking.id}</b>
                          <small>{booking.restaurant_name}</small>
                          <small>{booking.booking_date} {booking.booking_time} · {tr.guests}: {booking.guests}</small>
                        </div>
                        <span className={`status-pill ${getRestaurantBookingStatusClass(booking.status)}`}>
                          {getRestaurantBookingStatusLabel(lang, booking.status)}
                        </span>
                      </article>
                    ))}

                    {inStay?.bookingEvents.slice(0, 2).map((event) => (
                      <article key={`event-${event.id}`} className="account-instay-row account-instay-event">
                        <div>
                          <b>{tr.updates}</b>
                          <small>{getRestaurantBookingEventLabel(lang, event.event_type, event.message)}</small>
                          <small>{formatRestaurantBookingEventDateTime(lang, event.created_at)}</small>
                        </div>
                        <span className={`status-pill ${getRestaurantBookingStatusClass(event.status)}`}>
                          {getRestaurantBookingStatusLabel(lang, event.status)}
                        </span>
                      </article>
                    ))}
                  </section>
                ) : null}

                <div className="account-booking-actions">
                  <Link href={stayHref} className={stayServicesReady ? "primary" : undefined}>
                    {stayServicesReady ? tr.stayServices : tr.stayLink}
                  </Link>
                  <Link href={`/checkout?${repeatParams.toString()}`}>{tr.repeatBooking}</Link>
                  <button type="button" onClick={() => void onCheckPayment(item.id)} disabled={busyReservationId === item.id}>
                    {tr.payment}
                  </button>
                  <button type="button" onClick={() => void onLoadTerms(item.id)} disabled={busyReservationId === item.id}>
                    {tr.cancelTerms}
                  </button>
                  {canCancel ? (
                    <button type="button" onClick={() => void onCancel(item.id)} disabled={busyReservationId === item.id}>
                      {tr.cancel}
                    </button>
                  ) : null}
                </div>

                {payment ? (
                  <p className="desc">
                    {tr.paymentStatus}: <b>{paymentStatusLabel(payment.payment_status, lang)}</b>
                  </p>
                ) : null}

                {terms ? (
                  <p className="desc">
                    {tr.cancellation}: {terms.reason}. {tr.refundable}: <b>{formatMoney(terms.refund_amount)}</b>, {tr.penalty}:{" "}
                    <b>{formatMoney(terms.penalty_amount)}</b>.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>

        <section className="account-profile-card">
          <h3>{tr.profileTitle}</h3>
          <p className="desc">{tr.profileHint}</p>
          <div className="account-profile-grid">
            <input
              type="text"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder={tr.profileName}
            />
            <input
              type="text"
              value={profilePhone}
              onChange={(event) => setProfilePhone(event.target.value)}
              placeholder={tr.profilePhone}
            />
            <button type="button" onClick={saveProfile}>
              {tr.saveProfile}
            </button>
          </div>
          {profileSaved ? <p className="desc">{tr.profileSaved}</p> : null}
        </section>
      </section>
    </div>
  );
}
