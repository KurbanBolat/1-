"use client";

import { type ChangeEvent, type KeyboardEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";

type Lang = "en" | "ru";
type DateField = "checkIn" | "checkOut";

type DateRange = {
  checkIn: string;
  checkOut: string;
};

type DateRangePickerProps = {
  lang: Lang;
  variant?: "hero" | "booking";
  value?: DateRange;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
  onChange?: (range: DateRange) => void;
  minDate?: string;
  maxDate?: string;
  checkInName?: string;
  checkOutName?: string;
  checkInLabel: string;
  checkOutLabel: string;
  checkInStep?: string;
  checkOutStep?: string;
  submitted?: boolean;
  checkInError?: string;
  checkOutError?: string;
  checkInRef?: RefObject<HTMLInputElement>;
  checkOutRef?: RefObject<HTMLInputElement>;
  className?: string;
  defaultOpen?: boolean;
};

type CalendarDay = {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
};

const AUTO_NIGHTS = 2;
const DEFAULT_HORIZON_DAYS = 365;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayKey(): string {
  return isoFromDate(new Date());
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

function addMonths(monthKey: string, offset: number): string {
  const date = new Date(`${monthKey}-01T00:00:00`);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthKeyFromIso(isoDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate.slice(0, 7) : todayKey().slice(0, 7);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && isoFromDate(date) === value;
}

function formatDisplayDate(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return "";
  const date = new Date(`${isoDate}T00:00:00`);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function parseDateInput(value: string): string | null {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return isValidIsoDate(iso) ? iso : null;
  }

  const dottedMatch = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dottedMatch) {
    const iso = `${dottedMatch[3]}-${pad(Number(dottedMatch[2]))}-${pad(Number(dottedMatch[1]))}`;
    return isValidIsoDate(iso) ? iso : null;
  }

  return null;
}

function buildCalendarDays(monthKey: string): CalendarDay[] {
  const firstDay = new Date(`${monthKey}-01T00:00:00`);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const cursor = new Date(firstDay);
  cursor.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + index);
    const iso = isoFromDate(date);
    return {
      iso,
      day: date.getDate(),
      inCurrentMonth: iso.slice(0, 7) === monthKey,
    };
  });
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function monthTitle(monthKey: string, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const formatted = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(`${monthKey}-01T00:00:00`));
  return capitalize(lang === "ru" ? formatted.replace(/\sг\.$/, "") : formatted);
}

function formatAccessibleDay(isoDate: string, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${isoDate}T00:00:00`));
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 3.5v2M14 3.5v2M4.5 8h11" />
      <rect x="3.5" y="5" width="13" height="11.5" rx="2.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 16V4M5 9l5-5 5 5" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4v12M5 11l5 5 5-5" />
    </svg>
  );
}

export default function DateRangePicker({
  lang,
  variant = "booking",
  value,
  defaultCheckIn = "",
  defaultCheckOut = "",
  onChange,
  minDate,
  maxDate,
  checkInName,
  checkOutName,
  checkInLabel,
  checkOutLabel,
  checkInStep,
  checkOutStep,
  submitted = false,
  checkInError,
  checkOutError,
  checkInRef,
  checkOutRef,
  className,
  defaultOpen = false,
}: DateRangePickerProps) {
  const generatedId = useId();
  const fallbackToday = todayKey();
  const effectiveMinDate = minDate && isValidIsoDate(minDate) ? minDate : fallbackToday;
  const effectiveMaxDate = maxDate && isValidIsoDate(maxDate) ? maxDate : addDays(effectiveMinDate, DEFAULT_HORIZON_DAYS);
  const isControlled = Boolean(value && onChange);
  const [innerRange, setInnerRange] = useState<DateRange>({ checkIn: defaultCheckIn, checkOut: defaultCheckOut });
  const currentRange = isControlled ? value! : innerRange;
  const checkIn = currentRange.checkIn;
  const checkOut = currentRange.checkOut;
  const [activeField, setActiveField] = useState<DateField>("checkIn");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [calendarMonth, setCalendarMonth] = useState(() => monthKeyFromIso(checkIn || effectiveMinDate));
  const [drafts, setDrafts] = useState<Record<DateField, string>>({ checkIn: "", checkOut: "" });
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const labels =
    lang === "ru"
      ? {
          placeholder: "дд.мм.гггг",
          calendar: "Календарь",
          previousMonth: "Предыдущий месяц",
          nextMonth: "Следующий месяц",
          clear: "Удалить",
          today: "Сегодня",
          chooseCheckIn: "Выберите дату заезда",
          chooseCheckOut: "Теперь выберите дату выезда",
          selected: "Выбрано",
          noDates: "Даты не выбраны",
          startLabel: "заезд",
          endLabel: "выезд",
          weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
        }
      : {
          placeholder: "dd.mm.yyyy",
          calendar: "Calendar",
          previousMonth: "Previous month",
          nextMonth: "Next month",
          clear: "Clear",
          today: "Today",
          chooseCheckIn: "Choose check-in date",
          chooseCheckOut: "Now choose check-out date",
          selected: "Selected",
          noDates: "No dates selected",
          startLabel: "check-in",
          endLabel: "check-out",
          weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
        };

  useEffect(() => {
    if (!isControlled) {
      setInnerRange({ checkIn: defaultCheckIn, checkOut: defaultCheckOut });
    }
  }, [defaultCheckIn, defaultCheckOut, isControlled]);

  useEffect(() => {
    if (defaultOpen) setIsOpen(true);
  }, [defaultOpen]);

  useEffect(() => {
    setDrafts({ checkIn: "", checkOut: "" });
  }, [checkIn, checkOut]);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const minMonth = monthKeyFromIso(effectiveMinDate);
  const maxMonth = monthKeyFromIso(effectiveMaxDate);
  const canGoPrev = calendarMonth > minMonth;
  const canGoNext = calendarMonth < maxMonth;

  function commitRange(nextRange: DateRange) {
    if (isControlled) {
      onChange!(nextRange);
      return;
    }
    setInnerRange(nextRange);
    onChange?.(nextRange);
  }

  function openCalendar(field: DateField) {
    const nextField = field === "checkOut" && !checkIn ? "checkIn" : field;
    const focusDate = nextField === "checkOut" ? checkOut || checkIn || effectiveMinDate : checkIn || effectiveMinDate;
    setActiveField(nextField);
    setCalendarMonth(monthKeyFromIso(focusDate));
    setIsOpen(true);
  }

  function applyDate(field: DateField, isoDate: string, closeOnComplete: boolean) {
    if (isoDate < effectiveMinDate || isoDate > effectiveMaxDate) return;

    if (field === "checkIn") {
      const autoCheckOut = addDays(isoDate, AUTO_NIGHTS);
      const hasAutoCheckOut = autoCheckOut <= effectiveMaxDate;
      commitRange({
        checkIn: isoDate,
        checkOut: checkOut && checkOut > isoDate ? checkOut : hasAutoCheckOut ? autoCheckOut : "",
      });
      setActiveField("checkOut");
      setCalendarMonth(monthKeyFromIso(hasAutoCheckOut ? autoCheckOut : isoDate));
      return;
    }

    if (!checkIn || isoDate <= checkIn) {
      const autoCheckOut = addDays(isoDate, AUTO_NIGHTS);
      commitRange({
        checkIn: isoDate,
        checkOut: autoCheckOut <= effectiveMaxDate ? autoCheckOut : "",
      });
      setActiveField("checkOut");
      setCalendarMonth(monthKeyFromIso(autoCheckOut <= effectiveMaxDate ? autoCheckOut : isoDate));
      return;
    }

    commitRange({ checkIn, checkOut: isoDate });
    if (closeOnComplete) setIsOpen(false);
  }

  function onDateInput(field: DateField, event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setDrafts((prev) => ({ ...prev, [field]: nextValue }));

    if (!nextValue.trim()) {
      commitRange(field === "checkIn" ? { checkIn: "", checkOut: "" } : { checkIn, checkOut: "" });
      return;
    }

    const parsedDate = parseDateInput(nextValue);
    if (!parsedDate) return;
    applyDate(field, parsedDate, false);
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  function clearDates() {
    commitRange({ checkIn: "", checkOut: "" });
    setActiveField("checkIn");
    setCalendarMonth(monthKeyFromIso(effectiveMinDate));
  }

  function applyToday() {
    const nextCheckOut = addDays(effectiveMinDate, AUTO_NIGHTS);
    commitRange({
      checkIn: effectiveMinDate,
      checkOut: nextCheckOut <= effectiveMaxDate ? nextCheckOut : "",
    });
    setActiveField("checkOut");
    setCalendarMonth(monthKeyFromIso(effectiveMinDate));
  }

  function fieldValue(field: DateField): string {
    if (drafts[field]) return drafts[field];
    const isoDate = field === "checkIn" ? checkIn : checkOut;
    return formatDisplayDate(isoDate);
  }

  const selectedRangeLabel =
    checkIn && checkOut ? `${formatDisplayDate(checkIn)} - ${formatDisplayDate(checkOut)}` : labels.noDates;

  function renderField(field: DateField, label: string, step: string | undefined, error: string | undefined, inputRef: RefObject<HTMLInputElement> | undefined) {
    const isCheckIn = field === "checkIn";
    const isoDate = isCheckIn ? checkIn : checkOut;
    const errorId = `${generatedId}-${field}-error`;

    return (
      <label
        className={[
          "date-range-field",
          variant === "booking" ? "field-stack date-field" : "",
          isoDate ? "is-complete" : "",
          isOpen && activeField === field ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {step ? <span className="date-range-step">{step}</span> : null}
        <span className="date-range-label">
          <CalendarIcon />
          {label}
        </span>
        <span className="date-range-input-shell">
          <input
            suppressHydrationWarning
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={labels.placeholder}
            aria-label={label}
            aria-invalid={submitted && Boolean(error)}
            aria-describedby={submitted && error ? errorId : undefined}
            value={fieldValue(field)}
            onFocus={() => openCalendar(field)}
            onClick={() => openCalendar(field)}
            onChange={(event) => onDateInput(field, event)}
            className={submitted && error ? "input-error" : ""}
          />
          <CalendarIcon />
        </span>
        {submitted && error ? (
          <p id={errorId} className="field-error">
            {error}
          </p>
        ) : null}
      </label>
    );
  }

  return (
    <div
      ref={pickerRef}
      className={["date-range-picker", `date-range-picker-${variant}`, className].filter(Boolean).join(" ")}
      onKeyDown={onFieldKeyDown}
    >
      {checkInName ? <input type="hidden" name={checkInName} value={checkIn} disabled={!checkIn} readOnly /> : null}
      {checkOutName ? <input type="hidden" name={checkOutName} value={checkOut} disabled={!checkOut} readOnly /> : null}

      <div className={["date-range-fields", variant === "booking" ? "booking-date-grid" : ""].filter(Boolean).join(" ")}>
        {renderField("checkIn", checkInLabel, checkInStep, checkInError, checkInRef)}
        {renderField("checkOut", checkOutLabel, checkOutStep, checkOutError, checkOutRef)}
      </div>

      {isOpen ? (
        <div className="date-range-popover" role="dialog" aria-label={labels.calendar}>
          <div className="date-range-popover-head">
            <button type="button" className="date-range-month" aria-label={monthTitle(calendarMonth, lang)}>
              <span>{monthTitle(calendarMonth, lang)}</span>
              <ChevronDownIcon />
            </button>
            <div className="date-range-nav">
              <button
                type="button"
                aria-label={labels.previousMonth}
                disabled={!canGoPrev}
                onClick={() => setCalendarMonth(addMonths(calendarMonth, -1))}
              >
                <ArrowUpIcon />
              </button>
              <button
                type="button"
                aria-label={labels.nextMonth}
                disabled={!canGoNext}
                onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
              >
                <ArrowDownIcon />
              </button>
            </div>
          </div>

          <div className="date-range-guidance" aria-live="polite">
            <strong>{activeField === "checkIn" ? labels.chooseCheckIn : labels.chooseCheckOut}</strong>
            <span>
              {labels.selected}: {selectedRangeLabel}
            </span>
          </div>

          <div className="date-range-weekdays" aria-hidden="true">
            {labels.weekdays.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="date-range-days">
            {calendarDays.map((day) => {
              const isDisabled = day.iso < effectiveMinDate || day.iso > effectiveMaxDate;
              const isRangeStart = day.iso === checkIn;
              const isRangeEnd = day.iso === checkOut;
              const isInRange = Boolean(checkIn && checkOut && day.iso > checkIn && day.iso < checkOut);
              const isFocusAnchor = day.iso === (activeField === "checkOut" ? checkOut || checkIn : checkIn);
              return (
                <button
                  key={day.iso}
                  type="button"
                  data-date={day.iso}
                  disabled={isDisabled}
                  aria-pressed={isRangeStart || isRangeEnd}
                  aria-label={[
                    formatAccessibleDay(day.iso, lang),
                    isRangeStart ? labels.startLabel : "",
                    isRangeEnd ? labels.endLabel : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  className={[
                    "date-range-day",
                    day.inCurrentMonth ? "" : "is-outside",
                    isRangeStart ? "is-start" : "",
                    isRangeEnd ? "is-end" : "",
                    isInRange ? "is-in-range" : "",
                    isFocusAnchor && !isRangeStart && !isRangeEnd ? "is-focus-anchor" : "",
                    day.iso === effectiveMinDate ? "is-today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => applyDate(activeField, day.iso, true)}
                >
                  {day.day}
                </button>
              );
            })}
          </div>

          <div className="date-range-footer">
            <button type="button" onClick={clearDates}>
              {labels.clear}
            </button>
            <button type="button" onClick={applyToday}>
              {labels.today}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
