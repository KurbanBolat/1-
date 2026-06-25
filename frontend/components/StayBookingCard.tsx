"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DateRangePicker from "./DateRangePicker";

const MAX_STAY_NIGHTS = 30;
const MAX_BOOKING_HORIZON_DAYS = 365;

type Labels = {
  continue: string;
  checkIn: string;
  checkOut: string;
  guests: string;
  maxGuests: string;
  pickDates: string;
  bookedLegend: string;
  selectedLegend: string;
  selectedRange: string;
  nights: string;
  completeDates: string;
  summary: string;
  subtotal: string;
  cleaning: string;
  service: string;
  total: string;
  estimateHint: string;
  dateSearchTitle: string;
  dateSearchHint: string;
  showRooms: string;
};

type Currency = "KZT" | "USD";
type DateShortcut = {
  key: string;
  label: string;
  checkIn: string;
  nights: number;
};

const USD_RATE = 500;

type InitialPricedQuote = {
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
  nightlyPrice: number;
  subtotal: number;
  cleaningFee: number;
  serviceFee: number;
  total: number;
  dynamicMultiplier: number;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function StayBookingCard({
  listingId,
  lang,
  currency,
  expVariant = "a",
  nightlyPrice,
  cleaningFee,
  serviceFeePercent,
  maxGuests,
  initialCheckIn,
  initialCheckOut,
  initialGuests,
  initialPricedQuote,
  labels,
}: {
  listingId: number;
  lang: "en" | "ru";
  currency: Currency;
  expVariant?: "a" | "b";
  nightlyPrice: number;
  cleaningFee: number;
  serviceFeePercent: number;
  maxGuests: number;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
  initialPricedQuote?: InitialPricedQuote;
  labels: Labels;
}) {
  const router = useRouter();
  const safeMaxGuests = Math.max(1, maxGuests);
  const normalizedInitialGuests =
    initialGuests && Number.isFinite(initialGuests) ? Math.min(safeMaxGuests, Math.max(1, initialGuests)) : Math.min(2, safeMaxGuests);
  const [checkIn, setCheckIn] = useState(initialCheckIn || "");
  const [checkOut, setCheckOut] = useState(initialCheckOut || "");
  const [guests, setGuests] = useState(normalizedInitialGuests);
  const [submitted, setSubmitted] = useState(false);

  const checkInRef = useRef<HTMLInputElement | null>(null);
  const checkOutRef = useRef<HTMLInputElement | null>(null);
  const guestsRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCheckIn(initialCheckIn || "");
    setCheckOut(initialCheckOut || "");
    setGuests(normalizedInitialGuests);
    setSubmitted(false);
  }, [initialCheckIn, initialCheckOut, normalizedInitialGuests]);

  const text =
    lang === "ru"
      ? {
          checkInStep: "1. Заезд",
          checkOutStep: "2. Выезд",
          guestsStep: "3. Гости",
          roomsStep: "4. Номера",
          quickDates: "Быстрый выбор",
          tomorrow2: "Завтра на 2 ночи",
          weekend: "Ближайшие выходные",
          weekStay: "На неделю",
          clearDates: "Очистить",
          dateTip: "Выберите заезд — выезд подставится автоматически, если он был пустой.",
          requiredCheckIn: "Выберите дату заезда",
          requiredCheckOut: "Выберите дату выезда",
          invalidCheckOut: "Дата выезда должна быть позже даты заезда",
          invalidStayDuration: `Длительность проживания: от 1 до ${MAX_STAY_NIGHTS} ночей`,
          invalidCheckInFuture: `Дата заезда слишком далеко в будущем (максимум ${MAX_BOOKING_HORIZON_DAYS} дней)`,
          invalidGuests: `Количество гостей: от 1 до ${maxGuests}`,
          fixFields: "Проверьте даты и заполните обязательные поля",
          applyingSearch: "Показываем номера...",
          dynamicPricingNotice: "Финальная сумма подтверждается при оформлении и может включать динамическую цену.",
        }
      : {
          checkInStep: "1. Check-in",
          checkOutStep: "2. Check-out",
          guestsStep: "3. Guests",
          roomsStep: "4. Rooms",
          quickDates: "Quick dates",
          tomorrow2: "Tomorrow, 2 nights",
          weekend: "Nearest weekend",
          weekStay: "One week",
          clearDates: "Clear",
          dateTip: "Pick check-in. Check-out is filled automatically when empty.",
          requiredCheckIn: "Select check-in date",
          requiredCheckOut: "Select check-out date",
          invalidCheckOut: "Check-out must be after check-in",
          invalidStayDuration: `Stay duration must be between 1 and ${MAX_STAY_NIGHTS} nights`,
          invalidCheckInFuture: `Check-in date is too far in the future (max ${MAX_BOOKING_HORIZON_DAYS} days)`,
          invalidGuests: `Guests must be between 1 and ${maxGuests}`,
          fixFields: "Please check dates and complete required fields",
          applyingSearch: "Showing rooms...",
          dynamicPricingNotice: "Final price is confirmed in checkout and may include demand pricing.",
        };

  const today = todayKey();
  const maxBookDate = addDays(today, MAX_BOOKING_HORIZON_DAYS);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
    const from = new Date(`${checkIn}T00:00:00`);
    const to = new Date(`${checkOut}T00:00:00`);
    const diff = to.getTime() - from.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }, [checkIn, checkOut]);
  const pricedNights = nights > 0 ? nights : 1;
  const quoteMatchesSelection = Boolean(
    initialPricedQuote &&
      checkIn === initialPricedQuote.checkIn &&
      checkOut === initialPricedQuote.checkOut &&
      guests === initialPricedQuote.guests,
  );
  const summarySubtotal = quoteMatchesSelection ? initialPricedQuote!.subtotal : nightlyPrice * pricedNights;
  const summaryCleaningFee = quoteMatchesSelection ? initialPricedQuote!.cleaningFee : cleaningFee;
  const summaryServiceFee = quoteMatchesSelection
    ? initialPricedQuote!.serviceFee
    : Math.round(summarySubtotal * (serviceFeePercent / 100));
  const totalEstimate = quoteMatchesSelection ? initialPricedQuote!.total : summarySubtotal + summaryCleaningFee + summaryServiceFee;

  const guestsValid = Number.isFinite(guests) && guests >= 1 && guests <= maxGuests;

  const errors = useMemo(() => {
    const next: { checkIn?: string; checkOut?: string; guests?: string } = {};
    if (!checkIn) next.checkIn = text.requiredCheckIn;
    if (checkIn && checkIn > maxBookDate) next.checkIn = text.invalidCheckInFuture;
    if (!checkOut) next.checkOut = text.requiredCheckOut;
    if (checkIn && checkOut && checkOut <= checkIn) next.checkOut = text.invalidCheckOut;
    if (checkIn && checkOut && nights > MAX_STAY_NIGHTS) next.checkOut = text.invalidStayDuration;
    if (!guestsValid) next.guests = text.invalidGuests;
    return next;
  }, [checkIn, checkOut, guestsValid, text, nights, maxBookDate]);

  const formValid = !errors.checkIn && !errors.checkOut && !errors.guests;

  const dateLocale = lang === "ru" ? "ru-RU" : "en-GB";
  const [isApplyingSearch, setIsApplyingSearch] = useState(false);
  const nearestSaturday = useMemo(() => {
    const base = new Date(`${today}T00:00:00`);
    const day = base.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7 || 7;
    return addDays(today, daysUntilSaturday);
  }, [today]);
  const dateShortcuts: DateShortcut[] = useMemo(
    () => [
      { key: "tomorrow2", label: text.tomorrow2, checkIn: addDays(today, 1), nights: 2 },
      { key: "weekend", label: text.weekend, checkIn: nearestSaturday, nights: 2 },
      { key: "week", label: text.weekStay, checkIn: addDays(today, 7), nights: 7 },
    ],
    [nearestSaturday, text.tomorrow2, text.weekStay, text.weekend, today],
  );

  function formatHumanDate(isoDate: string): string {
    if (!isoDate) return "";
    return new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${isoDate}T00:00:00`));
  }

  function formatPrice(valueKzt: number): string {
    const locale = lang === "ru" ? "ru-RU" : "en-US";
    if (currency === "USD") {
      return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(valueKzt / USD_RATE);
    }
    return new Intl.NumberFormat(locale, { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(valueKzt);
  }

  function applyDateRange(nextCheckIn: string, nextNights = 2) {
    const safeNights = Math.min(MAX_STAY_NIGHTS, Math.max(1, nextNights));
    const nextCheckOut = addDays(nextCheckIn, safeNights);
    setCheckIn(nextCheckIn);
    setCheckOut(nextCheckOut <= maxBookDate ? nextCheckOut : maxBookDate);
    setSubmitted(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!formValid) {
      requestAnimationFrame(() => {
        if (errors.checkIn) {
          checkInRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          checkInRef.current?.focus();
          return;
        }
        if (errors.checkOut) {
          checkOutRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          checkOutRef.current?.focus();
          return;
        }
        if (errors.guests) {
          guestsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          guestsRef.current?.focus();
        }
      });
      return;
    }

    const query = new URLSearchParams({
      check_in: checkIn,
      check_out: checkOut,
      guests: String(guests),
      lang,
      currency,
      exp_variant: expVariant,
    });
    setIsApplyingSearch(true);
    router.push(`/stays/${listingId}?${query.toString()}#available-rooms`);
  }

  return (
    <form className="booking-form" onSubmit={onSubmit} noValidate>
      <div className="booking-date-search">
        <p className="calendar-title">{labels.dateSearchTitle}</p>
        <small>{labels.dateSearchHint}</small>
        <span>{text.dateTip}</span>
      </div>

      <div className="date-shortcuts" aria-label={text.quickDates}>
        <span>{text.quickDates}</span>
        {dateShortcuts.map((shortcut) => (
          <button
            key={shortcut.key}
            type="button"
            className={checkIn === shortcut.checkIn && nights === shortcut.nights ? "active" : ""}
            onClick={() => applyDateRange(shortcut.checkIn, shortcut.nights)}
          >
            {shortcut.label}
          </button>
        ))}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setCheckIn("");
            setCheckOut("");
            setSubmitted(false);
          }}
        >
          {text.clearDates}
        </button>
      </div>

      <DateRangePicker
        lang={lang}
        variant="booking"
        value={{ checkIn, checkOut }}
        onChange={(range) => {
          setCheckIn(range.checkIn);
          setCheckOut(range.checkOut);
          setSubmitted(false);
        }}
        minDate={today}
        maxDate={maxBookDate}
        checkInLabel={labels.checkIn}
        checkOutLabel={labels.checkOut}
        checkInStep={text.checkInStep}
        checkOutStep={text.checkOutStep}
        submitted={submitted}
        checkInError={errors.checkIn}
        checkOutError={errors.checkOut}
        checkInRef={checkInRef}
        checkOutRef={checkOutRef}
      />

      <label className="field-stack guests-field">
        <span>{text.guestsStep}</span>
        <b>{labels.guests}</b>
        <input
          suppressHydrationWarning
          ref={guestsRef}
          type="number"
          min={1}
          max={maxGuests}
          value={guests}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (!Number.isFinite(raw)) {
              setGuests(1);
              return;
            }
            setGuests(Math.min(maxGuests, Math.max(1, raw)));
          }}
          className={submitted && errors.guests ? "input-error" : ""}
          aria-invalid={submitted && Boolean(errors.guests)}
          required
        />
        {submitted && errors.guests ? <p className="field-error">{errors.guests}</p> : null}
      </label>

      <div className="booking-selection">
        <span>
          <b>{labels.selectedRange}:</b>{" "}
          {checkIn && checkOut ? `${formatHumanDate(checkIn)} - ${formatHumanDate(checkOut)}` : labels.completeDates}
        </span>
        <span>
          <b>{labels.nights}:</b> {nights > 0 ? nights : "-"}
        </span>
        <span>
          <b>{text.roomsStep}:</b> {labels.showRooms}
        </span>
      </div>
      <div className="stay-price-breakdown">
        <p className="desc">
          <b>{labels.summary}</b>
        </p>
        <div className="summary-row">
          <span>{labels.subtotal}</span>
          <b>{formatPrice(summarySubtotal)}</b>
        </div>
        <div className="summary-row">
          <span>{labels.cleaning}</span>
          <b>{formatPrice(summaryCleaningFee)}</b>
        </div>
        <div className="summary-row">
          <span>{labels.service}</span>
          <b>{formatPrice(summaryServiceFee)}</b>
        </div>
        <div className="summary-row total">
          <span>{labels.total}</span>
          <b>{formatPrice(totalEstimate)}</b>
        </div>
        {quoteMatchesSelection && initialPricedQuote!.dynamicMultiplier > 1 ? (
          <small>
            {lang === "ru" ? "Динамическая цена учтена" : "Demand pricing included"}: +{Math.round((initialPricedQuote!.dynamicMultiplier - 1) * 100)}%
          </small>
        ) : null}
        <small>{text.dynamicPricingNotice}</small>
        <small>{labels.estimateHint}</small>
      </div>

      {submitted && !formValid ? <p className="form-status error">{text.fixFields}</p> : null}

      <p className="desc">
        {labels.maxGuests}: {maxGuests}
      </p>
      <button type="submit" disabled={isApplyingSearch || !formValid} className={isApplyingSearch ? "btn-loading" : ""}>
        {isApplyingSearch ? text.applyingSearch : labels.showRooms}
      </button>
    </form>
  );
}
