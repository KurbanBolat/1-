"use client";

import { type SupportTicket } from "../../lib/api";

type Props = {
  tickets: SupportTicket[];
  priorityFilter: "all" | "low" | "medium" | "high";
  onPriorityFilterChange: (value: "all" | "low" | "medium" | "high") => void;
  onRefresh: () => void;
  onSetStatus: (ticketId: number, status: "open" | "in_progress" | "resolved") => void;
  defaultExpanded?: boolean;
};

function statusLabel(status: SupportTicket["status"]): string {
  if (status === "open") return "Новый";
  if (status === "in_progress") return "В работе";
  return "Решен";
}

function priorityLabel(priority: SupportTicket["priority"]): string {
  if (priority === "high") return "Высокий";
  if (priority === "medium") return "Средний";
  return "Низкий";
}

function nextSupportAction(status: SupportTicket["status"]): { status: "open" | "in_progress" | "resolved"; label: string } {
  if (status === "open") return { status: "in_progress", label: "Взять в работу" };
  if (status === "in_progress") return { status: "resolved", label: "Отметить решенным" };
  return { status: "open", label: "Переоткрыть" };
}

export default function ManagerSupportTicketsSection({
  tickets,
  priorityFilter,
  onPriorityFilterChange,
  onRefresh,
  onSetStatus,
  defaultExpanded = false,
}: Props) {
  return (
    <details className="manager-collapsible" open={defaultExpanded}>
      <summary>
        <b>Тикеты поддержки</b>
        <span>{tickets.length}</span>
      </summary>
      <div className="manager-collapsible-content">
        <div className="manager-toolbar">
          <button type="button" className="ghost-btn" onClick={onRefresh}>
            Обновить
          </button>
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value as "all" | "low" | "medium" | "high")}
          >
            <option value="all">Все приоритеты</option>
            <option value="high">Высокий</option>
            <option value="medium">Средний</option>
            <option value="low">Низкий</option>
          </select>
        </div>
        <div className="manager-list">
          {tickets.map((ticket) => {
            const action = nextSupportAction(ticket.status);
            return (
              <article key={ticket.id} className="manager-item">
                <div className="manager-item-head">
                  <b>#{ticket.id}</b>
                  <div className="manager-item-actions">
                    <span className="status-pill status-pending">{statusLabel(ticket.status)}</span>
                    <span className="status-pill status-cancelled">{priorityLabel(ticket.priority)}</span>
                  </div>
                </div>
                <small>{ticket.message}</small>
                <small>Тема: {ticket.topic}</small>
                <small>
                  {ticket.city || "Любой город"} • {ticket.check_in || "-"} → {ticket.check_out || "-"} • гостей: {ticket.guests ?? "-"}
                </small>
                <div className="manager-item-actions">
                  <button type="button" className="ghost-btn" onClick={() => onSetStatus(ticket.id, action.status)}>
                    {action.label}
                  </button>
                </div>
              </article>
            );
          })}
          {tickets.length === 0 ? <p className="desc">Тикетов пока нет.</p> : null}
        </div>
      </div>
    </details>
  );
}
