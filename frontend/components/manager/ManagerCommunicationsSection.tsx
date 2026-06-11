"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PartnerCommunicationBatchRetryResult, PartnerCommunicationEvent } from "../../lib/api";

type ChannelFilter = "all" | "webhook" | "email" | "telegram";
type StatusFilter = "all" | "sent" | "failed" | "skipped";

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

  const failures = useMemo(() => events.filter((row) => row.status === "failed").length, [events]);
  const lastBatchFailedIds = useMemo(
    () => (lastBatchResult ? lastBatchResult.items.filter((item) => !item.success).map((item) => item.event_id) : []),
    [lastBatchResult],
  );

  return (
    <section className="manager-notifications manager-communications">
      <div className="manager-collapsible-head">
        <div className="manager-notifications-head">
          <h4>Коммуникации</h4>
          <span>{failures} с ошибкой</span>
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
                onClick={() => onRetryFailedFiltered(events.filter((item) => item.status === "failed").map((item) => item.event_id))}
                disabled={failures === 0}
              >
                Повторить ошибки
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
            {events.map((item) => (
              <article key={item.event_id} className={`manager-notification-item manager-comm-item status-${item.status}`}>
                <b>
                  {item.event} {item.reservation_id ? `#${item.reservation_id}` : ""}
                </b>
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
            ))}
            {events.length === 0 ? <p className="desc">Событий по фильтру пока нет.</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
