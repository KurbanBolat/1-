"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PartnerCommunicationBatchRetryResult, PartnerCommunicationEvent } from "../../lib/api";

type ChannelFilter = "all" | "webhook" | "email" | "telegram";
type StatusFilter = "all" | "sent" | "failed" | "skipped";
type CommunicationQueueKey = "all" | "failed" | "webhook" | "email" | "telegram";
type CommunicationTone = "danger" | "success" | "neutral";

type Props = {
  events: PartnerCommunicationEvent[];
  channelFilter: ChannelFilter;
  statusFilter: StatusFilter;
  onChannelFilterChange: (value: ChannelFilter) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onRefresh: () => void;
  onRetryEvent: (eventId: string) => void;
  onRetryFailedFiltered: (eventIds: string[]) => void;
  onRetryFailedFromLastBatch: (eventIds: string[]) => void;
  lastBatchResult: PartnerCommunicationBatchRetryResult | null;
  refreshState: "idle" | "scheduled" | "loading";
  defaultExpanded?: boolean;
};

function channelLabel(channel: PartnerCommunicationEvent["channel"]): string {
  if (channel === "webhook") return "Webhook";
  if (channel === "email") return "Email";
  return "Telegram";
}

function statusLabel(status: PartnerCommunicationEvent["status"]): string {
  if (status === "sent") return "Отправлено";
  if (status === "failed") return "Ошибка";
  return "Пропущено";
}

function eventTitle(event: string): string {
  return event.split("_").join(" ");
}

function communicationSignal(item: PartnerCommunicationEvent): { label: string; detail: string; tone: CommunicationTone } {
  if (item.status === "failed") {
    return {
      label: "Требует повтора",
      detail: item.attempts > 1 ? `${item.attempts} попытки, проверьте канал` : "Повторите отправку или проверьте канал",
      tone: "danger",
    };
  }
  if (item.status === "sent") {
    return { label: "Доставлено", detail: item.retry_applied ? "Успешно после повтора" : "Канал отработал штатно", tone: "success" };
  }
  return { label: "Пропущено", detail: item.reason || "Отправка не требовалась", tone: "neutral" };
}

export default function ManagerCommunicationsSection({
  events,
  channelFilter,
  statusFilter,
  onChannelFilterChange,
  onStatusFilterChange,
  onRefresh,
  onRetryEvent,
  onRetryFailedFiltered,
  onRetryFailedFromLastBatch,
  lastBatchResult,
  refreshState,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const summary = useMemo(
    () =>
      events.reduce(
        (acc, row) => {
          acc.total += 1;
          acc[row.status] += 1;
          acc[row.channel] += 1;
          if (row.retry_applied) acc.retried += 1;
          return acc;
        },
        { total: 0, sent: 0, failed: 0, skipped: 0, webhook: 0, email: 0, telegram: 0, retried: 0 },
      ),
    [events],
  );
  const failedEventIds = useMemo(() => events.filter((item) => item.status === "failed").map((item) => item.event_id), [events]);
  const lastBatchFailedIds = useMemo(
    () => (lastBatchResult ? lastBatchResult.items.filter((item) => !item.success).map((item) => item.event_id) : []),
    [lastBatchResult],
  );
  const sortedEvents = useMemo(
    () =>
      [...events].sort((left, right) => {
        if (left.status !== right.status) {
          if (left.status === "failed") return -1;
          if (right.status === "failed") return 1;
        }
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      }),
    [events],
  );
  const focusEvent = sortedEvents.find((item) => item.status === "failed") ?? sortedEvents[0] ?? null;
  const focusSignal = focusEvent ? communicationSignal(focusEvent) : null;

  const queueItems: Array<{ key: CommunicationQueueKey; label: string; hint: string; count: number; active: boolean }> = [
    { key: "all", label: "Все", hint: "Вся лента", count: summary.total, active: channelFilter === "all" && statusFilter === "all" },
    { key: "failed", label: "Ошибки", hint: "Нужно повторить", count: summary.failed, active: statusFilter === "failed" },
    { key: "webhook", label: "Webhook", hint: "Интеграции", count: summary.webhook, active: channelFilter === "webhook" },
    { key: "email", label: "Email", hint: "Почта", count: summary.email, active: channelFilter === "email" },
    { key: "telegram", label: "Telegram", hint: "Мессенджер", count: summary.telegram, active: channelFilter === "telegram" },
  ];

  function applyQueue(key: CommunicationQueueKey) {
    if (key === "all") {
      onChannelFilterChange("all");
      onStatusFilterChange("all");
      return;
    }
    if (key === "failed") {
      onChannelFilterChange("all");
      onStatusFilterChange("failed");
      return;
    }
    onChannelFilterChange(key);
    onStatusFilterChange("all");
  }

  return (
    <section className="manager-notifications manager-communications">
      <div className="manager-collapsible-head">
        <div className="manager-notifications-head">
          <h4>Коммуникации</h4>
          <span>{summary.failed} ошибок • {summary.sent} отправлено</span>
        </div>
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
          <div className="manager-communication-dashboard">
            <div className="manager-communication-kpis" aria-label="Сводка коммуникаций">
              <article>
                <span>Ошибки</span>
                <b>{summary.failed}</b>
                <small>Требуют повтора</small>
              </article>
              <article>
                <span>Отправлено</span>
                <b>{summary.sent}</b>
                <small>Успешные события</small>
              </article>
              <article>
                <span>Пропущено</span>
                <b>{summary.skipped}</b>
                <small>Без отправки</small>
              </article>
              <article>
                <span>Повторы</span>
                <b>{summary.retried}</b>
                <small>Уже retried</small>
              </article>
            </div>

            <div className={`manager-communication-focus ${focusSignal?.tone ?? "neutral"}`}>
              <span>Операционный фокус</span>
              {focusEvent && focusSignal ? (
                <>
                  <b>{focusSignal.label}</b>
                  <p>
                    {eventTitle(focusEvent.event)} • {channelLabel(focusEvent.channel)} • {focusSignal.detail}
                  </p>
                </>
              ) : (
                <>
                  <b>Очередь чистая</b>
                  <p>Событий по текущему фильтру пока нет.</p>
                </>
              )}
            </div>

            <div className="manager-communication-queue" aria-label="Быстрые очереди коммуникаций">
              {queueItems.map((item) => (
                <button key={item.key} type="button" className={item.active ? "active" : ""} onClick={() => applyQueue(item.key)}>
                  <span>{item.label}</span>
                  <b>{item.count}</b>
                  <small>{item.hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="booking-row manager-communications-filters">
            <label>
              Канал
              <select value={channelFilter} onChange={(e) => onChannelFilterChange(e.target.value as ChannelFilter)}>
                <option value="all">Все каналы</option>
                <option value="webhook">Webhook</option>
                <option value="email">Email</option>
                <option value="telegram">Telegram</option>
              </select>
            </label>
            <label>
              Статус
              <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}>
                <option value="all">Все статусы</option>
                <option value="sent">Отправлено</option>
                <option value="failed">Ошибка</option>
                <option value="skipped">Пропущено</option>
              </select>
            </label>
            <div className="manager-filter-actions">
              <button type="button" className="ghost-btn" onClick={onRefresh}>
                Обновить
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => onRetryFailedFiltered(failedEventIds)}
                disabled={failedEventIds.length === 0}
              >
                Повторить ошибки ({failedEventIds.length})
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => onRetryFailedFromLastBatch(lastBatchFailedIds)}
                disabled={lastBatchFailedIds.length === 0}
              >
                Повторить ошибки батча
              </button>
            </div>
          </div>

          <div className="manager-notification-list">
            {refreshState !== "idle" ? (
              <article className="manager-notification-item manager-batch-result">
                <b>Обновляем коммуникации...</b>
                <p className="desc">{refreshState === "scheduled" ? "Обновление запланировано" : "Обновление в процессе"}</p>
              </article>
            ) : null}
            {lastBatchResult ? (
              <article className="manager-notification-item manager-batch-result">
                <b>
                  Результат батча: {lastBatchResult.retried}/{lastBatchResult.requested} успешно
                </b>
                <p className="desc">Ошибок: {lastBatchResult.failed}</p>
                {lastBatchResult.failed > 0 ? (
                  <div className="manager-batch-fail-list">
                    {lastBatchResult.items
                      .filter((item) => !item.success)
                      .map((item) => (
                        <p key={item.event_id} className="desc">
                          #{item.event_id}: {item.error || "Повтор не удался"}
                        </p>
                      ))}
                  </div>
                ) : null}
              </article>
            ) : null}
            {sortedEvents.map((item) => {
              const signal = communicationSignal(item);
              return (
                <article key={item.event_id} className={`manager-notification-item manager-comm-item status-${item.status}`}>
                  <div className="manager-comm-head">
                    <b>
                      {eventTitle(item.event)} {item.reservation_id ? `#${item.reservation_id}` : ""}
                    </b>
                    <span className={`manager-comm-signal ${signal.tone}`}>{signal.label}</span>
                  </div>
                  <p className="desc">
                    {channelLabel(item.channel)} • {statusLabel(item.status)} • {new Date(item.created_at).toLocaleString("ru-RU")}
                  </p>
                  <p className="desc">
                    {item.listing_title || `Listing #${item.listing_id ?? "?"}`} • причина: {item.reason}
                  </p>
                  <p className="desc">
                    Попыток: {item.attempts}
                    {item.retry_applied ? " • c повтором" : ""}
                  </p>
                  <div className="manager-notification-actions">
                    {item.status === "failed" ? (
                      <button type="button" className="ghost-btn" onClick={() => onRetryEvent(item.event_id)}>
                        Повторить
                      </button>
                    ) : null}
                    {item.reservation_id ? (
                      <a className="stay-link-btn" href={`#reservation-${item.reservation_id}`}>
                        Открыть бронь
                      </a>
                    ) : null}
                    {item.listing_id ? (
                      <Link className="stay-link-btn" href={`/stays/${item.listing_id}`}>
                        Открыть объект
                      </Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {events.length === 0 ? (
              <div className="manager-notification-empty">
                <b>Событий по фильтру нет</b>
                <p>Смените канал или статус, либо обновите ленту после новых броней.</p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
