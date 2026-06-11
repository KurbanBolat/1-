"use client";

import Link from "next/link";
import { useState } from "react";

import type { PartnerNotification } from "../../lib/api";

type Props = {
  unreadCount: number;
  notifications: PartnerNotification[];
  readNotificationIds: string[];
  onRefresh: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (eventId: string) => void;
  money: (value: number) => string;
  defaultExpanded?: boolean;
};

export default function ManagerNotificationsSection({
  unreadCount,
  notifications,
  readNotificationIds,
  onRefresh,
  onMarkAllRead,
  onMarkRead,
  money,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className="manager-notifications">
      <div className="manager-collapsible-head">
        <div className="manager-notifications-head">
          <h4>Уведомления</h4>
          <span>{unreadCount} новых</span>
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
          <div className="manager-notifications-actions">
            <button type="button" className="ghost-btn" onClick={onRefresh}>
              Обновить
            </button>
            <button type="button" className="ghost-btn" onClick={onMarkAllRead} disabled={notifications.length === 0}>
              Прочитать все
            </button>
          </div>
          <div className="manager-notification-list">
            {notifications.map((note) => {
              const unread = !(note.read || readNotificationIds.includes(note.event_id));
              return (
                <article key={note.event_id} className={`manager-notification-item ${unread ? "unread" : ""}`}>
                  <b>Бронь #{note.reservation_id}</b>
                  <p className="desc">
                    {note.listing_title} • {note.check_in} {"->"} {note.check_out} • {note.guests} гостей
                  </p>
                  <p className="desc">{money(note.total_price)} • {new Date(note.created_at).toLocaleString("ru-RU")}</p>
                  <div className="manager-notification-actions">
                    <Link href={`/stays/${note.listing_id}`} className="stay-link-btn">
                      Открыть объект
                    </Link>
                    {unread ? (
                      <button type="button" className="ghost-btn" onClick={() => onMarkRead(note.event_id)}>
                        Прочитано
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {notifications.length === 0 ? <p className="desc">Пока нет новых уведомлений.</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
