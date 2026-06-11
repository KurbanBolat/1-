import type { RestaurantBooking } from "./api";

export type BookingUiLang = "en" | "ru";

type BookingStatus = RestaurantBooking["status"];

const statusLabelMap: Record<BookingUiLang, Record<BookingStatus, string>> = {
  en: {
    submitted: "Submitted",
    confirmed: "Confirmed",
    seated: "Seated",
    completed: "Completed",
    cancelled: "Cancelled",
  },
  ru: {
    submitted: "Отправлено",
    confirmed: "Подтверждено",
    seated: "Гость в ресторане",
    completed: "Завершено",
    cancelled: "Отменено",
  },
};

const eventLabelMap: Record<BookingUiLang, Record<string, string>> = {
  en: {
    booking_submitted: "Table request submitted",
    booking_confirmed: "Table booking confirmed",
    guest_seated: "Guest seated at restaurant",
    booking_completed: "Restaurant visit completed",
    booking_cancelled: "Table booking cancelled",
  },
  ru: {
    booking_submitted: "Заявка на столик отправлена",
    booking_confirmed: "Бронь столика подтверждена",
    guest_seated: "Гость размещен в ресторане",
    booking_completed: "Посещение ресторана завершено",
    booking_cancelled: "Бронь столика отменена",
  },
};

const statusClassMap: Record<BookingStatus, string> = {
  submitted: "status-event-submitted",
  confirmed: "status-event-confirmed",
  seated: "status-event-seated",
  completed: "status-event-completed",
  cancelled: "status-event-cancelled",
};

export function getRestaurantBookingStatusLabel(lang: BookingUiLang, status: BookingStatus): string {
  return statusLabelMap[lang][status];
}

export function getRestaurantBookingStatusClass(status: BookingStatus): string {
  return statusClassMap[status];
}

export function getRestaurantBookingEventLabel(
  lang: BookingUiLang,
  eventType: string,
  fallbackMessage: string,
): string {
  return eventLabelMap[lang][eventType] || fallbackMessage;
}

export function formatRestaurantBookingEventDateTime(lang: BookingUiLang, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
