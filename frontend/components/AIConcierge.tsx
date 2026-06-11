"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  ApiError,
  askConcierge,
  ConciergeBookingState,
  ConciergeResponse,
  createRoomServiceOrder,
  createRestaurantBooking,
  createReservation,
  getInStayMenuForListing,
  getListings,
  getListingRoomAvailability,
  getListingRestaurants,
  getListingQuote,
  getReservationPayment,
  trackAnalyticsEvent,
  type MenuItem,
  type Quote,
  type Restaurant,
  type ReservationPayment,
  type RoomTypeAvailability,
} from "../lib/api";
import { humanSuggestionReason } from "../lib/explainability";
import { getReservationAccessToken, rememberReservationAccess } from "../lib/guestAccess";
import { useSoftRedirect } from "../hooks/useSoftRedirect";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";
type ConciergeStage = ConciergeResponse["stage"];
type ConciergeActionType = NonNullable<ConciergeResponse["next_action"]>["type"];
type TripPurpose = "business" | "family" | "couple" | "solo";

type Props = {
  lang: Lang;
  currency: Currency;
  variant?: "default" | "rail";
  showcaseCards?: RailShowcaseCard[];
  quickPrompts?: string[];
  initialUserPrompt?: string;
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  data?: ConciergeResponse;
};

type RailShowcaseCard = {
  id: number;
  title: string;
  city: string;
  district: string;
  nightlyPrice: number;
  coverPhotoUrl: string;
  href: string;
};

type BookingDraft = {
  listingId: number;
  roomTypeId?: number | null;
  roomTypeName?: string | null;
  title: string;
  checkIn: string;
  checkOut: string;
  guests: number;
};

type PendingBooking = {
  listingId: number;
  roomTypeId?: number | null;
  roomTypeName?: string | null;
  title: string;
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
};

type PaymentDraft = {
  reservationId: number;
  listingId: number;
  roomTypeId?: number | null;
  roomTypeName?: string | null;
  title: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  total: number;
  guestEmail?: string | null;
  accessToken?: string | null;
};

type BookingErrors = {
  name?: string;
  email?: string;
  phone?: string;
  checkInTime?: string;
};

type QuickPromptResult = {
  text: string;
  data?: ConciergeResponse;
} | null;

type ConciergeMemory = {
  messages: ChatMessage[];
  sessionId: string | null;
  bookingDraft: BookingDraft | null;
  pendingBooking?: PendingBooking | null;
  paymentDraft: PaymentDraft | null;
  paymentSnapshot: ReservationPayment | null;
  lastGuestEmail: string;
  slots: SlotState;
};

type SlotState = {
  city: string | null;
  check_in: string | null;
  check_out: string | null;
  guests: number | null;
  min_price: number | null;
  max_price: number | null;
  property_type: string | null;
  amenities: string[];
};

const EMPTY_SLOTS: SlotState = {
  city: null,
  check_in: null,
  check_out: null,
  guests: null,
  min_price: null,
  max_price: null,
  property_type: null,
  amenities: [],
};

type TariffQuoteBundle = {
  basic?: Quote;
  smart?: Quote;
  flex?: Quote;
};

const USD_RATE = 500;
const MAX_FILTER_PRICE_KZT = 2_000_000;
const API_MEDIA_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAX_CHAT_SUGGESTIONS = 3;
const MAX_CHAT_ALTERNATIVES = 3;
const AI_FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=720&q=82",
];
const CITY_LABELS_RU: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
  karagandy: "Караганда",
  istanbul: "Стамбул",
  vienna: "Вена",
  toronto: "Торонто",
  milan: "Милан",
  tbilisi: "Тбилиси",
  paris: "Париж",
  berlin: "Берлин",
  madrid: "Мадрид",
  rome: "Рим",
  london: "Лондон",
  dubai: "Дубай",
  antalya: "Анталья",
  baku: "Баку",
  bishkek: "Бишкек",
  tashkent: "Ташкент",
  moscow: "Москва",
  "saint petersburg": "Санкт-Петербург",
  "new york": "Нью-Йорк",
  "los angeles": "Лос-Анджелес",
};

function aiMediaUrl(path: string | null | undefined, fallbackSeed: number): string {
  if (path) return /^https?:\/\//i.test(path) ? path : `${API_MEDIA_BASE}${path}`;
  return AI_FALLBACK_IMAGES[Math.abs(fallbackSeed) % AI_FALLBACK_IMAGES.length];
}

function localizeCityName(city: string | undefined, lang: Lang): string {
  const raw = (city || "").trim();
  if (!raw) return "";
  if (lang === "en") return raw;
  return CITY_LABELS_RU[raw.toLowerCase()] || raw;
}

const t = {
  en: {
    title: "AI concierge",
    hint: "Tell me city, dates, guests and budget. I will shortlist and guide you to booking.",
    placeholder: "Example: Almaty, 2 guests, May 1-5, up to $90, business trip, wifi",
    send: "Find options",
    apply: "Apply filters",
    open: "Open stay",
    thinking: "Looking for the best options...",
    empty: "Type your request and I will guide you to booking.",
    alternatives: "Nearest available alternatives",
    unavailable: "Unavailable:",
    suggestedDates: "Suggested dates",
    applyDates: "Apply these dates",
    whyTitle: "Matched by",
    whyExplainTitle: "Why these options",
    workflowTitle: "What I am doing now",
    nextActionTitle: "Next step",
    stageTitle: "Stage",
    tariffLabel: "Choose tariff",
    tariffCompareTitle: "Tariff comparison",
    tariffSourceExact: "Exact prices",
    tariffSourceEstimate: "Estimated prices",
    tariffEstimatedNight: "Estimated per night",
    tariffEstimatedTrip: "Estimated for trip",
    tariffBadgeRecommended: "Recommended",
    tariffBadgeCheapest: "Best price",
    tariffBadgeFlexible: "Most flexible",
    tariffBasic: "Basic",
    tariffSmart: "Smart",
    tariffFlex: "Flex",
    tariffBasicFact1: "Price coefficient: 0.95x",
    tariffBasicFact2: "Service fee: 9%",
    tariffBasicFact3: "Refund: no refund within 7 days before check-in",
    tariffSmartFact1: "Price coefficient: 1.00x",
    tariffSmartFact2: "Service fee: 11%",
    tariffSmartFact3: "Refund: full refund up to 3 days before check-in",
    tariffFlexFact1: "Price coefficient: 1.12x",
    tariffFlexFact2: "Service fee: 13%",
    tariffFlexFact3: "Refund: full refund up to 1 day before check-in",
    bookThis: "Book this",
    bookTheseDates: "Book on these dates",
    bookingTitle: "Complete booking",
    bookingHint: "Please provide guest details:",
    bookingModeTitle: "Booking mode",
    bookingModeHint: "I will only help complete this booking: guest details -> confirmation -> payment.",
    bookingReady: "Good choice. If you want, I can help complete the booking.",
    fullName: "Full name",
    email: "Email",
    phone: "Phone",
    checkInTime: "Check-in time",
    createBooking: "Confirm booking",
    bookingInProgress: "Creating booking...",
    bookingDone: "Your booking is confirmed ✅",
    bookingDetails: "I sent reservation details and next steps.",
    paymentTitle: "Payment link",
    paymentHint: "Complete payment to finalize booking.",
    paymentCta: "Pay now",
    redirectingToPayment: "Redirecting to payment...",
    stayInChat: "Stay in chat",
    goToPaymentNow: "Go to payment now",
    paymentStatusTitle: "Payment status",
    paymentStatusRefresh: "Refresh status",
    paymentStatusLoading: "Checking payment status...",
    paymentPending: "Pending payment",
    paymentPaid: "Paid",
    paymentFailed: "Failed",
    paymentUnknown: "No data yet",
    bookingSummaryTitle: "Reservation details",
    guestLabel: "Guest",
    checkInTimeLabel: "Check-in time",
    needDatesFirst: "To book, please share check-in/check-out dates first.",
    needGuestsFirst: "To book, please share guests count first.",
    fieldRequired: "Please fill this field.",
    invalidEmail: "Please enter a valid email.",
    invalidPhone: "Please enter a valid phone number.",
    bookingStepName: "Please share guest full name.",
    bookingStepEmail: "Please share email for booking confirmation.",
    bookingStepPhone: "Please share contact phone number.",
    bookingStepTime: "Please share preferred check-in time.",
    bookingStepDone: "Great, all details are filled. Click Confirm booking below and I will finalize it.",
    bookingUpdated: "Got it, I updated your booking details.",
  },
  ru: {
    title: "AI-консьерж",
    hint: "Напишите город, даты, гостей и бюджет. Я быстро подберу варианты и доведу до брони.",
    placeholder: "Например: Алматы, 2 гостя, 1-5 мая, до 45000, командировка, wifi",
    send: "Подобрать",
    apply: "Применить фильтры",
    open: "Открыть объект",
    thinking: "Подбираю лучшие варианты...",
    empty: "Напишите запрос — доведу до бронирования.",
    alternatives: "Ближайшие доступные альтернативы",
    unavailable: "Недоступно:",
    suggestedDates: "Предложенные даты",
    applyDates: "Применить эти даты",
    whyTitle: "Подобрано по",
    whyExplainTitle: "Почему выбраны эти варианты",
    workflowTitle: "Что делаю сейчас",
    nextActionTitle: "Следующий шаг",
    stageTitle: "Этап",
    tariffLabel: "Выберите тариф",
    tariffCompareTitle: "Сравнение тарифов",
    tariffSourceExact: "Точные цены",
    tariffSourceEstimate: "Оценочные цены",
    tariffEstimatedNight: "Оценка за ночь",
    tariffEstimatedTrip: "Оценка за поездку",
    tariffBadgeRecommended: "Рекомендуем",
    tariffBadgeCheapest: "Лучшая цена",
    tariffBadgeFlexible: "Макс. гибкость",
    tariffBasic: "Базовый",
    tariffSmart: "Оптимальный",
    tariffFlex: "Гибкий",
    tariffBasicFact1: "Коэффициент цены: 0.95x",
    tariffBasicFact2: "Сервисный сбор: 9%",
    tariffBasicFact3: "Возврат: без возврата при отмене менее чем за 7 дней",
    tariffSmartFact1: "Коэффициент цены: 1.00x",
    tariffSmartFact2: "Сервисный сбор: 11%",
    tariffSmartFact3: "Возврат: полный возврат до 3 дней до заезда",
    tariffFlexFact1: "Коэффициент цены: 1.12x",
    tariffFlexFact2: "Сервисный сбор: 13%",
    tariffFlexFact3: "Возврат: полный возврат до 1 дня до заезда",
    bookThis: "Забронировать",
    bookTheseDates: "Забронировать на эти даты",
    bookingTitle: "Оформление брони",
    bookingHint: "Для оформления укажите данные гостя:",
    bookingModeTitle: "Режим бронирования",
    bookingModeHint: "Сейчас доведу только эту бронь: данные гостя -> подтверждение -> оплата.",
    bookingReady: "Хороший выбор. Если хотите, помогу оформить бронь.",
    fullName: "Имя и фамилия",
    email: "Email",
    phone: "Телефон",
    checkInTime: "Время заезда",
    createBooking: "Подтвердить бронь",
    bookingInProgress: "Создаю бронь...",
    bookingDone: "Ваше бронирование подтверждено ✅",
    bookingDetails: "Детали брони и дальнейшие шаги уже готовы.",
    paymentTitle: "Ссылка на оплату",
    paymentHint: "Завершите оплату, чтобы финализировать бронь.",
    paymentCta: "Перейти к оплате",
    redirectingToPayment: "Перенаправляю на оплату...",
    stayInChat: "Остаться в чате",
    goToPaymentNow: "Перейти на оплату сейчас",
    paymentStatusTitle: "Статус оплаты",
    paymentStatusRefresh: "Обновить статус",
    paymentStatusLoading: "Проверяю статус оплаты...",
    paymentPending: "Ожидает оплаты",
    paymentPaid: "Оплачено",
    paymentFailed: "Ошибка оплаты",
    paymentUnknown: "Пока нет данных",
    bookingSummaryTitle: "Детали бронирования",
    guestLabel: "Гость",
    checkInTimeLabel: "Время заезда",
    needDatesFirst: "Для брони сначала нужны даты заезда и выезда.",
    needGuestsFirst: "Для брони сначала нужно указать количество гостей.",
    fieldRequired: "Заполните поле.",
    invalidEmail: "Укажите корректный email.",
    invalidPhone: "Укажите корректный телефон.",
    bookingStepName: "Подскажите имя и фамилию гостя.",
    bookingStepEmail: "Подскажите email для подтверждения брони.",
    bookingStepPhone: "Подскажите контактный телефон.",
    bookingStepTime: "Подскажите желаемое время заезда.",
    bookingStepDone: "Отлично, все данные заполнены. Нажмите «Подтвердить бронь» ниже — и я завершу оформление.",
    bookingUpdated: "Принял, данные брони обновил.",
  },
} as const;

function formatPrice(valueKzt: number, currency: Currency, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (currency === "USD") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(valueKzt / USD_RATE);
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(valueKzt);
}

function formatRoomsAvailable(count: number, lang: Lang): string {
  if (lang === "en") return `${count} ${count === 1 ? "room" : "rooms"} available`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} номер доступен`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} номера доступны`;
  return `${count} номеров доступно`;
}

function roomFitsExactStay(room: RoomTypeAvailability, checkIn: string, checkOut: string): boolean {
  return room.available_windows.some(
    (window) => window.available_count > 0 && window.check_in <= checkIn && window.check_out >= checkOut,
  );
}

function pickBestRoomType(rooms: RoomTypeAvailability[], checkIn: string, checkOut: string): RoomTypeAvailability | null {
  const available = rooms.filter((room) => room.available_count > 0 && roomFitsExactStay(room, checkIn, checkOut));
  if (!available.length) return null;
  return [...available].sort((a, b) => a.nightly_price - b.nightly_price || a.sort_order - b.sort_order || a.id - b.id)[0];
}

const STAGE_ACTION_ALLOWLIST: Record<ConciergeStage, ConciergeActionType[]> = {
  collect: ["none"],
  search: ["apply_filters", "start_booking", "none"],
  availability: ["apply_alternative_dates", "apply_filters", "start_booking", "none"],
  pricing: ["go_checkout", "start_booking", "apply_filters", "none"],
  booking: ["start_booking", "go_checkout", "none"],
  payment_link: ["go_checkout", "none"],
  handoff: ["handoff_contact", "none"],
};

function isActionAllowedByStage(stage: ConciergeStage, actionType: ConciergeActionType): boolean {
  return STAGE_ACTION_ALLOWLIST[stage].includes(actionType);
}

const SUGGESTION_STAGES: ConciergeStage[] = ["search", "availability", "pricing", "booking", "payment_link"];
const ALTERNATIVE_STAGES: ConciergeStage[] = ["availability", "search"];

function shouldRenderSuggestions(stage: ConciergeStage): boolean {
  return SUGGESTION_STAGES.includes(stage);
}

function shouldRenderAlternatives(stage: ConciergeStage): boolean {
  return ALTERNATIVE_STAGES.includes(stage);
}

function parseEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function parsePhone(text: string): string | null {
  const match = text.match(/(?:\+?\d[\d\s()\-]{6,}\d)/);
  return match ? match[0].trim() : null;
}

function parseCheckInTime(text: string): string | null {
  const ru = text.match(/(?:заезд|время)\s*[:\-]?\s*(\d{1,2}[:.]\d{2})/i);
  if (ru) return ru[1].replace(".", ":");
  const en = text.match(/(?:check[- ]?in|arrival)\s*(?:time)?\s*[:\-]?\s*(\d{1,2}[:.]\d{2})/i);
  if (en) return en[1].replace(".", ":");
  const naked = text.match(/\b(\d{1,2}[:.]\d{2})\b/);
  return naked ? naked[1].replace(".", ":") : null;
}

function parseName(text: string): string | null {
  const normalized = text
    .replace(/(?:меня зовут|я\s+|name\s*[:\-]?|guest\s*[:\-]?)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 2) return null;
  const candidate = words.slice(0, 3).join(" ");
  if (candidate.length < 4) return null;
  if (/\d/.test(candidate)) return null;
  return candidate;
}

const MONTHS_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  января: 1,
  январь: 1,
  февраль: 2,
  февраля: 2,
  март: 3,
  марта: 3,
  апрель: 4,
  апреля: 4,
  май: 5,
  мая: 5,
  июнь: 6,
  июня: 6,
  июль: 7,
  июля: 7,
  август: 8,
  августа: 8,
  сентябрь: 9,
  сентября: 9,
  октябрь: 10,
  октября: 10,
  ноябрь: 11,
  ноября: 11,
  декабрь: 12,
  декабря: 12,
};

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isoFromParts(day: number, month: number): string | null {
  return isoFromPartsWithOptionalYear(day, month);
}

function isoFromPartsWithOptionalYear(day: number, month: number, explicitYear?: number | null): string | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const today = new Date();
  let year = explicitYear ?? today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  if (Number.isNaN(candidate.getTime()) || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
  if (!explicitYear && candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    year += 1;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseNaturalDateRange(text: string): { checkIn: string; checkOut: string } | null {
  const input = text.toLowerCase();
  const today = new Date();
  const normalizeIsoRange = (startIso: string, endIso: string): { checkIn: string; checkOut: string } | null => {
    const start = new Date(`${startIso}T00:00:00`);
    const end = new Date(`${endIso}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) return null;
    return { checkIn: startIso, checkOut: endIso };
  };

  const isoRange = input.match(/\b(\d{4}-\d{2}-\d{2})\s*(?:-|–|—|to|по|->|→)\s*(\d{4}-\d{2}-\d{2})\b/i);
  if (isoRange) {
    const normalized = normalizeIsoRange(isoRange[1], isoRange[2]);
    if (normalized) return normalized;
  }

  const dottedRange = input.match(
    /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*(?:-|–|—|to|по|->|→)\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/i,
  );
  if (dottedRange) {
    const day1 = Number(dottedRange[1]);
    const month1 = Number(dottedRange[2]);
    const explicitYear1 = dottedRange[3] ? Number(dottedRange[3]) : null;
    const day2 = Number(dottedRange[4]);
    const month2 = Number(dottedRange[5]);
    const explicitYear2 = dottedRange[6] ? Number(dottedRange[6]) : null;
    let year1 = explicitYear1 ?? today.getFullYear();
    const candidate1 = new Date(year1, month1 - 1, day1);
    if (!explicitYear1 && candidate1 < new Date(today.getFullYear(), today.getMonth(), today.getDate())) year1 += 1;
    let year2 = explicitYear2 ?? year1;
    const candidate2 = new Date(year2, month2 - 1, day2);
    const startIso = `${year1}-${pad2(month1)}-${pad2(day1)}`;
    const endIso = `${year2}-${pad2(month2)}-${pad2(day2)}`;
    if (!explicitYear2 && candidate2 <= new Date(`${startIso}T00:00:00`)) {
      year2 += 1;
    }
    const normalized = normalizeIsoRange(startIso, `${year2}-${pad2(month2)}-${pad2(day2)}`);
    if (normalized) return normalized;
  }

  if (/(послезавтра|day after tomorrow)/i.test(input)) {
    const start = addDays(today, 2);
    return { checkIn: toIsoDate(start), checkOut: toIsoDate(addDays(start, 1)) };
  }
  if (/(завтра|tomorrow)/i.test(input)) {
    const start = addDays(today, 1);
    return { checkIn: toIsoDate(start), checkOut: toIsoDate(addDays(start, 1)) };
  }
  if (/(сегодня|today)/i.test(input)) {
    return { checkIn: toIsoDate(today), checkOut: toIsoDate(addDays(today, 1)) };
  }
  if (/(выходн|weekend)/i.test(input)) {
    const day = today.getDay();
    const daysToSaturday = (6 - day + 7) % 7 || 7;
    const start = addDays(today, daysToSaturday);
    return { checkIn: toIsoDate(start), checkOut: toIsoDate(addDays(start, 2)) };
  }

  const sameMonthWithYearRange = input.match(/(?:с\s*)?(\d{1,2})\s*(?:-|–|—|по|to)\s*(\d{1,2})\s+([a-zа-яё]+)(?:\s+(\d{4}))?/i);
  if (sameMonthWithYearRange) {
    const day1 = Number(sameMonthWithYearRange[1]);
    const day2 = Number(sameMonthWithYearRange[2]);
    const month = MONTHS_MAP[sameMonthWithYearRange[3]];
    const year = sameMonthWithYearRange[4] ? Number(sameMonthWithYearRange[4]) : null;
    if (month && day2 > day1) {
      const checkIn = isoFromPartsWithOptionalYear(day1, month, year);
      const checkOut = isoFromPartsWithOptionalYear(day2, month, year);
      if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
    }
  }

  const splitMonthWithYearRange = input.match(
    /(?:с\s*)?(\d{1,2})\s+([a-zа-яё]+)(?:\s+(\d{4}))?\s*(?:-|–|—|по|to|->|→)\s*(\d{1,2})\s+([a-zа-яё]+)(?:\s+(\d{4}))?/i,
  );
  if (splitMonthWithYearRange) {
    const day1 = Number(splitMonthWithYearRange[1]);
    const month1 = MONTHS_MAP[splitMonthWithYearRange[2]];
    const year1 = splitMonthWithYearRange[3] ? Number(splitMonthWithYearRange[3]) : null;
    const day2 = Number(splitMonthWithYearRange[4]);
    const month2 = MONTHS_MAP[splitMonthWithYearRange[5]];
    const year2 = splitMonthWithYearRange[6] ? Number(splitMonthWithYearRange[6]) : year1;
    if (month1 && month2) {
      const checkIn = isoFromPartsWithOptionalYear(day1, month1, year1);
      let checkOut = isoFromPartsWithOptionalYear(day2, month2, year2);
      if (checkIn && checkOut && checkOut <= checkIn && !year2) {
        const nextYear = Number(checkIn.slice(0, 4)) + 1;
        checkOut = isoFromPartsWithOptionalYear(day2, month2, nextYear);
      }
      if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
    }
  }

  const sameMonthRange = input.match(/(?:с\s*)?(\d{1,2})\s*(?:-|–|—|по|to)\s*(\d{1,2})\s+([a-zа-яё]+)/i);
  if (sameMonthRange) {
    const day1 = Number(sameMonthRange[1]);
    const day2 = Number(sameMonthRange[2]);
    const month = MONTHS_MAP[sameMonthRange[3]];
    if (month && day2 > day1) {
      const checkIn = isoFromParts(day1, month);
      const checkOut = isoFromParts(day2, month);
      if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
    }
  }

  const splitMonthRange = input.match(/(\d{1,2})\s+([a-zа-яё]+)\s*(?:-|–|—|по|to)\s*(\d{1,2})\s+([a-zа-яё]+)/i);
  if (splitMonthRange) {
    const day1 = Number(splitMonthRange[1]);
    const month1 = MONTHS_MAP[splitMonthRange[2]];
    const day2 = Number(splitMonthRange[3]);
    const month2 = MONTHS_MAP[splitMonthRange[4]];
    if (month1 && month2) {
      const checkIn = isoFromParts(day1, month1);
      const checkOut = isoFromParts(day2, month2);
      if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
    }
  }

  const singleStartWithNights = input.match(/(?:с\s*)?(\d{1,2})\s+([a-zа-яё]+)\s*(?:на|for)\s*(\d{1,2})\s*(?:ноч|nights?|дн|days?)/i);
  if (singleStartWithNights) {
    const day = Number(singleStartWithNights[1]);
    const month = MONTHS_MAP[singleStartWithNights[2]];
    const nights = Number(singleStartWithNights[3]);
    if (month && nights >= 1 && nights <= 60) {
      const checkIn = isoFromParts(day, month);
      if (checkIn) {
        const checkOut = toIsoDate(addDays(new Date(`${checkIn}T00:00:00`), nights));
        if (checkOut > checkIn) return { checkIn, checkOut };
      }
    }
  }

  return null;
}

function parseGuestsCount(text: string): number | null {
  const lower = text.toLowerCase();

  const combined = lower.match(
    /(\d{1,2})\s*(?:adults?|взросл(?:ых|ые|ый)?)\s*(?:\+|and|и|,)\s*(\d{1,2})\s*(?:children?|kids?|дет(?:ей|и)?|ребенк(?:а|ов)?)/i,
  );
  if (combined) {
    const adults = Number(combined[1]);
    const children = Number(combined[2]);
    const total = adults + children;
    if (total >= 1 && total <= 16) return total;
  }

  const single = lower.match(
    /(\d{1,2})\s*(?:guests?|guest|people|persons?|гост(?:я|ей)?|чел(?:овек|\.?)?|қонақ|adam)/i,
  );
  if (single) {
    const guests = Number(single[1]);
    if (guests >= 1 && guests <= 16) return guests;
  }

  const contextual = lower.match(/(?:для|нас|we are|for)\s*(\d{1,2})(?!\s*(?:дн|дня|дней|ноч|days?|nights?))/i);
  if (contextual) {
    const guests = Number(contextual[1]);
    if (guests >= 1 && guests <= 16) return guests;
  }

  return null;
}

function parseMoneyToken(raw: string): { value: number; unit: Currency | null } | null {
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const unit: Currency | null =
    /(\$|usd|долл|dollar)/i.test(lower) ? "USD" : /(₸|kzt|тенге|тг)/i.test(lower) ? "KZT" : null;

  const compact = lower.replace(/\s+/g, "");
  const kMatch = compact.match(/(\d+(?:[.,]\d+)?)(k|к)\b/i);
  if (kMatch) {
    const base = Number(kMatch[1].replace(",", "."));
    if (!Number.isNaN(base)) return { value: Math.round(base * 1000), unit };
  }

  const thousandMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(тыс|thousand)\b/i);
  if (thousandMatch) {
    const base = Number(thousandMatch[1].replace(",", "."));
    if (!Number.isNaN(base)) return { value: Math.round(base * 1000), unit };
  }

  const numeric = lower.replace(/[^\d.,]/g, "").replace(/,/g, ".");
  if (!numeric) return null;
  const value = Number(numeric);
  if (Number.isNaN(value) || value <= 0) return null;
  return { value: Math.round(value), unit };
}

function toKzt(value: number, from: Currency | null, active: Currency): number {
  const unit = from || active;
  if (unit === "USD") return Math.round(value * USD_RATE);
  return value;
}

function parseBudgetRange(text: string, currency: Currency): { min?: number; max?: number } | null {
  const lower = text.toLowerCase();
  const moneyToken = "([$₸]?\\s*[\\d\\s.,]+(?:k|к|тыс|thousand)?\\s*(?:\\$|₸|usd|kzt|долл|тенге|тг)?)";
  const range = lower.match(
    new RegExp(`(?:from|от)\\s*${moneyToken}\\s*(?:to|до|-|–|—)\\s*${moneyToken}`, "i"),
  );
  if (range) {
    const left = parseMoneyToken(range[1]);
    const right = parseMoneyToken(range[2]);
    if (left && right) {
      const min = toKzt(left.value, left.unit, currency);
      const max = toKzt(right.value, right.unit, currency);
      return min <= max ? { min, max } : { min: max, max: min };
    }
  }

  const maxOnly = lower.match(new RegExp(`(?:up to|under|less than|до|не дороже)\\s*${moneyToken}`, "i"));
  if (maxOnly) {
    const parsed = parseMoneyToken(maxOnly[1]);
    if (parsed) return { max: toKzt(parsed.value, parsed.unit, currency) };
  }

  const minOnly = lower.match(new RegExp(`(?:from|от)\\s*${moneyToken}`, "i"));
  if (minOnly) {
    const parsed = parseMoneyToken(minOnly[1]);
    if (parsed) return { min: toKzt(parsed.value, parsed.unit, currency) };
  }

  const budgetLabel = lower.match(new RegExp(`(?:budget|бюджет)\\s*[:\\-]?\\s*${moneyToken}`, "i"));
  if (budgetLabel) {
    const parsed = parseMoneyToken(budgetLabel[1]);
    if (parsed) return { max: toKzt(parsed.value, parsed.unit, currency) };
  }

  return null;
}

function parseCityFromText(text: string): string | null {
  const lower = text.toLowerCase();
  const aliases: Array<{ tokens: string[]; city: string }> = [
    { tokens: ["almaty", "алматы", "алмате", "алмату"], city: "Almaty" },
    { tokens: ["astana", "астана"], city: "Astana" },
    { tokens: ["shymkent", "шимкент", "шымкент"], city: "Shymkent" },
    { tokens: ["istanbul", "istanb", "stambul", "стамбул", "стамбуле", "стамбула"], city: "Istanbul" },
    { tokens: ["antalya", "анталия"], city: "Antalya" },
    { tokens: ["vienna", "вена"], city: "Vienna" },
    { tokens: ["dubai", "дубай"], city: "Dubai" },
    { tokens: ["baku", "баку"], city: "Baku" },
    { tokens: ["milan", "милан"], city: "Milan" },
    { tokens: ["tbilisi", "тбилиси"], city: "Tbilisi" },
    { tokens: ["toronto", "торонто"], city: "Toronto" },
    { tokens: ["paris", "париж"], city: "Paris" },
    { tokens: ["berlin", "берлин"], city: "Berlin" },
    { tokens: ["madrid", "мадрид"], city: "Madrid" },
    { tokens: ["rome", "рим"], city: "Rome" },
    { tokens: ["london", "лондон"], city: "London" },
    { tokens: ["bishkek", "бишкек"], city: "Bishkek" },
    { tokens: ["tashkent", "ташкент"], city: "Tashkent" },
    { tokens: ["moscow", "москва"], city: "Moscow" },
  ];
  for (const alias of aliases) {
    if (alias.tokens.some((token) => lower.includes(token))) return alias.city;
  }
  return null;
}

function normalizeCityForQuery(city: string | null | undefined): string | null {
  if (!city) return null;
  const normalized = parseCityFromText(city);
  if (normalized) return normalized;
  const trimmed = city.trim();
  return trimmed || null;
}

function normalizeAmenitiesForQuery(raw: unknown): string | null {
  if (!raw) return null;
  const values = Array.isArray(raw) ? raw : [raw];
  const tokens = values
    .flatMap((value) => String(value).split(","))
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return null;
  return Array.from(new Set(tokens)).join(",");
}

function normalizeAmenitiesList(raw: unknown): string[] {
  const compact = normalizeAmenitiesForQuery(raw);
  if (!compact) return [];
  return compact.split(",").map((x) => x.trim()).filter(Boolean);
}

function normalizeCatalogSearchQuery(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  const preferenceOnly = new Set(["view", "sea view", "ocean view", "nice view", "good view"]);
  if (preferenceOnly.has(normalized)) return null;
  return value;
}

function mergeSlotState(base: SlotState, patch: Partial<SlotState>): SlotState {
  return {
    city: patch.city ?? base.city,
    check_in: patch.check_in ?? base.check_in,
    check_out: patch.check_out ?? base.check_out,
    guests: patch.guests ?? base.guests,
    min_price: patch.min_price ?? base.min_price,
    max_price: patch.max_price ?? base.max_price,
    property_type: patch.property_type ?? base.property_type,
    amenities: patch.amenities && patch.amenities.length ? Array.from(new Set([...base.amenities, ...patch.amenities])) : base.amenities,
  };
}

function extractSlotsFromText(text: string, currency: Currency): Partial<SlotState> {
  const city = parseCityFromText(text);
  const dates = parseNaturalDateRange(text);
  const guests = parseGuestsCount(text);
  const budget = parseBudgetRange(text, currency);
  const propertyType = parsePropertyType(text);
  const amenities = normalizeAmenitiesList(parseAmenityHints(text));
  return {
    city: city || undefined,
    check_in: dates?.checkIn,
    check_out: dates?.checkOut,
    guests: guests || undefined,
    min_price: budget?.min,
    max_price: budget?.max,
    property_type: propertyType || undefined,
    amenities,
  };
}

function slotsToFilters(slots: SlotState): Partial<ConciergeResponse["filters"]> {
  return {
    city: slots.city,
    check_in: slots.check_in,
    check_out: slots.check_out,
    guests: slots.guests,
    min_price: slots.min_price,
    max_price: slots.max_price,
    property_type: slots.property_type,
    amenities: slots.amenities,
  };
}

function clampPriceKzt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0) return null;
  return Math.min(rounded, MAX_FILTER_PRICE_KZT);
}

function normalizePriceForUrl(rawPriceKzt: unknown, currency: Currency): number | null {
  const priceKzt = clampPriceKzt(rawPriceKzt);
  if (priceKzt === null) return null;
  if (currency === "KZT") return priceKzt;
  // AI/backend can return either KZT or already-USD price.
  // If value is small, treat it as USD to avoid over-conversion.
  if (priceKzt <= 1000) return priceKzt;
  return Math.max(1, Math.round(priceKzt / USD_RATE));
}

function parseTripPurpose(text: string): "business" | "family" | "couple" | "solo" | null {
  const lower = text.toLowerCase();
  if (/(business|work|командиров|работ)/i.test(lower)) return "business";
  if (/(family|kids|дет|сем)/i.test(lower)) return "family";
  if (/(romantic|couple|пара|вдвоем)/i.test(lower)) return "couple";
  if (/(solo|one|один|сам)/i.test(lower)) return "solo";
  return null;
}

function resolveTripPurpose(value: unknown): TripPurpose | null {
  if (value === "business" || value === "family" || value === "couple" || value === "solo") return value;
  return null;
}

function purposeLabel(lang: Lang, purpose: TripPurpose | null): string {
  if (!purpose) return lang === "ru" ? "поездки" : "trip";
  if (lang === "ru") {
    if (purpose === "business") return "командировки";
    if (purpose === "family") return "семейной поездки";
    if (purpose === "couple") return "поездки для пары";
    return "поездки соло";
  }
  if (purpose === "business") return "business trip";
  if (purpose === "family") return "family trip";
  if (purpose === "couple") return "couple trip";
  return "solo trip";
}

function formatRuOptionCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} подходящих вариантов`;
  if (mod10 === 1) return `${count} подходящий вариант`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} подходящих варианта`;
  return `${count} подходящих вариантов`;
}

function compactKnownFilters(
  knownFilters?: Partial<ConciergeResponse["filters"]>,
): Partial<ConciergeResponse["filters"]> {
  if (!knownFilters) return {};
  const compact: Partial<ConciergeResponse["filters"]> = {};
  if (knownFilters.city) compact.city = knownFilters.city;
  if (knownFilters.check_in) compact.check_in = knownFilters.check_in;
  if (knownFilters.check_out) compact.check_out = knownFilters.check_out;
  if (knownFilters.guests) compact.guests = knownFilters.guests;
  if (knownFilters.min_price !== undefined && knownFilters.min_price !== null) compact.min_price = knownFilters.min_price;
  if (knownFilters.max_price !== undefined && knownFilters.max_price !== null) compact.max_price = knownFilters.max_price;
  if (knownFilters.trip_purpose) compact.trip_purpose = knownFilters.trip_purpose;
  if (knownFilters.q) compact.q = knownFilters.q;
  if (knownFilters.property_type) compact.property_type = knownFilters.property_type;
  if (Array.isArray(knownFilters.amenities) && knownFilters.amenities.length) compact.amenities = knownFilters.amenities;
  return compact;
}

function purposeCta(lang: Lang, purpose: TripPurpose | null): string {
  if (lang === "ru") {
    if (purpose === "business") return "Могу сразу закрепить вариант с надежным wifi и документами для командировки.";
    if (purpose === "family") return "Могу сразу закрепить семейный вариант с лучшими условиями для детей.";
    if (purpose === "couple") return "Могу закрепить самый уютный вариант для пары по текущей цене.";
    if (purpose === "solo") return "Могу закрепить самый выгодный соло-вариант и сразу перейти к брони.";
    return "Могу сразу закрепить лучший вариант по текущей цене и перейти к брони.";
  }
  if (purpose === "business") return "I can lock an option with reliable wifi and business documents right now.";
  if (purpose === "family") return "I can lock the best family-friendly option right now.";
  if (purpose === "couple") return "I can lock the most comfortable option for a couple at the current price.";
  if (purpose === "solo") return "I can lock the best-value solo option and move straight to booking.";
  return "I can lock the best option at current price and move to booking now.";
}

function parsePropertyType(text: string): "hotel" | "apartment" | null {
  const lower = text.toLowerCase();
  if (/(hotel|отель|гостиниц)/i.test(lower)) return "hotel";
  if (/(apartment|квартир|апартамент|посуточно|loft|studio)/i.test(lower)) return "apartment";
  return null;
}

function parseClockTime(text: string): string | null {
  const match = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!match) return null;
  return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

function parseSingleBookingDate(text: string): string | null {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const dot = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (dot) return `${dot[3]}-${dot[2]}-${dot[1]}`;

  const natural = parseNaturalDateRange(text);
  if (natural?.checkIn) return natural.checkIn;
  return null;
}

function parseAmenityHints(text: string): string[] {
  const lower = text.toLowerCase();
  const hints: string[] = [];
  const map: Array<{ token: RegExp; value: string }> = [
    { token: /(wifi|wi-fi|вайфай)/i, value: "wifi" },
    { token: /(parking|парков)/i, value: "parking" },
    { token: /(kitchen|кухн)/i, value: "kitchen" },
    { token: /(airport|аэропорт)/i, value: "airport" },
    { token: /(center|центр)/i, value: "center" },
  ];
  for (const item of map) {
    if (item.token.test(lower)) hints.push(item.value);
  }
  return hints;
}

function dishScore(item: MenuItem, message: string): number {
  const text = `${item.name} ${item.description} ${item.category}`.toLowerCase();
  const query = message.toLowerCase();
  let score = 0;
  if (query.includes("бургер") || query.includes("burger")) {
    if (text.includes("burger") || text.includes("бургер")) score += 8;
  }
  if (query.includes("пиц") || query.includes("pizza")) {
    if (text.includes("pizza") || text.includes("пиц")) score += 8;
  }
  if (query.includes("дешев") || query.includes("budget") || query.includes("недорог")) {
    score += Math.max(0, 6 - Math.round(item.price / 6000));
  }
  if (query.includes("стейк") || query.includes("steak")) {
    if (text.includes("steak") || text.includes("стейк")) score += 8;
  }
  if (query.includes("завтрак") || query.includes("breakfast")) {
    if (text.includes("breakfast") || text.includes("завтрак")) score += 8;
  }
  if (query.includes("дет") || query.includes("kids")) {
    if (text.includes("kids") || text.includes("дет")) score += 6;
  }
  score += Math.max(0, 4 - Math.round(item.price / 10000));
  return score;
}

function enrichConciergeMessage(raw: string, lang: Lang, currency: Currency): string {
  const additions: string[] = [];

  const guestsMissing = !/(guests?:\s*\d+|гости:\s*\d+)/i.test(raw);
  if (guestsMissing) {
    const guests = parseGuestsCount(raw);
    if (guests) additions.push(lang === "ru" ? `гости: ${guests}` : `guests: ${guests}`);
  }

  const budgetMissing = !/(budget:\s*|бюджет:\s*)/i.test(raw);
  if (budgetMissing) {
    const budget = parseBudgetRange(raw, currency);
    if (budget?.min !== undefined || budget?.max !== undefined) {
      if (budget.min !== undefined && budget.max !== undefined) {
        additions.push(lang === "ru" ? `бюджет: от ${budget.min} до ${budget.max}` : `budget: from ${budget.min} to ${budget.max}`);
      } else if (budget.max !== undefined) {
        additions.push(lang === "ru" ? `бюджет: до ${budget.max}` : `budget: up to ${budget.max}`);
      } else if (budget.min !== undefined) {
        additions.push(lang === "ru" ? `бюджет: от ${budget.min}` : `budget: from ${budget.min}`);
      }
    }
  }

  const cityMissing = !/(city:\s*[a-z])/i.test(raw.toLowerCase());
  if (cityMissing) {
    const city = parseCityFromText(raw);
    if (city) additions.push(`city: ${city}`);
  }

  const purposeMissing = !/(trip purpose:\s*[a-z]|цель:\s*[а-яa-z])/i.test(raw.toLowerCase());
  if (purposeMissing) {
    const purpose = parseTripPurpose(raw);
    if (purpose) additions.push(`trip purpose: ${purpose}`);
  }

  const propertyTypeMissing = !/(property type:\s*[a-z]|тип жилья:\s*[а-яa-z])/i.test(raw.toLowerCase());
  if (propertyTypeMissing) {
    const propertyType = parsePropertyType(raw);
    if (propertyType) additions.push(`property type: ${propertyType}`);
  }

  const amenityHints = parseAmenityHints(raw);
  if (amenityHints.length && !/(amenities:\s*[a-z,]+)/i.test(raw.toLowerCase())) {
    additions.push(`amenities: ${amenityHints.join(",")}`);
  }

  if (!/\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsedDates = parseNaturalDateRange(raw);
    if (parsedDates) {
      additions.push(
        lang === "ru"
          ? `даты: заезд ${parsedDates.checkIn}, выезд ${parsedDates.checkOut}`
          : `dates: check-in ${parsedDates.checkIn}, check-out ${parsedDates.checkOut}`,
      );
    }
  }

  if (!additions.length) return raw;
  return `${raw}\n${additions.join("\n")}`;
}

function cleanAssistantText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(
      (line) =>
        !/^логика подбора/i.test(line) &&
        !/^matched by/i.test(line) &&
        !/^workflow/i.test(line) &&
        !/^what i am doing now/i.test(line) &&
        !/^ход рассуждения/i.test(line) &&
        !/^этап:/i.test(line) &&
        !/^stage:/i.test(line) &&
        !/^selection summary:/i.test(line) &&
        !/^reasoning:/i.test(line) &&
        !/^rules?:/i.test(line) &&
        !/^\d+\)\s*(сначала|затем|потом|first|then)/i.test(line),
    )
    .join("\n");
}

function looksLikeMojibake(text: string): boolean {
  if (!text) return false;
  return /(Ð|Ñ|â€|â€™|вЂ|�)/.test(text);
}

function buildAssistantReply(
  data: ConciergeResponse,
  lang: Lang,
  currency: Currency,
  tr: (typeof t)["en"] | (typeof t)["ru"],
  knownFilters?: Partial<ConciergeResponse["filters"]>,
): string {
  const purpose = resolveTripPurpose(data.filters.trip_purpose);
  const compactKnown = compactKnownFilters(knownFilters);
  const effectiveFilters = {
    ...data.filters,
    ...compactKnown,
    amenities: compactKnown.amenities ?? data.filters.amenities,
  };
  const missingCity = !effectiveFilters.city;
  const missingDates = !effectiveFilters.check_in || !effectiveFilters.check_out;
  const missingGuests = !effectiveFilters.guests;
  const missingBudget = !effectiveFilters.max_price;
  const cleanedAnswer = cleanAssistantText(data.answer || "");
  const safeAnswer = looksLikeMojibake(cleanedAnswer) ? "" : cleanedAnswer;
  const consultQuestion =
    lang === "ru"
      ? "Показать дешевле, ближе к центру или сразу перейти к бронированию?"
      : "Want cheaper options, closer to center, or go straight to booking?";

  if (data.stage === "collect") {
    if (missingCity) return lang === "ru" ? "В каком городе ищем?" : "Which city should I search in?";
    if (missingDates) return lang === "ru" ? "Отлично. Подскажите даты заезда и выезда?" : "Great. What are your check-in and check-out dates?";
    if (missingGuests) return lang === "ru" ? "Сколько будет гостей?" : "How many guests?";
    if (missingBudget) return lang === "ru" ? "Какой бюджет за ночь рассматриваете?" : "What nightly budget should I use?";
    return safeAnswer || (lang === "ru" ? "Принял, продолжаю подбор." : "Perfect, I will continue the shortlist.");
  }

  if (data.suggestions.length > 0) {
    const top = data.suggestions.slice(0, 3);
    const cityHint = effectiveFilters.city
      ? localizeCityName(effectiveFilters.city, lang)
      : localizeCityName(top[0]?.city, lang);
    const head =
      lang === "ru"
        ? `Подобрал ${formatRuOptionCount(top.length)}${cityHint ? ` в ${cityHint}` : ""} для ${purposeLabel(lang, purpose)}.`
        : `I shortlisted ${top.length} good options${cityHint ? ` in ${cityHint}` : ""} for your ${purposeLabel(lang, purpose)}.`;
    const list = top.map((item, idx) => {
      const reason = cleanAssistantText(humanSuggestionReason(item.reason || "", lang));
      const roomLine = item.room_type_name
        ? lang === "ru"
          ? `Свободный номер: ${item.room_type_name}${item.room_available_count ? `, ${formatRoomsAvailable(item.room_available_count, lang)}` : ""}`
          : `Available room: ${item.room_type_name}${item.room_available_count ? `, ${formatRoomsAvailable(item.room_available_count, lang)}` : ""}`
        : "";
      const headline =
        lang === "ru"
          ? `${idx + 1}. ${item.title} — ${formatPrice(item.nightly_price, currency, lang)} / ночь`
          : `${idx + 1}. ${item.title} — ${formatPrice(item.nightly_price, currency, lang)} / night`;
      const meta =
        lang === "ru"
          ? `${item.district}, рейтинг ${item.rating.toFixed(1)}, до ${item.max_guests} гостей`
          : `${item.district}, rating ${item.rating.toFixed(1)}, up to ${item.max_guests} guests`;
      return reason
        ? `${headline}\n${[meta, roomLine].filter(Boolean).join("\n")}\n${lang === "ru" ? "Почему подходит" : "Why it fits"}: ${reason}`
        : `${headline}\n${[meta, roomLine].filter(Boolean).join("\n")}`;
    });

    let next = purposeCta(lang, purpose);
    if (missingDates) {
      next = lang === "ru" ? "Подскажите даты заезда и выезда?" : "What are your check-in and check-out dates?";
    } else if (missingGuests) {
      next = lang === "ru" ? "Сколько будет гостей?" : "How many guests?";
    } else if (missingBudget) {
      next = lang === "ru" ? "Чтобы сузить подбор, подскажите бюджет за ночь." : "To narrow options, share your nightly budget.";
    } else if (missingCity) {
      next = lang === "ru" ? "Уточните город, и я сразу сузю подбор." : "Share city and I will narrow the shortlist.";
    } else if (data.stage === "pricing" || data.stage === "booking") {
      next =
        lang === "ru"
          ? "Могу сразу закрепить и оформить бронь. Берем этот вариант или показать дешевле?"
          : "I can lock this option and proceed to booking now. Confirm this one or show cheaper options?";
    } else {
      next = consultQuestion;
    }

    return [head, ...list, next].join("\n\n");
  }

  if (data.alternatives.length > 0) {
    const topAlt = data.alternatives.slice(0, 3);
    const head =
      lang === "ru"
        ? "На выбранные даты вариантов мало, но есть хорошие альтернативы:"
        : "Options are limited for these dates, but here are good alternatives:";
    const list = topAlt.map((item, idx) =>
      lang === "ru"
        ? `${idx + 1}. ${item.title} — ${item.suggested_check_in} → ${item.suggested_check_out}, ${formatPrice(item.nightly_price, currency, lang)} / ночь`
        : `${idx + 1}. ${item.title} — ${item.suggested_check_in} → ${item.suggested_check_out}, ${formatPrice(item.nightly_price, currency, lang)} / night`,
    );
    const next =
      lang === "ru"
        ? "Могу сразу применить эти даты или подобрать еще 2-3 варианта рядом."
        : "I can apply these dates now or suggest 2-3 nearby options.";
    return [head, ...list, next].join("\n\n");
  }

  if (safeAnswer) return safeAnswer;
  if (missingDates) return lang === "ru" ? "Уточните даты заезда и выезда?" : "What dates do you need?";
  if (missingGuests) return lang === "ru" ? "Сколько будет гостей?" : "How many guests?";
  if (missingBudget) return lang === "ru" ? "Какой бюджет за ночь рассматриваете?" : "What nightly budget should I use?";
  if (missingCity) return lang === "ru" ? "В каком городе ищем?" : "Which city should I search in?";
  return tr.empty;
}

function normalizedPromptText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasDateSignalInText(text: string): boolean {
  return /(\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?|\d{4}-\d{2}-\d{2}|сегодня|завтра|послезавтра|май|июн|июл|авг|сен|окт|ноя|дек|today|tomorrow|weekend|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(
    text,
  );
}

function hasGuestsSignalInText(text: string): boolean {
  return /(\d{1,2}\s*(гост|чел|guests?|people|persons?))|(?:для|for|нас|we are)\s*\d{1,2}/i.test(text);
}

function hasBudgetSignalInText(text: string): boolean {
  return /(бюджет|budget|до|up to|under|less than|\$|₸|kzt|usd|\d+\s*(k|к|тыс|thousand))/i.test(text);
}

function softenRepeatedCollectPrompt(
  reply: string,
  data: ConciergeResponse,
  userMessage: string,
  lastAssistantText: string | undefined,
  lang: Lang,
  knownFilters?: Partial<ConciergeResponse["filters"]>,
): string {
  if (data.stage !== "collect") return reply;
  if (!lastAssistantText) return reply;
  const sameReply = normalizedPromptText(reply) === normalizedPromptText(lastAssistantText);
  if (!sameReply) return reply;

  const compactKnown = compactKnownFilters(knownFilters);
  const effectiveFilters = {
    ...data.filters,
    ...compactKnown,
    amenities: compactKnown.amenities ?? data.filters.amenities,
  };
  const missingCity = !effectiveFilters.city;
  const missingDates = !effectiveFilters.check_in || !effectiveFilters.check_out;
  const missingGuests = !effectiveFilters.guests;
  const missingBudget = !effectiveFilters.max_price;

  if (missingDates && hasDateSignalInText(userMessage)) {
    return lang === "ru"
      ? "Вижу, что даты указаны нестандартно. Напишите так: `10.05-13.05` или `2026-05-10 -> 2026-05-13`."
      : "I can see dates, but format is unclear. Please use `2026-05-10 -> 2026-05-13`.";
  }
  if (missingGuests && hasGuestsSignalInText(userMessage)) {
    return lang === "ru"
      ? "Чтобы продолжить, укажите гостей в формате `2 гостя` или `for 2 guests`."
      : "To continue, share guests as `2 guests`.";
  }
  if (missingBudget && hasBudgetSignalInText(userMessage)) {
    return lang === "ru"
      ? "Бюджет понял не до конца. Напишите, например: `до 45000 ₸` или `up to $90`."
      : "Budget format is unclear. Try `up to $90` or `до 45000 ₸`.";
  }
  if (missingCity && userMessage.trim().length >= 2) {
    return lang === "ru"
      ? "Нужен город для старта. Например: Алматы, Астана, Шымкент, Стамбул."
      : "I need a city to start. Example: Almaty, Astana, Shymkent, Istanbul.";
  }
  return reply;
}

type ExpectedCollectSlot = "city" | "dates" | "guests" | "budget" | null;

function inferExpectedCollectSlot(lastAssistantText: string | undefined): ExpectedCollectSlot {
  if (!lastAssistantText) return null;
  const text = lastAssistantText.toLowerCase();
  if (/(в каком городе|уточните город|need a city|which city)/i.test(text)) return "city";
  if (/(даты заезда|даты выезда|check-in|check-out|what dates)/i.test(text)) return "dates";
  if (/(сколько будет гостей|how many guests|share guests)/i.test(text)) return "guests";
  if (/(бюджет|nightly budget|share your nightly budget)/i.test(text)) return "budget";
  return null;
}

function enrichMessageByExpectedSlot(message: string, expected: ExpectedCollectSlot, lang: Lang): string {
  if (!expected) return message;
  const trimmed = message.trim();
  if (!trimmed) return message;

  if (expected === "guests" && /^\d{1,2}$/.test(trimmed)) {
    return lang === "ru" ? `${trimmed} гостя` : `${trimmed} guests`;
  }

  if (expected === "budget" && /^\d{2,9}$/.test(trimmed)) {
    return lang === "ru" ? `бюджет до ${trimmed}` : `budget up to ${trimmed}`;
  }

  if (expected === "dates" && /^\d{1,2}\s*[-–—]\s*\d{1,2}\s*[a-zа-яё]*$/i.test(trimmed)) {
    return lang === "ru" ? `даты ${trimmed}` : `dates ${trimmed}`;
  }

  return message;
}

function pickFollowUpPrompts(data: ConciergeResponse): string[] {
  const prompts = (data.follow_up_prompts ?? []).filter((prompt) => !looksLikeMojibake(prompt));
  if (!prompts.length) return [];

  if (data.stage === "collect") return prompts.slice(0, 1);
  if (data.stage === "search" || data.stage === "availability") return prompts.slice(0, 2);
  return prompts.slice(0, 1);
}

function isPriceObjection(text: string): boolean {
  return /(дорого|слишком дорого|высокая цена|high price|too expensive|expensive|over budget)/i.test(text);
}

function isDoubtObjection(text: string): boolean {
  return /(сомнева|не уверен|подумаю|не знаю|hesitat|not sure|i think later|need time)/i.test(text);
}

export default function AIConcierge({
  lang,
  currency,
  variant = "default",
  showcaseCards = [],
  quickPrompts = [],
  initialUserPrompt,
}: Props) {
  const tr = t[lang];
  const isRail = variant === "rail";
  const railUserPrompt =
    initialUserPrompt || (lang === "ru" ? "Нужен отель в Дубае на 3 ночи, 2 взрослых" : "Need a hotel in Dubai for 3 nights, 2 adults");
  const placeholder = isRail
    ? lang === "ru"
      ? "Напишите сообщение..."
      : "Write a message..."
    : lang === "ru"
      ? `Например: Алматы, 2 гостя, 1-5 мая, до ${currency === "USD" ? "90$" : "45000 ₸"}, командировка, wifi`
      : `Example: Almaty, 2 guests, May 1-5, up to ${currency === "USD" ? "$90" : "45 000 KZT"}, business trip, wifi`;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [assistantTyping, setAssistantTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotState>(EMPTY_SLOTS);

  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null);
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null);
  const [bookingName, setBookingName] = useState("");
  const [bookingEmail, setBookingEmail] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const [bookingCheckInTime, setBookingCheckInTime] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingErrors, setBookingErrors] = useState<BookingErrors>({});
  const [bookingPanelOpen, setBookingPanelOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const [paymentSnapshot, setPaymentSnapshot] = useState<ReservationPayment | null>(null);
  const [paymentStatusLoading, setPaymentStatusLoading] = useState(false);
  const [lastGuestEmail, setLastGuestEmail] = useState("");
  const [tariffQuoteCache, setTariffQuoteCache] = useState<Record<string, TariffQuoteBundle>>({});
  const analyticsSentRef = useRef<Set<string>>(new Set());
  const paymentModeActive = Boolean(paymentDraft);
  const bookingModeActive = Boolean(bookingDraft && !paymentDraft);
  const resultInteractionBlocked = bookingModeActive || paymentModeActive;

  const latestAnswer = useMemo(() => [...messages].reverse().find((msg) => msg.role === "assistant" && msg.data), [messages]);
  const latestReasonLines = useMemo(() => {
    const data = latestAnswer?.data;
    if (!data) return [] as string[];

    if (data.suggestions.length > 0) {
      return data.suggestions.slice(0, 3).map((item, idx) => {
        const reason = cleanAssistantText(humanSuggestionReason(item.reason || "", lang));
        if (reason) return `${idx + 1}. ${item.title}: ${reason}`;
        return lang === "ru"
          ? `${idx + 1}. ${item.title}: хороший баланс цены и рейтинга.`
          : `${idx + 1}. ${item.title}: balanced price and rating.`;
      });
    }

    if (data.alternatives.length > 0) {
      return data.alternatives.slice(0, 3).map((item, idx) =>
        lang === "ru"
          ? `${idx + 1}. ${item.title}: свободно на даты ${item.suggested_check_in} → ${item.suggested_check_out}.`
          : `${idx + 1}. ${item.title}: available on ${item.suggested_check_in} → ${item.suggested_check_out}.`,
      );
    }

    return [] as string[];
  }, [latestAnswer, lang]);
  const stageQuickPrompts = useMemo(() => {
    const data = latestAnswer?.data;
    if (!data) return [] as string[];
    if (resultInteractionBlocked) return [] as string[];
    const purpose = resolveTripPurpose(data.filters.trip_purpose);
    if (data.stage === "collect") return [];
    if (data.stage === "search" || data.stage === "pricing") {
      if (lang === "ru") {
        if (purpose === "business") return ["С документами для командировки", "С надежным wifi", "Поздний заезд"];
        if (purpose === "family") return ["Семейные варианты", "С кухней", "Тише и просторнее"];
        if (purpose === "couple") return ["Романтичнее", "С красивым видом", "Ближе к центру"];
        if (purpose === "solo") return ["Подешевле", "В центре", "Самозаселение"];
      } else {
        if (purpose === "business") return ["Business docs", "Reliable wifi", "Late check-in"];
        if (purpose === "family") return ["Family options", "With kitchen", "Quiet and spacious"];
        if (purpose === "couple") return ["More romantic", "Nice view", "Closer to center"];
        if (purpose === "solo") return ["Cheaper", "In center", "Self check-in"];
      }
      return lang === "ru"
        ? ["Покажи дешевле", "Ближе к центру", "Готов бронировать"]
        : ["Show cheaper", "Closer to center", "Ready to book"];
    }
    if (data.stage === "availability") {
      return lang === "ru"
        ? ["Покажи другие даты", "Покажи дешевле"]
        : ["Show other dates", "Show cheaper"];
    }
    if (data.stage === "booking") {
      return lang === "ru"
        ? ["Ок, оформляем бронь", "Показать рестораны отеля"]
        : ["Okay, proceed with booking", "Show hotel restaurants"];
    }
    if (data.stage === "payment_link") {
      return lang === "ru"
        ? ["Проверить статус оплаты", "Показать рестораны отеля"]
        : ["Check payment status", "Show hotel restaurants"];
    }
    return [];
  }, [latestAnswer, lang, resultInteractionBlocked]);

  const storageKey = useMemo(() => `findapart_ai_memory_${pathname}_${lang}_${currency}`, [pathname, lang, currency]);
  const {
    hasPendingRedirect: hasPendingPaymentRedirect,
    scheduleRedirect: schedulePaymentRedirect,
    cancelRedirect: cancelPaymentRedirect,
    redirectNow: redirectPaymentNow,
  } = useSoftRedirect({
    delayMs: 2500,
    onNavigate: (targetUrl) => {
      if (typeof window !== "undefined") {
        window.location.assign(new URL(targetUrl, window.location.origin).toString());
        return;
      }
      router.push(targetUrl);
    },
  });

  function currentBookingState(): ConciergeBookingState | undefined {
    if (!bookingDraft) return undefined;
    return {
      listing_id: bookingDraft.listingId,
      room_type_id: bookingDraft.roomTypeId ?? undefined,
      room_type_name: bookingDraft.roomTypeName ?? undefined,
      title: bookingDraft.title,
      check_in: bookingDraft.checkIn,
      check_out: bookingDraft.checkOut,
      guests: bookingDraft.guests,
      guest_name: bookingName.trim() || undefined,
      guest_email: bookingEmail.trim() || undefined,
      guest_phone: bookingPhone.trim() || undefined,
      check_in_time: bookingCheckInTime.trim() || undefined,
      step: !bookingName.trim()
        ? "name"
        : !bookingEmail.trim()
          ? "email"
          : !bookingPhone.trim()
            ? "phone"
            : !bookingCheckInTime.trim()
              ? "check_in_time"
              : "done",
    };
  }

  function applyServerBookingState(state?: ConciergeBookingState | null) {
    if (!state) return;
    if (state.listing_id && state.title && state.check_in && state.check_out && state.guests) {
      setBookingDraft({
        listingId: state.listing_id,
        roomTypeId: state.room_type_id ?? null,
        roomTypeName: state.room_type_name ?? null,
        title: state.title,
        checkIn: state.check_in,
        checkOut: state.check_out,
        guests: state.guests,
      });
    }
    if (typeof state.guest_name === "string") setBookingName(state.guest_name);
    if (typeof state.guest_email === "string") {
      setBookingEmail(state.guest_email);
      if (state.guest_email.trim()) setLastGuestEmail(state.guest_email.trim());
    }
    if (typeof state.guest_phone === "string") setBookingPhone(state.guest_phone);
    if (typeof state.check_in_time === "string") setBookingCheckInTime(state.check_in_time);
  }

  function slotsFromSearchParams(): Partial<SlotState> {
    const guestsRaw = Number(searchParams.get("guests") || "");
    return {
      city: normalizeCityForQuery(searchParams.get("city")) || undefined,
      check_in: searchParams.get("check_in") || undefined,
      check_out: searchParams.get("check_out") || undefined,
      guests: Number.isFinite(guestsRaw) && guestsRaw > 0 ? guestsRaw : undefined,
      min_price: clampPriceKzt(searchParams.get("min_price")),
      max_price: clampPriceKzt(searchParams.get("max_price")),
      property_type: searchParams.get("property_type") || undefined,
      amenities: normalizeAmenitiesList(searchParams.get("amenities")),
    };
  }

function mergedKnownSlots(extra?: Partial<SlotState>): SlotState {
  const base = mergeSlotState(EMPTY_SLOTS, slotsFromSearchParams());
  const withMemory = mergeSlotState(base, slots);
  return extra ? mergeSlotState(withMemory, extra) : withMemory;
}

function limitConciergeCards(response: ConciergeResponse): ConciergeResponse {
  const suggestions = Array.isArray(response.suggestions) ? response.suggestions.slice(0, MAX_CHAT_SUGGESTIONS) : [];
  const alternatives = Array.isArray(response.alternatives) ? response.alternatives.slice(0, MAX_CHAT_ALTERNATIVES) : [];
  let nextAction = response.next_action ?? null;

  if (nextAction?.type === "start_booking") {
    const top = suggestions[0];
    if (top) {
      const currentId = nextAction.listing_id ?? null;
      if (!currentId || currentId !== top.listing_id) {
        nextAction = {
          ...nextAction,
          listing_id: top.listing_id,
          title: top.title,
          city: top.city,
        };
      }
    }
  }

  if (nextAction?.type === "apply_alternative_dates") {
    const topAlt = alternatives[0];
    if (topAlt) {
      const currentId = nextAction.listing_id ?? null;
      if (!currentId || currentId !== topAlt.listing_id) {
        nextAction = {
          ...nextAction,
          listing_id: topAlt.listing_id,
          title: topAlt.title,
          city: topAlt.city,
          check_in: topAlt.suggested_check_in,
          check_out: topAlt.suggested_check_out,
        };
      }
    }
  }

  return {
    ...response,
    suggestions,
    alternatives,
    next_action: nextAction,
  };
}

function mergeResponseWithSlots(response: ConciergeResponse, sourceSlots?: Partial<SlotState>): ConciergeResponse {
  const limited = limitConciergeCards(response);
  const inferredCity = limited.filters.city ?? limited.suggestions?.[0]?.city ?? null;
  const normalizedCity = normalizeCityForQuery(inferredCity);
  const responseSlots: Partial<SlotState> = {
    city: normalizedCity || undefined,
    check_in: limited.filters.check_in || undefined,
    check_out: limited.filters.check_out || undefined,
    guests: limited.filters.guests || undefined,
    min_price: clampPriceKzt(limited.filters.min_price),
    max_price: clampPriceKzt(limited.filters.max_price),
    property_type: limited.filters.property_type ? String(limited.filters.property_type).toLowerCase() : undefined,
    amenities: normalizeAmenitiesList(limited.filters.amenities),
  };
  const nextSlots = mergeSlotState(mergedKnownSlots(sourceSlots), responseSlots);
  setSlots(nextSlots);
  return {
    ...limited,
    filters: {
      ...limited.filters,
      ...slotsToFilters(nextSlots),
    },
  };
}

async function enrichResponseWithRoomAvailability(response: ConciergeResponse): Promise<ConciergeResponse> {
  const action = response.next_action ?? null;
  const checkIn = action?.check_in || response.filters.check_in;
  const checkOut = action?.check_out || response.filters.check_out;
  const guests = action?.guests || response.filters.guests;
  if (!checkIn || !checkOut || !guests || response.suggestions.length === 0) return response;

  const enriched = await Promise.all(
    response.suggestions.map(async (suggestion): Promise<ConciergeResponse["suggestions"][number] | null> => {
      try {
        const availability = await getListingRoomAvailability({
          listing_id: suggestion.listing_id,
          from_date: checkIn,
          to_date: checkOut,
          guests,
        });
        const room = pickBestRoomType(availability.room_types, checkIn, checkOut);
        if (!room) return null;
        return {
          ...suggestion,
          nightly_price: room.nightly_price,
          max_guests: room.max_guests,
          reason:
            suggestion.reason && !suggestion.reason.toLowerCase().includes("room")
              ? `${suggestion.reason}, ${room.name}`
              : suggestion.reason,
          room_type_id: room.id,
          room_type_name: room.name,
          room_nightly_price: room.nightly_price,
          room_available_count: room.available_count,
          room_max_guests: room.max_guests,
        };
      } catch {
        return suggestion;
      }
    }),
  );

  const suggestions: ConciergeResponse["suggestions"] = enriched.flatMap((item) => (item ? [item] : []));
  if (!suggestions.length) {
    return {
      ...response,
      stage: "availability",
      suggestions: [],
      total_found: 0,
      answer:
        lang === "ru"
          ? "На эти даты свободных номеров по выбранным вариантам не осталось. Могу подобрать соседние даты или расширить фильтры."
          : "No room categories are available for these exact dates in the shortlisted stays. I can check nearby dates or broaden filters.",
      selection_summary: lang === "ru" ? "Свободные номера не найдены" : "No available rooms found",
      next_action: { type: "none", label: lang === "ru" ? "Изменить даты" : "Change dates" },
    };
  }

  const top = suggestions[0];
  const nextAction =
    action && (action.type === "start_booking" || action.type === "go_checkout")
      ? {
          ...action,
          listing_id: top.listing_id,
          title: top.title,
          city: top.city,
          check_in: checkIn,
          check_out: checkOut,
          guests,
          room_type_id: top.room_type_id ?? null,
          room_type_name: top.room_type_name ?? null,
        }
      : action;

  return {
    ...response,
    suggestions,
    total_found: Math.min(response.total_found || suggestions.length, suggestions.length),
    next_action: nextAction,
  };
}

  function paymentStatusLabel(snapshot: ReservationPayment | null): string {
    if (!snapshot) return tr.paymentUnknown;
    if (snapshot.payment_status === "paid") return tr.paymentPaid;
    if (snapshot.payment_status === "failed") return tr.paymentFailed;
    return tr.paymentPending;
  }

  function emitAnalytics(
    eventName: string,
    extra?: {
      listingId?: number | null;
      reservationId?: number | null;
      metadata?: Record<string, string | number | boolean | null>;
      dedupeKey?: string;
    },
  ) {
    const dedupeKey = extra?.dedupeKey ? `${eventName}:${extra.dedupeKey}` : "";
    if (dedupeKey && analyticsSentRef.current.has(dedupeKey)) return;
    if (dedupeKey) analyticsSentRef.current.add(dedupeKey);
    trackAnalyticsEvent({
      event_name: eventName,
      session_id: sessionId,
      listing_id: extra?.listingId ?? null,
      reservation_id: extra?.reservationId ?? null,
      lang,
      currency,
      metadata: extra?.metadata,
    });
  }

  async function refreshPaymentStatus(reservationId: number) {
    setPaymentStatusLoading(true);
    try {
      const snapshot = await getReservationPayment(
        reservationId,
        paymentDraft?.accessToken || getReservationAccessToken(reservationId),
      );
      setPaymentSnapshot(snapshot);
    } catch {
      // keep previous state silently to avoid noisy chat UX
    } finally {
      setPaymentStatusLoading(false);
    }
  }

  useEffect(() => {
    if (!paymentDraft?.reservationId) return;
    const reservationId = paymentDraft.reservationId;
    refreshPaymentStatus(reservationId);
    const timer = window.setInterval(() => {
      refreshPaymentStatus(reservationId);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paymentDraft?.reservationId]);

  useEffect(() => {
    emitAnalytics("chat_open", { dedupeKey: `${pathname}|${lang}|${currency}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function quoteCacheKey(data: ConciergeResponse): string | null {
    const action = data.next_action;
    if (!action || action.type !== "go_checkout") return null;
    const listingId = action.listing_id ?? data.suggestions?.[0]?.listing_id;
    const roomTypeId = action.room_type_id ?? data.suggestions?.[0]?.room_type_id ?? null;
    const checkIn = action.check_in || data.filters.check_in;
    const checkOut = action.check_out || data.filters.check_out;
    const guests = action.guests || data.filters.guests;
    if (!listingId || !checkIn || !checkOut || !guests) return null;
    return `${listingId}|${roomTypeId || "listing"}|${checkIn}|${checkOut}|${guests}`;
  }

  useEffect(() => {
    const latestGoCheckout = [...messages]
      .reverse()
      .find((entry) => entry.role === "assistant" && entry.data?.next_action?.type === "go_checkout");
    const data = latestGoCheckout?.data;
    if (!data) return;
    const key = quoteCacheKey(data);
    if (!key) return;
    const cached = tariffQuoteCache[key];
    if (cached?.basic && cached?.smart && cached?.flex) return;

    const action = data.next_action!;
    const listingId = action.listing_id ?? data.suggestions[0]?.listing_id;
    const roomTypeId = action.room_type_id ?? data.suggestions[0]?.room_type_id ?? undefined;
    const checkIn = action.check_in || data.filters.check_in;
    const checkOut = action.check_out || data.filters.check_out;
    const guests = action.guests || data.filters.guests;
    if (!listingId || !checkIn || !checkOut || !guests) return;

    let canceled = false;
    (async () => {
      try {
        const [basic, smart, flex] = await Promise.all([
          getListingQuote({ listing_id: listingId, check_in: checkIn, check_out: checkOut, guests, tariff: "basic", room_type_id: roomTypeId }),
          getListingQuote({ listing_id: listingId, check_in: checkIn, check_out: checkOut, guests, tariff: "smart", room_type_id: roomTypeId }),
          getListingQuote({ listing_id: listingId, check_in: checkIn, check_out: checkOut, guests, tariff: "flex", room_type_id: roomTypeId }),
        ]);
        if (canceled) return;
        setTariffQuoteCache((prev) => ({ ...prev, [key]: { basic, smart, flex } }));
      } catch {
        // keep approximate estimates if quote endpoint is temporarily unavailable
      }
    })();

    return () => {
      canceled = true;
    };
  }, [messages, tariffQuoteCache]);

  useEffect(() => {
    const latest = [...messages].reverse().find((entry) => entry.role === "assistant" && entry.data);
    const data = latest?.data;
    if (!data) return;
    const f = data.filters;
    if (!f.city || !f.check_in || !f.check_out || !f.guests) return;
    emitAnalytics("filters_collected", {
      listingId: data.suggestions[0]?.listing_id ?? null,
      metadata: {
        city: f.city,
        check_in: f.check_in,
        check_out: f.check_out,
        guests: f.guests,
      },
      dedupeKey: `${sessionId ?? "no-session"}|${f.city}|${f.check_in}|${f.check_out}|${f.guests}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionId]);

  useEffect(() => {
    if (!paymentDraft?.reservationId) return;
    if (paymentSnapshot?.payment_status !== "paid") return;
    emitAnalytics("paid", {
      listingId: paymentDraft.listingId,
      reservationId: paymentDraft.reservationId,
      dedupeKey: String(paymentDraft.reservationId),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentSnapshot?.payment_status, paymentDraft?.reservationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ConciergeMemory;
      if (!parsed || !Array.isArray(parsed.messages)) return;
      setMessages(parsed.messages.slice(-30));
      setSessionId(typeof parsed.sessionId === "string" ? parsed.sessionId : null);
      setBookingDraft(parsed.bookingDraft ?? null);
      setPendingBooking(parsed.pendingBooking ?? null);
      setPaymentDraft(parsed.paymentDraft ?? null);
      setPaymentSnapshot(parsed.paymentSnapshot ?? null);
      setLastGuestEmail(typeof parsed.lastGuestEmail === "string" ? parsed.lastGuestEmail : "");
      setSlots(parsed.slots ?? EMPTY_SLOTS);
    } catch {
      // ignore corrupted local storage payload
    }
    // restore once per key change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const memory: ConciergeMemory = {
      messages: messages.slice(-30),
      sessionId,
      bookingDraft,
      pendingBooking,
      paymentDraft,
      paymentSnapshot,
      lastGuestEmail,
      slots,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(memory));
  }, [messages, sessionId, bookingDraft, pendingBooking, paymentDraft, paymentSnapshot, lastGuestEmail, slots, storageKey]);

  async function sendMessage(message: string): Promise<ConciergeResponse> {
    const contextMessages = messages
      .filter((entry) => entry.role === "user")
      .map((entry) => entry.text)
      .slice(-4);

    const structuredContext: string[] = [];
    const city = latestAnswer?.data?.filters.city || searchParams.get("city") || parseCityFromText(message) || null;
    if (city && typeof city === "string") structuredContext.push(`city: ${city}`);

    const checkIn = latestAnswer?.data?.filters.check_in || bookingDraft?.checkIn || searchParams.get("check_in") || null;
    const checkOut = latestAnswer?.data?.filters.check_out || bookingDraft?.checkOut || searchParams.get("check_out") || null;
    if (checkIn && checkOut) structuredContext.push(`dates: check-in ${checkIn}, check-out ${checkOut}`);

    const guestsRaw = latestAnswer?.data?.filters.guests || bookingDraft?.guests || Number(searchParams.get("guests") || "");
    const guests = Number.isFinite(Number(guestsRaw)) && Number(guestsRaw) > 0 ? Number(guestsRaw) : null;
    if (guests) structuredContext.push(`guests: ${guests}`);

    const minPrice = latestAnswer?.data?.filters.min_price ?? searchParams.get("min_price");
    const maxPrice = latestAnswer?.data?.filters.max_price ?? searchParams.get("max_price");
    if (minPrice || maxPrice) {
      if (minPrice && maxPrice) structuredContext.push(`budget: from ${minPrice} to ${maxPrice}`);
      else if (maxPrice) structuredContext.push(`budget: up to ${maxPrice}`);
      else structuredContext.push(`budget: from ${minPrice}`);
    }

    const mergedContext = [...structuredContext, ...contextMessages];
    const dedupedContext = Array.from(new Set(mergedContext)).slice(-8);

    return askConcierge({
      message,
      lang,
      currency,
      context_messages: dedupedContext,
      session_id: sessionId ?? undefined,
      booking_state: currentBookingState(),
    });
  }

  async function buildOfflineConciergeResponse(message: string): Promise<ConciergeResponse> {
    const parsedDates = parseNaturalDateRange(message);
    const city = parseCityFromText(message) || searchParams.get("city") || null;
    const budget = parseBudgetRange(message, currency);
    const guestsFromText = parseGuestsCount(message);
    const guestsFromUrl = Number(searchParams.get("guests") || "");
    const guests = guestsFromText || (Number.isFinite(guestsFromUrl) && guestsFromUrl > 0 ? guestsFromUrl : null);
    const propertyType = parsePropertyType(message);
    const purpose = parseTripPurpose(message);
    const amenityHints = parseAmenityHints(message);

    if (!city) {
      return {
        stage: "collect",
        answer:
          lang === "ru"
            ? "Уточните город, и сразу подберу лучшие варианты. Например: Алматы, 2 гостя, 1-5 мая, до 45000."
            : "Please share city and I will shortlist the best stays. Example: Almaty, 2 guests, May 1-5, up to $90.",
        selection_summary: lang === "ru" ? "Нужен город для старта поиска" : "City is required to start search",
        reasoning: "offline_fallback_collect_city",
        filters: {
          city: null,
          check_in: parsedDates?.checkIn || null,
          check_out: parsedDates?.checkOut || null,
          guests: guests || null,
          min_price: budget?.min ?? null,
          max_price: budget?.max ?? null,
          trip_purpose: purpose,
          property_type: propertyType,
          amenities: amenityHints,
          q: amenityHints.length ? amenityHints.join(" ") : null,
        },
        suggestions: [],
        alternatives: [],
        total_found: 0,
        follow_up_prompts:
          lang === "ru"
            ? ["Алматы, 2 гостя, 1-5 мая, до 45000", "Шымкент, семейный вариант, до 35000"]
            : ["Almaty, 2 guests, May 1-5, up to $90", "Shymkent, family stay, up to $70"],
        workflow_steps: [],
        next_action: { type: "none", label: lang === "ru" ? "Указать город" : "Add city" },
        session_id: sessionId ?? "offline_fallback",
        booking_state: currentBookingState() ?? null,
      };
    }

    const listingResp = await getListings({
      city,
      guests: guests || undefined,
      min_price: budget?.min,
      max_price: budget?.max,
      property_type: propertyType || undefined,
      amenities: amenityHints.length ? amenityHints.join(",") : undefined,
      sort_by: "rating",
      sort_order: "desc",
      page_size: 80,
    });

    let candidates = listingResp.items.filter((item) => item.is_active);
    if (propertyType) {
      candidates = candidates.filter((item) => item.property_type.toLowerCase().includes(propertyType));
    }

    const scored = candidates
      .map((item) => {
        let score = item.rating * 12;
        const reasons: string[] = [];
        if (budget?.max && item.nightly_price <= budget.max) {
          score += 16;
          reasons.push(lang === "ru" ? "в рамках бюджета" : "within budget");
        }
        if (guests && item.max_guests >= guests) {
          score += 10;
          reasons.push(lang === "ru" ? "подходит по гостям" : "fits guest count");
        }
        const amenities = item.amenities.toLowerCase();
        if (amenityHints.includes("wifi") && amenities.includes("wifi")) {
          score += 6;
          reasons.push("wifi");
        }
        if (amenityHints.includes("parking") && amenities.includes("parking")) {
          score += 6;
          reasons.push(lang === "ru" ? "парковка" : "parking");
        }
        if (purpose === "family" && item.max_guests >= 4) {
          score += 7;
          reasons.push(lang === "ru" ? "подходит для семьи" : "family friendly");
        }
        if (purpose === "business" && (amenities.includes("wifi") || amenities.includes("workspace"))) {
          score += 7;
          reasons.push(lang === "ru" ? "для командировки" : "business friendly");
        }
        if (!reasons.length) reasons.push(lang === "ru" ? "сильный баланс цена/качество" : "strong value balance");
        return { item, score, reason: reasons.slice(0, 2).join(", ") };
      })
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.item.nightly_price - b.item.nightly_price));

    const suggestions = scored.slice(0, MAX_CHAT_SUGGESTIONS).map(({ item, reason }) => ({
      listing_id: item.id,
      title: item.title,
      city: item.city,
      district: item.district,
      nightly_price: item.nightly_price,
      rating: item.rating,
      max_guests: item.max_guests,
      reason,
      cover_photo_url: item.cover_photo_url ?? null,
    }));

    if (!suggestions.length) {
      return {
        stage: "availability",
        answer:
          lang === "ru"
            ? `В ${city} на текущие параметры вариантов мало. Могу предложить соседние даты или увеличить бюджет.`
            : `In ${city}, options are limited for current filters. I can suggest nearby dates or a higher budget.`,
        selection_summary: lang === "ru" ? "Совпадений не найдено" : "No matches found",
        reasoning: "offline_fallback_no_matches",
        filters: {
          city,
          check_in: parsedDates?.checkIn || searchParams.get("check_in") || null,
          check_out: parsedDates?.checkOut || searchParams.get("check_out") || null,
          guests: guests || null,
          min_price: budget?.min ?? null,
          max_price: budget?.max ?? null,
          trip_purpose: purpose,
          property_type: propertyType,
          amenities: amenityHints,
          q: amenityHints.length ? amenityHints.join(" ") : null,
        },
        suggestions: [],
        alternatives: [],
        total_found: 0,
        follow_up_prompts:
          lang === "ru" ? ["Покажи дешевле", "Покажи варианты на другие даты"] : ["Show cheaper", "Show other dates"],
        workflow_steps: [],
        next_action: { type: "none", label: lang === "ru" ? "Изменить фильтры" : "Adjust filters" },
        session_id: sessionId ?? "offline_fallback",
        booking_state: currentBookingState() ?? null,
      };
    }

    const topFirst = suggestions[0];
    return {
      stage: "search",
      answer:
        lang === "ru"
          ? `Нашел ${suggestions.length} вариантов в ${city}. Рекомендую начать с ${topFirst.title} — ${humanSuggestionReason(
              topFirst.reason,
              lang,
            )}.`
          : `I found ${suggestions.length} options in ${city}. I recommend starting with ${topFirst.title} — ${humanSuggestionReason(
              topFirst.reason,
              lang,
            )}.`,
      selection_summary: lang === "ru" ? "Локальный fallback подбор" : "Local fallback selection",
      reasoning: "offline_fallback_ranked",
      filters: {
        city,
        check_in: parsedDates?.checkIn || searchParams.get("check_in") || null,
        check_out: parsedDates?.checkOut || searchParams.get("check_out") || null,
        guests: guests || null,
        min_price: budget?.min ?? null,
        max_price: budget?.max ?? null,
        trip_purpose: purpose,
        property_type: propertyType,
        amenities: amenityHints,
        q: amenityHints.length ? amenityHints.join(" ") : null,
      },
      suggestions,
      alternatives: [],
      total_found: candidates.length,
      follow_up_prompts:
        lang === "ru" ? ["Покажи дешевле", "Покажи ближе к центру", "Сразу к бронированию"] : ["Show cheaper", "Closer to center", "Book now"],
      workflow_steps: [],
      next_action: {
        type: "start_booking",
        label: lang === "ru" ? "Забронировать" : "Book now",
        listing_id: topFirst.listing_id,
        title: topFirst.title,
        city: topFirst.city,
        check_in: parsedDates?.checkIn || searchParams.get("check_in") || undefined,
        check_out: parsedDates?.checkOut || searchParams.get("check_out") || undefined,
        guests: guests || undefined,
      },
      session_id: sessionId ?? "offline_fallback",
      booking_state: currentBookingState() ?? null,
    };
  }

  function shouldRescueWithOffline(message: string, serverResponse: ConciergeResponse): boolean {
    const requestedCity = normalizeCityForQuery(parseCityFromText(message));
    const parsedDates = parseNaturalDateRange(message);
    const parsedGuests = parseGuestsCount(message);
    const parsedBudget = parseBudgetRange(message, currency);
    const parsedPropertyType = parsePropertyType(message);
    const parsedAmenities = normalizeAmenitiesForQuery(parseAmenityHints(message));
    const serverAmenities = normalizeAmenitiesForQuery(serverResponse.filters.amenities);
    const serverPreferenceText = [serverAmenities, serverResponse.filters.q].filter(Boolean).join(",");
    const hasServerOptions = serverResponse.suggestions.length > 0 || serverResponse.alternatives.length > 0;

    // If the user shared a concrete constraint but server answer ignored it,
    // switch to local fallback instead of repeating the same clarification question.
    if (parsedDates && (!serverResponse.filters.check_in || !serverResponse.filters.check_out)) return true;
    if (parsedGuests && !serverResponse.filters.guests) return true;
    if (!hasServerOptions && parsedPropertyType && !serverResponse.filters.property_type) return true;
    if (!hasServerOptions && parsedAmenities && !serverPreferenceText) return true;
    if (parsedBudget && parsedBudget.max && !serverResponse.filters.max_price) return true;

    if (!requestedCity) return false;

    const responseCity = normalizeCityForQuery(serverResponse.filters.city ?? null);
    if (!responseCity) return true;

    const requested = requestedCity.toLowerCase();
    const actual = responseCity.toLowerCase();
    if (requested !== actual && serverResponse.stage === "collect") return true;

    if (!serverResponse.suggestions.length) return false;
    const allFromOtherCities = serverResponse.suggestions.every((item) => {
      const suggestionCity = normalizeCityForQuery(item.city);
      return !suggestionCity || suggestionCity.toLowerCase() !== requested;
    });
    return allFromOtherCities;
  }

  async function runConciergeTurn(message: string): Promise<ConciergeResponse> {
    const enriched = enrichConciergeMessage(message, lang, currency);
    const serverResponse = await sendMessage(enriched);
    if (!shouldRescueWithOffline(message, serverResponse)) return serverResponse;
    try {
      return await buildOfflineConciergeResponse(message);
    } catch {
      return serverResponse;
    }
  }

  function resolveChatListingContext() {
    if (bookingDraft) return { listingId: bookingDraft.listingId, title: bookingDraft.title };
    if (paymentDraft) return { listingId: paymentDraft.listingId, title: paymentDraft.title };
    const data = latestAnswer?.data;
    const actionListing = data?.next_action?.listing_id ?? null;
    const actionTitle = data?.next_action?.title ?? null;
    if (actionListing && actionTitle) return { listingId: actionListing, title: actionTitle };
    if (data?.suggestions?.[0]) return { listingId: data.suggestions[0].listing_id, title: data.suggestions[0].title };
    return null;
  }

  function isRestaurantIntent(message: string): boolean {
    return /(ресторан|столик|ужин|поужин|restaurant|dinner|table)/i.test(message);
  }

  function isFoodIntent(message: string): boolean {
    return /(блюд|еда|поесть|меню|food|dish|meal|burger|pizza|steak|завтрак)/i.test(message);
  }

  function isRoomServiceOrderIntent(message: string): boolean {
    return /(закаж|оформи.*заказ|принес|в номер|room service|order|bring|deliver)/i.test(message);
  }

  function isRestaurantBookingIntent(message: string): boolean {
    return /(забронир|бронь|book|reserve).*(стол|table|restaurant|ресторан)/i.test(message);
  }

  function pickRestaurantByMessage(restaurants: Restaurant[], message: string): Restaurant {
    const lower = message.toLowerCase();
    const byName = restaurants.find((item) => lower.includes(item.name.toLowerCase()));
    if (byName) return byName;
    const sorted = [...restaurants].sort((a, b) => a.avg_check_kzt - b.avg_check_kzt);
    return sorted[0];
  }

  function formatAvgCheck(avgCheckKzt: number): string {
    return formatPrice(avgCheckKzt, currency, lang);
  }

  function resolvePaymentAccessToken(): string | undefined {
    if (!paymentDraft?.reservationId) return undefined;
    return paymentDraft.accessToken || getReservationAccessToken(paymentDraft.reservationId) || undefined;
  }

  function summarizeRestaurant(item: Restaurant): string {
    if (lang === "ru") {
      return `${item.name} (${item.cuisine}) — средний чек ${formatAvgCheck(item.avg_check_kzt)}, часы ${item.open_from}-${item.open_to}`;
    }
    return `${item.name} (${item.cuisine}) — average check ${formatAvgCheck(item.avg_check_kzt)}, open ${item.open_from}-${item.open_to}`;
  }

  function dishReason(item: MenuItem, message: string): string {
    const q = message.toLowerCase();
    if ((q.includes("бургер") || q.includes("burger")) && /(бургер|burger)/i.test(item.name + item.description)) {
      return lang === "ru" ? "совпадает с запросом на бургер" : "matches your burger request";
    }
    if ((q.includes("завтрак") || q.includes("breakfast")) && /(завтрак|breakfast)/i.test(item.name + item.description + item.category)) {
      return lang === "ru" ? "подходит для завтрака" : "fits breakfast preference";
    }
    if (item.price <= 7000) {
      return lang === "ru" ? "хорошая цена" : "good value price";
    }
    return lang === "ru" ? "популярный вариант в этой категории" : "strong option in this category";
  }

  function parseOrderQuantity(message: string): number {
    const direct = message.match(/\b(\d{1,2})\b/);
    if (!direct) return 1;
    const value = Number(direct[1]);
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(9, value));
  }

  async function handleHospitalityIntent(message: string): Promise<boolean> {
    const restaurantIntent = isRestaurantIntent(message);
    const foodIntent = isFoodIntent(message);
    if (!restaurantIntent && !foodIntent) return false;

    const context = resolveChatListingContext();
    if (!context) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            lang === "ru"
              ? "Сначала выберите объект, и я подберу рестораны и блюда именно для него."
              : "Please pick a stay first, then I can recommend its restaurants and menu options.",
        },
      ]);
      return true;
    }

    if (restaurantIntent) {
      try {
        const restaurants = await getListingRestaurants(context.listingId, true);
        if (!restaurants.length) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text:
                lang === "ru"
                  ? `У объекта ${context.title} пока нет подключенных ресторанов. Могу предложить доставку по меню в номер.`
                  : `${context.title} has no connected restaurants yet. I can still help with room-service menu options.`,
            },
          ]);
          return true;
        }

        if (isRestaurantBookingIntent(message)) {
          if (!paymentDraft?.reservationId || !lastGuestEmail) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                text:
                  lang === "ru"
                    ? "Могу забронировать столик сразу после создания брони проживания. Сначала завершим бронирование объекта."
                    : "I can book a table right after stay reservation is created. First, let’s complete stay booking.",
              },
            ]);
            return true;
          }

          const selected = pickRestaurantByMessage(restaurants, message);
          const bookingDate = parseSingleBookingDate(message) || paymentDraft.checkIn;
          const bookingTime = parseClockTime(message) || "19:00";
          const guests = parseGuestsCount(message) || paymentDraft.guests || 2;
          const note = lang === "ru" ? "Создано через AI-консьержа" : "Created by AI concierge";

          await createRestaurantBooking({
            reservation_id: paymentDraft.reservationId,
            restaurant_id: selected.id,
            guest_email: lastGuestEmail,
            access_token: resolvePaymentAccessToken(),
            booking_date: bookingDate,
            booking_time: bookingTime,
            guests,
            note,
          });

          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text:
                lang === "ru"
                  ? `Готово: забронировал столик в ${selected.name} на ${bookingDate} в ${bookingTime} для ${guests} гостей.`
                  : `Done: table booked at ${selected.name} for ${bookingDate} at ${bookingTime} for ${guests} guests.`,
            },
          ]);
          return true;
        }

        const ranked = [...restaurants].sort((a, b) => a.avg_check_kzt - b.avg_check_kzt).slice(0, 3);
        const reasonText =
          lang === "ru"
            ? "Выбрал по балансу цены, кухни и часов работы:"
            : "Picked by best balance of price, cuisine and opening hours:";
        const lines = ranked.map((item, idx) => `${idx + 1}. ${summarizeRestaurant(item)}`);
        const tail =
          lang === "ru"
            ? "Если хотите, сразу забронирую столик. Напишите: ресторан + дата + время + гости."
            : "If you want, I can book a table now. Send: restaurant + date + time + guests.";
        setMessages((prev) => [...prev, { role: "assistant", text: [reasonText, ...lines, tail].join("\n") }]);
        return true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to load restaurants";
        setMessages((prev) => [...prev, { role: "assistant", text: msg }]);
        return true;
      }
    }

    if (foodIntent) {
      try {
        const menu = await getInStayMenuForListing(context.listingId, true);
        if (!menu.length) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text:
                lang === "ru"
                  ? `Для ${context.title} меню пока пустое. Могу показать доступные рестораны и забронировать столик.`
                  : `Menu for ${context.title} is currently empty. I can show restaurants and book a table for you.`,
            },
          ]);
          return true;
        }

        const ranked = [...menu]
          .map((item) => ({ item, score: dishScore(item, message) }))
          .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.item.price - b.item.price))
          .slice(0, 3)
          .map(({ item }) => item);

        if (isRoomServiceOrderIntent(message)) {
          if (!paymentDraft?.reservationId || !lastGuestEmail) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                text:
                  lang === "ru"
                    ? "Смогу оформить заказ в номер сразу после подтверждения брони проживания."
                    : "I can place a room-service order right after your stay booking is confirmed.",
              },
            ]);
            return true;
          }

          const quantity = parseOrderQuantity(message);
          const selectedDish = ranked[0];
          const deliveryNote = message.trim().slice(0, 250);

          const order = await createRoomServiceOrder({
            reservation_id: paymentDraft.reservationId,
            guest_email: lastGuestEmail,
            access_token: resolvePaymentAccessToken(),
            items: [{ menu_item_id: selectedDish.id, quantity }],
            delivery_note: deliveryNote,
          });

          const confirmation =
            lang === "ru"
              ? `Заказ принят: ${selectedDish.name} x${quantity}. Сумма ${formatPrice(
                  order.total_price,
                  currency,
                  lang,
                )}. Статус: ${order.status}.`
              : `Order accepted: ${selectedDish.name} x${quantity}. Total ${formatPrice(
                  order.total_price,
                  currency,
                  lang,
                )}. Status: ${order.status}.`;
          setMessages((prev) => [...prev, { role: "assistant", text: confirmation }]);
          return true;
        }

        const reasonText =
          lang === "ru"
            ? "Подобрал блюда под ваш запрос:"
            : "Picked menu options for your request:";
        const lines = ranked.map(
          (item, idx) =>
            `${idx + 1}. ${item.name} — ${formatPrice(item.price, currency, lang)} (${lang === "ru" ? "почему" : "why"}: ${dishReason(
              item,
              message,
            )})`,
        );
        const tail =
          lang === "ru"
            ? "Если хотите, подскажу, что лучше взять для 1-2 гостей или для семьи."
            : "If you want, I can suggest the best combo for 1-2 guests or a family.";
        setMessages((prev) => [...prev, { role: "assistant", text: [reasonText, ...lines, tail].join("\n") }]);
        return true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to load menu";
        setMessages((prev) => [...prev, { role: "assistant", text: msg }]);
        return true;
      }
    }

    return false;
  }

  function handleSalesObjection(message: string): boolean {
    const data = latestAnswer?.data;
    if (!data || data.suggestions.length === 0) return false;
    const purpose = resolveTripPurpose(data.filters.trip_purpose);

    if (isPriceObjection(message)) {
      const cheaper = [...data.suggestions].sort((a, b) => a.nightly_price - b.nightly_price).slice(0, 2);
      const tail =
        lang === "ru"
          ? purpose === "family"
            ? "Могу сразу показать более семейные варианты в этом бюджете."
            : purpose === "business"
              ? "Могу сразу оставить только варианты с wifi и отчетными документами."
              : purpose === "couple"
                ? "Могу подобрать более уютные варианты без выхода за бюджет."
                : "Могу сразу применить фильтр дешевле или закрепить самый выгодный вариант."
          : purpose === "family"
            ? "I can show more family-friendly options within this budget."
            : purpose === "business"
              ? "I can keep only options with wifi and business docs."
              : purpose === "couple"
                ? "I can find cozier options without going over budget."
                : "I can apply a cheaper filter now or lock the best value option.";
      const lines =
        lang === "ru"
          ? [
              "Понял вас, давайте уложимся в бюджет.",
              ...cheaper.map(
                (item, idx) =>
                  `${idx + 1}. ${item.title} — ${formatPrice(item.nightly_price, currency, lang)} / ночь (${item.district})`,
              ),
              tail,
            ]
          : [
              "Understood, let's stay within budget.",
              ...cheaper.map(
                (item, idx) =>
                  `${idx + 1}. ${item.title} — ${formatPrice(item.nightly_price, currency, lang)} / night (${item.district})`,
              ),
              tail,
            ];
      setMessages((prev) => [...prev, { role: "assistant", text: lines.join("\n") }]);
      return true;
    }

    if (isDoubtObjection(message)) {
      const top = data.suggestions[0];
      const compare = data.suggestions[1];
      const lines =
        lang === "ru"
          ? [
              "Нормально, давайте без спешки сравним.",
              top ? `• Лучший старт: ${top.title} — ${formatPrice(top.nightly_price, currency, lang)} / ночь.` : "",
              compare ? `• Альтернатива: ${compare.title} — ${formatPrice(compare.nightly_price, currency, lang)} / ночь.` : "",
              "Если хотите, покажу еще 3 варианта или сразу закреплю текущую цену на лучший.",
            ].filter(Boolean)
          : [
              "Makes sense, let's compare calmly.",
              top ? `• Best start: ${top.title} — ${formatPrice(top.nightly_price, currency, lang)} / night.` : "",
              compare ? `• Alternative: ${compare.title} — ${formatPrice(compare.nightly_price, currency, lang)} / night.` : "",
              "If you want, I can show 3 more options or lock the current price for the best one now.",
            ].filter(Boolean);
      setMessages((prev) => [...prev, { role: "assistant", text: lines.join("\n") }]);
      return true;
    }

    return false;
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userMessage = query.trim();
    if (!userMessage || loading) return;

    if (shouldResetConversation(userMessage)) {
      resetConversationState();
      setQuery("");
      setMessages([
        {
          role: "assistant",
          text:
            lang === "ru"
              ? "Начинаем заново. Напишите город, даты, гостей и бюджет — подберу лучший вариант."
              : "Starting fresh. Share city, dates, guests and budget — I will shortlist the best options.",
        },
      ]);
      return;
    }

    const previousAssistantText = [...messages].reverse().find((msg) => msg.role === "assistant")?.text;
    const expectedSlot = inferExpectedCollectSlot(previousAssistantText);
    const message = enrichMessageByExpectedSlot(userMessage, expectedSlot, lang);

    if (bookingDraft) {
      setMessages((prev) => [...prev, { role: "user", text: userMessage }]);

      let changed = false;
      const parsedEmail = parseEmail(message);
      const parsedPhone = parsePhone(message);
      const parsedTime = parseCheckInTime(message);
      const parsedName = parseName(message);

      if (parsedName && !bookingName.trim()) {
        setBookingName(parsedName);
        changed = true;
      }
      if (parsedEmail && !bookingEmail.trim()) {
        setBookingEmail(parsedEmail);
        changed = true;
      }
      if (parsedPhone && !bookingPhone.trim()) {
        setBookingPhone(parsedPhone);
        changed = true;
      }
      if (parsedTime && !bookingCheckInTime.trim()) {
        setBookingCheckInTime(parsedTime);
        changed = true;
      }

      const nextMissing = !bookingName.trim() && !(parsedName && !bookingName.trim())
        ? tr.bookingStepName
        : !bookingEmail.trim() && !(parsedEmail && !bookingEmail.trim())
          ? tr.bookingStepEmail
          : !bookingPhone.trim() && !(parsedPhone && !bookingPhone.trim())
            ? tr.bookingStepPhone
            : !bookingCheckInTime.trim() && !(parsedTime && !bookingCheckInTime.trim())
              ? tr.bookingStepTime
              : null;

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: changed ? `${tr.bookingUpdated}\n${nextMissing ?? tr.bookingStepDone}` : nextMissing ?? tr.bookingStepDone,
        },
      ]);
      setQuery("");
      return;
    }

    if (pendingBooking) {
      setMessages((prev) => [...prev, { role: "user", text: userMessage }]);
      setQuery("");

      const pendingSlots = extractSlotsFromText(message, currency);
      setSlots((prev) => mergeSlotState(prev, pendingSlots));

      const searchGuests = Number(searchParams.get("guests") || "");
      const nextBooking: PendingBooking = {
        ...pendingBooking,
        checkIn: pendingSlots.check_in || pendingBooking.checkIn || latestAnswer?.data?.filters.check_in || searchParams.get("check_in") || null,
        checkOut: pendingSlots.check_out || pendingBooking.checkOut || latestAnswer?.data?.filters.check_out || searchParams.get("check_out") || null,
        guests:
          pendingSlots.guests ||
          pendingBooking.guests ||
          latestAnswer?.data?.filters.guests ||
          (Number.isFinite(searchGuests) && searchGuests > 0 ? searchGuests : null),
      };

      if (!nextBooking.checkIn || !nextBooking.checkOut) {
        setPendingBooking(nextBooking);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: lang === "ru" ? "Даты всё ещё не понял. Напишите, например: «с 10 июня на 3 ночи»." : "I still need dates. For example: \"June 10 for 3 nights\".",
          },
        ]);
        return;
      }

      if (!nextBooking.guests) {
        setPendingBooking(nextBooking);
        setMessages((prev) => [...prev, { role: "assistant", text: tr.needGuestsFirst }]);
        return;
      }

      startBooking({
        listingId: nextBooking.listingId,
        roomTypeId: nextBooking.roomTypeId ?? null,
        roomTypeName: nextBooking.roomTypeName ?? null,
        title: nextBooking.title,
        checkIn: nextBooking.checkIn,
        checkOut: nextBooking.checkOut,
        guests: nextBooking.guests,
      });
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text: userMessage }]);
    setAssistantTyping(true);
    setQuery("");

    const handledHospitality = await handleHospitalityIntent(userMessage);
    if (handledHospitality) {
      setAssistantTyping(false);
      return;
    }

    const handledObjection = handleSalesObjection(userMessage);
    if (handledObjection) {
      setAssistantTyping(false);
      return;
    }

    const quickHandledReply = await tryHandleQuickPrompt(userMessage);
    if (quickHandledReply) {
      const quickData = quickHandledReply.data ? await enrichResponseWithRoomAvailability(quickHandledReply.data) : undefined;
      setMessages((prev) => [...prev, { role: "assistant", text: quickHandledReply.text, data: quickData }]);
      setAssistantTyping(false);
      return;
    }

    setLoading(true);
    const messageSlots = extractSlotsFromText(message, currency);
    setSlots((prev) => mergeSlotState(prev, messageSlots));

    try {
      const response = await runConciergeTurn(message);
      await wait(320);
      if (response.session_id) setSessionId(response.session_id);
      const normalized = await enrichResponseWithRoomAvailability(mergeResponseWithSlots(response, messageSlots));
      applyServerBookingState(normalized.booking_state);
      const knownFilters = slotsToFilters(mergedKnownSlots(messageSlots));
      const previousAssistant = [...messages].reverse().find((msg) => msg.role === "assistant")?.text;
      const assistantReply = softenRepeatedCollectPrompt(
        buildAssistantReply(normalized, lang, currency, tr, knownFilters),
        normalized,
        userMessage,
        previousAssistantText,
        lang,
        knownFilters,
      );
      setMessages((prev) => [...prev, { role: "assistant", text: assistantReply, data: normalized }]);
      if (shouldSyncFiltersFromChat(normalized)) applyFilters(normalized);
    } catch (error) {
      try {
        const fallbackResponse = await buildOfflineConciergeResponse(message);
        await wait(180);
        const normalizedFallback = await enrichResponseWithRoomAvailability(mergeResponseWithSlots(fallbackResponse, messageSlots));
        const knownFilters = slotsToFilters(mergedKnownSlots(messageSlots));
        const previousAssistant = [...messages].reverse().find((msg) => msg.role === "assistant")?.text;
        const assistantReply = buildAssistantReply(
          normalizedFallback,
          lang,
          currency,
          tr,
          knownFilters,
        );
        const softened = softenRepeatedCollectPrompt(
          assistantReply,
          normalizedFallback,
          userMessage,
          previousAssistantText,
          lang,
          knownFilters,
        );
        setMessages((prev) => [...prev, { role: "assistant", text: softened, data: normalizedFallback }]);
        if (shouldSyncFiltersFromChat(normalizedFallback)) applyFilters(normalizedFallback);
      } catch (fallbackError) {
        await wait(180);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text:
              lang === "ru"
                ? "Сервис временно недоступен. Напишите город, даты и гостей — подберу вручную и доведу до брони."
                : "Service is temporarily unavailable. Share city, dates and guests — I will shortlist manually and continue to booking.",
          },
        ]);
      }
    } finally {
      setAssistantTyping(false);
      setLoading(false);
    }
  }

  async function onFollowUp(prompt: string) {
    if (loading) return;
    setMessages((prev) => [...prev, { role: "user", text: prompt }]);
    const quickHandledReply = await tryHandleQuickPrompt(prompt);
    if (quickHandledReply) {
      const quickData = quickHandledReply.data ? await enrichResponseWithRoomAvailability(quickHandledReply.data) : undefined;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: quickHandledReply.text,
          data: quickData,
        },
      ]);
      return;
    }
    setLoading(true);
    setAssistantTyping(true);
    const promptSlots = extractSlotsFromText(prompt, currency);
    setSlots((prev) => mergeSlotState(prev, promptSlots));
    try {
      const response = await runConciergeTurn(prompt);
      await wait(260);
      if (response.session_id) setSessionId(response.session_id);
      const normalized = await enrichResponseWithRoomAvailability(mergeResponseWithSlots(response, promptSlots));
      applyServerBookingState(normalized.booking_state);
      const knownFilters = slotsToFilters(mergedKnownSlots(promptSlots));
      const previousAssistant = [...messages].reverse().find((msg) => msg.role === "assistant")?.text;
      const assistantReply = softenRepeatedCollectPrompt(
        buildAssistantReply(normalized, lang, currency, tr, knownFilters),
        normalized,
        prompt,
        previousAssistant,
        lang,
        knownFilters,
      );
      setMessages((prev) => [...prev, { role: "assistant", text: assistantReply, data: normalized }]);
      if (shouldSyncFiltersFromChat(normalized)) applyFilters(normalized);
    } catch (error) {
      try {
        const fallbackResponse = await buildOfflineConciergeResponse(prompt);
        await wait(140);
        const normalizedFallback = await enrichResponseWithRoomAvailability(mergeResponseWithSlots(fallbackResponse, promptSlots));
        const knownFilters = slotsToFilters(mergedKnownSlots(promptSlots));
        const previousAssistant = [...messages].reverse().find((msg) => msg.role === "assistant")?.text;
        const assistantReply = buildAssistantReply(
          normalizedFallback,
          lang,
          currency,
          tr,
          knownFilters,
        );
        const softened = softenRepeatedCollectPrompt(
          assistantReply,
          normalizedFallback,
          prompt,
          previousAssistant,
          lang,
          knownFilters,
        );
        setMessages((prev) => [...prev, { role: "assistant", text: softened, data: normalizedFallback }]);
        if (shouldSyncFiltersFromChat(normalizedFallback)) applyFilters(normalizedFallback);
      } catch (fallbackError) {
        await wait(140);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text:
              lang === "ru"
                ? "Сервис временно недоступен. Напишите город, даты и гостей — подберу вручную и продолжу."
                : "Service is temporarily unavailable. Share city, dates and guests — I will shortlist manually and continue.",
          },
        ]);
      }
    } finally {
      setAssistantTyping(false);
      setLoading(false);
    }
  }

  function applyFilters(source?: ConciergeResponse) {
    const current = source ?? latestAnswer?.data;
    if (!current) return;
    const next = new URLSearchParams(searchParams.toString());
    const known = mergedKnownSlots();
    const filters: ConciergeResponse["filters"] = {
      ...current.filters,
      ...slotsToFilters(known),
      amenities: known.amenities.length ? known.amenities : current.filters.amenities,
    };

    const assign = (key: string, value?: string | number | null) => {
      if (value === undefined || value === null || value === "") {
        next.delete(key);
        return;
      }
      next.set(key, String(value));
    };

    const normalizedCity = normalizeCityForQuery(filters.city ?? null);
    const propertyType = filters.property_type ? String(filters.property_type).toLowerCase() : null;
    const amenities = normalizeAmenitiesForQuery(filters.amenities);
    let minPrice = normalizePriceForUrl(filters.min_price, currency);
    let maxPrice = normalizePriceForUrl(filters.max_price, currency);
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      const tmp = minPrice;
      minPrice = maxPrice;
      maxPrice = tmp;
    }

    assign("q", normalizeCatalogSearchQuery(filters.q));
    assign("city", normalizedCity);
    assign("check_in", filters.check_in || null);
    assign("check_out", filters.check_out || null);
    assign("guests", filters.guests || null);
    assign("min_price", minPrice);
    assign("max_price", maxPrice);
    assign("trip_purpose", filters.trip_purpose || null);
    assign("property_type", propertyType);
    assign("amenities", amenities);
    next.set("page", "1");
    next.set("view", "list");
    next.delete("map_safe");
    next.set("lang", lang);
    next.set("currency", currency);

    router.push(`${pathname}?${next.toString()}`);
  }

  function shouldSyncFiltersFromChat(source: ConciergeResponse): boolean {
    const filters = source.filters;
    const normalizedCity = normalizeCityForQuery(filters.city ?? null);
    const propertyType = filters.property_type ? String(filters.property_type).toLowerCase() : null;
    const amenities = normalizeAmenitiesForQuery(filters.amenities);
    let minPrice = normalizePriceForUrl(filters.min_price, currency);
    let maxPrice = normalizePriceForUrl(filters.max_price, currency);
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      const tmp = minPrice;
      minPrice = maxPrice;
      maxPrice = tmp;
    }
    const hasFilters = Boolean(
      normalizeCatalogSearchQuery(filters.q) ||
        normalizedCity ||
        filters.check_in ||
        filters.check_out ||
        filters.guests ||
        minPrice ||
        maxPrice ||
        filters.trip_purpose ||
        propertyType ||
        amenities,
    );
    if (!hasFilters) return false;
    const currentView = searchParams.get("view") || "list";
    const currentPage = searchParams.get("page") || "1";
    if (currentView !== "list" || currentPage !== "1") return true;

    const current = {
      q: searchParams.get("q") || "",
      city: searchParams.get("city") || "",
      check_in: searchParams.get("check_in") || "",
      check_out: searchParams.get("check_out") || "",
      guests: searchParams.get("guests") || "",
      min_price: searchParams.get("min_price") || "",
      max_price: searchParams.get("max_price") || "",
      trip_purpose: searchParams.get("trip_purpose") || "",
      property_type: searchParams.get("property_type") || "",
      amenities: searchParams.get("amenities") || "",
    };
    const next = {
      q: normalizeCatalogSearchQuery(filters.q) ?? "",
      city: normalizedCity ? String(normalizedCity) : "",
      check_in: filters.check_in ? String(filters.check_in) : "",
      check_out: filters.check_out ? String(filters.check_out) : "",
      guests: filters.guests ? String(filters.guests) : "",
      min_price: minPrice !== null ? String(minPrice) : "",
      max_price: maxPrice !== null ? String(maxPrice) : "",
      trip_purpose: filters.trip_purpose ? String(filters.trip_purpose) : "",
      property_type: propertyType ? String(propertyType) : "",
      amenities: amenities ? String(amenities) : "",
    };
    return Object.keys(current).some((key) => current[key as keyof typeof current] !== next[key as keyof typeof next]);
  }

  function shouldResetConversation(message: string): boolean {
    const text = message.trim().toLowerCase();
    return /^(привет|заново|очисти чат|начнем заново|начнем сначала|hello|hi|new search|start over|reset chat)$/.test(text);
  }

  function resetConversationState() {
    setMessages([]);
    setSessionId(null);
    setPendingBooking(null);
    setBookingDraft(null);
    setBookingPanelOpen(false);
    setBookingName("");
    setBookingEmail("");
    setBookingPhone("");
    setBookingCheckInTime("");
    setBookingErrors({});
    setPaymentDraft(null);
    setPaymentSnapshot(null);
    setLastGuestEmail("");
    setSlots(EMPTY_SLOTS);
  }

  function applyQuickFilterPatch(patch: Record<string, string | null>): URLSearchParams {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      const normalizedValue = key === "q" ? normalizeCatalogSearchQuery(value) : value;
      if (!normalizedValue) next.delete(key);
      else next.set(key, normalizedValue);
    });
    if (!Object.prototype.hasOwnProperty.call(patch, "page")) next.set("page", "1");
    next.set("lang", lang);
    next.set("currency", currency);
    router.push(`${pathname}?${next.toString()}`);
    return next;
  }

  function parsePositiveInt(value: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.round(parsed);
  }

  function parseQuickFiltersFromParams(params: URLSearchParams): ConciergeResponse["filters"] {
    const city = normalizeCityForQuery(params.get("city"));
    const guests = parsePositiveInt(params.get("guests"));
    const minRaw = params.get("min_price");
    const maxRaw = params.get("max_price");
    const minPrice = minRaw ? Number(minRaw) : null;
    const maxPrice = maxRaw ? Number(maxRaw) : null;
    return {
      q: normalizeCatalogSearchQuery(params.get("q")),
      city: city || null,
      check_in: params.get("check_in") || null,
      check_out: params.get("check_out") || null,
      guests: guests ?? null,
      min_price: Number.isFinite(minPrice) ? minPrice : null,
      max_price: Number.isFinite(maxPrice) ? maxPrice : null,
      trip_purpose: params.get("trip_purpose") || null,
      property_type: params.get("property_type") || null,
      amenities: normalizeAmenitiesList(params.get("amenities")),
    };
  }

  function quickReasonByFilters(item: { nightly_price: number; rating: number; district: string }, filters: ConciergeResponse["filters"]): string {
    const reasons: string[] = [];
    if (filters.max_price && item.nightly_price <= filters.max_price) {
      reasons.push(lang === "ru" ? "укладывается в бюджет" : "fits your budget");
    }
    if ((filters.q || "").toLowerCase().includes("center")) {
      reasons.push(lang === "ru" ? "удобная локация" : "central location");
    }
    if (Array.isArray(filters.amenities) && filters.amenities.length) {
      reasons.push(
        lang === "ru"
          ? `есть: ${filters.amenities.map((x) => x.toLowerCase()).join(", ")}`
          : `includes ${filters.amenities.map((x) => x.toLowerCase()).join(", ")}`,
      );
    }
    if (item.rating >= 4.6) reasons.push(lang === "ru" ? "высокий рейтинг" : "high rating");
    if (!reasons.length) reasons.push(lang === "ru" ? "хороший баланс цены и качества" : "good value for money");
    return reasons.join(", ");
  }

  async function buildQuickRefreshData(params: URLSearchParams): Promise<ConciergeResponse | null> {
    const filters = parseQuickFiltersFromParams(params);
    const listingResp = await getListings({
      q: filters.q || undefined,
      city: filters.city || undefined,
      check_in: filters.check_in || undefined,
      check_out: filters.check_out || undefined,
      guests: filters.guests || undefined,
      min_price: filters.min_price ?? undefined,
      max_price: filters.max_price ?? undefined,
      trip_purpose: filters.trip_purpose || undefined,
      property_type: filters.property_type || undefined,
      amenities: normalizeAmenitiesForQuery(filters.amenities) || undefined,
      sort_by: params.get("sort_by") || "best_match",
      sort_order: params.get("sort_order") || "desc",
      page_size: 24,
    });

    const active = listingResp.items.filter((item) => item.is_active);
    const suggestions = active.slice(0, 3).map((item) => ({
      listing_id: item.id,
      title: item.title,
      city: item.city,
      district: item.district,
      nightly_price: item.nightly_price,
      rating: item.rating,
      max_guests: item.max_guests,
      reason: quickReasonByFilters(item, filters),
      cover_photo_url: item.cover_photo_url || null,
    }));

    if (!suggestions.length) return null;
    const top = suggestions[0];
    const city = filters.city || top.city;
    return {
      stage: "search",
      answer:
        lang === "ru"
          ? `Обновил подбор. Нашел ${active.length} вариантов${city ? ` в ${localizeCityName(city, lang)}` : ""}.`
          : `Updated shortlist. Found ${active.length} options${city ? ` in ${city}` : ""}.`,
      selection_summary: lang === "ru" ? "Быстрое обновление подбора" : "Quick shortlist refresh",
      reasoning: "quick_refresh",
      filters,
      suggestions,
      alternatives: [],
      total_found: active.length,
      follow_up_prompts: lang === "ru" ? ["Покажи дешевле", "Ближе к центру", "Готов бронировать"] : ["Show cheaper", "Closer to center", "Ready to book"],
      workflow_steps: [],
      next_action: {
        type: "start_booking",
        label: lang === "ru" ? "Забронировать" : "Book now",
        listing_id: top.listing_id,
        title: top.title,
        city: top.city,
        check_in: filters.check_in,
        check_out: filters.check_out,
        guests: filters.guests,
      },
      session_id: sessionId ?? "quick_refresh",
      booking_state: currentBookingState() ?? null,
    };
  }

  function mergeAmenityValue(newAmenity: string): string {
    const current = normalizeAmenitiesList(searchParams.get("amenities"));
    if (!current.includes(newAmenity)) current.push(newAmenity);
    return current.join(",");
  }

  async function tryHandleQuickPrompt(prompt: string): Promise<QuickPromptResult> {
    const lower = prompt.trim().toLowerCase();
    const data = latestAnswer?.data;

    if (/проверить статус оплаты|check payment status/.test(lower) && paymentDraft?.reservationId) {
      await refreshPaymentStatus(paymentDraft.reservationId);
      return {
        text:
          lang === "ru"
            ? "Проверил статус оплаты. Если хотите, помогу завершить оплату или покажу другие варианты."
            : "I checked the payment status. I can help finish payment or show alternatives.",
      };
    }

    if (/показать рестораны|покажи рестораны|show hotel restaurants|show restaurants/.test(lower)) {
      const synthetic = lang === "ru" ? "покажи рестораны отеля" : "show hotel restaurants";
      const handled = await handleHospitalityIntent(synthetic);
      return handled
        ? { text: lang === "ru" ? "Показал рестораны и доступные действия." : "Displayed restaurants and available actions." }
        : null;
    }

    const wantsMoreOptions = /показать\s+(ещ[её]|еще)\s+варианты|ещ[её]\s+варианты|show more options|show more/.test(lower);
    const wantsViewOptions = /вид|view|sea-view|sea view|море/.test(lower);
    const wantsBudgetOptions = /дешевле|cheaper|lower price|снизить цену|бюджетн|budget options/.test(lower);
    const hasStructuredSearchIntent = Boolean(
      parseCityFromText(prompt) ||
        parseNaturalDateRange(prompt) ||
        parseGuestsCount(prompt) ||
        parseBudgetRange(prompt, currency) ||
        parsePropertyType(prompt),
    );
    if (hasStructuredSearchIntent && (!data || data.suggestions.length === 0)) return null;

    if (wantsMoreOptions) {
      const currentPage = parsePositiveInt(searchParams.get("page")) || 1;
      const next = applyQuickFilterPatch({ page: String(currentPage + 1) });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Показал ещё варианты и обновил выдачу."
            : "Showing more options and refreshing the shortlist.",
        data: refreshed ?? undefined,
      };
    }

    if (wantsViewOptions) {
      const next = applyQuickFilterPatch({ q: "marina" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Добавил акцент на варианты у воды и в районе Marina."
            : "Focused on waterfront and Marina-area options.",
        data: refreshed ?? undefined,
      };
    }

    if ((!data || data.suggestions.length === 0) && wantsBudgetOptions) {
      const next = applyQuickFilterPatch({ sort_by: "price", sort_order: "asc" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Отсортировал варианты по цене и обновил выдачу."
            : "Sorted options by price and refreshed the shortlist.",
        data: refreshed ?? undefined,
      };
    }

    if (!data || data.suggestions.length === 0) return null;

    if (/готов бронировать|ready to book|book now|сразу к бронированию|давай бронировать/.test(lower)) {
      const top = data.suggestions[0];
      startBooking({
        listingId: top.listing_id,
        roomTypeId: top.room_type_id ?? null,
        roomTypeName: top.room_type_name ?? null,
        title: top.title,
        checkIn: data.filters.check_in,
        checkOut: data.filters.check_out,
        guests: data.filters.guests,
      });
      return {
        text:
          lang === "ru"
            ? "Отлично, начинаем оформление. Проверьте данные гостя ниже."
            : "Great, let’s proceed with booking. Please confirm guest details below.",
      };
    }

    if (/ближе к центру|closer to center|near center|центр/.test(lower)) {
      const next = applyQuickFilterPatch({ q: "center" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Сузил подбор ближе к центру. Обновил выдачу."
            : "Narrowed the shortlist to central locations. Results updated.",
        data: refreshed ?? undefined,
      };
    }

    if (wantsBudgetOptions) {
      const sorted = [...data.suggestions].sort((a, b) => a.nightly_price - b.nightly_price);
      const ceiling = sorted[Math.min(2, sorted.length - 1)]?.nightly_price || sorted[0]?.nightly_price;
      if (ceiling) {
        const next = applyQuickFilterPatch({ max_price: String(ceiling), sort_by: "price", sort_order: "asc" });
        const refreshed = await buildQuickRefreshData(next);
        return {
          text:
            lang === "ru"
              ? "Сделал подбор дешевле и отсортировал по цене."
              : "I focused on cheaper options and sorted by price.",
          data: refreshed ?? undefined,
        };
      }
    }

    if (/с кухней|with kitchen/.test(lower)) {
      const next = applyQuickFilterPatch({ amenities: mergeAmenityValue("kitchen") });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text: lang === "ru" ? "Добавил фильтр «Кухня»." : "Added the Kitchen amenity filter.",
        data: refreshed ?? undefined,
      };
    }

    if (/wifi|wi-fi|вайфай|надежным wifi|reliable wifi/.test(lower)) {
      const next = applyQuickFilterPatch({ amenities: mergeAmenityValue("wifi") });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text: lang === "ru" ? "Добавил фильтр по Wi-Fi." : "Added the Wi-Fi amenity filter.",
        data: refreshed ?? undefined,
      };
    }

    if (/семейн|family options|для семьи/.test(lower)) {
      const next = applyQuickFilterPatch({ trip_purpose: "family" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Переключил подбор на семейные варианты."
            : "Switched the shortlist to family-friendly options.",
        data: refreshed ?? undefined,
      };
    }

    if (/business docs|командиров|документ/.test(lower)) {
      const next = applyQuickFilterPatch({ trip_purpose: "business", q: "business documents" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Переключил подбор под командировку."
            : "Switched the shortlist to business-trip options.",
        data: refreshed ?? undefined,
      };
    }

    if (/late check-?in|поздний заезд/.test(lower)) {
      const next = applyQuickFilterPatch({ q: "late check-in" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Добавил акцент на поздний заезд."
            : "Added preference for late check-in.",
        data: refreshed ?? undefined,
      };
    }

    if (/самозаселение|self check-?in/.test(lower)) {
      const next = applyQuickFilterPatch({ q: "self check-in" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Добавил варианты с самозаселением."
            : "Added self check-in options.",
        data: refreshed ?? undefined,
      };
    }

    if (/тише|quiet|spacious|просторн/.test(lower)) {
      const next = applyQuickFilterPatch({ q: "quiet spacious" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Сместил подбор в более тихие и просторные варианты."
            : "Shifted shortlist toward quieter and more spacious options.",
        data: refreshed ?? undefined,
      };
    }

    if (/романтич|romantic/.test(lower)) {
      const next = applyQuickFilterPatch({ trip_purpose: "couple", q: "romantic" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Сделал акцент на романтичные варианты для пары."
            : "Focused on romantic options for couples.",
        data: refreshed ?? undefined,
      };
    }

    if (/вид|view/.test(lower)) {
      const next = applyQuickFilterPatch({ q: "view" });
      const refreshed = await buildQuickRefreshData(next);
      return {
        text:
          lang === "ru"
            ? "Добавил акцент на варианты с видом."
            : "Focused on options with a view.",
        data: refreshed ?? undefined,
      };
    }

    return null;
  }

  function applyAlternativeDates(checkIn: string, checkOut: string, city?: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("check_in", checkIn);
    next.set("check_out", checkOut);
    if (city) next.set("city", city);
    next.set("page", "1");
    next.set("lang", lang);
    next.set("currency", currency);
    router.push(`${pathname}?${next.toString()}`);
  }

  function goCheckout(data: ConciergeResponse, tariff: "basic" | "smart" | "flex" = "smart") {
    const action = data.next_action;
    if (!action || action.type !== "go_checkout") return;
    const listingId = action.listing_id ?? data.suggestions[0]?.listing_id;
    const roomTypeId = action.room_type_id ?? data.suggestions[0]?.room_type_id ?? null;
    const checkIn = action.check_in || data.filters.check_in;
    const checkOut = action.check_out || data.filters.check_out;
    const guests = action.guests || data.filters.guests;
    if (!listingId || !checkIn || !checkOut || !guests) return;
    emitAnalytics("checkout_clicked", {
      listingId,
      metadata: { tariff, check_in: checkIn, check_out: checkOut, guests, room_type_id: roomTypeId ?? null },
      dedupeKey: `${listingId}|${roomTypeId || "listing"}|${checkIn}|${checkOut}|${guests}|${tariff}`,
    });
    const next = new URLSearchParams();
    next.set("listing_id", String(listingId));
    if (roomTypeId) next.set("room_type_id", String(roomTypeId));
    next.set("check_in", checkIn);
    next.set("check_out", checkOut);
    next.set("guests", String(guests));
    next.set("tariff", tariff);
    next.set("lang", lang);
    next.set("currency", currency);
    router.push(`/checkout?${next.toString()}`);
  }

  function parseIsoDate(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function diffNights(checkIn?: string | null, checkOut?: string | null): number {
    const start = parseIsoDate(checkIn);
    const end = parseIsoDate(checkOut);
    if (!start || !end) return 1;
    const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  }

  function buildTariffEstimates(data: ConciergeResponse) {
    const key = quoteCacheKey(data);
    const exact = key ? tariffQuoteCache[key] : undefined;
    if (exact?.basic && exact.smart && exact.flex) {
      const maxBudget = data.filters.max_price ?? null;
      const fitBasic = maxBudget ? exact.basic.nightly_price <= maxBudget : true;
      const fitSmart = maxBudget ? exact.smart.nightly_price <= maxBudget : true;
      let recommended: "basic" | "smart" | "flex" = "smart";
      if (maxBudget) {
        if (fitSmart) recommended = "smart";
        else if (fitBasic) recommended = "basic";
        else recommended = "basic";
      } else if (exact.smart.nights <= 2) {
        recommended = "flex";
      }
      return {
        source: "exact" as const,
        nights: exact.smart.nights,
        recommended,
        basic: { nightly: Math.round(exact.basic.nightly_price), trip: Math.round(exact.basic.total) },
        smart: { nightly: Math.round(exact.smart.nightly_price), trip: Math.round(exact.smart.total) },
        flex: { nightly: Math.round(exact.flex.nightly_price), trip: Math.round(exact.flex.total) },
      };
    }

    const baseNightly = data.suggestions?.[0]?.nightly_price || 0;
    const nights = diffNights(data.filters.check_in, data.filters.check_out);
    const maxBudget = data.filters.max_price ?? null;
    const rules = {
      basic: { m: 0.95, s: 0.09 },
      smart: { m: 1.0, s: 0.11 },
      flex: { m: 1.12, s: 0.13 },
    } as const;

    const basicNight = Math.round(baseNightly * rules.basic.m);
    const smartNight = Math.round(baseNightly * rules.smart.m);
    const flexNight = Math.round(baseNightly * rules.flex.m);

    const basicTrip = Math.round(basicNight * nights * (1 + rules.basic.s));
    const smartTrip = Math.round(smartNight * nights * (1 + rules.smart.s));
    const flexTrip = Math.round(flexNight * nights * (1 + rules.flex.s));

    const fitBasic = maxBudget ? basicNight <= maxBudget : true;
    const fitSmart = maxBudget ? smartNight <= maxBudget : true;

    let recommended: "basic" | "smart" | "flex" = "smart";
    if (maxBudget) {
      if (fitSmart) recommended = "smart";
      else if (fitBasic) recommended = "basic";
      else recommended = "basic";
    } else if (nights <= 2) {
      recommended = "flex";
    }

    return {
      source: "estimate" as const,
      nights,
      recommended,
      basic: { nightly: basicNight, trip: basicTrip },
      smart: { nightly: smartNight, trip: smartTrip },
      flex: { nightly: flexNight, trip: flexTrip },
    };
  }

  function runNextAction(data: ConciergeResponse) {
    const action = data.next_action;
    if (!action) return;
    if (!isActionAllowedByStage(data.stage, action.type)) return;
    if (action.type === "apply_filters") {
      applyFilters(data);
      return;
    }
    if (action.type === "apply_alternative_dates") {
      if (!action.check_in || !action.check_out) return;
      applyAlternativeDates(action.check_in, action.check_out, action.city || data.filters.city || undefined);
      return;
    }
    if (action.type === "start_booking") {
      const listingId = action.listing_id ?? data.suggestions[0]?.listing_id;
      const title = action.title ?? data.suggestions[0]?.title;
      if (!listingId || !title) return;
      startBooking({
        listingId,
        roomTypeId: action.room_type_id ?? data.suggestions[0]?.room_type_id ?? null,
        roomTypeName: action.room_type_name ?? data.suggestions[0]?.room_type_name ?? null,
        title,
        checkIn: action.check_in || data.filters.check_in,
        checkOut: action.check_out || data.filters.check_out,
        guests: action.guests || data.filters.guests,
      });
      return;
    }
    if (action.type === "go_checkout") {
      goCheckout(data, "smart");
      return;
    }
    if (action.type === "handoff_contact") {
      setQuery(lang === "ru" ? "Номер брони: \nТелефон: " : "Booking ID: \nPhone: ");
    }
  }

  function stayAvailabilityHref(args: {
    listingId: number;
    roomTypeId?: number | null;
    checkIn?: string | null;
    checkOut?: string | null;
    guests?: number | null;
  }): string {
    const next = new URLSearchParams({
      lang,
      currency,
    });
    if (args.roomTypeId) next.set("room_type_id", String(args.roomTypeId));
    if (args.checkIn) next.set("check_in", args.checkIn);
    if (args.checkOut) next.set("check_out", args.checkOut);
    if (args.guests) next.set("guests", String(args.guests));
    return `/stays/${args.listingId}?${next.toString()}#available-rooms`;
  }

  function assistantDisplayText(msg: ChatMessage): string {
    if (!isRail || msg.role !== "assistant" || !msg.data || msg.data.suggestions.length === 0) return msg.text;
    const city = msg.data.filters.city ? localizeCityName(msg.data.filters.city, lang) : "";
    const count = Math.min(msg.data.suggestions.length, 3);
    if (lang === "ru") {
      const noun = count === 1 ? "вариант" : count >= 2 && count <= 4 ? "варианта" : "вариантов";
      return `Подобрал ${count} ${noun}${city ? ` в ${city}` : ""}. Ниже - свободные номера, цена и переход к бронированию.`;
    }
    return `Found ${count} matching ${count === 1 ? "option" : "options"}${city ? ` in ${city}` : ""}. See available rooms, price and booking links below.`;
  }

  function startBooking(args: {
    listingId: number;
    roomTypeId?: number | null;
    roomTypeName?: string | null;
    title: string;
    checkIn?: string | null;
    checkOut?: string | null;
    guests?: number | null;
  }) {
    const searchGuests = Number(searchParams.get("guests") || "");
    const checkIn = args.checkIn || latestAnswer?.data?.filters.check_in || searchParams.get("check_in") || "";
    const checkOut = args.checkOut || latestAnswer?.data?.filters.check_out || searchParams.get("check_out") || "";
    const guests = args.guests || latestAnswer?.data?.filters.guests || (Number.isFinite(searchGuests) && searchGuests > 0 ? searchGuests : null);

    if (!checkIn || !checkOut) {
      setPendingBooking({
        listingId: args.listingId,
        roomTypeId: args.roomTypeId ?? null,
        roomTypeName: args.roomTypeName ?? null,
        title: args.title,
        checkIn,
        checkOut,
        guests,
      });
      setBookingPanelOpen(false);
      setBookingErrors({});
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            lang === "ru"
              ? `Выбрал ${args.title}. Для брони напишите даты, например: «с 10 июня на 3 ночи».`
              : `Selected ${args.title}. To book, share dates, for example: "June 10 for 3 nights".`,
        },
      ]);
      return;
    }
    if (!guests) {
      setPendingBooking({
        listingId: args.listingId,
        roomTypeId: args.roomTypeId ?? null,
        roomTypeName: args.roomTypeName ?? null,
        title: args.title,
        checkIn,
        checkOut,
        guests,
      });
      setBookingPanelOpen(false);
      setBookingErrors({});
      setMessages((prev) => [...prev, { role: "assistant", text: tr.needGuestsFirst }]);
      return;
    }

    setPendingBooking(null);
    setBookingDraft({
      listingId: args.listingId,
      roomTypeId: args.roomTypeId ?? null,
      roomTypeName: args.roomTypeName ?? null,
      title: args.title,
      checkIn,
      checkOut,
      guests,
    });
    setBookingPanelOpen(true);
    setBookingErrors({});

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text:
          `${tr.bookingReady}\n${tr.bookingHint}\n• ${args.title}\n• ${checkIn} → ${checkOut}\n• ${guests} ${lang === "ru" ? "гост." : "guests"}` +
          (args.roomTypeName ? `\n• ${args.roomTypeName}` : "") +
          (lang === "ru"
            ? "\nПосле брони могу сразу показать рестораны отеля и помочь забронировать столик."
            : "\nAfter booking, I can show hotel restaurants and help reserve a table."),
      },
    ]);
  }

  function validateBooking(): BookingErrors {
    const errors: BookingErrors = {};
    if (bookingName.trim().length < 2) errors.name = tr.fieldRequired;
    if (!bookingEmail.trim()) errors.email = tr.fieldRequired;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingEmail.trim())) errors.email = tr.invalidEmail;
    if (!bookingPhone.trim()) errors.phone = tr.fieldRequired;
    else if (!/^[+0-9()\-\s]{7,20}$/.test(bookingPhone.trim())) errors.phone = tr.invalidPhone;
    if (!bookingCheckInTime.trim()) errors.checkInTime = tr.fieldRequired;
    return errors;
  }

  async function onCreateBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookingDraft || bookingLoading) return;
    const errors = validateBooking();
    setBookingErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBookingLoading(true);
    try {
      const reservation = await createReservation({
        listing_id: bookingDraft.listingId,
        room_type_id: bookingDraft.roomTypeId || undefined,
        guest_name: bookingName.trim(),
        guest_email: bookingEmail.trim(),
        guest_phone: bookingPhone.trim(),
        check_in: bookingDraft.checkIn,
        check_out: bookingDraft.checkOut,
        guests: bookingDraft.guests,
        tariff_plan: "smart",
      });
      rememberReservationAccess(reservation);

      const summary = `${tr.bookingDone}
#${reservation.id}
${tr.bookingSummaryTitle}: ${bookingDraft.title}
${bookingDraft.checkIn} → ${bookingDraft.checkOut}
${tr.guestLabel}: ${bookingName.trim()}, ${bookingDraft.guests}
${tr.checkInTimeLabel}: ${bookingCheckInTime.trim()}
${tr.bookingDetails}`;
      setMessages((prev) => [...prev, { role: "assistant", text: summary }]);
      setPaymentDraft({
        reservationId: reservation.id,
        listingId: bookingDraft.listingId,
        roomTypeId: bookingDraft.roomTypeId ?? null,
        roomTypeName: bookingDraft.roomTypeName ?? null,
        title: bookingDraft.title,
        checkIn: bookingDraft.checkIn,
        checkOut: bookingDraft.checkOut,
        guests: bookingDraft.guests,
        total: reservation.total_price,
        guestEmail: bookingEmail.trim().toLowerCase(),
        accessToken: reservation.access_token || null,
      });
      setLastGuestEmail(bookingEmail.trim());
      setPaymentSnapshot(null);

      emitAnalytics("payment_started", {
        listingId: bookingDraft.listingId,
        reservationId: reservation.id,
        metadata: { total: reservation.total_price, guests: bookingDraft.guests, source: "ai_auto_redirect", room_type_id: bookingDraft.roomTypeId ?? null },
        dedupeKey: String(reservation.id),
      });

      setBookingDraft(null);
      setBookingPanelOpen(false);
      setBookingName("");
      setBookingEmail("");
      setBookingPhone("");
      setBookingCheckInTime("");

      const next = new URLSearchParams({
        reservation_id: String(reservation.id),
        listing_id: String(bookingDraft.listingId),
        title: bookingDraft.title,
        check_in: bookingDraft.checkIn,
        check_out: bookingDraft.checkOut,
        guests: String(bookingDraft.guests),
        total: String(reservation.total_price),
        lang,
        currency,
        guest_email: bookingEmail.trim().toLowerCase(),
      });
      if (bookingDraft.roomTypeId) next.set("room_type_id", String(bookingDraft.roomTypeId));
      if (bookingDraft.roomTypeName) next.set("room_type_name", bookingDraft.roomTypeName);
      if (reservation.access_token) next.set("access_token", reservation.access_token);
      schedulePaymentRedirect(`/checkout/payment?${next.toString()}`);
      setMessages((prev) => [...prev, { role: "assistant", text: tr.redirectingToPayment }]);
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Booking failed";
      setMessages((prev) => [...prev, { role: "assistant", text: msg }]);
    } finally {
      setBookingLoading(false);
    }
  }

  return (
    <section className={`ai-concierge${isRail ? " ai-concierge-rail" : ""}`}>
      {!isRail ? (
        <div className="ai-concierge-head">
          <h3>{tr.title}</h3>
          <p>{tr.hint}</p>
        </div>
      ) : null}

      <form className="ai-concierge-form" onSubmit={onSubmit}>
        <input suppressHydrationWarning value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} maxLength={1000} />
        <button type="submit" disabled={loading}>
          {loading ? tr.thinking : tr.send}
        </button>
      </form>

      {bookingModeActive ? (
        <section className="ai-booking-mode">
          <strong>{tr.bookingModeTitle}</strong>
          <p>{tr.bookingModeHint}</p>
        </section>
      ) : null}

      {latestReasonLines.length > 0 && !resultInteractionBlocked && !isRail ? (
        <section className="ai-why-card">
          <strong>{tr.whyExplainTitle}</strong>
          {latestReasonLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      ) : null}

      {stageQuickPrompts.length > 0 && !isRail ? (
        <div className="ai-followups">
          {stageQuickPrompts.map((prompt) => (
            <button key={prompt} type="button" className="ai-followup-chip" onClick={() => onFollowUp(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      {bookingDraft ? (
        <details
          className="ai-booking-collapsible"
          open={bookingPanelOpen}
          onToggle={(event) => setBookingPanelOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            {tr.bookingTitle}: {bookingDraft.title}
            {bookingDraft.roomTypeName ? ` · ${bookingDraft.roomTypeName}` : ""} • {bookingDraft.checkIn} → {bookingDraft.checkOut} • {bookingDraft.guests}
          </summary>
          <section className="ai-booking-card">
            <form className="ai-booking-form" onSubmit={onCreateBooking}>
              <input required value={bookingName} onChange={(e) => setBookingName(e.target.value)} placeholder={tr.fullName} minLength={2} />
              {bookingErrors.name ? <small className="ai-booking-error">{bookingErrors.name}</small> : null}
              <input required type="email" value={bookingEmail} onChange={(e) => setBookingEmail(e.target.value)} placeholder={tr.email} />
              {bookingErrors.email ? <small className="ai-booking-error">{bookingErrors.email}</small> : null}
              <input required value={bookingPhone} onChange={(e) => setBookingPhone(e.target.value)} placeholder={tr.phone} minLength={7} />
              {bookingErrors.phone ? <small className="ai-booking-error">{bookingErrors.phone}</small> : null}
              <input required value={bookingCheckInTime} onChange={(e) => setBookingCheckInTime(e.target.value)} placeholder={tr.checkInTime} />
              {bookingErrors.checkInTime ? <small className="ai-booking-error">{bookingErrors.checkInTime}</small> : null}
              <button type="submit" disabled={bookingLoading}>{bookingLoading ? tr.bookingInProgress : tr.createBooking}</button>
            </form>
          </section>
        </details>
      ) : null}

      {paymentDraft ? (
        <section className="ai-booking-card">
          <h4>{tr.paymentTitle}</h4>
          <p>
            #{paymentDraft.reservationId} • {paymentDraft.title}
            {paymentDraft.roomTypeName ? ` · ${paymentDraft.roomTypeName}` : ""}
          </p>
          <p>{tr.paymentHint}</p>
          <p>
            {tr.paymentStatusTitle}: {paymentStatusLabel(paymentSnapshot)}
          </p>
          {paymentStatusLoading ? <small className="ai-payment-status-loading">{tr.paymentStatusLoading}</small> : null}
          <button
            type="button"
            className="ai-apply-btn"
            onClick={() => refreshPaymentStatus(paymentDraft.reservationId)}
            disabled={paymentStatusLoading}
          >
            {tr.paymentStatusRefresh}
          </button>
          <Link
            className="ai-pay-link"
            onClick={() =>
              emitAnalytics("payment_started", {
                listingId: paymentDraft.listingId,
                reservationId: paymentDraft.reservationId,
                metadata: { total: paymentDraft.total, guests: paymentDraft.guests },
                dedupeKey: String(paymentDraft.reservationId),
              })
            }
            href={`/checkout/payment?reservation_id=${paymentDraft.reservationId}&listing_id=${paymentDraft.listingId}&title=${encodeURIComponent(
              paymentDraft.title,
            )}${paymentDraft.roomTypeId ? `&room_type_id=${paymentDraft.roomTypeId}` : ""}${
              paymentDraft.roomTypeName ? `&room_type_name=${encodeURIComponent(paymentDraft.roomTypeName)}` : ""
            }&check_in=${paymentDraft.checkIn}&check_out=${paymentDraft.checkOut}&guests=${paymentDraft.guests}&total=${
              paymentDraft.total
            }&lang=${lang}&currency=${currency}${
              paymentDraft.guestEmail ? `&guest_email=${encodeURIComponent(paymentDraft.guestEmail)}` : ""
            }${
              paymentDraft.accessToken ? `&access_token=${encodeURIComponent(paymentDraft.accessToken)}` : ""
            }`}
          >
            {tr.paymentCta}
          </Link>
          {hasPendingPaymentRedirect ? (
            <div className="ai-followups">
              <button type="button" className="ai-followup-chip" onClick={cancelPaymentRedirect}>
                {tr.stayInChat}
              </button>
              <button type="button" className="ai-followup-chip" onClick={redirectPaymentNow}>
                {tr.goToPaymentNow}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="ai-concierge-log">
        {messages.length === 0 && isRail ? (
          <>
            <article className="ai-message ai-message-assistant ai-message-starter">
              <p>
                {lang === "ru"
                  ? "Привет! Я ваш AI-консьерж. Помогу подобрать идеальный отель, отвечу на вопросы и забронирую для вас лучший вариант."
                  : "Hi! I am your AI concierge. I can shortlist the right stay, answer questions and guide booking."}
              </p>
            </article>
            <article className="ai-message ai-message-user ai-message-starter">
              <p>{railUserPrompt}</p>
            </article>
            <article className="ai-message ai-message-assistant ai-message-starter">
              <p>
                {lang === "ru"
                  ? "Отлично! Я нашёл несколько прекрасных вариантов в Дубае на ваши даты:"
                  : "Great. I found several strong Dubai options for your dates:"}
              </p>
            </article>
          </>
        ) : null}
        {messages.length === 0 && !isRail ? <p className="ai-concierge-empty">{tr.empty}</p> : null}
        {messages.map((msg, index) => (
          <article key={`${msg.role}-${index}`} className={`ai-message ai-message-${msg.role}`}>
            <p>{assistantDisplayText(msg)}</p>
            {msg.role === "assistant" &&
            !resultInteractionBlocked &&
            msg.data?.next_action &&
            msg.data.next_action.type !== "none" &&
            isActionAllowedByStage(msg.data.stage, msg.data.next_action.type) ? (
              <div className="ai-next-action">
                <strong>{tr.nextActionTitle}</strong>
                <button type="button" className="ai-next-action-btn" onClick={() => msg.data && runNextAction(msg.data)}>
                  {msg.data.next_action.label}
                </button>
              </div>
            ) : null}

            {msg.role === "assistant" &&
            msg.data &&
            !resultInteractionBlocked &&
            shouldRenderSuggestions(msg.data.stage) &&
            msg.data.suggestions.length > 0 ? (
              <div className="ai-suggestions">
                {msg.data.suggestions.slice(0, 3).map((item) => (
                    <div key={item.listing_id} className="ai-suggestion-card">
                      <div className="ai-suggestion-cover" aria-hidden="true">
                      <img src={aiMediaUrl(item.cover_photo_url, item.listing_id)} alt={item.title} />
                      <span>{localizeCityName(item.city, lang)}</span>
                    </div>
                    <div className="ai-suggestion-content">
                      <strong>{item.title}</strong>
                      <small>
                        {item.district} • {item.rating.toFixed(1)}
                      </small>
                      {item.room_type_name ? (
                        <small>
                          {item.room_type_name}
                          {item.room_available_count ? ` · ${formatRoomsAvailable(item.room_available_count, lang)}` : ""}
                        </small>
                      ) : null}
                      <small>{humanSuggestionReason(item.reason, lang)}</small>
                      <b>{formatPrice(item.nightly_price, currency, lang)}</b>
                      <button
                        type="button"
                        className="ai-apply-btn"
                        onClick={() =>
                          startBooking({
                            listingId: item.listing_id,
                            roomTypeId: item.room_type_id ?? null,
                            roomTypeName: item.room_type_name ?? null,
                            title: item.title,
                            checkIn: msg.data?.filters.check_in,
                            checkOut: msg.data?.filters.check_out,
                            guests: msg.data?.filters.guests,
                          })
                        }
                      >
                        {tr.bookThis}
                      </button>
                      <Link
                        href={stayAvailabilityHref({
                          listingId: item.listing_id,
                          roomTypeId: item.room_type_id ?? null,
                          checkIn: msg.data?.filters.check_in,
                          checkOut: msg.data?.filters.check_out,
                          guests: msg.data?.filters.guests,
                        })}
                      >
                        {tr.open}
                      </Link>
                    </div>
                  </div>
                ))}
                {pickFollowUpPrompts(msg.data).length ? (
                  <div className="ai-followups">
                    {pickFollowUpPrompts(msg.data).map((prompt) => (
                      <button key={prompt} type="button" className="ai-followup-chip" onClick={() => onFollowUp(prompt)}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {msg.role === "assistant" &&
            msg.data &&
            !resultInteractionBlocked &&
            shouldRenderAlternatives(msg.data.stage) &&
            msg.data.suggestions.length === 0 &&
            msg.data.alternatives.length > 0 ? (
              <div className="ai-suggestions">
                <strong className="ai-alt-title">{tr.alternatives}</strong>
                {msg.data.alternatives.slice(0, 3).map((item) => (
                  <div key={item.listing_id} className="ai-suggestion-card">
                    <div className="ai-suggestion-cover" aria-hidden="true">
                      <img src={aiMediaUrl(item.cover_photo_url, item.listing_id)} alt={item.title} />
                      <span>{localizeCityName(item.city, lang)}</span>
                    </div>
                    <div className="ai-suggestion-content">
                      <strong>{item.title}</strong>
                      <small>
                        {item.district} • {tr.unavailable} {item.unavailable_reason}
                      </small>
                      <small>
                        {tr.suggestedDates}: {item.suggested_check_in} → {item.suggested_check_out}
                      </small>
                      <b>{formatPrice(item.nightly_price, currency, lang)}</b>
                      <button
                        type="button"
                        className="ai-apply-btn"
                        onClick={() =>
                          startBooking({
                            listingId: item.listing_id,
                            title: item.title,
                            checkIn: item.suggested_check_in,
                            checkOut: item.suggested_check_out,
                            guests: msg.data?.filters.guests || 2,
                          })
                        }
                      >
                        {tr.bookTheseDates}
                      </button>
                      <Link
                        href={stayAvailabilityHref({
                          listingId: item.listing_id,
                          checkIn: item.suggested_check_in,
                          checkOut: item.suggested_check_out,
                          guests: msg.data?.filters.guests || 2,
                        })}
                      >
                        {tr.open}
                      </Link>
                    </div>
                  </div>
                ))}
                {pickFollowUpPrompts(msg.data).length ? (
                  <div className="ai-followups">
                    {pickFollowUpPrompts(msg.data).map((prompt) => (
                      <button key={prompt} type="button" className="ai-followup-chip" onClick={() => onFollowUp(prompt)}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
        {assistantTyping ? (
          <article className="ai-message ai-message-assistant">
            <p>{lang === "ru" ? "Секунду, подбираю..." : "One moment, preparing options..."}</p>
          </article>
        ) : null}
      </div>

      {isRail && messages.length === 0 && showcaseCards.length > 0 ? (
        <div className="ai-rail-showcase">
          {showcaseCards.slice(0, 3).map((item) => (
            <Link key={item.id} href={item.href} className="ai-rail-showcase-item">
              <span className="ai-rail-showcase-thumb">
                <img src={item.coverPhotoUrl} alt={item.title} loading="lazy" />
              </span>
              <strong>{item.title}</strong>
              <small>{lang === "ru" ? "от " : "from "}{formatPrice(item.nightlyPrice, currency, lang)}</small>
            </Link>
          ))}
        </div>
      ) : null}

      {isRail && quickPrompts.length > 0 && !pendingBooking && !bookingModeActive && !paymentDraft ? (
        <div className="ai-rail-quick-prompts">
          {quickPrompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => onFollowUp(prompt)} disabled={loading}>
              {prompt}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
