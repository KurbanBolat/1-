"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ApiError, createReservation } from "../lib/api";
import { rememberReservationAccess } from "../lib/guestAccess";

type LockedBooking = {
  checkIn: string;
  checkOut: string;
  guests: number;
};

export default function ReservationForm({
  listingId,
  listingTitle,
  lang,
  currency,
  lockedBooking,
  roomTypeId,
  tariffPlan = "smart",
  quoteToken,
  expVariant = "a",
  quoteExpired = false,
  bookingUnavailable = false,
  bookingUnavailableMessage,
  quoteRefreshing = false,
  onRefreshQuote,
}: {
  listingId: number;
  listingTitle: string;
  lang: "en" | "ru";
  currency: "KZT" | "USD";
  lockedBooking?: LockedBooking;
  roomTypeId?: number;
  tariffPlan?: "basic" | "smart" | "flex";
  quoteToken?: string;
  expVariant?: "a" | "b";
  quoteExpired?: boolean;
  bookingUnavailable?: boolean;
  bookingUnavailableMessage?: string;
  quoteRefreshing?: boolean;
  onRefreshQuote?: () => Promise<void>;
}) {
  const router = useRouter();
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [checkIn, setCheckIn] = useState(lockedBooking?.checkIn || "");
  const [checkOut, setCheckOut] = useState(lockedBooking?.checkOut || "");
  const [guests, setGuests] = useState(lockedBooking?.guests || 2);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"idle" | "error" | "progress">("idle");
  const [reservationStage, setReservationStage] = useState<"details" | "draft" | "payment" | "confirmed">("details");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingQuote, setIsRefreshingQuote] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!lockedBooking) return;
    setCheckIn(lockedBooking.checkIn || "");
    setCheckOut(lockedBooking.checkOut || "");
    setGuests(lockedBooking.guests || 2);
  }, [lockedBooking?.checkIn, lockedBooking?.checkOut, lockedBooking?.guests]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("findapart_guest_profile");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { name?: string; email?: string; phone?: string } | null;
      if (!parsed) return;
      if (!guestName && parsed.name) setGuestName(parsed.name);
      if (!guestEmail && parsed.email) setGuestEmail(parsed.email);
      if (!guestPhone && parsed.phone) setGuestPhone(parsed.phone);
    } catch {
      // ignore malformed local storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const payload = {
        name: guestName.trim(),
        email: guestEmail.trim().toLowerCase(),
        phone: guestPhone.trim(),
      };
      localStorage.setItem("findapart_guest_profile", JSON.stringify(payload));
      if (payload.email) localStorage.setItem("findapart_guest_email", payload.email);
    } catch {
      // ignore local storage errors
    }
  }, [guestName, guestEmail, guestPhone]);

  const normalizedEmail = guestEmail.trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const phoneDigits = guestPhone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length >= 10;
  const nameValid = guestName.trim().length >= 2;

  const text =
    lang === "ru"
      ? {
          booking: "Бронирование...",
          reserveNow: "Подтвердить бронирование",
          contactDetails: "Контактные данные",
          stayDetails: "Параметры проживания",
          fullName: "Имя и фамилия",
          email: "Email",
          phone: "Телефон",
          checkIn: "Заезд",
          checkOut: "Выезд",
          guests: "Гости",
          reservationError: "Ошибка бронирования",
          requiredName: "Укажите имя и фамилию",
          requiredEmail: "Укажите email",
          invalidEmail: "Некорректный email",
          requiredPhone: "Укажите телефон",
          invalidPhone: "Введите минимум 10 цифр",
          requiredCheckIn: "Укажите дату заезда",
          requiredCheckOut: "Укажите дату выезда",
          invalidDateRange: "Дата выезда должна быть позже даты заезда",
          invalidStayDuration: "Длительность проживания: от 1 до 30 ночей",
          invalidCheckInPast: "Дата заезда не может быть в прошлом",
          invalidCheckInFuture: "Дата заезда слишком далеко в будущем (максимум 365 дней)",
          requiredGuests: "Укажите количество гостей",
          invalidGuests: "Количество гостей от 1 до 12",
          fixFields: "Заполните обязательные поля",
          formHasErrors: "Проверьте форму, есть ошибки в обязательных полях:",
          quoteExpired: "Фиксация цены истекла. Обновите цену и попробуйте снова.",
          bookingUnavailable: "Выбранный номер больше недоступен. Выберите другой свободный номер.",
          quoteUpdated: "Цена обновлена. Проверьте сумму и повторите подтверждение.",
          refreshQuote: "Обновить цену",
          refreshingQuote: "Обновляем цену...",
          flowTitle: "Этапы бронирования",
          flowDetails: "1. Данные гостя и даты",
          flowDraft: "2. Черновик брони",
          flowPayment: "3. Оплата",
          flowConfirmed: "4. Подтверждение",
          draftCreated: "Черновик брони создан. Переход к оплате...",
        }
      : {
          booking: "Booking...",
          reserveNow: "Confirm booking",
          contactDetails: "Contact details",
          stayDetails: "Stay details",
          fullName: "Full name",
          email: "Email",
          phone: "Phone",
          checkIn: "Check-in",
          checkOut: "Check-out",
          guests: "Guests",
          reservationError: "Reservation error",
          requiredName: "Enter full name",
          requiredEmail: "Enter email",
          invalidEmail: "Invalid email format",
          requiredPhone: "Enter phone number",
          invalidPhone: "Enter at least 10 digits",
          requiredCheckIn: "Select check-in date",
          requiredCheckOut: "Select check-out date",
          invalidDateRange: "Check-out must be after check-in",
          invalidStayDuration: "Stay duration must be between 1 and 30 nights",
          invalidCheckInPast: "Check-in date cannot be in the past",
          invalidCheckInFuture: "Check-in date is too far in the future (max 365 days)",
          requiredGuests: "Enter number of guests",
          invalidGuests: "Guests must be between 1 and 12",
          fixFields: "Please complete required fields",
          formHasErrors: "Please review the required fields:",
          quoteExpired: "Price lock expired. Refresh quote and try again.",
          bookingUnavailable: "Selected room is no longer available. Choose another available room.",
          quoteUpdated: "Quote was refreshed. Review total and submit again.",
          refreshQuote: "Refresh quote",
          refreshingQuote: "Refreshing quote...",
          flowTitle: "Booking stages",
          flowDetails: "1. Guest details and dates",
          flowDraft: "2. Reservation draft",
          flowPayment: "3. Payment",
          flowConfirmed: "4. Confirmation",
          draftCreated: "Reservation draft created. Redirecting to payment...",
        };

  function isQuoteError(message: string): boolean {
    return message.includes("Quote expired") || message.includes("Quote mismatch");
  }

  function localizeServerMessage(message: string): string {
    const mapRu: Array<[string, string]> = [
      ["Validation failed", text.fixFields],
      ["check_out must be after check_in", text.invalidDateRange],
      ["Too many guests for this listing", text.invalidGuests],
      ["Listing not found", "Объект не найден"],
      ["Selected dates are unavailable", "Выбранные даты уже заняты"],
      ["Quote expired", text.quoteExpired],
      ["Quote mismatch", text.quoteExpired],
      ["Stay duration must be between 1 and 30 nights", text.invalidStayDuration],
      ["check_in cannot be in the past", text.invalidCheckInPast],
      ["check_in is too far in the future", text.invalidCheckInFuture],
    ];
    const mapEn: Array<[string, string]> = [
      ["Validation failed", text.fixFields],
      ["check_out must be after check_in", text.invalidDateRange],
      ["Too many guests for this listing", text.invalidGuests],
      ["Listing not found", "Listing not found"],
      ["Selected dates are unavailable", "Selected dates are unavailable"],
      ["Quote expired", text.quoteExpired],
      ["Quote mismatch", text.quoteExpired],
      ["Stay duration must be between 1 and 30 nights", text.invalidStayDuration],
      ["check_in cannot be in the past", text.invalidCheckInPast],
      ["check_in is too far in the future", text.invalidCheckInFuture],
    ];
    const pairs = lang === "ru" ? mapRu : mapEn;
    for (const [needle, translated] of pairs) {
      if (message.includes(needle)) return translated;
    }
    return message;
  }

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (!guestName.trim()) next.guestName = text.requiredName;
    else if (!nameValid) next.guestName = text.requiredName;

    if (!normalizedEmail) next.guestEmail = text.requiredEmail;
    else if (!emailValid) next.guestEmail = text.invalidEmail;

    if (!guestPhone.trim()) next.guestPhone = text.requiredPhone;
    else if (!phoneValid) next.guestPhone = text.invalidPhone;

    if (!checkIn) next.checkIn = text.requiredCheckIn;
    if (!checkOut) next.checkOut = text.requiredCheckOut;
    if (checkIn && checkOut && checkOut <= checkIn) next.checkOut = text.invalidDateRange;

    if (!Number.isFinite(guests)) next.guests = text.requiredGuests;
    else if (guests < 1 || guests > 12) next.guests = text.invalidGuests;

    return next;
  }, [guestName, normalizedEmail, emailValid, guestPhone, phoneValid, checkIn, checkOut, guests, nameValid, text]);

  const allErrors = { ...errors, ...serverErrors };
  const formValid = Object.keys(errors).length === 0;
  const showError = (field: string) => Boolean(allErrors[field] && (submitted || touched[field] || Boolean(serverErrors[field])));
  const visibleErrors = Object.entries(allErrors).filter(([field]) => showError(field));

  function clearServerField(field: string) {
    if (!serverErrors[field]) return;
    setServerErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function parseServerFieldErrors(error: ApiError): Record<string, string> {
    const details = Array.isArray(error.details) ? error.details : [];
    const mapping: Record<string, string> = {
      guest_name: "guestName",
      guest_email: "guestEmail",
      guest_phone: "guestPhone",
      check_in: "checkIn",
      check_out: "checkOut",
      guests: "guests",
    };
    const next: Record<string, string> = {};
    const requiredByField: Record<string, string> = {
      guestName: text.requiredName,
      guestEmail: text.requiredEmail,
      guestPhone: text.requiredPhone,
      checkIn: text.requiredCheckIn,
      checkOut: text.requiredCheckOut,
      guests: text.requiredGuests,
    };
    for (const item of details) {
      if (!item || typeof item !== "object") continue;
      const locRaw = (item as { loc?: unknown[] }).loc;
      const loc: unknown[] = Array.isArray(locRaw) ? locRaw : [];
      const lastLoc = loc.length > 0 ? loc[loc.length - 1] : undefined;
      const fieldKey = typeof lastLoc === "string" ? lastLoc : "";
      const uiField = mapping[fieldKey];
      if (!uiField) continue;
      const msg = typeof (item as { msg?: unknown }).msg === "string" ? String((item as { msg?: unknown }).msg) : "";
      if (!msg) continue;
      if (msg.includes("This field is required") || msg.includes("Field required")) {
        next[uiField] = requiredByField[uiField] || text.fixFields;
        continue;
      }
      if (uiField === "guestEmail" && msg.toLowerCase().includes("email")) {
        next[uiField] = text.invalidEmail;
        continue;
      }
      if (uiField === "guestPhone" && (msg.toLowerCase().includes("pattern") || msg.toLowerCase().includes("string should match"))) {
        next[uiField] = text.invalidPhone;
        continue;
      }
      if (uiField === "checkOut" && msg.toLowerCase().includes("after")) {
        next[uiField] = text.invalidDateRange;
        continue;
      }
      next[uiField] = msg;
    }
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerErrors({});
    if (quoteExpired) {
      setStatus(text.quoteExpired);
      setStatusKind("error");
      return;
    }
    if (bookingUnavailable) {
      setStatus(bookingUnavailableMessage || text.bookingUnavailable);
      setStatusKind("error");
      return;
    }
    setSubmitted(true);
    if (!formValid) {
      setStatus(text.fixFields);
      setStatusKind("error");
      requestAnimationFrame(() => {
        const firstInvalid = event.currentTarget.querySelector<HTMLInputElement>(".input-error");
        if (!firstInvalid) return;
        firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
        firstInvalid.focus();
      });
      return;
    }
    setIsSubmitting(true);
    setStatus(text.booking);
    setStatusKind("progress");

    try {
      setReservationStage("details");
      const reservation = await createReservation({
        listing_id: listingId,
        room_type_id: roomTypeId,
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim(),
        guest_phone: guestPhone.trim(),
        check_in: checkIn,
        check_out: checkOut,
        guests,
        tariff_plan: tariffPlan,
        quote_token: quoteToken,
      });
      rememberReservationAccess(reservation);
      setReservationStage("draft");
      setStatus(text.draftCreated);
      setStatusKind("progress");
      const query = new URLSearchParams({
        reservation_id: String(reservation.id),
        listing_id: String(listingId),
        title: listingTitle,
        check_in: checkIn,
        check_out: checkOut,
        guests: String(guests),
        total: String(Math.round(reservation.total_price)),
        lang,
        currency,
        guest_email: guestEmail.trim().toLowerCase(),
        exp_variant: expVariant,
      });
      if (roomTypeId) query.set("room_type_id", String(roomTypeId));
      if (reservation.room_type_name) query.set("room_type_name", reservation.room_type_name);
      if (reservation.access_token) query.set("access_token", reservation.access_token);
      setReservationStage("payment");
      router.push(`/checkout/payment?${query.toString()}`);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : text.reservationError;
      const message = localizeServerMessage(rawMessage);
      if (error instanceof ApiError) {
        const nextServerErrors = parseServerFieldErrors(error);
        if (Object.keys(nextServerErrors).length > 0) {
          setServerErrors(nextServerErrors);
          setStatus(text.fixFields);
          setStatusKind("error");
          return;
        }
      }
      if (onRefreshQuote && isQuoteError(message)) {
        try {
          await onRefreshQuote();
          setStatus(text.quoteUpdated);
          setStatusKind("error");
        } catch {
          setStatus(message);
          setStatusKind("error");
        }
      } else {
        setStatus(message);
        setStatusKind("error");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onQuoteRefreshClick() {
    if (!onRefreshQuote) return;
    setIsRefreshingQuote(true);
    setStatus(text.refreshingQuote);
    setStatusKind("progress");
    try {
      await onRefreshQuote();
      setStatus(text.quoteUpdated);
      setStatusKind("progress");
    } catch {
      setStatus(text.quoteExpired);
      setStatusKind("error");
    } finally {
      setIsRefreshingQuote(false);
    }
  }

  function onPhoneChange(rawValue: string) {
    const digits = rawValue.replace(/\D/g, "").slice(0, 15);
    if (digits.length === 0) {
      setGuestPhone("");
      return;
    }
    setGuestPhone(`+${digits}`);
  }

  return (
    <form onSubmit={onSubmit} className="booking-form" noValidate>
      <section className="booking-flow-card">
        <p className="desc"><b>{text.flowTitle}</b></p>
        <div className="pill-row">
          <span className={reservationStage === "details" ? "flow-pill active" : "flow-pill"}>{text.flowDetails}</span>
          <span className={reservationStage === "draft" ? "flow-pill active" : "flow-pill"}>{text.flowDraft}</span>
          <span className={reservationStage === "payment" ? "flow-pill active" : "flow-pill"}>{text.flowPayment}</span>
          <span className={reservationStage === "confirmed" ? "flow-pill active" : "flow-pill"}>{text.flowConfirmed}</span>
        </div>
      </section>
      {visibleErrors.length > 0 ? (
        <div className="form-error-summary" role="alert" aria-live="polite">
          <b>{text.formHasErrors}</b>
          <ul>
            {visibleErrors.map(([field, message]) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <section className="form-section">
        <h4>{text.contactDetails}</h4>
        <div className="form-grid">
          <label className="field-stack">
            <span>{text.fullName}</span>
            <input
              placeholder={text.fullName}
              value={guestName}
              onChange={(e) => {
                setGuestName(e.target.value);
                clearServerField("guestName");
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, guestName: true }))}
              className={showError("guestName") ? "input-error" : ""}
              aria-invalid={showError("guestName")}
              aria-describedby={showError("guestName") ? "guestName-error" : undefined}
              required
            />
            {showError("guestName") ? <p id="guestName-error" className="field-error" role="alert">{allErrors.guestName}</p> : null}
          </label>

          <label className="field-stack">
            <span>{text.email}</span>
            <input
              type="email"
              placeholder={text.email}
              value={guestEmail}
              onChange={(e) => {
                setGuestEmail(e.target.value);
                clearServerField("guestEmail");
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, guestEmail: true }))}
              className={showError("guestEmail") ? "input-error" : ""}
              aria-invalid={showError("guestEmail")}
              aria-describedby={showError("guestEmail") ? "guestEmail-error" : undefined}
              required
            />
            {showError("guestEmail") ? <p id="guestEmail-error" className="field-error" role="alert">{allErrors.guestEmail}</p> : null}
          </label>

          <label className="field-stack field-wide">
            <span>{text.phone}</span>
            <input
              placeholder={text.phone}
              value={guestPhone}
              onChange={(e) => {
                onPhoneChange(e.target.value);
                clearServerField("guestPhone");
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, guestPhone: true }))}
              className={showError("guestPhone") ? "input-error" : ""}
              aria-invalid={showError("guestPhone")}
              aria-describedby={showError("guestPhone") ? "guestPhone-error" : undefined}
              required
            />
            {showError("guestPhone") ? <p id="guestPhone-error" className="field-error" role="alert">{allErrors.guestPhone}</p> : null}
          </label>
        </div>
      </section>

      <section className="form-section">
        <h4>{text.stayDetails}</h4>
        <div className="booking-row">
          <label className="field-stack">
            <span>{text.checkIn}</span>
            <input
              type="date"
              lang={lang === "ru" ? "ru-RU" : "en-GB"}
              value={checkIn}
              suppressHydrationWarning
              onChange={(e) => {
                setCheckIn(e.target.value);
                clearServerField("checkIn");
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, checkIn: true }))}
              className={showError("checkIn") ? "input-error" : ""}
              aria-invalid={showError("checkIn")}
              aria-describedby={showError("checkIn") ? "checkIn-error" : undefined}
              required
              disabled={Boolean(lockedBooking)}
            />
            {showError("checkIn") ? <p id="checkIn-error" className="field-error" role="alert">{allErrors.checkIn}</p> : null}
          </label>
          <label className="field-stack">
            <span>{text.checkOut}</span>
            <input
              type="date"
              lang={lang === "ru" ? "ru-RU" : "en-GB"}
              value={checkOut}
              suppressHydrationWarning
              onChange={(e) => {
                setCheckOut(e.target.value);
                clearServerField("checkOut");
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, checkOut: true }))}
              className={showError("checkOut") ? "input-error" : ""}
              aria-invalid={showError("checkOut")}
              aria-describedby={showError("checkOut") ? "checkOut-error" : undefined}
              required
              disabled={Boolean(lockedBooking)}
            />
            {showError("checkOut") ? <p id="checkOut-error" className="field-error" role="alert">{allErrors.checkOut}</p> : null}
          </label>
        </div>

        <label className="field-stack">
          <span>{text.guests}</span>
          <input
            type="number"
            min={1}
            max={12}
            value={guests}
            suppressHydrationWarning
            onChange={(e) => {
              setGuests(Number(e.target.value));
              clearServerField("guests");
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, guests: true }))}
            className={showError("guests") ? "input-error" : ""}
            aria-invalid={showError("guests")}
            aria-describedby={showError("guests") ? "guests-error" : undefined}
            required
            disabled={Boolean(lockedBooking)}
          />
          {showError("guests") ? <p id="guests-error" className="field-error" role="alert">{allErrors.guests}</p> : null}
        </label>
      </section>

      {quoteExpired && onRefreshQuote ? (
        <button
          type="button"
          className="ghost-btn quote-refresh-btn"
          onClick={onQuoteRefreshClick}
          disabled={quoteRefreshing || isRefreshingQuote}
        >
          {quoteRefreshing || isRefreshingQuote ? text.refreshingQuote : text.refreshQuote}
        </button>
      ) : null}
      <button type="submit" disabled={isSubmitting || quoteExpired || bookingUnavailable || quoteRefreshing || isRefreshingQuote}>{text.reserveNow}</button>
      {status ? <p className={`form-status ${statusKind === "error" ? "error" : ""}`}>{status}</p> : null}
    </form>
  );
}
