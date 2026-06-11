"use client";

import { useEffect, useMemo, useState } from "react";

import type { CancellationTerms, Listing, PartnerOpsSummary, PartnerReservation } from "../../lib/api";

type ReservationStatusFilter = "all" | "draft" | "pending_payment" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired";
type Lang = "en" | "ru";
type Currency = "KZT" | "USD";
type ReservationPaymentFilter = "all" | "pending" | "paid" | "failed" | "refunded";
type ReservationListingFilter = "all" | number;
type SummaryPeriodDays = 7 | 30 | 90;

const cancellableStatuses = new Set<PartnerReservation["status"]>(["draft", "pending_payment", "confirmed", "checked_in"]);
const reopenableStatuses = new Set<PartnerReservation["status"]>(["cancelled", "expired"]);
const RESERVATION_BATCH_SIZE = 24;

function paymentStatusLabel(status: PartnerReservation["payment_status"]): string {
  if (status === "paid") return "Оплачено";
  if (status === "failed") return "Ошибка оплаты";
  if (status === "refunded") return "Возврат";
  return "Ожидает оплаты";
}

function paymentStatusClass(status: PartnerReservation["payment_status"]): string {
  if (status === "paid") return "payment-pill payment-paid";
  if (status === "failed") return "payment-pill payment-failed";
  if (status === "refunded") return "payment-pill payment-refunded";
  return "payment-pill payment-pending";
}

function paymentMethodLabel(method: PartnerReservation["payment_method"]): string {
  if (method === "apple_pay") return "Apple Pay";
  if (method === "kaspi") return "Kaspi";
  if (method === "card") return "Карта";
  return "Метод не выбран";
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

type Props = {
  lang: Lang;
  currency: Currency;
  items: Listing[];
  reservations: PartnerReservation[];
  summary: PartnerOpsSummary | null;
  summaryPeriodDays: SummaryPeriodDays;
  setSummaryPeriodDays: (days: SummaryPeriodDays) => void;
  reservationStatusFilter: ReservationStatusFilter;
  setReservationStatusFilter: (next: ReservationStatusFilter) => void;
  reservationPaymentFilter: ReservationPaymentFilter;
  setReservationPaymentFilter: (next: ReservationPaymentFilter) => void;
  reservationListingFilter: ReservationListingFilter;
  setReservationListingFilter: (next: ReservationListingFilter) => void;
  reservationGuestQuery: string;
  setReservationGuestQuery: (next: string) => void;
  reservationCheckInFrom: string;
  setReservationCheckInFrom: (next: string) => void;
  reservationCheckOutTo: string;
  setReservationCheckOutTo: (next: string) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  cancellationTermsByReservation: Record<number, CancellationTerms>;
  onPartnerCancelReservation: (reservation: PartnerReservation) => void;
  onPartnerConfirmReservation: (reservationId: number) => void;
  reservationStatusLabel: (status: PartnerReservation["status"]) => string;
  reservationStatusClass: (status: PartnerReservation["status"]) => string;
  money: (value: number) => string;
  defaultExpanded?: boolean;
};

export default function ManagerReservationsSection({
  lang,
  currency,
  items,
  reservations,
  summary,
  summaryPeriodDays,
  setSummaryPeriodDays,
  reservationStatusFilter,
  setReservationStatusFilter,
  reservationPaymentFilter,
  setReservationPaymentFilter,
  reservationListingFilter,
  setReservationListingFilter,
  reservationGuestQuery,
  setReservationGuestQuery,
  reservationCheckInFrom,
  setReservationCheckInFrom,
  reservationCheckOutTo,
  setReservationCheckOutTo,
  onApplyFilters,
  onResetFilters,
  cancellationTermsByReservation,
  onPartnerCancelReservation,
  onPartnerConfirmReservation,
  reservationStatusLabel,
  reservationStatusClass,
  money,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [visibleCount, setVisibleCount] = useState(RESERVATION_BATCH_SIZE);
  const filteredSummary = useMemo(
    () =>
      reservations.reduce(
        (acc, reservation) => {
          acc.total += 1;
          if (!["cancelled", "expired", "checked_out"].includes(reservation.status)) acc.active += 1;
          if (reservation.payment_status === "paid") {
            acc.paid += 1;
            acc.paidRevenue += reservation.total_price;
          }
          if (reservation.payment_status === "pending" || reservation.status === "pending_payment") acc.pendingPayment += 1;
          if (reservation.payment_status === "failed") acc.failedPayment += 1;
          if (reservation.payment_status === "refunded") acc.refunded += 1;
          if (reservation.room_type_id) acc.withRoomType += 1;
          return acc;
        },
        {
          total: 0,
          active: 0,
          paid: 0,
          paidRevenue: 0,
          pendingPayment: 0,
          failedPayment: 0,
          refunded: 0,
          withRoomType: 0,
        },
      ),
    [reservations],
  );
  const visibleReservations = useMemo(() => reservations.slice(0, visibleCount), [reservations, visibleCount]);
  const hiddenReservationsCount = Math.max(0, reservations.length - visibleReservations.length);

  useEffect(() => {
    setVisibleCount(RESERVATION_BATCH_SIZE);
  }, [
    reservationStatusFilter,
    reservationPaymentFilter,
    reservationListingFilter,
    reservationGuestQuery,
    reservationCheckInFrom,
    reservationCheckOutTo,
    reservations.length,
  ]);

  return (
    <section className="manager-reservations">
      <div className="manager-collapsible-head">
        <h3>Брони по моим объектам</h3>
        <button
          type="button"
          className="ghost-btn manager-collapse-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          {expanded ? "Свернуть" : "Развернуть"}
        </button>
      </div>
      {!expanded ? null : (
        <>
          <div className="booking-row">
            <label>
              Статус
              <select
                value={reservationStatusFilter}
                onChange={(e) => setReservationStatusFilter(e.target.value as ReservationStatusFilter)}
              >
                <option value="all">Все</option>
                <option value="draft">Черновик</option>
                <option value="pending_payment">Ожидает оплаты</option>
                <option value="confirmed">Подтверждено</option>
                <option value="checked_in">Заезд</option>
                <option value="checked_out">Выезд завершен</option>
                <option value="cancelled">Отменено</option>
                <option value="expired">Истекло</option>
              </select>
            </label>
            <label>
              Оплата
              <select
                value={reservationPaymentFilter}
                onChange={(e) => setReservationPaymentFilter(e.target.value as ReservationPaymentFilter)}
              >
                <option value="all">Все оплаты</option>
                <option value="pending">Ожидает оплаты</option>
                <option value="paid">Оплачено</option>
                <option value="failed">Ошибка оплаты</option>
                <option value="refunded">Возврат</option>
              </select>
            </label>
            <label>
              Объект
              <select
                value={String(reservationListingFilter)}
                onChange={(e) => setReservationListingFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              >
                <option value="all">Все объекты</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} {item.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="booking-row">
            <label>
              Поиск гостя
              <input
                value={reservationGuestQuery}
                onChange={(e) => setReservationGuestQuery(e.target.value)}
                placeholder="Имя, email, телефон"
              />
            </label>
            <label>
              Заезд с
              <input
                type="date"
                value={reservationCheckInFrom}
                onChange={(e) => setReservationCheckInFrom(e.target.value)}
              />
            </label>
          </div>
          <div className="booking-row">
            <label>
              Выезд до
              <input
                type="date"
                value={reservationCheckOutTo}
                onChange={(e) => setReservationCheckOutTo(e.target.value)}
              />
            </label>
            <div className="manager-filter-actions">
              <button type="button" className="ghost-btn" onClick={onApplyFilters}>
                Применить фильтры
              </button>
              <button type="button" className="ghost-btn" onClick={onResetFilters}>
                Сбросить
              </button>
            </div>
          </div>
          <div className="manager-period-toggle">
            <span>Период дашборда:</span>
            <div className="view-toggle">
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`view-toggle-btn ${summaryPeriodDays === days ? "active" : ""}`}
                  onClick={() => setSummaryPeriodDays(days as SummaryPeriodDays)}
                >
                  {days} дн
                </button>
              ))}
            </div>
          </div>
          <p className="desc">Отмен за период: {summary?.cancellations_period ?? 0}</p>
          <div className="manager-reservation-kpis" aria-label="Сводка по текущему фильтру">
            <article>
              <span>В фильтре</span>
              <b>{filteredSummary.total}</b>
              <small>{filteredSummary.active} активных</small>
            </article>
            <article>
              <span>Оплачено</span>
              <b>{filteredSummary.paid}</b>
              <small>{money(filteredSummary.paidRevenue)}</small>
            </article>
            <article>
              <span>Нужны действия</span>
              <b>{filteredSummary.pendingPayment + filteredSummary.failedPayment}</b>
              <small>{filteredSummary.pendingPayment} ждут оплату</small>
            </article>
            <article>
              <span>Категории</span>
              <b>
                {filteredSummary.withRoomType}/{filteredSummary.total}
              </b>
              <small>{filteredSummary.refunded} возвратов</small>
            </article>
          </div>

          <div className="manager-reservation-list">
            {reservations.length > 0 ? (
              <p className="desc manager-visible-count">
                Показано {visibleReservations.length} из {reservations.length}
              </p>
            ) : null}
            {visibleReservations.map((reservation) => {
              const cancellationTerms = cancellationTermsByReservation[reservation.id];
              const canCancel = cancellableStatuses.has(reservation.status);
              const canReopen = reopenableStatuses.has(reservation.status);
              const stayHref = `/stays/${reservation.listing_id}?lang=${lang}&currency=${currency}${
                reservation.room_type_id ? `&room_type_id=${reservation.room_type_id}` : ""
              }`;

              return (
                <article id={`reservation-${reservation.id}`} key={reservation.id} className="manager-reservation-item">
                  <div className="manager-reservation-head">
                    <div>
                      <b>#{reservation.id}</b>
                      <p className="desc">{reservation.listing_title}</p>
                    </div>
                    <span className={reservationStatusClass(reservation.status)}>{reservationStatusLabel(reservation.status)}</span>
                  </div>

                  <div className="manager-reservation-pills">
                    <span className={paymentStatusClass(reservation.payment_status)}>{paymentStatusLabel(reservation.payment_status)}</span>
                    <span className="manager-room-pill">{reservation.room_type_name || "Без категории номера"}</span>
                  </div>

                  <div className="manager-reservation-meta">
                    <span>
                      Объект
                      <b>
                        {reservation.city}, {reservation.district}
                      </b>
                    </span>
                    <span>
                      Даты
                      <b>
                        {reservation.check_in} - {reservation.check_out}
                      </b>
                    </span>
                    <span>
                      Ночи / гости
                      <b>
                        {nightsBetween(String(reservation.check_in), String(reservation.check_out))} / {reservation.guests}
                      </b>
                    </span>
                    <span>
                      Сумма
                      <b>{money(reservation.total_price)}</b>
                    </span>
                    <span>
                      Тариф
                      <b>{reservation.tariff_plan}</b>
                    </span>
                    <span>
                      Оплата
                      <b>{paymentMethodLabel(reservation.payment_method)}</b>
                    </span>
                  </div>

                  <div className="manager-guest-block">
                    <span>Гость</span>
                    <b>{reservation.guest_name}</b>
                    <a href={`mailto:${reservation.guest_email}`}>{reservation.guest_email}</a>
                    <small>{reservation.guest_phone}</small>
                  </div>

                  <div className="reservation-cancel-preview">
                    {cancellationTerms ? (
                      <>
                        <p className="desc">
                          <b>{reservation.status === "cancelled" ? "Итог отмены" : "Штраф"}:</b> {money(cancellationTerms.penalty_amount)} (
                          {cancellationTerms.penalty_percent}%)
                        </p>
                        <p className="desc">
                          <b>К возврату:</b> {money(cancellationTerms.refund_amount)} • <b>Дней до заезда:</b> {cancellationTerms.days_before_check_in}
                        </p>
                      </>
                    ) : canCancel ? (
                      <p className="desc">Штраф и сумма возврата будут рассчитаны перед подтверждением отмены.</p>
                    ) : (
                      <p className="desc">{canReopen ? "Бронь можно вернуть в подтвержденные." : "Бронь завершена, отмена недоступна."}</p>
                    )}
                  </div>
                  <div className="manager-item-actions">
                    <a className="ghost-btn" href={stayHref} target="_blank" rel="noreferrer">
                      Открыть объект
                    </a>
                    {canReopen ? (
                      <button type="button" className="ghost-btn" onClick={() => onPartnerConfirmReservation(reservation.id)}>
                        Подтвердить снова
                      </button>
                    ) : canCancel ? (
                      <button type="button" className="ghost-btn" onClick={() => onPartnerCancelReservation(reservation)}>
                        Отменить бронь
                      </button>
                    ) : (
                      <span className="manager-action-note">Действий нет</span>
                    )}
                  </div>
                </article>
              );
            })}
            {hiddenReservationsCount > 0 ? (
              <button
                type="button"
                className="ghost-btn manager-reservation-more"
                onClick={() => setVisibleCount((current) => current + RESERVATION_BATCH_SIZE)}
              >
                Показать еще {Math.min(RESERVATION_BATCH_SIZE, hiddenReservationsCount)} из {hiddenReservationsCount}
              </button>
            ) : null}
            {reservations.length === 0 ? <p className="desc">Бронирований по фильтру не найдено.</p> : null}
          </div>

          <div className="manager-performance">
            <h4>Топ объектов по выручке ({summary?.period_days ?? summaryPeriodDays} дней)</h4>
            <div className="manager-performance-list">
              {(summary?.listing_performance ?? []).map((item) => (
                <article key={item.listing_id} className="manager-performance-item">
                  <b>
                    #{item.listing_id} {item.listing_title}
                  </b>
                  <p className="desc">
                    {item.city}, {item.district}
                  </p>
                  <p className="desc">
                    Бронирований: {item.reservations_period} • Выручка: {money(item.revenue_period)}
                  </p>
                  <p className="desc">ADR: {money(item.adr_period)} • Загрузка: {item.occupancy_period.toFixed(1)}%</p>
                </article>
              ))}
              {(summary?.listing_performance ?? []).length === 0 ? <p className="desc">Нет данных по объектам за выбранный период.</p> : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
