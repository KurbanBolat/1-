"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  type Listing,
  type MenuItem,
  type MenuItemPayload,
  type Restaurant,
  type RestaurantBooking,
  type RestaurantBookingEvent,
  type RestaurantPayload,
  type RoomServiceOrder,
} from "../../lib/api";
import {
  formatRestaurantBookingEventDateTime,
  getRestaurantBookingEventLabel,
  getRestaurantBookingStatusClass,
  getRestaurantBookingStatusLabel,
} from "../../lib/restaurantBookingUi";

type OrderStatus = "all" | "submitted" | "accepted" | "preparing" | "delivered" | "closed" | "cancelled";
type TableBookingStatus = "all" | "submitted" | "confirmed" | "seated" | "completed" | "cancelled";
type CatalogStatusFilter = "all" | "active" | "inactive";
type ServiceSignal = { label: string; tone: "ok" | "warning" | "danger"; detail: string };
const MANAGER_MENU_PREVIEW_LIMIT = 8;
const MANAGER_RESTAURANT_PREVIEW_LIMIT = 6;

type ServiceCommandItem =
  | {
      key: string;
      kind: "room";
      priority: number;
      createdAt: number;
      title: string;
      subtitle: string;
      detail: string;
      statusLabel: string;
      statusClassName: string;
      signal: ServiceSignal;
      action: { next: RoomServiceOrder["status"]; label: string };
      order: RoomServiceOrder;
    }
  | {
      key: string;
      kind: "table";
      priority: number;
      createdAt: number;
      title: string;
      subtitle: string;
      detail: string;
      statusLabel: string;
      statusClassName: string;
      signal: ServiceSignal;
      action: { next: RestaurantBooking["status"]; label: string };
      booking: RestaurantBooking;
    };

function normalizeCatalogText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function catalogTokens(value: string): string[] {
  return normalizeCatalogText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function matchesCatalogQuery(query: string, target: string): boolean {
  const normalizedQuery = normalizeCatalogText(query);
  const normalizedTarget = normalizeCatalogText(target);
  if (!normalizedQuery) return true;
  if (!normalizedTarget) return false;
  if (normalizedTarget.includes(normalizedQuery)) return true;
  const tokens = catalogTokens(normalizedQuery);
  const targetTokens = catalogTokens(normalizedTarget);
  const targetTokenSet = new Set(targetTokens);
  return tokens.every(
    (token) => targetTokenSet.has(token) || targetTokens.some((targetToken) => targetToken.startsWith(token) || token.startsWith(targetToken)),
  );
}

function menuItemToPayload(item: MenuItem): MenuItemPayload {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    category: item.category,
    is_active: item.is_active,
    sort_order: item.sort_order,
  };
}

function restaurantToPayload(item: Restaurant): RestaurantPayload {
  return {
    name: item.name,
    cuisine: item.cuisine,
    description: item.description,
    open_from: item.open_from,
    open_to: item.open_to,
    avg_check_kzt: item.avg_check_kzt,
    is_active: item.is_active,
  };
}

function sortMenuCatalog(items: MenuItem[]): MenuItem[] {
  return [...items].sort((left, right) => {
    const activeDiff = Number(right.is_active) - Number(left.is_active);
    if (activeDiff !== 0) return activeDiff;
    const orderDiff = (left.sort_order ?? 0) - (right.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return right.id - left.id;
  });
}

function sortRestaurantCatalog(items: Restaurant[]): Restaurant[] {
  return [...items].sort((left, right) => {
    const activeDiff = Number(right.is_active) - Number(left.is_active);
    if (activeDiff !== 0) return activeDiff;
    return right.id - left.id;
  });
}

function roomOrderStatusLabel(status: RoomServiceOrder["status"]): string {
  if (status === "submitted") return "Новый";
  if (status === "accepted") return "Принят";
  if (status === "preparing") return "Готовится";
  if (status === "delivered") return "Доставлен";
  if (status === "closed") return "Закрыт";
  return "Отменен";
}

function roomOrderStatusClass(status: RoomServiceOrder["status"]): string {
  if (status === "submitted") return "status-pill status-pending";
  if (status === "accepted" || status === "preparing") return "status-pill status-event-confirmed";
  if (status === "delivered" || status === "closed") return "status-pill status-confirmed";
  return "status-pill status-cancelled";
}

function nextBookingAction(status: RestaurantBooking["status"]): { next: RestaurantBooking["status"]; label: string } | null {
  if (status === "submitted") return { next: "confirmed", label: "Подтвердить" };
  if (status === "confirmed") return { next: "seated", label: "Посадить гостя" };
  if (status === "seated") return { next: "completed", label: "Завершить" };
  return null;
}

function canCancelBooking(status: RestaurantBooking["status"]): boolean {
  return status === "submitted" || status === "confirmed" || status === "seated";
}

function newestFirst<T extends { created_at: string; id: number }>(a: T, b: T): number {
  const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  if (dateDiff !== 0) return dateDiff;
  return b.id - a.id;
}

function formatManagerDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function timeValue(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function minutesSince(value: string, now: number): number | null {
  const timestamp = timeValue(value);
  if (timestamp <= 0) return null;
  return Math.max(0, Math.floor((now - timestamp) / 60000));
}

function formatElapsedMinutes(minutes: number | null): string {
  if (minutes === null) return "время не распознано";
  if (minutes < 1) return "меньше минуты";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
  const days = Math.floor(hours / 24);
  const dayHours = hours % 24;
  return dayHours > 0 ? `${days} д ${dayHours} ч` : `${days} д`;
}

function formatManagerMoney(value: number, currency = "KZT"): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ${currency}`;
}

function nextRoomServiceAction(status: RoomServiceOrder["status"]): { next: RoomServiceOrder["status"]; label: string } | null {
  if (status === "submitted") return { next: "accepted", label: "Принять" };
  if (status === "accepted") return { next: "preparing", label: "В готовку" };
  if (status === "preparing") return { next: "delivered", label: "Отметить доставку" };
  if (status === "delivered") return { next: "closed", label: "Закрыть" };
  return null;
}

function roomOrderPriority(status: RoomServiceOrder["status"]): number {
  if (status === "submitted") return 0;
  if (status === "accepted") return 1;
  if (status === "preparing") return 2;
  if (status === "delivered") return 3;
  return 4;
}

function tableBookingPriority(status: RestaurantBooking["status"]): number {
  if (status === "submitted") return 0;
  if (status === "confirmed") return 1;
  if (status === "seated") return 2;
  return 3;
}

function roomOrderQueueSort(a: RoomServiceOrder, b: RoomServiceOrder): number {
  const priorityDiff = roomOrderPriority(a.status) - roomOrderPriority(b.status);
  if (priorityDiff !== 0) return priorityDiff;
  const ageDiff = timeValue(a.created_at) - timeValue(b.created_at);
  if (ageDiff !== 0) return ageDiff;
  return a.id - b.id;
}

function tableBookingQueueSort(a: RestaurantBooking, b: RestaurantBooking): number {
  const priorityDiff = tableBookingPriority(a.status) - tableBookingPriority(b.status);
  if (priorityDiff !== 0) return priorityDiff;
  const ageDiff = timeValue(a.created_at) - timeValue(b.created_at);
  if (ageDiff !== 0) return ageDiff;
  return a.id - b.id;
}

function roomOrderSignal(order: RoomServiceOrder, now: number): { label: string; tone: "ok" | "warning" | "danger"; detail: string } {
  const age = minutesSince(order.created_at, now);
  const elapsed = formatElapsedMinutes(age);
  if (order.status === "submitted" && age !== null && age >= 10) {
    return { label: "Срочно принять", tone: "danger", detail: `Ждет ${elapsed}` };
  }
  if (order.status === "accepted" && age !== null && age >= 20) {
    return { label: "Передать в готовку", tone: "warning", detail: `Принят ${elapsed} назад` };
  }
  if (order.status === "preparing" && age !== null && age >= 35) {
    return { label: "Проверить кухню", tone: "warning", detail: `В работе ${elapsed}` };
  }
  if (order.status === "delivered" && age !== null && age >= 45) {
    return { label: "Закрыть заказ", tone: "warning", detail: `Доставлен ${elapsed} назад` };
  }
  if (age === null) {
    return { label: "Проверить", tone: "warning", detail: elapsed };
  }
  return { label: "В норме", tone: "ok", detail: `Ожидает ${elapsed}` };
}

function tableBookingSignal(booking: RestaurantBooking, now: number): { label: string; tone: "ok" | "warning" | "danger"; detail: string } {
  const age = minutesSince(booking.created_at, now);
  const elapsed = formatElapsedMinutes(age);
  if (booking.status === "submitted" && age !== null && age >= 10) {
    return { label: "Подтвердить заявку", tone: "danger", detail: `Ждет ${elapsed}` };
  }
  if (booking.status === "submitted") {
    return { label: "Новая заявка", tone: "warning", detail: `Ждет ${elapsed}` };
  }
  if (booking.status === "confirmed") {
    const visitTime = timeValue(`${booking.booking_date}T${booking.booking_time}`);
    if (visitTime > 0) {
      const minutesUntilVisit = Math.floor((visitTime - now) / 60000);
      if (minutesUntilVisit <= 60 && minutesUntilVisit >= -30) {
        return { label: "Гость скоро", tone: "warning", detail: `Визит через ${formatElapsedMinutes(Math.max(0, minutesUntilVisit))}` };
      }
      if (minutesUntilVisit < -30) {
        return { label: "Проверить посадку", tone: "danger", detail: "Время брони уже прошло" };
      }
    }
    return { label: "Подтверждено", tone: "ok", detail: `${booking.booking_date} ${booking.booking_time}` };
  }
  if (booking.status === "seated") {
    const seatedAge = minutesSince(booking.updated_at || booking.created_at, now);
    if (seatedAge !== null && seatedAge >= 90) {
      return { label: "Проверить счет", tone: "warning", detail: `За столом ${formatElapsedMinutes(seatedAge)}` };
    }
    return { label: "Гость за столом", tone: "ok", detail: `За столом ${formatElapsedMinutes(seatedAge)}` };
  }
  return { label: "В норме", tone: "ok", detail: `${booking.booking_date} ${booking.booking_time}` };
}

type Props = {
  listings: Listing[];
  selectedListingId: number | null;
  onSelectListing: (value: number) => void;
  menuItems: MenuItem[];
  restaurants: Restaurant[];
  restaurantBookings: RestaurantBooking[];
  restaurantBookingEvents: RestaurantBookingEvent[];
  orderItems: RoomServiceOrder[];
  tableBookingStatusFilter: TableBookingStatus;
  orderStatusFilter: OrderStatus;
  onTableBookingStatusFilterChange: (value: TableBookingStatus) => void;
  onOrderStatusFilterChange: (value: OrderStatus) => void;
  menuDraft: MenuItemPayload;
  restaurantDraft: RestaurantPayload;
  onMenuDraftChange: <K extends keyof MenuItemPayload>(key: K, value: MenuItemPayload[K]) => void;
  onRestaurantDraftChange: <K extends keyof RestaurantPayload>(key: K, value: RestaurantPayload[K]) => void;
  onCreateMenuItem: (event: FormEvent<HTMLFormElement>) => void;
  onCreateRestaurant: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateMenuItem: (item: MenuItem, payload: MenuItemPayload) => void;
  onUpdateRestaurant: (item: Restaurant, payload: RestaurantPayload) => void;
  onToggleMenuItem: (item: MenuItem) => void;
  onToggleRestaurant: (item: Restaurant) => void;
  onRefresh: () => void;
  onUpdateRestaurantBookingStatus: (bookingId: number, status: RestaurantBooking["status"]) => void;
  onUpdateOrderStatus: (orderId: number, status: RoomServiceOrder["status"]) => void;
};

export default function ManagerInStaySection({
  listings,
  selectedListingId,
  onSelectListing,
  menuItems,
  restaurants,
  restaurantBookings,
  restaurantBookingEvents,
  orderItems,
  tableBookingStatusFilter,
  orderStatusFilter,
  onTableBookingStatusFilterChange,
  onOrderStatusFilterChange,
  menuDraft,
  restaurantDraft,
  onMenuDraftChange,
  onRestaurantDraftChange,
  onCreateMenuItem,
  onCreateRestaurant,
  onUpdateMenuItem,
  onUpdateRestaurant,
  onToggleMenuItem,
  onToggleRestaurant,
  onRefresh,
  onUpdateRestaurantBookingStatus,
  onUpdateOrderStatus,
}: Props) {
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | "booking_submitted" | "booking_confirmed" | "guest_seated" | "booking_completed" | "booking_cancelled">("all");
  const [eventGuestQuery, setEventGuestQuery] = useState("");
  const [eventSortOrder, setEventSortOrder] = useState<"desc" | "asc">("desc");
  const [menuQuery, setMenuQuery] = useState("");
  const [menuStatusFilter, setMenuStatusFilter] = useState<CatalogStatusFilter>("all");
  const [showAllMenu, setShowAllMenu] = useState(false);
  const [editingMenuId, setEditingMenuId] = useState<number | null>(null);
  const [menuEditDraft, setMenuEditDraft] = useState<MenuItemPayload | null>(null);
  const [restaurantQuery, setRestaurantQuery] = useState("");
  const [restaurantStatusFilter, setRestaurantStatusFilter] = useState<CatalogStatusFilter>("all");
  const [showAllRestaurants, setShowAllRestaurants] = useState(false);
  const [editingRestaurantId, setEditingRestaurantId] = useState<number | null>(null);
  const [restaurantEditDraft, setRestaurantEditDraft] = useState<RestaurantPayload | null>(null);
  const managerNow = Date.now();
  const inStaySummary = useMemo(() => {
    const waitingOrders = orderItems.filter((order) => order.status === "submitted").length;
    const inProgressOrders = orderItems.filter((order) => order.status === "accepted" || order.status === "preparing" || order.status === "delivered").length;
    const waitingTables = restaurantBookings.filter((booking) => booking.status === "submitted").length;
    const activeTables = restaurantBookings.filter((booking) => booking.status === "confirmed" || booking.status === "seated").length;
    return {
      waitingOrders,
      inProgressOrders,
      waitingTables,
      activeTables,
      activeMenuItems: menuItems.filter((item) => item.is_active).length,
      activeRestaurants: restaurants.filter((item) => item.is_active).length,
      totalRevenue: orderItems.reduce((sum, order) => sum + order.total_price, 0),
      needsAction: waitingOrders + waitingTables,
      inProgress: inProgressOrders + activeTables,
    };
  }, [menuItems, restaurants, restaurantBookings, orderItems]);
  const priorityTableBookings = useMemo(
    () =>
      restaurantBookings
        .filter((booking) => nextBookingAction(booking.status) !== null)
        .sort(tableBookingQueueSort)
        .slice(0, 4),
    [restaurantBookings],
  );
  const priorityRoomOrders = useMemo(
    () =>
      orderItems
        .filter((order) => nextRoomServiceAction(order.status) !== null)
        .sort(roomOrderQueueSort)
        .slice(0, 4),
    [orderItems],
  );
  const focusRoomOrder = priorityRoomOrders[0] ?? null;
  const focusTableBooking = priorityTableBookings[0] ?? null;
  const serviceCommandItems = useMemo<ServiceCommandItem[]>(() => {
    const roomCommands = orderItems.flatMap((order): ServiceCommandItem[] => {
      const action = nextRoomServiceAction(order.status);
      if (!action) return [];
      const signal = roomOrderSignal(order, managerNow);
      return [
        {
          key: `room-${order.id}`,
          kind: "room",
          priority: roomOrderPriority(order.status),
          createdAt: timeValue(order.created_at),
          title: `Room service #${order.id}`,
          subtitle: `Бронь #${order.reservation_id} · ${order.guest_name}`,
          detail: `${order.items.map((x) => `${x.item_name} x${x.quantity}`).join(", ")} · ${formatManagerMoney(order.total_price, order.currency)}`,
          statusLabel: roomOrderStatusLabel(order.status),
          statusClassName: roomOrderStatusClass(order.status),
          signal,
          action,
          order,
        },
      ];
    });
    const tableCommands = restaurantBookings.flatMap((booking): ServiceCommandItem[] => {
      const action = nextBookingAction(booking.status);
      if (!action) return [];
      const signal = tableBookingSignal(booking, managerNow);
      return [
        {
          key: `table-${booking.id}`,
          kind: "table",
          priority: tableBookingPriority(booking.status),
          createdAt: timeValue(booking.created_at),
          title: `Столик #${booking.id}`,
          subtitle: `${booking.restaurant_name} · ${booking.guest_name}`,
          detail: `${booking.booking_date} ${booking.booking_time} · гостей: ${booking.guests} · ${booking.guest_email}`,
          statusLabel: getRestaurantBookingStatusLabel("ru", booking.status),
          statusClassName: `status-pill ${getRestaurantBookingStatusClass(booking.status)}`,
          signal,
          action,
          booking,
        },
      ];
    });
    return [...roomCommands, ...tableCommands]
      .sort((a, b) => {
        const priorityDiff = a.priority - b.priority;
        if (priorityDiff !== 0) return priorityDiff;
        const ageDiff = a.createdAt - b.createdAt;
        if (ageDiff !== 0) return ageDiff;
        return a.key.localeCompare(b.key);
      });
  }, [managerNow, orderItems, restaurantBookings]);

  const filteredRestaurantBookingEvents = useMemo(() => {
    const q = eventGuestQuery.trim().toLowerCase();
    const filtered = restaurantBookingEvents.filter((event) => {
      const typeOk = eventTypeFilter === "all" || event.event_type === eventTypeFilter;
      const guestOk = q.length === 0 || event.guest_email.toLowerCase().includes(q);
      return typeOk && guestOk;
    });
    return [...filtered].sort((a, b) => {
      const tA = new Date(a.created_at).getTime();
      const tB = new Date(b.created_at).getTime();
      return eventSortOrder === "desc" ? tB - tA : tA - tB;
    });
  }, [restaurantBookingEvents, eventTypeFilter, eventGuestQuery, eventSortOrder]);
  const sortedRestaurantBookings = useMemo(
    () => [...restaurantBookings].sort(newestFirst),
    [restaurantBookings],
  );
  const sortedRoomOrders = useMemo(
    () => [...orderItems].sort(newestFirst),
    [orderItems],
  );
  const sortedMenuCatalog = useMemo(() => sortMenuCatalog(menuItems), [menuItems]);
  const sortedRestaurantCatalog = useMemo(() => sortRestaurantCatalog(restaurants), [restaurants]);
  const filteredMenuCatalog = useMemo(() => {
    const query = menuQuery.trim();
    return sortedMenuCatalog.filter((item) => {
      const statusOk =
        menuStatusFilter === "all" ||
        (menuStatusFilter === "active" && item.is_active) ||
        (menuStatusFilter === "inactive" && !item.is_active);
      const queryOk = matchesCatalogQuery(query, `${item.name} ${item.description} ${item.category}`);
      return statusOk && queryOk;
    });
  }, [sortedMenuCatalog, menuQuery, menuStatusFilter]);
  const filteredRestaurantCatalog = useMemo(() => {
    const query = restaurantQuery.trim();
    return sortedRestaurantCatalog.filter((item) => {
      const statusOk =
        restaurantStatusFilter === "all" ||
        (restaurantStatusFilter === "active" && item.is_active) ||
        (restaurantStatusFilter === "inactive" && !item.is_active);
      const queryOk = matchesCatalogQuery(query, `${item.name} ${item.description} ${item.cuisine}`);
      return statusOk && queryOk;
    });
  }, [sortedRestaurantCatalog, restaurantQuery, restaurantStatusFilter]);
  const visibleMenuCatalog =
    showAllMenu || menuQuery.trim().length > 0 || menuStatusFilter !== "all"
      ? filteredMenuCatalog
      : filteredMenuCatalog.slice(0, MANAGER_MENU_PREVIEW_LIMIT);
  const visibleRestaurantCatalog =
    showAllRestaurants || restaurantQuery.trim().length > 0 || restaurantStatusFilter !== "all"
      ? filteredRestaurantCatalog
      : filteredRestaurantCatalog.slice(0, MANAGER_RESTAURANT_PREVIEW_LIMIT);
  const hiddenMenuCatalogCount = Math.max(0, filteredMenuCatalog.length - visibleMenuCatalog.length);
  const hiddenRestaurantCatalogCount = Math.max(0, filteredRestaurantCatalog.length - visibleRestaurantCatalog.length);
  const menuDraftDuplicate = menuItems.some(
    (item) =>
      item.listing_id === selectedListingId &&
      normalizeCatalogText(item.name) === normalizeCatalogText(menuDraft.name) &&
      normalizeCatalogText(item.category) === normalizeCatalogText(menuDraft.category),
  );
  const restaurantDraftDuplicate = restaurants.some(
    (item) => item.listing_id === selectedListingId && normalizeCatalogText(item.name) === normalizeCatalogText(restaurantDraft.name),
  );
  const menuEditDuplicate =
    editingMenuId && menuEditDraft
      ? menuItems.some(
          (item) =>
            item.id !== editingMenuId &&
            item.listing_id === selectedListingId &&
            normalizeCatalogText(item.name) === normalizeCatalogText(menuEditDraft.name) &&
            normalizeCatalogText(item.category) === normalizeCatalogText(menuEditDraft.category),
        )
      : false;
  const restaurantEditDuplicate =
    editingRestaurantId && restaurantEditDraft
      ? restaurants.some(
          (item) =>
            item.id !== editingRestaurantId &&
            item.listing_id === selectedListingId &&
            normalizeCatalogText(item.name) === normalizeCatalogText(restaurantEditDraft.name),
        )
      : false;

  function beginMenuEdit(item: MenuItem) {
    setEditingMenuId(item.id);
    setMenuEditDraft(menuItemToPayload(item));
  }

  function beginRestaurantEdit(item: Restaurant) {
    setEditingRestaurantId(item.id);
    setRestaurantEditDraft(restaurantToPayload(item));
  }

  return (
    <details className="manager-collapsible" open>
      <summary>
        <b>In-stay сервис</b>
      </summary>
      <div className="manager-collapsible-content">
        <div className="manager-toolbar">
          <button type="button" className="ghost-btn" onClick={onRefresh}>
            Обновить
          </button>
          <select
            value={selectedListingId ?? ""}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value > 0) onSelectListing(value);
            }}
            disabled={listings.length === 0}
          >
            <option value="" disabled>
              Выберите объект
            </option>
            {listings.map((item) => (
              <option key={item.id} value={item.id}>
                #{item.id} {item.title}
              </option>
            ))}
          </select>
        </div>
        <div className="manager-instay-kpis">
          <article>
            <span>Новые room service</span>
            <b>{inStaySummary.waitingOrders}</b>
            <small>{inStaySummary.inProgressOrders} в работе</small>
          </article>
          <article>
            <span>Новые столики</span>
            <b>{inStaySummary.waitingTables}</b>
            <small>{inStaySummary.activeTables} активных</small>
          </article>
          <article>
            <span>Каталог сервисов</span>
            <b>{inStaySummary.activeMenuItems + inStaySummary.activeRestaurants}</b>
            <small>{inStaySummary.activeMenuItems} меню · {inStaySummary.activeRestaurants} ресторанов</small>
          </article>
          <article>
            <span>Room service сумма</span>
            <b>{Math.round(inStaySummary.totalRevenue).toLocaleString("ru-RU")}</b>
            <small>KZT по текущему фильтру</small>
          </article>
        </div>

        <div className="manager-instay-action-strip" aria-label="Сводка in-stay действий">
          <span>
            <b>{inStaySummary.needsAction}</b>
            Требует действий
          </span>
          <span>
            <b>{inStaySummary.inProgress}</b>
            В работе
          </span>
          <span>
            <b>{priorityRoomOrders[0] ? `#${priorityRoomOrders[0].id}` : "-"}</b>
            Приоритет room service
          </span>
          <span>
            <b>{priorityTableBookings[0] ? `#${priorityTableBookings[0].id}` : "-"}</b>
            Приоритет столик
          </span>
        </div>

        <section className="manager-service-command-center" aria-label="Единая очередь in-stay">
          <div className="manager-service-command-head">
            <div>
              <span>Операционная очередь</span>
              <h4>Единая очередь in-stay</h4>
              <p>Room service и столики отсортированы по срочности, старые заявки поднимаются выше.</p>
            </div>
          </div>
          <div className="manager-service-command-list">
            {serviceCommandItems.map((item) => (
              <article key={item.key} className={`manager-service-command-row ${item.kind}`}>
                <div className="manager-service-command-main">
                  <span className="manager-service-kind">{item.kind === "room" ? "Room service" : "Столик"}</span>
                  <b>{item.title}</b>
                  <small>{item.subtitle}</small>
                  <small>{item.detail}</small>
                </div>
                <div className="manager-service-command-state">
                  <span className={item.statusClassName}>{item.statusLabel}</span>
                  <span className={`manager-sla-pill manager-sla-${item.signal.tone}`}>{item.signal.label}</span>
                  <small>{item.signal.detail}</small>
                </div>
                {item.kind === "room" ? (
                  <button type="button" className="ghost-btn manager-instay-primary-action" onClick={() => onUpdateOrderStatus(item.order.id, item.action.next)}>
                    {item.action.label}
                  </button>
                ) : (
                  <button type="button" className="ghost-btn manager-instay-primary-action" onClick={() => onUpdateRestaurantBookingStatus(item.booking.id, item.action.next)}>
                    {item.action.label}
                  </button>
                )}
              </article>
            ))}
            {serviceCommandItems.length === 0 ? <p className="desc">Единая очередь пустая: новых room service заказов и активных заявок на столики нет.</p> : null}
          </div>
        </section>

        <div className="manager-instay-focus" aria-label="Операционный фокус">
          <article>
            <div className="manager-instay-focus-head">
              <span>Операционный фокус</span>
              <b>Room service</b>
            </div>
            {focusRoomOrder ? (
              <>
                <div className="manager-instay-priority-line">
                  <strong>Заказ #{focusRoomOrder.id}</strong>
                  {(() => {
                    const signal = roomOrderSignal(focusRoomOrder, managerNow);
                    return <span className={`manager-sla-pill manager-sla-${signal.tone}`}>{signal.label}</span>;
                  })()}
                </div>
                <small>Бронь #{focusRoomOrder.reservation_id} · {focusRoomOrder.guest_name}</small>
                <small>{focusRoomOrder.items.map((x) => `${x.item_name} x${x.quantity}`).join(", ")}</small>
                <small>{roomOrderSignal(focusRoomOrder, managerNow).detail} · {formatManagerMoney(focusRoomOrder.total_price, focusRoomOrder.currency)}</small>
                <div className="manager-item-actions">
                  {(() => {
                    const focusAction = nextRoomServiceAction(focusRoomOrder.status);
                    return focusAction ? (
                      <button type="button" className="ghost-btn manager-instay-primary-action" onClick={() => onUpdateOrderStatus(focusRoomOrder.id, focusAction.next)}>
                        {focusAction.label}
                      </button>
                    ) : null;
                  })()}
                </div>
              </>
            ) : (
              <p className="desc">Открытых заказов room service нет.</p>
            )}
          </article>

          <article>
            <div className="manager-instay-focus-head">
              <span>Операционный фокус</span>
              <b>Столики</b>
            </div>
            {focusTableBooking ? (
              <>
                <div className="manager-instay-priority-line">
                  <strong>Бронь #{focusTableBooking.id}</strong>
                  {(() => {
                    const signal = tableBookingSignal(focusTableBooking, managerNow);
                    return <span className={`manager-sla-pill manager-sla-${signal.tone}`}>{signal.label}</span>;
                  })()}
                </div>
                <small>{focusTableBooking.restaurant_name} · гостей: {focusTableBooking.guests}</small>
                <small>{focusTableBooking.booking_date} {focusTableBooking.booking_time} · {focusTableBooking.guest_name}</small>
                <small>{tableBookingSignal(focusTableBooking, managerNow).detail}</small>
                <div className="manager-item-actions">
                  {(() => {
                    const focusAction = nextBookingAction(focusTableBooking.status);
                    return focusAction ? (
                      <button type="button" className="ghost-btn manager-instay-primary-action" onClick={() => onUpdateRestaurantBookingStatus(focusTableBooking.id, focusAction.next)}>
                        {focusAction.label}
                      </button>
                    ) : null;
                  })()}
                </div>
              </>
            ) : (
              <p className="desc">Открытых заявок на столики нет.</p>
            )}
          </article>
        </div>

        <div className="manager-instay-queue">
          <article>
            <div className="manager-instay-queue-head">
              <h4>Очередь room service</h4>
              <span>{priorityRoomOrders.length}</span>
            </div>
            <div className="manager-list manager-instay-compact-list">
              {priorityRoomOrders.map((order) => {
                const orderNextAction = nextRoomServiceAction(order.status);
                const signal = roomOrderSignal(order, managerNow);
                return (
                  <article key={order.id} className="manager-item manager-instay-ticket">
                    <div className="manager-item-head">
                      <b>#{order.id}</b>
                      <span className={roomOrderStatusClass(order.status)}>{roomOrderStatusLabel(order.status)}</span>
                    </div>
                    <div className="manager-instay-ticket-meta">
                      <span className={`manager-sla-pill manager-sla-${signal.tone}`}>{signal.label}</span>
                      <small>{signal.detail}</small>
                    </div>
                    <small>Бронь #{order.reservation_id} · {order.guest_name}</small>
                    <small>{order.guest_email}</small>
                    <small>Создан: {formatManagerDateTime(order.created_at)} · {formatManagerMoney(order.total_price, order.currency)}</small>
                    <small>{order.items.map((x) => `${x.item_name} x${x.quantity}`).join(", ")}</small>
                    <div className="manager-item-actions">
                      {orderNextAction ? (
                        <button type="button" className="ghost-btn manager-instay-primary-action" onClick={() => onUpdateOrderStatus(order.id, orderNextAction.next)}>
                          {orderNextAction.label}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {priorityRoomOrders.length === 0 ? <p className="desc">Срочных заказов нет.</p> : null}
            </div>
          </article>

          <article>
            <div className="manager-instay-queue-head">
              <h4>Очередь столиков</h4>
              <span>{priorityTableBookings.length}</span>
            </div>
            <div className="manager-list manager-instay-compact-list">
              {priorityTableBookings.map((booking) => {
                const bookingNextAction = nextBookingAction(booking.status);
                const signal = tableBookingSignal(booking, managerNow);
                return (
                  <article key={booking.id} className="manager-item manager-instay-ticket">
                    <div className="manager-item-head">
                      <b>#{booking.id}</b>
                      <span className={`status-pill ${getRestaurantBookingStatusClass(booking.status)}`}>
                        {getRestaurantBookingStatusLabel("ru", booking.status)}
                      </span>
                    </div>
                    <div className="manager-instay-ticket-meta">
                      <span className={`manager-sla-pill manager-sla-${signal.tone}`}>{signal.label}</span>
                      <small>{signal.detail}</small>
                    </div>
                    <small>{booking.restaurant_name}</small>
                    <small>{booking.booking_date} {booking.booking_time} · гостей: {booking.guests} · {booking.guest_name}</small>
                    <small>{booking.guest_email}</small>
                    <small>Создана: {formatManagerDateTime(booking.created_at)}</small>
                    <div className="manager-item-actions">
                      {bookingNextAction ? (
                        <button type="button" className="ghost-btn manager-instay-primary-action" onClick={() => onUpdateRestaurantBookingStatus(booking.id, bookingNextAction.next)}>
                          {bookingNextAction.label}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {priorityTableBookings.length === 0 ? <p className="desc">Новых заявок на столики нет.</p> : null}
            </div>
          </article>
        </div>

        <h4>Управление меню</h4>
        <div className="manager-catalog-tools">
          <input
            value={menuQuery}
            onChange={(e) => {
              setMenuQuery(e.target.value);
              setShowAllMenu(false);
            }}
            placeholder="Поиск по меню"
          />
          <select value={menuStatusFilter} onChange={(e) => setMenuStatusFilter(e.target.value as CatalogStatusFilter)}>
            <option value="all">Все позиции</option>
            <option value="active">Активные</option>
            <option value="inactive">Скрытые</option>
          </select>
          <span className="manager-catalog-count">
            {visibleMenuCatalog.length}/{filteredMenuCatalog.length || menuItems.length}
          </span>
        </div>
        <form className="booking-form" onSubmit={onCreateMenuItem}>
          <input
            value={menuDraft.name}
            onChange={(e) => onMenuDraftChange("name", e.target.value)}
            placeholder="Название позиции"
            required
          />
          <div className="booking-row">
            <input
              type="number"
              min={1}
              value={menuDraft.price}
              onChange={(e) => onMenuDraftChange("price", Number(e.target.value))}
              placeholder="Цена (KZT)"
              required
            />
            <input
              value={menuDraft.category}
              onChange={(e) => onMenuDraftChange("category", e.target.value)}
              placeholder="Категория"
              required
            />
          </div>
          <input
            value={menuDraft.description}
            onChange={(e) => onMenuDraftChange("description", e.target.value)}
            placeholder="Описание"
          />
          {menuDraftDuplicate ? <p className="manager-catalog-warning">Такая позиция уже есть в этой категории. Измените название или категорию.</p> : null}
          <button type="submit" disabled={!selectedListingId || menuDraftDuplicate}>
            Добавить позицию
          </button>
        </form>
        <div className="manager-list manager-catalog-list">
          {visibleMenuCatalog.map((item) => {
            const isEditing = editingMenuId === item.id && menuEditDraft;
            return (
            <article key={item.id} className={`manager-item ${isEditing ? "is-editing" : ""}`}>
              {isEditing ? (
                <form
                  className="manager-catalog-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!menuEditDraft || menuEditDuplicate) return;
                    onUpdateMenuItem(item, menuEditDraft);
                    setEditingMenuId(null);
                    setMenuEditDraft(null);
                  }}
                >
                  <input
                    value={menuEditDraft.name}
                    onChange={(e) => setMenuEditDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    placeholder="Название позиции"
                    required
                  />
                  <div className="booking-row">
                    <input
                      type="number"
                      min={1}
                      value={menuEditDraft.price}
                      onChange={(e) => setMenuEditDraft((prev) => (prev ? { ...prev, price: Number(e.target.value) } : prev))}
                      placeholder="Цена (KZT)"
                      required
                    />
                    <input
                      value={menuEditDraft.category}
                      onChange={(e) => setMenuEditDraft((prev) => (prev ? { ...prev, category: e.target.value } : prev))}
                      placeholder="Категория"
                      required
                    />
                  </div>
                  <input
                    value={menuEditDraft.description}
                    onChange={(e) => setMenuEditDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                    placeholder="Описание"
                  />
                  <label className="manager-check">
                    <input
                      type="checkbox"
                      checked={menuEditDraft.is_active}
                      onChange={(e) => setMenuEditDraft((prev) => (prev ? { ...prev, is_active: e.target.checked } : prev))}
                    />
                    Активна
                  </label>
                  {menuEditDuplicate ? <p className="manager-catalog-warning">Дубль позиции в этой категории.</p> : null}
                  <div className="manager-item-actions">
                    <button type="submit" className="ghost-btn manager-instay-primary-action" disabled={Boolean(menuEditDuplicate)}>
                      Сохранить
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setEditingMenuId(null);
                        setMenuEditDraft(null);
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              ) : (
                <>
              <div className="manager-item-head">
                <b>{item.name}</b>
                <span>{Math.round(item.price)} KZT</span>
              </div>
              <small>{item.category} · {item.is_active ? "Активна" : "Скрыта"}</small>
              <small>{item.description}</small>
              <div className="manager-item-actions">
                <button type="button" className="ghost-btn" onClick={() => beginMenuEdit(item)}>
                  Редактировать
                </button>
                <button type="button" className="ghost-btn" onClick={() => onToggleMenuItem(item)}>
                  {item.is_active ? "Скрыть" : "Активировать"}
                </button>
              </div>
                </>
              )}
            </article>
            );
          })}
          {menuItems.length === 0 ? <p className="desc">Пока нет позиций меню для выбранного объекта.</p> : null}
          {menuItems.length > 0 && filteredMenuCatalog.length === 0 ? <p className="desc">По текущим фильтрам меню ничего не найдено.</p> : null}
        </div>
        {filteredMenuCatalog.length > MANAGER_MENU_PREVIEW_LIMIT && menuQuery.trim().length === 0 && menuStatusFilter === "all" ? (
          <button type="button" className="ghost-btn manager-catalog-more" onClick={() => setShowAllMenu((prev) => !prev)}>
            {showAllMenu ? "Свернуть меню" : `Показать еще (${hiddenMenuCatalogCount})`}
          </button>
        ) : null}

        <h4>Рестораны объекта</h4>
        <div className="manager-catalog-tools">
          <input
            value={restaurantQuery}
            onChange={(e) => {
              setRestaurantQuery(e.target.value);
              setShowAllRestaurants(false);
            }}
            placeholder="Поиск по ресторанам"
          />
          <select value={restaurantStatusFilter} onChange={(e) => setRestaurantStatusFilter(e.target.value as CatalogStatusFilter)}>
            <option value="all">Все рестораны</option>
            <option value="active">Активные</option>
            <option value="inactive">Скрытые</option>
          </select>
          <span className="manager-catalog-count">
            {visibleRestaurantCatalog.length}/{filteredRestaurantCatalog.length || restaurants.length}
          </span>
        </div>
        <form className="booking-form" onSubmit={onCreateRestaurant}>
          <input
            value={restaurantDraft.name}
            onChange={(e) => onRestaurantDraftChange("name", e.target.value)}
            placeholder="Название ресторана"
            required
          />
          <div className="booking-row">
            <input
              value={restaurantDraft.cuisine}
              onChange={(e) => onRestaurantDraftChange("cuisine", e.target.value)}
              placeholder="Кухня"
              required
            />
            <input
              type="number"
              min={0}
              value={restaurantDraft.avg_check_kzt}
              onChange={(e) => onRestaurantDraftChange("avg_check_kzt", Number(e.target.value))}
              placeholder="Средний чек (KZT)"
              required
            />
          </div>
          <div className="booking-row">
            <input
              type="time"
              value={restaurantDraft.open_from}
              onChange={(e) => onRestaurantDraftChange("open_from", e.target.value)}
              required
            />
            <input
              type="time"
              value={restaurantDraft.open_to}
              onChange={(e) => onRestaurantDraftChange("open_to", e.target.value)}
              required
            />
          </div>
          <input
            value={restaurantDraft.description}
            onChange={(e) => onRestaurantDraftChange("description", e.target.value)}
            placeholder="Описание"
          />
          {restaurantDraftDuplicate ? <p className="manager-catalog-warning">Ресторан с таким названием уже есть у объекта.</p> : null}
          <button type="submit" disabled={!selectedListingId || restaurantDraftDuplicate}>
            Добавить ресторан
          </button>
        </form>
        <div className="manager-list manager-catalog-list">
          {visibleRestaurantCatalog.map((item) => {
            const isEditing = editingRestaurantId === item.id && restaurantEditDraft;
            return (
            <article key={item.id} className={`manager-item ${isEditing ? "is-editing" : ""}`}>
              {isEditing ? (
                <form
                  className="manager-catalog-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!restaurantEditDraft || restaurantEditDuplicate) return;
                    onUpdateRestaurant(item, restaurantEditDraft);
                    setEditingRestaurantId(null);
                    setRestaurantEditDraft(null);
                  }}
                >
                  <input
                    value={restaurantEditDraft.name}
                    onChange={(e) => setRestaurantEditDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    placeholder="Название ресторана"
                    required
                  />
                  <div className="booking-row">
                    <input
                      value={restaurantEditDraft.cuisine}
                      onChange={(e) => setRestaurantEditDraft((prev) => (prev ? { ...prev, cuisine: e.target.value } : prev))}
                      placeholder="Кухня"
                      required
                    />
                    <input
                      type="number"
                      min={0}
                      value={restaurantEditDraft.avg_check_kzt}
                      onChange={(e) => setRestaurantEditDraft((prev) => (prev ? { ...prev, avg_check_kzt: Number(e.target.value) } : prev))}
                      placeholder="Средний чек (KZT)"
                      required
                    />
                  </div>
                  <div className="booking-row">
                    <input
                      type="time"
                      value={restaurantEditDraft.open_from}
                      onChange={(e) => setRestaurantEditDraft((prev) => (prev ? { ...prev, open_from: e.target.value } : prev))}
                      required
                    />
                    <input
                      type="time"
                      value={restaurantEditDraft.open_to}
                      onChange={(e) => setRestaurantEditDraft((prev) => (prev ? { ...prev, open_to: e.target.value } : prev))}
                      required
                    />
                  </div>
                  <input
                    value={restaurantEditDraft.description}
                    onChange={(e) => setRestaurantEditDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                    placeholder="Описание"
                  />
                  <label className="manager-check">
                    <input
                      type="checkbox"
                      checked={restaurantEditDraft.is_active}
                      onChange={(e) => setRestaurantEditDraft((prev) => (prev ? { ...prev, is_active: e.target.checked } : prev))}
                    />
                    Активен
                  </label>
                  {restaurantEditDuplicate ? <p className="manager-catalog-warning">Дубль ресторана у этого объекта.</p> : null}
                  <div className="manager-item-actions">
                    <button type="submit" className="ghost-btn manager-instay-primary-action" disabled={Boolean(restaurantEditDuplicate)}>
                      Сохранить
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setEditingRestaurantId(null);
                        setRestaurantEditDraft(null);
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              ) : (
                <>
              <div className="manager-item-head">
                <b>{item.name}</b>
                <span>{item.cuisine}</span>
              </div>
              <small>{item.open_from} - {item.open_to} · {item.is_active ? "Активен" : "Скрыт"}</small>
              <small>{Math.round(item.avg_check_kzt)} KZT</small>
              <small>{item.description}</small>
              <div className="manager-item-actions">
                <button type="button" className="ghost-btn" onClick={() => beginRestaurantEdit(item)}>
                  Редактировать
                </button>
                <button type="button" className="ghost-btn" onClick={() => onToggleRestaurant(item)}>
                  {item.is_active ? "Скрыть" : "Активировать"}
                </button>
              </div>
                </>
              )}
            </article>
            );
          })}
          {restaurants.length === 0 ? <p className="desc">Пока нет ресторанов для выбранного объекта.</p> : null}
          {restaurants.length > 0 && filteredRestaurantCatalog.length === 0 ? <p className="desc">По текущим фильтрам ресторанов ничего не найдено.</p> : null}
        </div>
        {filteredRestaurantCatalog.length > MANAGER_RESTAURANT_PREVIEW_LIMIT && restaurantQuery.trim().length === 0 && restaurantStatusFilter === "all" ? (
          <button type="button" className="ghost-btn manager-catalog-more" onClick={() => setShowAllRestaurants((prev) => !prev)}>
            {showAllRestaurants ? "Свернуть рестораны" : `Показать еще (${hiddenRestaurantCatalogCount})`}
          </button>
        ) : null}

        <h4>Брони столиков</h4>
        <div className="manager-toolbar">
          <select value={tableBookingStatusFilter} onChange={(e) => onTableBookingStatusFilterChange(e.target.value as TableBookingStatus)}>
            <option value="all">Все статусы</option>
            <option value="submitted">Новая</option>
            <option value="confirmed">Подтверждена</option>
            <option value="seated">Гость в ресторане</option>
            <option value="completed">Завершена</option>
            <option value="cancelled">Отменена</option>
          </select>
        </div>
        <div className="manager-list">
          {sortedRestaurantBookings.map((booking) => (
            <article key={booking.id} className="manager-item">
              {(() => {
                const bookingNextAction = nextBookingAction(booking.status);
                return (
                  <>
              <div className="manager-item-head">
                <b>#{booking.id}</b>
                <span className={`status-pill ${getRestaurantBookingStatusClass(booking.status)}`}>
                  {getRestaurantBookingStatusLabel("ru", booking.status)}
                </span>
              </div>
              <small>{booking.restaurant_name}</small>
              <small>{booking.booking_date} {booking.booking_time} • гостей: {booking.guests}</small>
              <small>{booking.guest_email}</small>
              <div className="manager-item-actions">
                {bookingNextAction ? (
                  <button type="button" className="ghost-btn" onClick={() => onUpdateRestaurantBookingStatus(booking.id, bookingNextAction.next)}>
                    {bookingNextAction.label}
                  </button>
                ) : null}
                {canCancelBooking(booking.status) ? (
                  <button type="button" className="ghost-btn" onClick={() => onUpdateRestaurantBookingStatus(booking.id, "cancelled")}>
                    Отменить
                  </button>
                ) : null}
              </div>
                  </>
                );
              })()}
            </article>
          ))}
          {restaurantBookings.length === 0 ? <p className="desc">Пока нет броней столиков.</p> : null}
        </div>

        <h4>История уведомлений по столикам</h4>
        <div className="manager-toolbar">
          <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value as typeof eventTypeFilter)}>
            <option value="all">Все события</option>
            <option value="booking_submitted">Новая заявка</option>
            <option value="booking_confirmed">Подтверждение</option>
            <option value="guest_seated">Гость размещен</option>
            <option value="booking_completed">Завершение</option>
            <option value="booking_cancelled">Отмена</option>
          </select>
          <select value={eventSortOrder} onChange={(e) => setEventSortOrder(e.target.value as "desc" | "asc")}>
            <option value="desc">Сначала новые</option>
            <option value="asc">Сначала старые</option>
          </select>
          <input
            value={eventGuestQuery}
            onChange={(e) => setEventGuestQuery(e.target.value)}
            placeholder="Поиск по email гостя"
          />
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setEventTypeFilter("all");
              setEventSortOrder("desc");
              setEventGuestQuery("");
            }}
          >
            Сбросить фильтры
          </button>
        </div>
        <div className="manager-list">
          {filteredRestaurantBookingEvents.map((event) => (
            <article key={event.id} className="manager-item">
              <div className="manager-item-head">
                <b>{getRestaurantBookingEventLabel("ru", event.event_type, event.message)}</b>
                <span className={`status-pill ${getRestaurantBookingStatusClass(event.status)}`}>
                  {getRestaurantBookingStatusLabel("ru", event.status)}
                </span>
              </div>
              <small>Бронь #{event.booking_id} • объект #{event.listing_id}</small>
              <small>{event.guest_email}</small>
              <small>{formatRestaurantBookingEventDateTime("ru", event.created_at)}</small>
            </article>
          ))}
          {filteredRestaurantBookingEvents.length === 0 ? <p className="desc">По текущим фильтрам уведомлений нет.</p> : null}
        </div>

        <h4>Заказы room service</h4>
        <div className="manager-toolbar">
          <select value={orderStatusFilter} onChange={(e) => onOrderStatusFilterChange(e.target.value as OrderStatus)}>
            <option value="all">Все статусы</option>
            <option value="submitted">Новый</option>
            <option value="accepted">Принят</option>
            <option value="preparing">Готовится</option>
            <option value="delivered">Доставлен</option>
            <option value="closed">Закрыт</option>
            <option value="cancelled">Отменен</option>
          </select>
        </div>
        <div className="manager-list">
          {sortedRoomOrders.map((order) => (
            <article key={order.id} className="manager-item manager-room-order-row">
              {(() => {
                const orderNextAction = nextRoomServiceAction(order.status);
                const signal = roomOrderSignal(order, managerNow);
                return (
                  <>
              <div className="manager-item-head">
                <b>#{order.id}</b>
                <span className={roomOrderStatusClass(order.status)}>{roomOrderStatusLabel(order.status)}</span>
              </div>
              <div className="manager-instay-ticket-meta">
                <span className={`manager-sla-pill manager-sla-${signal.tone}`}>{signal.label}</span>
                <small>{signal.detail}</small>
              </div>
              <small>Объект #{order.listing_id} • Бронь #{order.reservation_id}</small>
              <small>{order.guest_email}</small>
              <small>{order.items.map((x) => `${x.item_name} x${x.quantity}`).join(", ")}</small>
              <small>Сумма: {formatManagerMoney(order.total_price, order.currency)}</small>
              <div className="manager-item-actions">
                {orderNextAction ? (
                  <button type="button" className="ghost-btn manager-instay-primary-action" onClick={() => onUpdateOrderStatus(order.id, orderNextAction.next)}>
                    {orderNextAction.label}
                  </button>
                ) : null}
              </div>
                  </>
                );
              })()}
            </article>
          ))}
          {orderItems.length === 0 ? <p className="desc">Пока нет заказов.</p> : null}
        </div>
      </div>
    </details>
  );
}
