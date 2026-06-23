"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import {
  askInStayConcierge,
  createRestaurantBooking,
  createRoomServiceOrder,
  getInStayMenu,
  getListingRestaurants,
  getRestaurantBookingEventsByReservation,
  getRestaurantBookingsByReservation,
  getRoomServiceOrdersByReservation,
  type MenuItem,
  type Restaurant,
  type RestaurantBooking,
  type RestaurantBookingEvent,
  type RoomServiceOrder,
  type RoomServiceOrderItemIn,
  type InStayConciergeAction,
} from "../lib/api";
import {
  formatRestaurantBookingEventDateTime,
  getRestaurantBookingEventLabel,
  getRestaurantBookingStatusClass,
  getRestaurantBookingStatusLabel,
} from "../lib/restaurantBookingUi";
import { formatPriceFromKzt } from "../lib/moneyUi";

type Props = {
  listingId: number;
  reservationId: number;
  guestEmail: string;
  accessToken?: string;
  lang: "en" | "ru";
  currency: "KZT" | "USD";
  postPayment?: boolean;
};

type ConciergeAction =
  | { type: "add_item"; itemId: number; label: string }
  | { type: "submit_room_order"; itemId: number; quantity: number; label: string; note?: string }
  | { type: "submit_draft_order"; label: string; note?: string }
  | { type: "select_restaurant"; restaurantId: number; label: string }
  | { type: "book_table"; restaurantId: number; bookingDate: string; bookingTime: string; guests: number; label: string; note?: string };

type ConciergeMessage = {
  role: "assistant" | "user";
  text: string;
  action?: ConciergeAction;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const MENU_PREVIEW_LIMIT = 8;
const RESTAURANT_PREVIEW_LIMIT = 6;

function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseClockTime(text: string): string | null {
  const match = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!match) return null;
  return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

function parseGuestCount(text: string): number | null {
  const match = text.match(/\b(\d{1,2})\s*(?:гост|чел|персон|guest|people|person)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(20, Math.round(value)));
}

function parseQuantity(text: string): number {
  const match = text.match(/\b(\d{1,2})\b/);
  if (!match) return 1;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(9, Math.round(value)));
}

function parseBookingDate(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(today|сегодня)\b/i.test(lower)) return toIsoDay(new Date());
  if (/\b(tomorrow|завтра)\b/i.test(lower)) return toIsoDay(addDays(new Date(), 1));

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const dot = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/);
  if (!dot) return null;

  const day = Number(dot[1]);
  const month = Number(dot[2]);
  const explicitYear = dot[3] ? Number(dot[3]) : null;
  if (!Number.isFinite(day) || !Number.isFinite(month) || day < 1 || day > 31 || month < 1 || month > 12) return null;

  const today = new Date();
  let year = explicitYear || today.getFullYear();
  let candidate = new Date(year, month - 1, day);
  if (!explicitYear && candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    year += 1;
    candidate = new Date(year, month - 1, day);
  }
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
  return toIsoDay(candidate);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function scoreSearchText(query: string, target: string): number {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTarget = normalizeSearchText(target);

  if (!normalizedQuery || !normalizedTarget) return 0;
  if (normalizedQuery.includes(normalizedTarget)) return 100 + Math.min(normalizedTarget.length, 50);
  if (normalizedTarget.includes(normalizedQuery)) return 80 + Math.min(normalizedQuery.length, 40);

  const queryTokens = tokenizeSearchText(normalizedQuery);
  const targetTokens = tokenizeSearchText(normalizedTarget);
  const targetTokenSet = new Set(targetTokens);

  return queryTokens.reduce((score, token) => {
    if (targetTokenSet.has(token)) return score + (token.length >= 4 ? 12 : 6);
    const partialMatch = targetTokens.some((targetToken) => targetToken.startsWith(token) || token.startsWith(targetToken));
    return partialMatch ? score + 4 : score;
  }, 0);
}

function matchesSearchQuery(query: string, target: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTarget = normalizeSearchText(target);

  if (!normalizedQuery) return true;
  if (!normalizedTarget) return false;
  if (normalizedTarget.includes(normalizedQuery)) return true;

  const queryTokens = tokenizeSearchText(normalizedQuery);
  const targetTokens = tokenizeSearchText(normalizedTarget);
  const targetTokenSet = new Set(targetTokens);

  return queryTokens.every(
    (token) => targetTokenSet.has(token) || targetTokens.some((targetToken) => targetToken.startsWith(token) || token.startsWith(targetToken)),
  );
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.webkitSpeechRecognition ?? speechWindow.SpeechRecognition ?? null;
}

function sortMenuItemsForDisplay(items: MenuItem[]): MenuItem[] {
  return [...items].sort((left, right) => {
    const order = (left.sort_order ?? 0) - (right.sort_order ?? 0);
    if (order !== 0) return order;
    return right.id - left.id;
  });
}

function sortRestaurantsForDisplay(items: Restaurant[]): Restaurant[] {
  return [...items].sort((left, right) => right.id - left.id);
}

function roomOrderStatusLabel(lang: "en" | "ru", status: RoomServiceOrder["status"]): string {
  if (lang === "ru") {
    if (status === "submitted") return "Отправлен";
    if (status === "accepted") return "Принят";
    if (status === "preparing") return "Готовится";
    if (status === "delivered") return "Доставлен";
    if (status === "closed") return "Закрыт";
    return "Отменен";
  }
  if (status === "submitted") return "Submitted";
  if (status === "accepted") return "Accepted";
  if (status === "preparing") return "Preparing";
  if (status === "delivered") return "Delivered";
  if (status === "closed") return "Closed";
  return "Cancelled";
}

function roomOrderStatusClass(status: RoomServiceOrder["status"]): string {
  if (status === "submitted") return "status-pill status-pending";
  if (status === "accepted" || status === "preparing") return "status-pill status-event-confirmed";
  if (status === "delivered" || status === "closed") return "status-pill status-confirmed";
  return "status-pill status-cancelled";
}

export default function InStayConcierge({ listingId, reservationId, guestEmail, accessToken, lang, currency, postPayment = false }: Props) {
  const text =
    lang === "ru"
      ? {
          title: "AI-консьерж во время проживания",
          subtitle: "Еда в номер и рестораны отеля",
          loading: "Загружаю сервисы...",
          orderNow: "Заказать в номер",
          quantity: "Количество",
          note: "Комментарий",
          yourOrders: "Ваши заказы в номер",
          emptyMenu: "Меню пока недоступно",
          emptyOrders: "Заказов пока нет",
          refresh: "Обновить",
          restaurants: "Рестораны отеля",
          emptyRestaurants: "Ресторанов пока нет",
          reserveTable: "Забронировать столик",
          tableBookings: "Ваши брони столиков",
          tableBookingUpdates: "Обновления по броням столиков",
          emptyBookings: "Бронирований столика пока нет",
          emptyBookingUpdates: "Обновлений пока нет",
          catalogPartialLoad: "Меню и рестораны загружены. История заказов временно недоступна.",
          catalogLoadFailed: "Не удалось загрузить сервисы проживания. Нажмите «Обновить».",
          date: "Дата",
          time: "Время",
          guests: "Гостей",
          selectRestaurant: "Выберите ресторан",
          avgCheck: "Средний чек",
          openHours: "Часы работы",
          openRestaurantPage: "Открыть ресторан",
          tableBooked: "Столик забронирован. Передали в отель.",
          roomOrderSent: "Заказ отправлен персоналу",
          online: "Онлайн",
          chatKicker: "Гостевой AI-сервис",
          chatTitle: "Чат-консьерж",
          chatPlaceholder: "Например: хочу бургер или забронируй столик на вечер",
          chatSend: "Отправить",
          chatIntro: "Помогу с заказом еды в номер и бронью столика в ресторане.",
          postPaymentIntro: "Бронь подтверждена. Я уже вижу эту бронь: могу показать рестораны отеля, забронировать столик или собрать заказ в номер.",
          chatHeadHint: "Выберите быстрый сценарий или напишите запрос.",
          postPaymentHeadHint: "Сервисы уже привязаны к подтвержденной брони.",
          voiceInput: "Голосовой ввод",
          voiceSpeak: "Сказать запрос",
          voiceStop: "Остановить запись",
          voiceUnsupported: "Голосовой ввод не поддерживается этим браузером",
          voiceAllowMic: "Разрешите доступ к микрофону в браузере.",
          voiceNoSpeech: "Речь не распознана. Попробуйте ещё раз.",
          voiceUnavailable: "Голосовой ввод сейчас недоступен.",
          voiceListening: "Слушаю... говорите запрос.",
          transferUnavailable: "Трансфер пока не подключен к API. Сейчас могу помочь с рестораном отеля или заказом в номер.",
          roomService: "Еда в номер",
          activeRequests: "Заявки в работе",
          activeRequestsHint: "заказы и брони",
          orderDraft: "Черновик заказа",
          orderHistory: "История заказов",
          bookingForm: "Бронь столика",
          quickMenu: "Что есть в меню?",
          quickBurger: "Хочу бургер",
          quickTable: "Забронируй столик на 19:00",
          quickTotal: "Сколько стоит мой заказ?",
          quickStatus: "Покажи статус заявок",
          actionDone: "Готово",
          actionBusy: "Выполняю...",
          submitDraft: "Отправить заказ",
          noActiveRequests: "Пока нет активных заявок. Могу собрать заказ в номер или забронировать столик.",
          orderStatusIntro: "По этой брони сейчас вижу:",
          restaurantListIntro: "Доступные рестораны отеля:",
          draftEmpty: "В черновике пока нет блюд. Напишите, что хотите заказать, или выберите позицию из меню.",
          noConnectedRestaurants: "Рестораны у этого объекта пока не подключены, но я могу собрать заказ в номер из доступного меню.",
          servicesUnavailable: "Пока не вижу подключённых сервисов проживания для этого объекта. Нажмите «Обновить» или попросите менеджера добавить меню и рестораны.",
          menuSearchPlaceholder: "Найти блюдо",
          restaurantSearchPlaceholder: "Найти ресторан",
          showMore: "Показать еще",
          showLess: "Свернуть",
          noMatches: "Ничего не найдено",
        }
      : {
          title: "AI concierge during stay",
          subtitle: "Room service and hotel restaurants",
          loading: "Loading services...",
          orderNow: "Order to room",
          quantity: "Qty",
          note: "Note",
          yourOrders: "Your room service orders",
          emptyMenu: "Menu is not available yet",
          emptyOrders: "No orders yet",
          refresh: "Refresh",
          restaurants: "Hotel restaurants",
          emptyRestaurants: "No restaurants yet",
          reserveTable: "Reserve table",
          tableBookings: "Your table bookings",
          tableBookingUpdates: "Table booking updates",
          emptyBookings: "No table bookings yet",
          emptyBookingUpdates: "No updates yet",
          catalogPartialLoad: "Menu and restaurants loaded. Order history is temporarily unavailable.",
          catalogLoadFailed: "Could not load in-stay services. Tap Refresh.",
          date: "Date",
          time: "Time",
          guests: "Guests",
          selectRestaurant: "Select restaurant",
          avgCheck: "Average check",
          openHours: "Open",
          openRestaurantPage: "Open restaurant",
          tableBooked: "Table booking submitted to hotel",
          roomOrderSent: "Order submitted to hotel staff",
          online: "Online",
          chatKicker: "Guest AI service",
          chatTitle: "Concierge chat",
          chatPlaceholder: "For example: I want a burger or reserve a table for dinner",
          chatSend: "Send",
          chatIntro: "I can help with room service and table booking.",
          postPaymentIntro: "Booking confirmed. I can see this reservation and can help with hotel restaurants, table booking, or room service.",
          chatHeadHint: "Pick a quick flow or write your request.",
          postPaymentHeadHint: "Services are attached to the confirmed reservation.",
          voiceInput: "Voice input",
          voiceSpeak: "Speak request",
          voiceStop: "Stop recording",
          voiceUnsupported: "Voice input is not supported by this browser",
          voiceAllowMic: "Allow microphone access in the browser.",
          voiceNoSpeech: "No speech detected. Try again.",
          voiceUnavailable: "Voice input is unavailable right now.",
          voiceListening: "Listening... speak your request.",
          transferUnavailable: "Transfer is not connected to the API yet. I can help with hotel restaurants or room service now.",
          roomService: "Room service",
          activeRequests: "Active requests",
          activeRequestsHint: "orders and bookings",
          orderDraft: "Order draft",
          orderHistory: "Order history",
          bookingForm: "Table booking",
          quickMenu: "What is on the menu?",
          quickBurger: "I want a burger",
          quickTable: "Reserve a table at 19:00",
          quickTotal: "How much is my order?",
          quickStatus: "Show request status",
          actionDone: "Done",
          actionBusy: "Working...",
          submitDraft: "Send order",
          noActiveRequests: "No active requests yet. I can build a room-service order or reserve a table.",
          orderStatusIntro: "For this reservation I can see:",
          restaurantListIntro: "Available hotel restaurants:",
          draftEmpty: "Your draft has no items yet. Tell me what you want or pick an item from the menu.",
          noConnectedRestaurants: "Restaurants are not connected for this stay yet, but I can build a room-service order from the available menu.",
          servicesUnavailable: "I do not see connected in-stay services for this property yet. Refresh or ask the manager to add menu and restaurants.",
          menuSearchPlaceholder: "Find a dish",
          restaurantSearchPlaceholder: "Find a restaurant",
          showMore: "Show more",
          showLess: "Collapse",
          noMatches: "Nothing found",
        };

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<RoomServiceOrder[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [tableBookings, setTableBookings] = useState<RestaurantBooking[]>([]);
  const [bookingEvents, setBookingEvents] = useState<RestaurantBookingEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [completedActionKeys, setCompletedActionKeys] = useState<Set<string>>(() => new Set());

  const [quantityByItem, setQuantityByItem] = useState<Record<number, number>>({});
  const [deliveryNote, setDeliveryNote] = useState("");

  const [restaurantId, setRestaurantId] = useState<number>(0);
  const [bookingDate, setBookingDate] = useState(() => toIsoDay(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [bookingTime, setBookingTime] = useState("19:00");
  const [bookingGuests, setBookingGuests] = useState(2);
  const [bookingNote, setBookingNote] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ConciergeMessage[]>(() => [
    { role: "assistant", text: postPayment ? text.postPaymentIntro : text.chatIntro },
  ]);
  const [menuQuery, setMenuQuery] = useState("");
  const [restaurantQuery, setRestaurantQuery] = useState("");
  const [showAllMenu, setShowAllMenu] = useState(false);
  const [showAllRestaurants, setShowAllRestaurants] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function isTransientNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = (error.message || "").toLowerCase();
    return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("network error");
  }

  async function refresh() {
    setLoading(true);
    setStatus("");
    try {
      const [menuResult, restaurantResult] = await Promise.allSettled([
        getInStayMenu(listingId),
        getListingRestaurants(listingId, true),
      ]);

      const catalogFailures: string[] = [];
      if (menuResult.status === "fulfilled") {
        setMenu(menuResult.value);
      } else {
        catalogFailures.push("menu");
      }
      if (restaurantResult.status === "fulfilled") {
        setRestaurants(restaurantResult.value);
        if (restaurantResult.value.length > 0 && restaurantId === 0) {
          setRestaurantId(restaurantResult.value[0].id);
        }
      } else {
        catalogFailures.push("restaurants");
      }

      const [orderResult, bookingResult, bookingEventResult] = await Promise.allSettled([
        getRoomServiceOrdersByReservation(reservationId, guestEmail, accessToken),
        getRestaurantBookingsByReservation(reservationId, guestEmail, accessToken),
        getRestaurantBookingEventsByReservation(reservationId, guestEmail, accessToken),
      ]);

      const privateFailures: string[] = [];
      if (orderResult.status === "fulfilled") {
        setOrders(orderResult.value);
      } else {
        privateFailures.push("orders");
      }
      if (bookingResult.status === "fulfilled") {
        setTableBookings(bookingResult.value);
      } else {
        privateFailures.push("bookings");
      }
      if (bookingEventResult.status === "fulfilled") {
        setBookingEvents(bookingEventResult.value);
      } else {
        privateFailures.push("bookingEvents");
      }

      if (catalogFailures.length > 0) setStatus(text.catalogLoadFailed);
      else if (privateFailures.length > 0) setStatus(text.catalogPartialLoad);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [listingId, reservationId, guestEmail, accessToken]);

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      voiceRecognitionRef.current?.abort?.();
      voiceRecognitionRef.current = null;
    };
  }, []);

  const selectedItems = useMemo<RoomServiceOrderItemIn[]>(() => {
    return menu
      .map((item) => ({ menu_item_id: item.id, quantity: quantityByItem[item.id] || 0 }))
      .filter((item) => item.quantity > 0);
  }, [menu, quantityByItem]);

  const menuById = useMemo(() => {
    const map = new Map<number, MenuItem>();
    for (const item of menu) map.set(item.id, item);
    return map;
  }, [menu]);

  const currentDraftTotal = useMemo(() => {
    let total = 0;
    for (const row of selectedItems) {
      const menuItem = menuById.get(row.menu_item_id);
      if (menuItem) total += menuItem.price * row.quantity;
    }
    return total;
  }, [selectedItems, menuById]);
  const serviceSummary = useMemo(() => {
    const activeOrders = orders.filter((order) => ["submitted", "accepted", "preparing"].includes(order.status)).length;
    const activeTableBookings = tableBookings.filter((booking) => ["submitted", "confirmed", "seated"].includes(booking.status)).length;
    return {
      menuCount: menu.length,
      restaurantCount: restaurants.length,
      activeOrders,
      activeTableBookings,
      activeRequests: activeOrders + activeTableBookings,
    };
  }, [menu.length, restaurants.length, orders, tableBookings]);
  const sortedMenuItems = useMemo(() => sortMenuItemsForDisplay(menu), [menu]);
  const sortedRestaurants = useMemo(() => sortRestaurantsForDisplay(restaurants), [restaurants]);
  const normalizedMenuQuery = normalizeSearchText(menuQuery);
  const normalizedRestaurantQuery = normalizeSearchText(restaurantQuery);
  const filteredMenuItems = useMemo(() => {
    if (!normalizedMenuQuery) return sortedMenuItems;
    return sortedMenuItems.filter((item) => matchesSearchQuery(normalizedMenuQuery, `${item.name} ${item.description ?? ""} ${item.category ?? ""}`));
  }, [sortedMenuItems, normalizedMenuQuery]);
  const filteredRestaurants = useMemo(() => {
    if (!normalizedRestaurantQuery) return sortedRestaurants;
    return sortedRestaurants.filter((restaurant) => matchesSearchQuery(normalizedRestaurantQuery, `${restaurant.name} ${restaurant.cuisine ?? ""} ${restaurant.description ?? ""}`));
  }, [sortedRestaurants, normalizedRestaurantQuery]);
  const visibleMenuItems = showAllMenu || normalizedMenuQuery ? filteredMenuItems : filteredMenuItems.slice(0, MENU_PREVIEW_LIMIT);
  const visibleRestaurants = showAllRestaurants || normalizedRestaurantQuery ? filteredRestaurants : filteredRestaurants.slice(0, RESTAURANT_PREVIEW_LIMIT);
  const hiddenMenuCount = Math.max(0, filteredMenuItems.length - visibleMenuItems.length);
  const hiddenRestaurantCount = Math.max(0, filteredRestaurants.length - visibleRestaurants.length);
  const selectedRestaurant = sortedRestaurants.find((row) => row.id === restaurantId) || null;

  async function onCreateRoomOrder() {
    if (selectedItems.length === 0) return;
    setStatus("");
    try {
      await createRoomServiceOrder({
        reservation_id: reservationId,
        guest_email: guestEmail,
        access_token: accessToken,
        items: selectedItems,
        delivery_note: deliveryNote,
      });
      setQuantityByItem({});
      setDeliveryNote("");
      await refresh();
      setStatus(text.roomOrderSent);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed");
    }
  }

  async function createRoomOrderFromChat(itemId: number, quantity: number, note?: string) {
    const item = menuById.get(itemId);
    if (!item) return;
    setStatus("");
    try {
      const order = await createRoomServiceOrder({
        reservation_id: reservationId,
        guest_email: guestEmail,
        access_token: accessToken,
        items: [{ menu_item_id: itemId, quantity }],
        delivery_note: note || "",
      });
      await refresh();
      setStatus(text.roomOrderSent);
      appendAssistant(
        lang === "ru"
          ? `Готово: отправил ${item.name} x${quantity} персоналу. Сумма ${formatPriceFromKzt(order.total_price, currency, lang)}.`
          : `Done: ${item.name} x${quantity} was sent to staff. Total ${formatPriceFromKzt(order.total_price, currency, lang)}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      setStatus(message);
      appendAssistant(message);
    }
  }

  async function createDraftRoomOrderFromChat(note?: string) {
    if (selectedItems.length === 0) {
      appendAssistant(text.draftEmpty);
      return;
    }
    setStatus("");
    try {
      const order = await createRoomServiceOrder({
        reservation_id: reservationId,
        guest_email: guestEmail,
        access_token: accessToken,
        items: selectedItems,
        delivery_note: note || deliveryNote,
      });
      const itemSummary = order.items.map((item) => `${item.item_name} x${item.quantity}`).join(", ");
      setQuantityByItem({});
      setDeliveryNote("");
      await refresh();
      setStatus(text.roomOrderSent);
      appendAssistant(
        lang === "ru"
          ? `Готово: отправил заказ персоналу. ${itemSummary}. Сумма ${formatPriceFromKzt(order.total_price, currency, lang)}.`
          : `Done: order sent to staff. ${itemSummary}. Total ${formatPriceFromKzt(order.total_price, currency, lang)}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      setStatus(message);
      appendAssistant(message);
    }
  }

  async function onCreateTableBooking() {
    if (!restaurantId || !bookingDate) return;
    setStatus("");
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await createRestaurantBooking({
          reservation_id: reservationId,
          restaurant_id: restaurantId,
          guest_email: guestEmail,
          access_token: accessToken,
          booking_date: bookingDate,
          booking_time: bookingTime,
          guests: bookingGuests,
          note: bookingNote,
        });
        setBookingNote("");
        await refresh();
        setStatus(text.tableBooked);
        return;
      } catch (error) {
        const maybeCreatedDespiteNetworkError = async () => {
          try {
            const rows = await getRestaurantBookingsByReservation(reservationId, guestEmail, accessToken);
            const exists = rows.some(
              (row) =>
                row.restaurant_id === restaurantId &&
                row.booking_date === bookingDate &&
                row.booking_time === bookingTime &&
                (row.status === "submitted" || row.status === "confirmed" || row.status === "seated"),
            );
            if (!exists) return false;
            setTableBookings(rows);
            setStatus(text.tableBooked);
            return true;
          } catch {
            return false;
          }
        };

        if (await maybeCreatedDespiteNetworkError()) return;
        if (attempt < 2 && isTransientNetworkError(error)) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          continue;
        }
        setStatus(error instanceof Error ? error.message : "Failed");
        return;
      }
    }
  }

  async function createTableBookingFromChat(action: Extract<ConciergeAction, { type: "book_table" }>) {
    const restaurant = restaurants.find((item) => item.id === action.restaurantId);
    if (!restaurant) return;
    setStatus("");
    try {
      await createRestaurantBooking({
        reservation_id: reservationId,
        restaurant_id: action.restaurantId,
        guest_email: guestEmail,
        access_token: accessToken,
        booking_date: action.bookingDate,
        booking_time: action.bookingTime,
        guests: action.guests,
        note: action.note || "",
      });
      setRestaurantId(action.restaurantId);
      setBookingDate(action.bookingDate);
      setBookingTime(action.bookingTime);
      setBookingGuests(action.guests);
      await refresh();
      setStatus(text.tableBooked);
      appendAssistant(
        lang === "ru"
          ? `Готово: отправил бронь столика в ${restaurant.name} на ${action.bookingDate} в ${action.bookingTime} для ${action.guests} гостей.`
          : `Done: table booking sent to ${restaurant.name} for ${action.bookingDate} at ${action.bookingTime} for ${action.guests} guests.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      setStatus(message);
      appendAssistant(message);
    }
  }

  function toDisplayEventMessage(event: RestaurantBookingEvent): string {
    return getRestaurantBookingEventLabel(lang, event.event_type, event.message);
  }

  function findMenuCandidate(query: string): MenuItem | null {
    const scored = sortedMenuItems
      .map((item) => ({
        item,
        score: scoreSearchText(query, `${item.name} ${item.description ?? ""} ${item.category ?? ""}`),
      }))
      .sort((left, right) => right.score - left.score);

    if (scored[0]?.score >= 10) return scored[0].item;

    const normalized = normalizeSearchText(query);
    const keywordGroups = [
      ["burger", "бургер"],
      ["pizza", "пицца"],
      ["coffee", "кофе"],
      ["breakfast", "завтрак"],
      ["salad", "салат"],
      ["steak", "стейк"],
      ["soup", "суп"],
    ];
    for (const group of keywordGroups) {
      if (!group.some((token) => normalized.includes(token))) continue;
      const found = sortedMenuItems.find((item) =>
        group.some((token) => normalizeSearchText(`${item.name} ${item.description ?? ""} ${item.category ?? ""}`).includes(normalizeSearchText(token))),
      );
      if (found) return found;
    }
    return null;
  }

  function findRestaurantCandidate(query: string): Restaurant | null {
    const scored = sortedRestaurants
      .map((restaurant) => ({
        restaurant,
        score: scoreSearchText(query, `${restaurant.name} ${restaurant.cuisine ?? ""} ${restaurant.description ?? ""}`),
      }))
      .sort((left, right) => right.score - left.score);

    return scored[0]?.score >= 10 ? scored[0].restaurant : null;
  }

  function appendAssistant(textValue: string, action?: ConciergeAction) {
    setChatMessages((prev) => [...prev, { role: "assistant", text: textValue, action }]);
  }

  function toConciergeAction(action?: InStayConciergeAction | null): ConciergeAction | undefined {
    if (!action || action.type === "none") return undefined;
    const label = action.label || text.actionDone;
    if (action.type === "add_item" && action.item_id) {
      return { type: "add_item", itemId: action.item_id, label };
    }
    if (action.type === "submit_room_order" && action.item_id) {
      return {
        type: "submit_room_order",
        itemId: action.item_id,
        quantity: Math.max(1, Math.min(9, action.quantity || 1)),
        note: action.note || undefined,
        label,
      };
    }
    if (action.type === "submit_draft_order") {
      return { type: "submit_draft_order", note: action.note || undefined, label };
    }
    if (action.type === "select_restaurant" && action.restaurant_id) {
      return { type: "select_restaurant", restaurantId: action.restaurant_id, label };
    }
    if (action.type === "book_table" && action.restaurant_id && action.booking_date && action.booking_time) {
      return {
        type: "book_table",
        restaurantId: action.restaurant_id,
        bookingDate: action.booking_date,
        bookingTime: action.booking_time,
        guests: Math.max(1, Math.min(20, action.guests || bookingGuests || 2)),
        note: action.note || undefined,
        label,
      };
    }
    return undefined;
  }

  function applyServerActionPreview(action?: ConciergeAction) {
    if (!action) return;
    if (action.type === "select_restaurant") {
      setRestaurantId(action.restaurantId);
      return;
    }
    if (action.type === "book_table") {
      setRestaurantId(action.restaurantId);
      setBookingDate(action.bookingDate);
      setBookingTime(action.bookingTime);
      setBookingGuests(action.guests);
    }
  }

  function describeMenu(): string {
    if (menu.length === 0) return text.emptyMenu;
    const items = sortedMenuItems.slice(0, 4).map((item) => `• ${item.name} — ${formatPriceFromKzt(item.price, currency, lang)}`);
    return lang === "ru" ? `В меню сейчас:\n${items.join("\n")}` : `Available menu now:\n${items.join("\n")}`;
  }

  function describeRestaurants(): string {
    if (restaurants.length === 0) return menu.length > 0 ? text.noConnectedRestaurants : text.servicesUnavailable;
    const items = sortedRestaurants
      .slice(0, 4)
      .map(
        (restaurant) =>
          `• ${restaurant.name} — ${restaurant.cuisine}, ${text.avgCheck.toLowerCase()}: ${formatPriceFromKzt(restaurant.avg_check_kzt, currency, lang)}`,
      );
    return `${text.restaurantListIntro}\n${items.join("\n")}`;
  }

  function describeRequestStatus(): string {
    const latestOrders = [...orders].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 3);
    const latestTables = [...tableBookings].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 3);
    const latestEvents = [...bookingEvents].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 2);
    const lines: string[] = [];

    for (const order of latestOrders) {
      const itemSummary = order.items.map((item) => `${item.item_name} x${item.quantity}`).join(", ");
      lines.push(
        lang === "ru"
          ? `• Room service #${order.id}: ${roomOrderStatusLabel(lang, order.status)}, ${formatPriceFromKzt(order.total_price, currency, lang)} — ${itemSummary}`
          : `• Room service #${order.id}: ${roomOrderStatusLabel(lang, order.status)}, ${formatPriceFromKzt(order.total_price, currency, lang)} — ${itemSummary}`,
      );
    }

    for (const booking of latestTables) {
      lines.push(
        lang === "ru"
          ? `• Столик #${booking.id}: ${booking.restaurant_name}, ${booking.booking_date} ${booking.booking_time}, ${getRestaurantBookingStatusLabel(lang, booking.status)}`
          : `• Table #${booking.id}: ${booking.restaurant_name}, ${booking.booking_date} ${booking.booking_time}, ${getRestaurantBookingStatusLabel(lang, booking.status)}`,
      );
    }

    for (const event of latestEvents) {
      lines.push(`• ${getRestaurantBookingEventLabel(lang, event.event_type, event.message)} — ${getRestaurantBookingStatusLabel(lang, event.status)}`);
    }

    if (lines.length === 0) return text.noActiveRequests;
    return `${text.orderStatusIntro}\n${lines.join("\n")}`;
  }

  function fallbackTaskMessage(): string {
    if (menu.length > 0 && restaurants.length > 0) {
      return lang === "ru"
        ? "Могу собрать заказ в номер или забронировать столик в ресторане. Что выберем?"
        : "I can build a room-service order or reserve a restaurant table. Which one should we do?";
    }
    if (menu.length > 0) {
      return lang === "ru"
        ? "Рестораны пока не подключены, зато еда в номер доступна. Могу показать меню или добавить блюдо в заказ."
        : "Restaurants are not connected yet, but room service is available. I can show the menu or add an item to your order.";
    }
    if (restaurants.length > 0) {
      return lang === "ru"
        ? "Меню доставки в номер пока недоступно, но могу забронировать столик в ресторане отеля."
        : "Room-service menu is unavailable, but I can reserve a table at the hotel restaurant.";
    }
    return text.servicesUnavailable;
  }

  function actionKey(action: ConciergeAction): string {
    if (action.type === "add_item") return `add-${action.itemId}`;
    if (action.type === "submit_room_order") return `order-${reservationId}-${action.itemId}-${action.quantity}-${action.note || ""}`;
    if (action.type === "submit_draft_order") {
      const draftSignature = selectedItems.map((item) => `${item.menu_item_id}:${item.quantity}`).join("|");
      return `draft-${reservationId}-${draftSignature}-${action.note || deliveryNote}`;
    }
    if (action.type === "select_restaurant") return `restaurant-${action.restaurantId}`;
    return `table-${reservationId}-${action.restaurantId}-${action.bookingDate}-${action.bookingTime}-${action.guests}`;
  }

  function isFinalAction(action: ConciergeAction): boolean {
    return action.type === "submit_room_order" || action.type === "submit_draft_order" || action.type === "book_table";
  }

  async function handleConciergeAction(action: ConciergeAction) {
    const key = actionKey(action);
    if (busyActionKey || (isFinalAction(action) && completedActionKeys.has(key))) return;
    setBusyActionKey(key);
    if (action.type === "add_item") {
      setQuantityByItem((prev) => ({
        ...prev,
        [action.itemId]: Math.max(1, prev[action.itemId] || 0),
      }));
      const item = menuById.get(action.itemId);
      if (item) {
        appendAssistant(
          lang === "ru"
            ? `${item.name} добавил в заказ. Готов отправить персоналу, когда подтвердите.`
            : `${item.name} added to your order. I can submit it once you confirm.`,
        );
      }
      setBusyActionKey(null);
      return;
    }
    try {
      if (action.type === "submit_room_order") {
        await createRoomOrderFromChat(action.itemId, action.quantity, action.note);
        setCompletedActionKeys((prev) => new Set(prev).add(key));
        return;
      }
      if (action.type === "submit_draft_order") {
        await createDraftRoomOrderFromChat(action.note);
        setCompletedActionKeys((prev) => new Set(prev).add(key));
        return;
      }
      if (action.type === "book_table") {
        await createTableBookingFromChat(action);
        setCompletedActionKeys((prev) => new Set(prev).add(key));
        return;
      }
      setRestaurantId(action.restaurantId);
      appendAssistant(
        lang === "ru"
          ? "Выбрал ресторан. Укажите дату и время ниже, затем нажмите «Забронировать столик»."
          : "Restaurant selected. Set date and time below, then tap “Reserve table”.",
      );
    } finally {
      setBusyActionKey(null);
    }
  }

  async function submitConciergeMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || chatLoading) return;
    setChatMessages((prev) => [...prev, { role: "user", text: message }]);
    setChatInput("");

    setChatLoading(true);
    try {
      const response = await askInStayConcierge({
        message,
        lang,
        currency,
        listing_id: listingId,
        reservation_id: reservationId,
        guest_email: guestEmail,
        access_token: accessToken,
        history: chatMessages.slice(-8).map((row) => ({ role: row.role, text: row.text })),
        draft_items: selectedItems.map((item) => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
          name: menuById.get(item.menu_item_id)?.name ?? "",
          unit_price: menuById.get(item.menu_item_id)?.price ?? 0,
        })),
      });
      const action = toConciergeAction(response.action);
      applyServerActionPreview(action);
      appendAssistant(response.answer, action);
    } catch {
      runLocalConciergeMessage(message);
    } finally {
      setChatLoading(false);
    }
  }

  function runLocalConciergeMessage(message: string) {
    const low = message.toLowerCase();
    const menuIntent = ["меню", "блюда", "позиции", "что есть", "menu", "dish", "dishes"].some((token) => low.includes(token));
    const foodIntent = ["еда", "поесть", "бургер", "pizza", "пиц", "food", "order", "закаж", "заказать", "room service"].some((token) => low.includes(token));
    const tableIntent = ["столик", "ресторан", "ужин", "reserve", "table", "restaurant", "тойхана"].some((token) => low.includes(token));
    const restaurantListIntent = /(какие|покажи|список|есть|available|show|list).*(ресторан|restaurant)|\brestaurants\b/i.test(low);
    const statusIntent = /(статус|заявк|истори|где.*заказ|мой заказ|мои заказы|мои.*столик|status|history|request|requests|where.*order)/i.test(low);
    const transferIntent = ["трансфер", "такси", "аэропорт", "transfer", "taxi", "airport", "shuttle"].some((token) => low.includes(token));
    const priceIntent = ["сколько", "цена", "price", "cost", "total"].some((token) => low.includes(token));
    const submitDraftIntent = /(отправ|подтверд|оформи|submit|send|confirm).*(заказ|order)/i.test(low);
    const directFoodOrderIntent = /(закаж|заказать|оформи|принес|достав|order|bring|deliver|send)/i.test(low);
    const directTableBookingIntent = /(заброни|бронь|зарезерв|reserve|book)/i.test(low);

    if (statusIntent) {
      appendAssistant(describeRequestStatus());
      return;
    }

    if (submitDraftIntent && selectedItems.length > 0) {
      appendAssistant(
        lang === "ru"
          ? `В черновике ${selectedItems.length} позиций на ${formatPriceFromKzt(currentDraftTotal, currency, lang)}. Могу отправить заказ персоналу.`
          : `Your draft has ${selectedItems.length} item(s), total ${formatPriceFromKzt(currentDraftTotal, currency, lang)}. I can send it to staff.`,
        {
          type: "submit_draft_order",
          label: text.submitDraft,
          note: message,
        },
      );
      return;
    }

    if (priceIntent && currentDraftTotal > 0) {
      appendAssistant(
        lang === "ru"
          ? `Сейчас в черновике на ${formatPriceFromKzt(currentDraftTotal, currency, lang)}. Готов отправить заказ в номер.`
          : `Your current draft total is ${formatPriceFromKzt(currentDraftTotal, currency, lang)}. I can submit it now.`,
        {
          type: "submit_draft_order",
          label: text.submitDraft,
          note: message,
        },
      );
      return;
    }

    if (transferIntent) {
      appendAssistant(text.transferUnavailable);
      return;
    }

    if (restaurantListIntent && !directTableBookingIntent) {
      const first = sortedRestaurants[0];
      appendAssistant(
        describeRestaurants(),
        first
          ? {
              type: "select_restaurant",
              restaurantId: first.id,
              label: lang === "ru" ? "Выбрать первый ресторан" : "Use first restaurant",
            }
          : undefined,
      );
      return;
    }

    if (menuIntent) {
      if (menu.length > 0) {
        const first = sortedMenuItems[0];
        appendAssistant(describeMenu(), first ? { type: "add_item", itemId: first.id, label: lang === "ru" ? "Добавить первую позицию" : "Add first item" } : undefined);
        return;
      }
      appendAssistant(restaurants.length > 0 ? (lang === "ru" ? "Меню пока недоступно, но могу забронировать столик в ресторане отеля." : "Menu is unavailable, but I can reserve a table at the hotel restaurant.") : text.servicesUnavailable);
      return;
    }

    if (foodIntent) {
      if (menu.length === 0) {
        appendAssistant(
          lang === "ru"
            ? "Сейчас меню недоступно. Если рестораны подключены, могу забронировать столик."
            : "Menu is unavailable right now. If restaurants are connected, I can reserve a table instead.",
          sortedRestaurants[0]
            ? {
                type: "select_restaurant",
                restaurantId: sortedRestaurants[0].id,
                label: lang === "ru" ? "Выбрать ресторан" : "Select restaurant",
              }
            : undefined,
        );
        return;
      }
      const candidate = findMenuCandidate(low);
      if (!candidate) {
        appendAssistant(
          lang === "ru"
            ? `Не вижу такую позицию в меню. ${describeMenu()}`
            : `I do not see that item on the menu. ${describeMenu()}`,
        );
        return;
      }
      const quantity = parseQuantity(low);
      if (directFoodOrderIntent) {
        appendAssistant(
          lang === "ru"
            ? `Нашёл ${candidate.name} — ${formatPriceFromKzt(candidate.price, currency, lang)}. Могу сразу отправить заказ x${quantity} персоналу.`
            : `I found ${candidate.name} — ${formatPriceFromKzt(candidate.price, currency, lang)}. I can send order x${quantity} to staff now.`,
          {
            type: "submit_room_order",
            itemId: candidate.id,
            quantity,
            note: message,
            label: lang === "ru" ? "Отправить заказ" : "Send order",
          },
        );
        return;
      }
      appendAssistant(
        lang === "ru"
          ? `Есть вариант: ${candidate.name} — ${formatPriceFromKzt(candidate.price, currency, lang)}. Добавить в заказ?`
          : `I found this option: ${candidate.name} — ${formatPriceFromKzt(candidate.price, currency, lang)}. Add to order?`,
        {
          type: "add_item",
          itemId: candidate.id,
          label: lang === "ru" ? "Добавить в заказ" : "Add to order",
        },
      );
      return;
    }

    if (tableIntent) {
      if (restaurants.length === 0) {
        appendAssistant(menu.length > 0 ? text.noConnectedRestaurants : text.servicesUnavailable);
        return;
      }
      const explicitRestaurant = findRestaurantCandidate(message);
      const selected = explicitRestaurant ?? selectedRestaurant ?? sortedRestaurants[0];
      const parsedDate = parseBookingDate(message) || bookingDate;
      const parsedTime = parseClockTime(message) || bookingTime || "19:00";
      const parsedGuests = parseGuestCount(message) || bookingGuests || 2;
      setRestaurantId(selected.id);
      setBookingDate(parsedDate);
      setBookingTime(parsedTime);
      setBookingGuests(parsedGuests);
      if (directTableBookingIntent) {
        appendAssistant(
          lang === "ru"
            ? `${explicitRestaurant ? "Нашел ресторан" : "Выберу ресторан"} ${selected.name}: ${parsedDate} в ${parsedTime}, гостей: ${parsedGuests}.`
            : `${explicitRestaurant ? "Found restaurant" : "I will use"} ${selected.name}: ${parsedDate} at ${parsedTime}, guests: ${parsedGuests}.`,
          {
            type: "book_table",
            restaurantId: selected.id,
            bookingDate: parsedDate,
            bookingTime: parsedTime,
            guests: parsedGuests,
            note: lang === "ru" ? "Создано через AI-консьержа" : "Created by AI concierge",
            label: lang === "ru" ? "Забронировать столик" : "Book table",
          },
        );
        return;
      }
      appendAssistant(
        lang === "ru"
          ? `Подойдет ${selected.name}. Средний чек ${formatPriceFromKzt(selected.avg_check_kzt, currency, lang)}. Выбрать его для брони?`
          : `${selected.name} looks good. Average check is ${formatPriceFromKzt(selected.avg_check_kzt, currency, lang)}. Use it for booking?`,
        {
          type: "select_restaurant",
          restaurantId: selected.id,
          label: lang === "ru" ? "Выбрать ресторан" : "Use this restaurant",
        },
      );
      return;
    }

    appendAssistant(fallbackTaskMessage());
  }

  function voiceErrorMessage(error?: string): string {
    if (error === "not-allowed" || error === "service-not-allowed") return text.voiceAllowMic;
    if (error === "no-speech") return text.voiceNoSpeech;
    return text.voiceUnavailable;
  }

  function toggleVoiceInput() {
    if (loading || chatLoading || busyActionKey) return;

    if (voiceListening) {
      voiceRecognitionRef.current?.stop();
      setVoiceListening(false);
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceSupported(false);
      setVoiceError(text.voiceUnsupported);
      return;
    }

    const recognition = new Recognition();
    const baseInput = chatInput.trim();
    recognition.lang = lang === "ru" ? "ru-RU" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      setVoiceError(null);
      setVoiceListening(true);
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      const cleanTranscript = transcript.trim();
      if (cleanTranscript) {
        setChatInput([baseInput, cleanTranscript].filter(Boolean).join(" ").slice(0, 1000));
      }
    };
    recognition.onerror = (event) => {
      setVoiceError(voiceErrorMessage(event.error));
      setVoiceListening(false);
    };
    recognition.onend = () => {
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
    };

    voiceRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setVoiceError(voiceErrorMessage());
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
    }
  }

  function onConciergeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitConciergeMessage(chatInput);
  }

  const quickPrompts = [
    text.quickMenu,
    sortedMenuItems.some((item) => `${item.name} ${item.description}`.toLowerCase().includes("burger") || `${item.name} ${item.description}`.toLowerCase().includes("бургер")) ? text.quickBurger : null,
    restaurants.length > 0 ? text.quickTable : null,
    orders.length > 0 || tableBookings.length > 0 || bookingEvents.length > 0 ? text.quickStatus : null,
    currentDraftTotal > 0 ? text.quickTotal : null,
  ].filter((item): item is string => Boolean(item));

  function restaurantDetailHref(targetRestaurantId: number): string {
    const params = new URLSearchParams({
      lang,
      currency,
    });
    if (reservationId > 0) params.set("reservation_id", String(reservationId));
    if (guestEmail) params.set("guest_email", guestEmail);
    if (accessToken) params.set("access_token", accessToken);
    return `/stays/${listingId}/restaurants/${targetRestaurantId}?${params.toString()}`;
  }

  return (
    <section className="property-detail in-stay-concierge-card" id="in-stay-concierge">
      <div className="in-stay-hero">
        <div>
          <span className="in-stay-kicker">{text.chatKicker}</span>
          <h3>{text.title}</h3>
          <p className="desc">{text.subtitle}</p>
        </div>
        <span className="in-stay-online"><i />{text.online}</span>
      </div>
      <div className="in-stay-service-summary">
        <article>
          <span>{text.roomService}</span>
          <b>{serviceSummary.menuCount}</b>
          <small>{serviceSummary.activeOrders} {lang === "ru" ? "активных заказов" : "active orders"}</small>
        </article>
        <article>
          <span>{text.restaurants}</span>
          <b>{serviceSummary.restaurantCount}</b>
          <small>{serviceSummary.activeTableBookings} {lang === "ru" ? "активных броней" : "active bookings"}</small>
        </article>
        <article>
          <span>{text.activeRequests}</span>
          <b>{serviceSummary.activeRequests}</b>
          <small>{text.activeRequestsHint}</small>
        </article>
      </div>

      <section className="ai-concierge in-stay-chat">
        <div className="in-stay-chat-head">
          <div>
            <h4>{text.chatTitle}</h4>
            <p>{postPayment ? text.postPaymentHeadHint : text.chatHeadHint}</p>
          </div>
          <button type="button" className="ghost-btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? text.actionBusy : text.refresh}
          </button>
        </div>
        <div className="ai-concierge-log in-stay-chat-log" aria-live="polite">
          {chatMessages.map((msg, idx) => {
            const action = msg.action;
            const key = action ? actionKey(action) : "";
            const completed = action ? isFinalAction(action) && completedActionKeys.has(key) : false;
            const busy = Boolean(action && busyActionKey === key);
            return (
            <article key={`${msg.role}-${idx}`} className={`ai-message ai-message-${msg.role}`}>
              <p>{msg.text}</p>
              {msg.role === "assistant" && action ? (
                <div className="in-stay-message-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void handleConciergeAction(action)}
                    disabled={Boolean(busyActionKey) || completed}
                  >
                    {completed ? text.actionDone : busy ? text.actionBusy : action.label}
                  </button>
                </div>
              ) : null}
            </article>
            );
          })}
        </div>
        {quickPrompts.length > 0 ? (
          <div className="in-stay-quick-prompts">
            {quickPrompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => void submitConciergeMessage(prompt)} disabled={chatLoading}>
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
        <form className="ai-concierge-form in-stay-chat-form" onSubmit={onConciergeSubmit}>
          <input suppressHydrationWarning value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder={text.chatPlaceholder} maxLength={1000} />
          <button
            type="button"
            className={`ai-voice-btn${voiceListening ? " is-listening" : ""}`}
            onClick={toggleVoiceInput}
            disabled={loading || chatLoading || Boolean(busyActionKey) || !voiceSupported}
            aria-label={voiceListening ? text.voiceStop : text.voiceInput}
            title={!voiceSupported ? text.voiceUnsupported : voiceListening ? text.voiceStop : text.voiceSpeak}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V6A2.5 2.5 0 0 0 10 3.5Z" />
              <path d="M5.5 9.5v.4a4.5 4.5 0 0 0 9 0v-.4M10 14.5v2M7.5 16.5h5" />
            </svg>
          </button>
          <button type="submit" disabled={loading || chatLoading || Boolean(busyActionKey) || chatInput.trim().length === 0}>
            {chatLoading ? text.actionBusy : text.chatSend}
          </button>
        </form>
        {voiceListening || voiceError ? (
          <p className={`ai-voice-status${voiceError ? " is-error" : ""}`}>{voiceError || text.voiceListening}</p>
        ) : null}
      </section>
      {loading ? <p className="desc">{text.loading}</p> : null}

      <div className="in-stay-workspace">
        <article className="in-stay-panel">
          <div className="in-stay-panel-head">
            <div>
              <h4>{text.roomService}</h4>
              <p>{currentDraftTotal > 0 ? `${text.orderDraft}: ${formatPriceFromKzt(currentDraftTotal, currency, lang)}` : text.emptyOrders}</p>
            </div>
          </div>
          <div className="in-stay-catalog-tools">
            <label className="in-stay-search">
              <input
                suppressHydrationWarning
                type="search"
                value={menuQuery}
                onChange={(e) => {
                  setMenuQuery(e.target.value);
                  setShowAllMenu(false);
                }}
                placeholder={text.menuSearchPlaceholder}
                aria-label={text.menuSearchPlaceholder}
              />
            </label>
            <span className="in-stay-catalog-count">
              {visibleMenuItems.length}/{filteredMenuItems.length || menu.length}
            </span>
          </div>
          <div className="in-stay-menu-list">
            {visibleMenuItems.map((item) => (
              <article key={item.id} className="in-stay-menu-item">
                <div>
                  <b>{item.name}</b>
                  <small>{item.description}</small>
                </div>
                <div className="in-stay-menu-controls">
                  <span>{formatPriceFromKzt(item.price, currency, lang)}</span>
                  <input
                    suppressHydrationWarning
                    aria-label={`${text.quantity}: ${item.name}`}
                    type="number"
                    min={0}
                    max={20}
                    value={quantityByItem[item.id] || 0}
                    onChange={(e) =>
                      setQuantityByItem((prev) => ({
                        ...prev,
                        [item.id]: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
              </article>
            ))}
            {!loading && menu.length === 0 ? <p className="in-stay-empty">{text.emptyMenu}</p> : null}
            {!loading && menu.length > 0 && filteredMenuItems.length === 0 ? <p className="in-stay-empty">{text.noMatches}</p> : null}
          </div>
          {filteredMenuItems.length > MENU_PREVIEW_LIMIT && !normalizedMenuQuery ? (
            <button type="button" className="in-stay-show-more" onClick={() => setShowAllMenu((prev) => !prev)}>
              {showAllMenu ? text.showLess : `${text.showMore} (${hiddenMenuCount})`}
            </button>
          ) : null}
          <label className="field-stack in-stay-note">
            <span>{text.note}</span>
            <input suppressHydrationWarning value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
          </label>
          <button className="in-stay-primary-btn" type="button" onClick={() => void onCreateRoomOrder()} disabled={selectedItems.length === 0}>
            {selectedItems.length > 0 ? `${text.orderNow} · ${formatPriceFromKzt(currentDraftTotal, currency, lang)}` : text.orderNow}
          </button>

          <div className="in-stay-history">
            <h5>{text.orderHistory}</h5>
            {orders.map((order) => (
              <article key={order.id} className="in-stay-history-row">
                <b>#{order.id}</b>
                <span className={roomOrderStatusClass(order.status)}>{roomOrderStatusLabel(lang, order.status)}</span>
                <span>{formatPriceFromKzt(order.total_price, currency, lang)}</span>
                <small>{order.items.map((item) => `${item.item_name} x${item.quantity}`).join(", ")}</small>
                {order.delivery_note ? <small>{order.delivery_note}</small> : null}
              </article>
            ))}
            {orders.length === 0 ? <p className="in-stay-empty">{text.emptyOrders}</p> : null}
          </div>
        </article>

        <article className="in-stay-panel">
          <div className="in-stay-panel-head">
            <div>
              <h4>{text.restaurants}</h4>
              <p>{selectedRestaurant ? `${selectedRestaurant.name} · ${selectedRestaurant.open_from}-${selectedRestaurant.open_to}` : text.emptyRestaurants}</p>
            </div>
          </div>
          <div className="in-stay-catalog-tools">
            <label className="in-stay-search">
              <input
                suppressHydrationWarning
                type="search"
                value={restaurantQuery}
                onChange={(e) => {
                  setRestaurantQuery(e.target.value);
                  setShowAllRestaurants(false);
                }}
                placeholder={text.restaurantSearchPlaceholder}
                aria-label={text.restaurantSearchPlaceholder}
              />
            </label>
            <span className="in-stay-catalog-count">
              {visibleRestaurants.length}/{filteredRestaurants.length || restaurants.length}
            </span>
          </div>
          <div className="in-stay-restaurant-list">
            {visibleRestaurants.map((restaurant) => (
              <article key={restaurant.id} className={`in-stay-restaurant ${restaurant.id === restaurantId ? "active" : ""}`}>
                <div>
                  <b>{restaurant.name}</b>
                  <small>{restaurant.cuisine} · {text.avgCheck}: {formatPriceFromKzt(restaurant.avg_check_kzt, currency, lang)}</small>
                </div>
                <p>{restaurant.description}</p>
                <div className="in-stay-restaurant-actions">
                  <button type="button" onClick={() => setRestaurantId(restaurant.id)}>
                    {text.reserveTable}
                  </button>
                  <Link href={restaurantDetailHref(restaurant.id)}>{text.openRestaurantPage}</Link>
                </div>
              </article>
            ))}
            {!loading && restaurants.length === 0 ? <p className="in-stay-empty">{menu.length > 0 ? text.noConnectedRestaurants : text.servicesUnavailable}</p> : null}
            {!loading && restaurants.length > 0 && filteredRestaurants.length === 0 ? <p className="in-stay-empty">{text.noMatches}</p> : null}
          </div>
          {filteredRestaurants.length > RESTAURANT_PREVIEW_LIMIT && !normalizedRestaurantQuery ? (
            <button type="button" className="in-stay-show-more" onClick={() => setShowAllRestaurants((prev) => !prev)}>
              {showAllRestaurants ? text.showLess : `${text.showMore} (${hiddenRestaurantCount})`}
            </button>
          ) : null}

          <div className="booking-form in-stay-booking-form">
            <h5>{text.bookingForm}</h5>
            <select suppressHydrationWarning value={restaurantId || ""} onChange={(e) => setRestaurantId(Number(e.target.value))} required disabled={restaurants.length === 0}>
              <option value="" disabled>{text.selectRestaurant}</option>
              {sortedRestaurants.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
            <div className="booking-row">
              <label className="field-stack">
                <span>{text.date}</span>
                <input suppressHydrationWarning type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} required />
              </label>
              <label className="field-stack">
                <span>{text.time}</span>
                <input suppressHydrationWarning type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} required />
              </label>
            </div>
            <label className="field-stack">
              <span>{text.guests}</span>
              <input suppressHydrationWarning type="number" min={1} max={20} value={bookingGuests} onChange={(e) => setBookingGuests(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
            </label>
            <label className="field-stack">
              <span>{text.note}</span>
              <input suppressHydrationWarning value={bookingNote} onChange={(e) => setBookingNote(e.target.value)} />
            </label>
            <button type="button" onClick={() => void onCreateTableBooking()} disabled={!restaurantId || !bookingDate}>
              {text.reserveTable}
            </button>
          </div>

          <div className="in-stay-history">
            <h5>{text.tableBookings}</h5>
            {tableBookings.map((booking) => (
              <article key={booking.id} className="in-stay-history-row">
                <b>{booking.restaurant_name}</b>
                <span className={`status-pill ${getRestaurantBookingStatusClass(booking.status)}`}>
                  {getRestaurantBookingStatusLabel(lang, booking.status)}
                </span>
                <small>{booking.booking_date} {booking.booking_time} · {text.guests}: {booking.guests}</small>
              </article>
            ))}
            {tableBookings.length === 0 ? <p className="in-stay-empty">{text.emptyBookings}</p> : null}
          </div>

          <div className="in-stay-history">
            <h5>{text.tableBookingUpdates}</h5>
            {bookingEvents.map((event) => (
              <article key={event.id} className="in-stay-history-row">
                <b>{toDisplayEventMessage(event)}</b>
                <span className={`status-pill ${getRestaurantBookingStatusClass(event.status)}`}>
                  {getRestaurantBookingStatusLabel(lang, event.status)}
                </span>
                <small>{formatRestaurantBookingEventDateTime(lang, event.created_at)}</small>
              </article>
            ))}
            {bookingEvents.length === 0 ? <p className="in-stay-empty">{text.emptyBookingUpdates}</p> : null}
          </div>
        </article>
      </div>
      {status ? <p className="form-status in-stay-status-message" aria-live="polite">{status}</p> : null}
    </section>
  );
}
