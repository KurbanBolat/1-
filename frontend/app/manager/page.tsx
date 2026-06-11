"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import StayPilotShell from "../../components/StayPilotShell";
import ManagerCommunicationsSection from "../../components/manager/ManagerCommunicationsSection";
import ManagerInStaySection from "../../components/manager/ManagerInStaySection";
import ManagerAvailabilitySection from "../../components/manager/ManagerAvailabilitySection";
import ManagerNotificationsSection from "../../components/manager/ManagerNotificationsSection";
import ManagerReservationsSection from "../../components/manager/ManagerReservationsSection";
import ManagerRoomTypesSection from "../../components/manager/ManagerRoomTypesSection";
import ManagerSupportTicketsSection from "../../components/manager/ManagerSupportTicketsSection";

import {
  createInStayMenuItem,
  createRestaurant,
  createListing,
  deleteListing,
  deleteListingPhoto,
  getInStayMenuForListing,
  getListingBlocks,
  getListingPhotos,
  getListingRestaurants,
  getListingRoomTypes,
  getMyListings,
  getPartnerCommunicationEvents,
  getPartnerNotifications,
  getPartnerAbSummary,
  getPartnerOpsSummary,
  getPartnerFunnelSummary,
  getPartnerRestaurantBookingEvents,
  getPartnerRestaurantBookings,
  getPartnerRoomServiceOrders,
  getPartnerReservations,
  getReservationCancellationTerms,
  getSupportTickets,
  markPartnerNotificationsRead,
  partnerCancelReservation,
  partnerConfirmReservation,
  reorderListingPhotos,
  retryPartnerCommunicationEvent,
  retryPartnerCommunicationEventsBatch,
  setListingCoverPhoto,
  setListingsActiveBulk,
  type CancellationTerms,
  type Listing,
  type ListingBlock,
  type ListingPayload,
  type ListingPhoto,
  type MenuItem,
  type MenuItemPayload,
  type PartnerOpsSummary,
  type PartnerFunnelSummary,
  type PartnerCommunicationBatchRetryResult,
  type PartnerCommunicationEvent,
  type PartnerAbSummary,
  type PartnerNotification,
  type PartnerReservation,
  type Restaurant,
  type RestaurantBooking,
  type RestaurantBookingEvent,
  type RestaurantPayload,
  type RoomType,
  type RoomServiceOrder,
  type SupportTicket,
  uploadListingPhoto,
  updateInStayMenuItem,
  updateListing,
  updateRestaurant,
  updateRestaurantBookingStatus,
  updateRoomServiceOrderStatus,
  updateSupportTicketStatus,
} from "../../lib/api";

type FormState = ListingPayload;

const initialForm: FormState = {
  title: "",
  city: "",
  district: "",
  property_type: "apartment",
  nightly_price: 25000,
  cleaning_fee: 7000,
  service_fee_percent: 10,
  cancellation_policy: "flexible",
  rating: 4.7,
  max_guests: 2,
  bedrooms: 1,
  bathrooms: 1,
  amenities: "WiFi,Kitchen",
  description: "",
  is_active: true,
};
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const disabledFlagValues = new Set(["0", "false", "off", "no"]);

function featureEnabled(value: string | undefined, fallback: boolean = true): boolean {
  if (value === undefined) return fallback;
  return !disabledFlagValues.has(value.toLowerCase());
}

const managerFeatures = {
  trend: featureEnabled(process.env.NEXT_PUBLIC_FEATURE_MANAGER_TREND, true),
  notifications: featureEnabled(process.env.NEXT_PUBLIC_FEATURE_MANAGER_NOTIFICATIONS, true),
  reservations: featureEnabled(process.env.NEXT_PUBLIC_FEATURE_MANAGER_RESERVATIONS, true),
};

function reservationStatusLabel(status: PartnerReservation["status"]): string {
  if (status === "draft") return "Черновик";
  if (status === "pending_payment") return "Ожидает оплаты";
  if (status === "confirmed") return "Подтверждено";
  if (status === "checked_in") return "Заезд";
  if (status === "checked_out") return "Выезд завершен";
  if (status === "expired") return "Истекла";
  return "Отменено";
}

function reservationStatusClass(status: PartnerReservation["status"]): string {
  if (status === "draft" || status === "pending_payment") return "status-pill status-pending";
  if (status === "confirmed" || status === "checked_in") return "status-pill status-confirmed";
  return "status-pill status-cancelled";
}

export default function ManagerPage() {
  type ManagerTab = "listings" | "reservations" | "communications" | "instay" | "support";
  const [lang, setLang] = useState<"en" | "ru">("ru");
  const [currency, setCurrency] = useState<"USD" | "KZT">("KZT");
  const [token, setToken] = useState("");
  const [items, setItems] = useState<Listing[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [blocks, setBlocks] = useState<ListingBlock[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [photos, setPhotos] = useState<ListingPhoto[]>([]);
  const [dragPhotoId, setDragPhotoId] = useState<number | null>(null);
  const [reservations, setReservations] = useState<PartnerReservation[]>([]);
  const [editingReservations, setEditingReservations] = useState<PartnerReservation[]>([]);
  const [notifications, setNotifications] = useState<PartnerNotification[]>([]);
  const [communicationEvents, setCommunicationEvents] = useState<PartnerCommunicationEvent[]>([]);
  const [communicationBatchResult, setCommunicationBatchResult] = useState<PartnerCommunicationBatchRetryResult | null>(null);
  const [communicationRefreshState, setCommunicationRefreshState] = useState<"idle" | "scheduled" | "loading">("idle");
  const [communicationChannelFilter, setCommunicationChannelFilter] = useState<"all" | "webhook" | "email" | "telegram">("all");
  const [communicationStatusFilter, setCommunicationStatusFilter] = useState<"all" | "sent" | "failed" | "skipped">("all");
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [supportPriorityFilter, setSupportPriorityFilter] = useState<"all" | "low" | "medium" | "high">("all");
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<PartnerOpsSummary | null>(null);
  const [funnel, setFunnel] = useState<PartnerFunnelSummary | null>(null);
  const [abSummary, setAbSummary] = useState<PartnerAbSummary | null>(null);
  const [summaryPeriodDays, setSummaryPeriodDays] = useState<7 | 30 | 90>(30);
  const [reservationStatusFilter, setReservationStatusFilter] = useState<"all" | "draft" | "pending_payment" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired">("all");
  const [reservationPaymentFilter, setReservationPaymentFilter] = useState<"all" | "pending" | "paid" | "failed" | "refunded">("all");
  const [reservationListingFilter, setReservationListingFilter] = useState<"all" | number>("all");
  const [reservationGuestQuery, setReservationGuestQuery] = useState("");
  const [reservationCheckInFrom, setReservationCheckInFrom] = useState("");
  const [reservationCheckOutTo, setReservationCheckOutTo] = useState("");
  const [cancellationTermsByReservation, setCancellationTermsByReservation] = useState<Record<number, CancellationTerms>>({});
  const [trendMetric, setTrendMetric] = useState<"revenue" | "reservations" | "cancellations">("revenue");
  const [trendExpanded, setTrendExpanded] = useState(false);
  const [inStayListingId, setInStayListingId] = useState<number | null>(null);
  const [inStayMenuItems, setInStayMenuItems] = useState<MenuItem[]>([]);
  const [inStayRestaurants, setInStayRestaurants] = useState<Restaurant[]>([]);
  const [inStayRestaurantBookings, setInStayRestaurantBookings] = useState<RestaurantBooking[]>([]);
  const [inStayRestaurantBookingEvents, setInStayRestaurantBookingEvents] = useState<RestaurantBookingEvent[]>([]);
  const [inStayOrders, setInStayOrders] = useState<RoomServiceOrder[]>([]);
  const [inStayTableBookingStatusFilter, setInStayTableBookingStatusFilter] = useState<"all" | "submitted" | "confirmed" | "seated" | "completed" | "cancelled">("all");
  const [inStayOrderStatusFilter, setInStayOrderStatusFilter] = useState<"all" | "submitted" | "accepted" | "preparing" | "delivered" | "closed" | "cancelled">("all");
  const [inStayMenuDraft, setInStayMenuDraft] = useState<MenuItemPayload>({
    name: "",
    description: "",
    price: 2500,
    category: "food",
    is_active: true,
    sort_order: 0,
  });
  const [inStayRestaurantDraft, setInStayRestaurantDraft] = useState<RestaurantPayload>({
    name: "",
    cuisine: "",
    description: "",
    open_from: "08:00",
    open_to: "23:00",
    avg_check_kzt: 8000,
    is_active: true,
  });
  const [listingQuery, setListingQuery] = useState("");
  const [listingStateFilter, setListingStateFilter] = useState<"all" | "active" | "hidden">("all");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [managerTab, setManagerTab] = useState<ManagerTab>("listings");
  const communicationRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLang(params.get("lang") === "en" ? "en" : "ru");
    setCurrency(params.get("currency") === "USD" ? "USD" : "KZT");
  }, []);

  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      try {
        const response = await fetch(`${API_URL}/auth/session`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!active) return;
        setToken(response.ok ? "cookie" : "");
      } catch {
        if (!active) return;
        setToken("");
      }
    };
    void checkSession();
    return () => {
      active = false;
    };
  }, []);

  async function loadListings(currentToken: string) {
    if (!currentToken) return;
    setLoading(true);
    try {
      const list = await getMyListings(currentToken);
      setItems(list);
      setSelectedIds((prev) => prev.filter((id) => list.some((x) => x.id === id)));
      setInStayListingId((prev) => {
        if (list.length === 0) return null;
        if (prev && list.some((x) => x.id === prev)) return prev;
        return list[0].id;
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить объекты");
    } finally {
      setLoading(false);
    }
  }

  async function loadInStayMenu(currentToken: string, listingId: number | null) {
    if (!currentToken || !listingId) {
      setInStayMenuItems([]);
      return;
    }
    try {
      const rows = await getInStayMenuForListing(listingId, false);
      setInStayMenuItems(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить меню in-stay");
    }
  }

  async function loadInStayRestaurants(currentToken: string, listingId: number | null) {
    if (!currentToken || !listingId) {
      setInStayRestaurants([]);
      return;
    }
    try {
      const rows = await getListingRestaurants(listingId, false);
      setInStayRestaurants(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить рестораны объекта");
    }
  }

  async function loadInStayOrders(currentToken: string) {
    if (!currentToken) return;
    try {
      const rows = await getPartnerRoomServiceOrders(currentToken, {
        status: inStayOrderStatusFilter === "all" ? undefined : inStayOrderStatusFilter,
      });
      setInStayOrders(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить заказы room service");
    }
  }

  async function loadInStayRestaurantBookings(currentToken: string) {
    if (!currentToken) return;
    try {
      const rows = await getPartnerRestaurantBookings(currentToken, {
        status: inStayTableBookingStatusFilter === "all" ? undefined : inStayTableBookingStatusFilter,
      });
      setInStayRestaurantBookings(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить брони столиков");
    }
  }

  async function loadInStayRestaurantBookingEvents(currentToken: string) {
    if (!currentToken) return;
    try {
      const rows = await getPartnerRestaurantBookingEvents(currentToken);
      setInStayRestaurantBookingEvents(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить уведомления по столикам");
    }
  }

  async function loadReservations(currentToken: string) {
    if (!currentToken) return;
    try {
      const rows = await getPartnerReservations(currentToken, {
        status: reservationStatusFilter === "all" ? undefined : reservationStatusFilter,
        payment_status: reservationPaymentFilter === "all" ? undefined : reservationPaymentFilter,
        listing_id: reservationListingFilter === "all" ? undefined : reservationListingFilter,
        guest_query: reservationGuestQuery.trim() || undefined,
        check_in_from: reservationCheckInFrom || undefined,
        check_out_to: reservationCheckOutTo || undefined,
      });
      setReservations(rows);
      setCancellationTermsByReservation((prev) => {
        const next: Record<number, CancellationTerms> = {};
        for (const row of rows) {
          if (prev[row.id]) next[row.id] = prev[row.id];
        }
        return next;
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить бронирования");
    }
  }

  async function loadSummary(currentToken: string) {
    if (!currentToken) return;
    try {
      const data = await getPartnerOpsSummary(currentToken, summaryPeriodDays);
      setSummary(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить метрики кабинета");
    }
  }

  async function loadFunnel(currentToken: string) {
    if (!currentToken) return;
    try {
      const data = await getPartnerFunnelSummary(currentToken, summaryPeriodDays);
      setFunnel(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить AI-воронку");
    }
  }

  async function loadAbSummary(currentToken: string) {
    if (!currentToken) return;
    try {
      const data = await getPartnerAbSummary(currentToken, summaryPeriodDays);
      setAbSummary(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить A/B метрики");
    }
  }

  async function loadNotifications(currentToken: string) {
    if (!currentToken) return;
    try {
      const rows = await getPartnerNotifications(currentToken, 60);
      setNotifications(rows);
      setReadNotificationIds(rows.filter((item) => item.read).map((item) => item.event_id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить уведомления");
    }
  }

  async function loadCommunicationEvents(currentToken: string) {
    if (!currentToken) return;
    setCommunicationRefreshState("loading");
    try {
      const rows = await getPartnerCommunicationEvents(currentToken, {
        limit: 80,
        channel: communicationChannelFilter === "all" ? undefined : communicationChannelFilter,
        status: communicationStatusFilter === "all" ? undefined : communicationStatusFilter,
      });
      setCommunicationEvents(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить лог коммуникаций");
    } finally {
      setCommunicationRefreshState("idle");
    }
  }

  function scheduleCommunicationEventsReload(currentToken: string, delayMs = 350) {
    if (!currentToken) return;
    if (communicationRefreshTimerRef.current) {
      clearTimeout(communicationRefreshTimerRef.current);
    }
    setCommunicationRefreshState("scheduled");
    communicationRefreshTimerRef.current = setTimeout(() => {
      communicationRefreshTimerRef.current = null;
      void loadCommunicationEvents(currentToken);
    }, delayMs);
  }

  async function onRetryCommunicationEvent(eventId: string) {
    if (!token) return;
    try {
      const out = await retryPartnerCommunicationEvent(token, eventId);
      setCommunicationBatchResult(null);
      setStatus(
        `Retry ${out.previous_event.channel}: ${out.previous_event.status} -> ${out.retried_event.status}`,
      );
      scheduleCommunicationEventsReload(token);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось повторить отправку");
    }
  }

  async function onRetryFailedCommunicationEvents(eventIds: string[]) {
    if (!token || eventIds.length === 0) return;
    try {
      const out = await retryPartnerCommunicationEventsBatch(token, eventIds);
      setCommunicationBatchResult(out);
      setStatus(`Batch retry done: success ${out.retried}, failed ${out.failed}`);
      scheduleCommunicationEventsReload(token);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось выполнить batch retry");
    }
  }

  async function onRetryOnlyFailedFromLastBatch(eventIds: string[]) {
    if (!token || eventIds.length === 0) return;
    try {
      const out = await retryPartnerCommunicationEventsBatch(token, eventIds);
      setCommunicationBatchResult(out);
      setStatus(`Last batch retry: success ${out.retried}, failed ${out.failed}`);
      scheduleCommunicationEventsReload(token);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось повторить failed из последнего batch");
    }
  }

  async function loadSupportTickets(currentToken: string) {
    if (!currentToken) return;
    try {
      const rows = await getSupportTickets(currentToken, {
        priority: supportPriorityFilter === "all" ? undefined : supportPriorityFilter,
      });
      setSupportTickets(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить тикеты поддержки");
    }
  }

  useEffect(() => {
    void loadListings(token);
    void loadSummary(token);
    void loadFunnel(token);
    void loadAbSummary(token);
    void loadNotifications(token);
    void loadSupportTickets(token);
  }, [token, summaryPeriodDays, supportPriorityFilter]);

  useEffect(() => {
    void loadCommunicationEvents(token);
  }, [token, communicationChannelFilter, communicationStatusFilter]);

  useEffect(() => {
    void loadReservations(token);
  }, [token, reservationStatusFilter, reservationPaymentFilter, reservationListingFilter, reservationGuestQuery, reservationCheckInFrom, reservationCheckOutTo]);

  useEffect(() => {
    void loadInStayMenu(token, inStayListingId);
  }, [token, inStayListingId]);

  useEffect(() => {
    void loadInStayRestaurants(token, inStayListingId);
  }, [token, inStayListingId]);

  useEffect(() => {
    void loadInStayOrders(token);
  }, [token, inStayOrderStatusFilter]);

  useEffect(() => {
    void loadInStayRestaurantBookings(token);
  }, [token, inStayTableBookingStatusFilter]);

  useEffect(() => {
    void loadInStayRestaurantBookingEvents(token);
  }, [token]);

  useEffect(() => {
    return () => {
      if (communicationRefreshTimerRef.current) {
        clearTimeout(communicationRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editingId) return;
    const scrollTimer = window.setTimeout(() => {
      editorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(scrollTimer);
  }, [editingId]);

  const title = useMemo(() => (editingId ? `Редактирование #${editingId}` : "Новый объект"), [editingId]);
  const editingListing = useMemo(() => items.find((item) => item.id === editingId) ?? null, [items, editingId]);
  const activeRoomTypesCount = useMemo(() => roomTypes.filter((room) => room.is_active).length, [roomTypes]);
  const activeRoomInventory = useMemo(
    () => roomTypes.filter((room) => room.is_active).reduce((sum, room) => sum + room.total_inventory, 0),
    [roomTypes],
  );
  const activeEditingReservations = useMemo(
    () => editingReservations.filter((reservation) => !["cancelled", "expired"].includes(reservation.status)).length,
    [editingReservations],
  );
  const paidEditingReservations = useMemo(
    () => editingReservations.filter((reservation) => reservation.payment_status === "paid").length,
    [editingReservations],
  );
  const orderedPhotos = useMemo(
    () => [...photos].sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort_order - b.sort_order),
    [photos],
  );
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const stateOk =
        listingStateFilter === "all" ||
        (listingStateFilter === "active" && item.is_active) ||
        (listingStateFilter === "hidden" && !item.is_active);
      const q = listingQuery.trim().toLowerCase();
      const queryOk =
        q.length === 0 ||
        item.title.toLowerCase().includes(q) ||
        item.city.toLowerCase().includes(q) ||
        item.district.toLowerCase().includes(q) ||
        String(item.id).includes(q);
      return stateOk && queryOk;
    });
  }, [items, listingQuery, listingStateFilter]);
  const filteredInStayOrders = useMemo(() => {
    if (!inStayListingId) return inStayOrders;
    return inStayOrders.filter((order) => order.listing_id === inStayListingId);
  }, [inStayOrders, inStayListingId]);
  const filteredInStayRestaurantBookings = useMemo(() => {
    if (!inStayListingId) return inStayRestaurantBookings;
    return inStayRestaurantBookings.filter((booking) => booking.listing_id === inStayListingId);
  }, [inStayRestaurantBookings, inStayListingId]);
  const filteredInStayRestaurantBookingEvents = useMemo(() => {
    if (!inStayListingId) return inStayRestaurantBookingEvents;
    return inStayRestaurantBookingEvents.filter((event) => event.listing_id === inStayListingId);
  }, [inStayRestaurantBookingEvents, inStayListingId]);
  const unreadNotificationCount = useMemo(
    () => notifications.filter((x) => !readNotificationIds.includes(x.event_id)).length,
    [notifications, readNotificationIds],
  );
  const slaSummary = useMemo(() => {
    const pendingReservations = reservations.filter((row) => row.status === "pending_payment").length;
    const failedCommunications = communicationEvents.filter((event) => event.status === "failed").length;
    const highPriorityTicketsOpen = supportTickets.filter(
      (ticket) => ticket.priority === "high" && ticket.status !== "resolved",
    ).length;
    const waitingRestaurantBookings = inStayRestaurantBookings.filter(
      (booking) => booking.status === "submitted",
    ).length;
    const waitingRoomService = inStayOrders.filter(
      (order) => order.status === "submitted" || order.status === "accepted",
    ).length;
    const criticalCount =
      pendingReservations +
      failedCommunications +
      highPriorityTicketsOpen +
      waitingRestaurantBookings +
      waitingRoomService;
    return {
      pendingReservations,
      failedCommunications,
      highPriorityTicketsOpen,
      waitingRestaurantBookings,
      waitingRoomService,
      criticalCount,
    };
  }, [reservations, communicationEvents, supportTickets, inStayRestaurantBookings, inStayOrders]);
  const dailyChart = useMemo(() => {
    const rows = summary?.daily_stats ?? [];
    const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));
    const maxReservations = Math.max(1, ...rows.map((row) => row.reservations));
    const maxCancellations = Math.max(1, ...rows.map((row) => row.cancellations));
    const metricMax =
      trendMetric === "revenue"
        ? maxRevenue
        : trendMetric === "reservations"
          ? maxReservations
          : maxCancellations;
    return rows.map((row) => ({
      ...row,
      metricValue:
        trendMetric === "revenue"
          ? row.revenue
          : trendMetric === "reservations"
            ? row.reservations
            : row.cancellations,
      metricHeight: Math.max(8, Math.round(((trendMetric === "revenue"
        ? row.revenue
        : trendMetric === "reservations"
          ? row.reservations
          : row.cancellations) / metricMax) * 100)),
      reservationsWidth: Math.max(10, Math.round((row.reservations / maxReservations) * 100)),
      cancellationsWidth: Math.max(10, Math.round((row.cancellations / maxCancellations) * 100)),
      dateLabel: row.date.slice(5),
    }));
  }, [summary, trendMetric]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function loadBlocks(currentToken: string, listingId: number) {
    try {
      const rows = await getListingBlocks(listingId, currentToken);
      setBlocks(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить блокировки");
    }
  }

  async function loadPhotos(currentToken: string, listingId: number) {
    try {
      const rows = await getListingPhotos(listingId, currentToken);
      setPhotos(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить фото");
    }
  }

  async function loadRoomTypes(currentToken: string, listingId: number) {
    try {
      const rows = await getListingRoomTypes(listingId, currentToken);
      setRoomTypes(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить типы номеров");
    }
  }

  async function loadEditingReservations(currentToken: string, listingId: number) {
    try {
      const rows = await getPartnerReservations(currentToken, { listing_id: listingId });
      setEditingReservations(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить бронирования объекта");
    }
  }

  function startEdit(item: Listing) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      city: item.city,
      district: item.district,
      property_type: item.property_type,
      nightly_price: item.nightly_price,
      cleaning_fee: item.cleaning_fee,
      service_fee_percent: item.service_fee_percent,
      cancellation_policy: item.cancellation_policy,
      rating: item.rating,
      max_guests: item.max_guests,
      bedrooms: item.bedrooms,
      bathrooms: item.bathrooms,
      amenities: item.amenities,
      description: item.description,
      is_active: item.is_active,
    });
    setRoomTypes([]);
    setPhotos([]);
    setEditingReservations([]);
    if (token) {
      void loadBlocks(token, item.id);
      void loadRoomTypes(token, item.id);
      void loadPhotos(token, item.id);
      void loadEditingReservations(token, item.id);
    }
  }

  function resetForm() {
    setEditingId(null);
    setForm(initialForm);
    setBlocks([]);
    setRoomTypes([]);
    setPhotos([]);
    setEditingReservations([]);
  }

  function toggleSelect(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  }

  function selectAll() {
    setSelectedIds(filteredItems.map((x) => x.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setStatus("Сохранение...");

    try {
      if (editingId) {
        await updateListing(editingId, form, token);
        setStatus(`Объект #${editingId} обновлен`);
      } else {
        const created = await createListing(form, token);
        setStatus(`Объект #${created.id} создан`);
      }
      await loadListings(token);
      await loadReservations(token);
      await loadSummary(token);
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка сохранения");
    }
  }

  async function onBulkStatus(nextActive: boolean) {
    if (!token || selectedIds.length === 0) return;
    setStatus("Обновление статусов...");
    try {
      await setListingsActiveBulk(selectedIds, nextActive, token);
      await loadListings(token);
      await loadReservations(token);
      await loadSummary(token);
      setStatus(nextActive ? "Выбранные объекты активированы" : "Выбранные объекты скрыты");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка обновления статусов");
    }
  }

  async function onDelete(id: number) {
    if (!token) return;
    if (!confirm(`Удалить объект #${id}?`)) return;
    setStatus(`Удаление #${id}...`);
    try {
      await deleteListing(id, token);
      await loadListings(token);
      await loadReservations(token);
      await loadSummary(token);
      setStatus(`Объект #${id} удален`);
      if (editingId === id) resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка удаления");
    }
  }

  async function onUploadPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !editingId) return;
    const formData = new FormData(event.currentTarget);
    const files = formData.getAll("photo").filter((x): x is File => x instanceof File && x.size > 0);
    if (files.length === 0) {
      setStatus("Выберите изображение для загрузки");
      return;
    }
    if (files.length > 10) {
      setStatus("Можно загрузить максимум 10 фото за раз");
      return;
    }
    setStatus("Загрузка фото...");
    try {
      for (const file of files) {
        await uploadListingPhoto(editingId, file, token);
      }
      await loadPhotos(token, editingId);
      event.currentTarget.reset();
      setStatus(`Загружено фото: ${files.length}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка загрузки фото");
    }
  }

  async function onSetCoverPhoto(photoId: number) {
    if (!token || !editingId) return;
    setStatus("Обновление обложки...");
    try {
      await setListingCoverPhoto(editingId, photoId, token);
      await loadPhotos(token, editingId);
      setStatus("Обложка обновлена");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка обновления обложки");
    }
  }

  async function onDeletePhoto(photoId: number) {
    if (!token || !editingId) return;
    setStatus("Удаление фото...");
    try {
      await deleteListingPhoto(editingId, photoId, token);
      await loadPhotos(token, editingId);
      setStatus("Фото удалено");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка удаления фото");
    }
  }

  async function onMovePhoto(photoId: number, direction: "left" | "right") {
    if (!token || !editingId) return;
    const index = orderedPhotos.findIndex((x) => x.id === photoId);
    if (index < 0) return;
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= orderedPhotos.length) return;
    const copy = [...orderedPhotos];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;
    setStatus("Сохранение порядка фото...");
    try {
      const reordered = await reorderListingPhotos(editingId, copy.map((x) => x.id), token);
      setPhotos(reordered);
      setStatus("Порядок фото обновлен");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка изменения порядка фото");
    }
  }

  async function onDropPhoto(targetPhotoId: number) {
    if (!token || !editingId || dragPhotoId === null || dragPhotoId === targetPhotoId) {
      setDragPhotoId(null);
      return;
    }
    const sourceIndex = orderedPhotos.findIndex((x) => x.id === dragPhotoId);
    const targetIndex = orderedPhotos.findIndex((x) => x.id === targetPhotoId);
    if (sourceIndex < 0 || targetIndex < 0) {
      setDragPhotoId(null);
      return;
    }

    const copy = [...orderedPhotos];
    const [moved] = copy.splice(sourceIndex, 1);
    copy.splice(targetIndex, 0, moved);

    setStatus("Сохранение порядка фото...");
    try {
      const reordered = await reorderListingPhotos(editingId, copy.map((x) => x.id), token);
      setPhotos(reordered);
      setStatus("Порядок фото обновлен");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка drag&drop сортировки");
    } finally {
      setDragPhotoId(null);
    }
  }

  async function onPartnerCancelReservation(reservation: PartnerReservation) {
    if (!token) return;
    let terms: CancellationTerms | undefined = cancellationTermsByReservation[reservation.id];
    if (!terms) {
      try {
        terms = await getReservationCancellationTerms(reservation.id);
        setCancellationTermsByReservation((prev) => ({ ...prev, [reservation.id]: terms as CancellationTerms }));
      } catch {
        terms = undefined;
      }
    }
    const previewText = terms
      ? `\nШтраф: ${money(terms.penalty_amount)} (${terms.penalty_percent}%)\nК возврату: ${money(terms.refund_amount)}\nДней до заезда: ${terms.days_before_check_in}`
      : "";
    if (!confirm(`Отменить бронирование #${reservation.id}?${previewText}`)) return;
    setStatus(`Отмена бронирования #${reservation.id}...`);
    try {
      const result = await partnerCancelReservation(reservation.id, token);
      setCancellationTermsByReservation((prev) => ({ ...prev, [reservation.id]: result.cancellation_terms }));
      await loadReservations(token);
      await loadSummary(token);
      if (editingId) {
        await loadEditingReservations(token, editingId);
      }
      setStatus(
        `Бронирование #${reservation.id} отменено. Штраф: ${money(result.cancellation_terms.penalty_amount)}, к возврату: ${money(result.cancellation_terms.refund_amount)}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка отмены бронирования");
    }
  }

  async function onPartnerConfirmReservation(reservationId: number) {
    if (!token) return;
    setStatus(`Подтверждение бронирования #${reservationId}...`);
    try {
      await partnerConfirmReservation(reservationId, token);
      await loadReservations(token);
      await loadSummary(token);
      if (editingId) {
        await loadEditingReservations(token, editingId);
      }
      setStatus(`Бронирование #${reservationId} подтверждено`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка подтверждения бронирования");
    }
  }

  async function onSetSupportTicketStatus(ticketId: number, nextStatus: "open" | "in_progress" | "resolved") {
    if (!token) return;
    setStatus(`Обновление тикета #${ticketId}...`);
    try {
      await updateSupportTicketStatus(ticketId, nextStatus, token);
      await loadSupportTickets(token);
      setStatus(`Тикет #${ticketId} обновлен`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить тикет");
    }
  }

  function onInStayMenuDraftChange<K extends keyof MenuItemPayload>(key: K, value: MenuItemPayload[K]) {
    setInStayMenuDraft((prev) => ({ ...prev, [key]: value }));
  }

  function onInStayRestaurantDraftChange<K extends keyof RestaurantPayload>(key: K, value: RestaurantPayload[K]) {
    setInStayRestaurantDraft((prev) => ({ ...prev, [key]: value }));
  }

  function resolveInStayListingId(): number | null {
    if (inStayListingId) return inStayListingId;
    if (items.length > 0) return items[0].id;
    return null;
  }

  async function onCreateInStayMenuItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const listingId = resolveInStayListingId();
    if (!token || !listingId) return;
    setStatus("Добавление блюда в меню...");
    try {
      await createInStayMenuItem(listingId, inStayMenuDraft, token);
      await loadInStayMenu(token, listingId);
      setInStayMenuDraft({
        name: "",
        description: "",
        price: 2500,
        category: inStayMenuDraft.category || "food",
        is_active: true,
        sort_order: 0,
      });
      setStatus("Позиция меню добавлена");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось добавить позицию меню");
    }
  }

  async function onToggleInStayMenuItem(item: MenuItem) {
    if (!token) return;
    setStatus(`Обновление меню #${item.id}...`);
    try {
      await updateInStayMenuItem(
        item.id,
        {
          name: item.name,
          description: item.description,
          price: item.price,
          category: item.category,
          is_active: !item.is_active,
          sort_order: item.sort_order,
        },
        token,
      );
      await loadInStayMenu(token, inStayListingId);
      setStatus(`Меню #${item.id} обновлено`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить позицию меню");
    }
  }

  async function onUpdateInStayMenuItem(item: MenuItem, payload: MenuItemPayload) {
    if (!token) return;
    setStatus(`Сохранение меню #${item.id}...`);
    try {
      await updateInStayMenuItem(item.id, payload, token);
      await loadInStayMenu(token, inStayListingId);
      setStatus(`Меню #${item.id} сохранено`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить позицию меню");
    }
  }

  async function onCreateInStayRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const listingId = resolveInStayListingId();
    if (!token || !listingId) return;
    setStatus("Добавление ресторана...");
    try {
      await createRestaurant(listingId, inStayRestaurantDraft, token);
      await loadInStayRestaurants(token, listingId);
      setInStayRestaurantDraft({
        name: "",
        cuisine: "",
        description: "",
        open_from: "08:00",
        open_to: "23:00",
        avg_check_kzt: 8000,
        is_active: true,
      });
      setStatus("Ресторан добавлен");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось добавить ресторан");
    }
  }

  async function onToggleInStayRestaurant(item: Restaurant) {
    if (!token) return;
    setStatus(`Обновление ресторана #${item.id}...`);
    try {
      await updateRestaurant(
        item.id,
        {
          name: item.name,
          cuisine: item.cuisine,
          description: item.description,
          open_from: item.open_from,
          open_to: item.open_to,
          avg_check_kzt: item.avg_check_kzt,
          is_active: !item.is_active,
        },
        token,
      );
      await loadInStayRestaurants(token, inStayListingId);
      setStatus(`Ресторан #${item.id} обновлен`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить ресторан");
    }
  }

  async function onUpdateInStayRestaurant(item: Restaurant, payload: RestaurantPayload) {
    if (!token) return;
    setStatus(`Сохранение ресторана #${item.id}...`);
    try {
      await updateRestaurant(item.id, payload, token);
      await loadInStayRestaurants(token, inStayListingId);
      setStatus(`Ресторан #${item.id} сохранен`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить ресторан");
    }
  }

  async function onUpdateInStayOrderStatus(orderId: number, nextStatus: RoomServiceOrder["status"]) {
    if (!token) return;
    setStatus(`Обновление заказа #${orderId}...`);
    try {
      const updated = await updateRoomServiceOrderStatus(orderId, nextStatus, token);
      setInStayOrders((prev) => prev.map((order) => (order.id === updated.id ? updated : order)));
      await loadInStayOrders(token);
      setStatus(`Статус заказа #${orderId} обновлен`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить статус заказа");
    }
  }

  async function onUpdateInStayRestaurantBookingStatus(
    bookingId: number,
    nextStatus: RestaurantBooking["status"],
  ) {
    if (!token) return;
    setStatus(`Обновление брони столика #${bookingId}...`);
    try {
      const updated = await updateRestaurantBookingStatus(bookingId, nextStatus, token);
      setInStayRestaurantBookings((prev) => prev.map((booking) => (booking.id === updated.id ? updated : booking)));
      await loadInStayRestaurantBookings(token);
      await loadInStayRestaurantBookingEvents(token);
      setStatus(`Статус брони столика #${bookingId} обновлен`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить статус брони столика");
    }
  }

  if (!token) {
    return (
      <StayPilotShell lang={lang} currency={currency}>
        <div className="sp-manager-page sp-manager-locked">
          <article className="property-detail sp-manager-locked-card">
            <span className="sp-manager-kicker">Партнерский кабинет</span>
            <h1>Кабинет партнера</h1>
            <p className="desc">Для доступа нужен подтвержденный вход партнера.</p>
            <Link href={`/login?lang=${lang}&currency=${currency}`} className="stay-link-btn">
              Перейти к логину
            </Link>
          </article>
        </div>
      </StayPilotShell>
    );
  }

  const money = (value: number) =>
    new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(value);

  async function markNotificationRead(eventId: string) {
    if (readNotificationIds.includes(eventId)) return;
    if (!token) return;
    const previous = readNotificationIds;
    setReadNotificationIds([...readNotificationIds, eventId]);
    try {
      await markPartnerNotificationsRead(token, [eventId]);
      await loadNotifications(token);
    } catch (error) {
      setReadNotificationIds(previous);
      setStatus(error instanceof Error ? error.message : "Не удалось отметить уведомление");
    }
  }

  async function markAllNotificationsRead() {
    if (!token) return;
    const eventIds = notifications.map((x) => x.event_id);
    const previous = readNotificationIds;
    setReadNotificationIds(eventIds);
    try {
      await markPartnerNotificationsRead(token, eventIds);
      await loadNotifications(token);
    } catch (error) {
      setReadNotificationIds(previous);
      setStatus(error instanceof Error ? error.message : "Не удалось отметить уведомления");
    }
  }

  async function onLogout() {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setToken("");
      if (typeof window !== "undefined") {
        window.location.href = `/login?lang=${lang}&currency=${currency}`;
      }
    }
  }
  const trendMetricLabel =
    trendMetric === "revenue" ? "Выручка" : trendMetric === "reservations" ? "Брони" : "Отмены";

  function exportTrendCsv() {
    const rows = summary?.daily_stats ?? [];
    if (rows.length === 0) {
      setStatus("Нет данных для экспорта CSV");
      return;
    }

    const csvHeader = "date,revenue_kzt,reservations,cancellations,selected_metric,selected_value";
    const csvRows = rows.map((row) => {
      const selectedValue =
        trendMetric === "revenue"
          ? row.revenue.toFixed(2)
          : trendMetric === "reservations"
            ? String(row.reservations)
            : String(row.cancellations);
      return [
        row.date,
        row.revenue.toFixed(2),
        String(row.reservations),
        String(row.cancellations),
        trendMetric,
        selectedValue,
      ].join(",");
    });

    const csvContent = [csvHeader, ...csvRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `findapart-trend-${summary?.period_days ?? summaryPeriodDays}d-${trendMetric}-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatus("CSV экспортирован");
  }

  return (
    <StayPilotShell lang={lang} currency={currency} layout="workspace">
      <div className="sp-manager-page">
      <section className="manager-grid">
        <article className="property-detail">
          <span className="sp-manager-kicker">Партнерский кабинет</span>
          <h1>Кабинет партнера</h1>
          <button type="button" className="ghost-btn" style={{ maxWidth: 180, marginBottom: 10 }} onClick={onLogout}>
            Выйти из кабинета
          </button>
          <p className="desc">Публичная витрина показывает только объявления, добавленные здесь.</p>
          <p className="desc">{loading ? "Загрузка..." : `Моих объектов: ${items.length}`}</p>
          {status ? <p className="form-status">{status}</p> : null}

          <section className="manager-ops-grid">
            <article className="manager-ops-card">
              <b>{summary?.arrivals_today ?? 0}</b>
              <span>Заезды сегодня</span>
            </article>
            <article className="manager-ops-card">
              <b>{summary?.departures_today ?? 0}</b>
              <span>Выезды сегодня</span>
            </article>
            <article className="manager-ops-card">
              <b>{summary?.active_stays_today ?? 0}</b>
              <span>Проживают сейчас</span>
            </article>
            <article className="manager-ops-card">
              <b>{summary?.cancellations_period ?? 0}</b>
              <span>Отмен за период</span>
            </article>
          </section>

          <section className="manager-funnel manager-sla-panel">
            <div className="manager-funnel-head">
              <h3>SLA-контроль</h3>
              <span>{slaSummary.criticalCount} задач требуют внимания</span>
            </div>
            <div className="manager-funnel-grid manager-sla-grid">
              <article className="manager-funnel-card">
                <span>Ожидают оплаты</span>
                <b>{slaSummary.pendingReservations}</b>
                <small>Брони в статусе pending_payment</small>
              </article>
              <article className="manager-funnel-card">
                <span>Ошибка коммуникаций</span>
                <b>{slaSummary.failedCommunications}</b>
                <small>Webhook/Email/Telegram со статусом failed</small>
              </article>
              <article className="manager-funnel-card">
                <span>Критичные тикеты</span>
                <b>{slaSummary.highPriorityTicketsOpen}</b>
                <small>High priority, не закрытые</small>
              </article>
              <article className="manager-funnel-card">
                <span>Новые заказы in-stay</span>
                <b>{slaSummary.waitingRoomService}</b>
                <small>Room service: submitted/accepted</small>
              </article>
              <article className="manager-funnel-card">
                <span>Новые брони столиков</span>
                <b>{slaSummary.waitingRestaurantBookings}</b>
                <small>Restaurant booking: submitted</small>
              </article>
            </div>
          </section>

          <section className="manager-fin-grid">
            <article className="manager-fin-card">
              <span>Броней за период</span>
              <b>{summary?.reservations_period ?? 0}</b>
            </article>
            <article className="manager-fin-card">
              <span>Выручка за период</span>
              <b>{money(summary?.revenue_period ?? 0)}</b>
            </article>
            <article className="manager-fin-card">
              <span>ADR за период</span>
              <b>{money(summary?.adr_period ?? 0)}</b>
            </article>
            <article className="manager-fin-card">
              <span>Загрузка за период</span>
              <b>{(summary?.occupancy_period ?? 0).toFixed(1)}%</b>
            </article>
          </section>

          <section className="manager-funnel">
            <div className="manager-funnel-head">
              <h3>AI-воронка</h3>
              <span>За {funnel?.period_days ?? summaryPeriodDays} дней</span>
            </div>
            <div className="manager-funnel-grid">
              {(funnel?.steps ?? []).map((step) => (
                <article key={step.event_name} className="manager-funnel-card">
                  <span>{step.label}</span>
                  <b>{step.count}</b>
                  <small>Конверсия от chat_open: {step.conversion_from_open.toFixed(1)}%</small>
                </article>
              ))}
              {!(funnel?.steps?.length) ? <p className="desc">Пока нет данных по AI-воронке.</p> : null}
            </div>
          </section>

          <section className="manager-funnel manager-ab-funnel">
            <div className="manager-funnel-head">
              <h3>A/B конверсия</h3>
              <span>За {abSummary?.period_days ?? summaryPeriodDays} дней</span>
            </div>
            <div className="manager-funnel-grid manager-ab-grid">
              {(abSummary?.variants ?? []).map((variant) => (
                <article key={variant.variant} className="manager-funnel-card manager-ab-card">
                  <span>Вариант {variant.variant}</span>
                  <b>{variant.paid_from_exposed.toFixed(1)}%</b>
                  <small>Оплат от показа: {variant.paid}/{variant.exposed}</small>
                  <small>CTR: {variant.ctr_from_exposed.toFixed(1)}%</small>
                  <small>Checkout: {variant.checkout_from_exposed.toFixed(1)}%</small>
                </article>
              ))}
              {!(abSummary?.variants?.length) ? <p className="desc">Пока нет данных по A/B.</p> : null}
            </div>
          </section>

          {managerFeatures.trend ? (
            <section className="manager-trend">
              <div className="manager-collapsible-head">
                <div className="manager-trend-head">
                  <h3>Динамика бронирований</h3>
                  <div className="manager-trend-head-actions">
                    <span>За {summary?.period_days ?? summaryPeriodDays} дней</span>
                    <button type="button" className="ghost-btn manager-trend-export" onClick={exportTrendCsv}>
                      Export CSV
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="ghost-btn manager-collapse-toggle"
                  onClick={() => setTrendExpanded((prev) => !prev)}
                  aria-expanded={trendExpanded}
                >
                  {trendExpanded ? "Свернуть" : "Развернуть"}
                </button>
              </div>
              {!trendExpanded ? null : (
                <>
                  <div className="manager-trend-toggle">
                    <button
                      type="button"
                      className={`ghost-btn ${trendMetric === "revenue" ? "active" : ""}`}
                      onClick={() => setTrendMetric("revenue")}
                    >
                      Выручка
                    </button>
                    <button
                      type="button"
                      className={`ghost-btn ${trendMetric === "reservations" ? "active" : ""}`}
                      onClick={() => setTrendMetric("reservations")}
                    >
                      Брони
                    </button>
                    <button
                      type="button"
                      className={`ghost-btn ${trendMetric === "cancellations" ? "active" : ""}`}
                      onClick={() => setTrendMetric("cancellations")}
                    >
                      Отмены
                    </button>
                  </div>
                  <div className="manager-trend-legend">
                    <span className={`metric-dot metric-${trendMetric}`} />
                    <small>{trendMetricLabel} (столбцы)</small>
                    <span className="metric-line" />
                    <small>{trendMetric === "cancellations" ? "Относительный уровень отмен" : "Относительный уровень бронирований"}</small>
                  </div>
                  <div className="manager-trend-chart">
                    {dailyChart.map((item) => (
                      <article
                        key={item.date}
                        className="manager-trend-col"
                        title={`${item.date} | Выручка: ${money(item.revenue)} | Брони: ${item.reservations} | Отмены: ${item.cancellations}`}
                        data-tip={`${item.date} • Выручка ${money(item.revenue)} • Брони ${item.reservations} • Отмены ${item.cancellations}`}
                      >
                        <div className="manager-trend-bar-wrap">
                          <div className={`manager-trend-bar metric-${trendMetric}`} style={{ height: `${item.metricHeight}%` }} />
                        </div>
                        <div className="manager-trend-meta">
                          <span>{item.dateLabel}</span>
                          <small>
                            {trendMetric === "revenue"
                              ? money(item.metricValue)
                              : `${item.metricValue} ${trendMetric === "reservations" ? "бр." : "отм."}`}
                          </small>
                        </div>
                        <div className="manager-trend-line">
                          <b
                            style={{
                              width: `${trendMetric === "cancellations" ? item.cancellationsWidth : item.reservationsWidth}%`,
                            }}
                          />
                        </div>
                      </article>
                    ))}
                    {dailyChart.length === 0 ? <p className="desc">Пока нет данных по динамике.</p> : null}
                  </div>
                </>
              )}
            </section>
          ) : null}

          <div ref={editorPanelRef} className={`manager-editor-panel ${editingId ? "is-editing" : ""}`} id="manager-editor">
          <div className="manager-editor-head">
            <div>
              <span className="sp-manager-kicker">{editingId ? "Выбранный объект" : "Новый объект"}</span>
              <h3>{title}</h3>
              <p className="desc">
                {editingListing
                  ? `${editingListing.title} · ${editingListing.city}, ${editingListing.district}`
                  : "Заполните карточку объекта, затем добавьте категории номеров и доступность."}
              </p>
            </div>
            {editingListing ? (
              <span className={`status-pill ${editingListing.is_active ? "status-confirmed" : "status-cancelled"}`}>
                {editingListing.is_active ? "Активно" : "Скрыто"}
              </span>
            ) : null}
          </div>

          {editingId ? (
            <>
              <div className="manager-editor-summary" aria-label="Сводка выбранного объекта">
                <span>
                  <b>{activeRoomTypesCount}</b>
                  Категорий
                </span>
                <span>
                  <b>{activeRoomInventory}</b>
                  Номеров в продаже
                </span>
                <span>
                  <b>{activeEditingReservations}</b>
                  Активных броней
                </span>
                <span>
                  <b>{paidEditingReservations}</b>
                  Оплачено
                </span>
              </div>
              <nav className="manager-editor-nav" aria-label="Разделы объекта">
                <a href="#manager-object-data">Данные</a>
                <a href="#manager-room-types">Номера</a>
                <a href="#manager-availability">Доступность</a>
                <a href="#manager-photos">Фото</a>
              </nav>
            </>
          ) : null}

          <h3 id="manager-object-data" className="manager-editor-subtitle">Данные объекта</h3>
          <form className="booking-form" onSubmit={onSubmit}>
            <input value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="Название" required />
            <div className="booking-row">
              <input value={form.city} onChange={(e) => setField("city", e.target.value)} placeholder="Город" required />
              <input value={form.district} onChange={(e) => setField("district", e.target.value)} placeholder="Район" required />
            </div>
            <div className="booking-row">
              <input value={form.property_type} onChange={(e) => setField("property_type", e.target.value)} placeholder="Тип (apartment/studio)" required />
              <input
                type="number"
                min={0}
                step="0.1"
                value={form.rating}
                onChange={(e) => setField("rating", Number(e.target.value))}
                placeholder="Рейтинг"
                required
              />
            </div>
            <div className="booking-row">
              <input
                type="number"
                min={1}
                value={form.nightly_price}
                onChange={(e) => setField("nightly_price", Number(e.target.value))}
                placeholder="Цена за ночь"
                required
              />
              <input
                type="number"
                min={0}
                value={form.cleaning_fee}
                onChange={(e) => setField("cleaning_fee", Number(e.target.value))}
                placeholder="Уборка"
                required
              />
            </div>
            <div className="booking-row">
              <input
                type="number"
                min={0}
                max={50}
                value={form.service_fee_percent}
                onChange={(e) => setField("service_fee_percent", Number(e.target.value))}
                placeholder="Сервис %"
                required
              />
              <input
                value={form.cancellation_policy}
                onChange={(e) => setField("cancellation_policy", e.target.value)}
                placeholder="Политика отмены"
                required
              />
            </div>
            <div className="booking-row">
              <input type="number" min={1} value={form.max_guests} onChange={(e) => setField("max_guests", Number(e.target.value))} placeholder="Макс. гостей" required />
              <input type="number" min={0} value={form.bedrooms} onChange={(e) => setField("bedrooms", Number(e.target.value))} placeholder="Спальни" required />
            </div>
            <div className="booking-row">
              <input type="number" min={0} value={form.bathrooms} onChange={(e) => setField("bathrooms", Number(e.target.value))} placeholder="Ванные" required />
              <label>
                Активно
                <input type="checkbox" checked={form.is_active} onChange={(e) => setField("is_active", e.target.checked)} />
              </label>
            </div>
            <input value={form.amenities} onChange={(e) => setField("amenities", e.target.value)} placeholder="Удобства через запятую" required />
            <textarea value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Описание" rows={4} />
            <button type="submit">{editingId ? "Сохранить изменения" : "Добавить объявление"}</button>
            {editingId ? (
              <button type="button" className="ghost-btn" onClick={resetForm}>
                Отменить редактирование
              </button>
            ) : null}
          </form>

          {editingId ? (
            <ManagerRoomTypesSection
              listing={editingListing}
              token={token}
              items={roomTypes}
              onItemsChange={setRoomTypes}
              onStatus={setStatus}
            />
          ) : null}

          {editingId ? (
            <ManagerAvailabilitySection
              listing={editingListing}
              token={token}
              roomTypes={roomTypes}
              blocks={blocks}
              onBlocksChange={setBlocks}
              onStatus={setStatus}
            />
          ) : null}

          {editingId ? (
            <section className="manager-photos">
              <h3 id="manager-photos">Фото объекта</h3>
              <form className="booking-form" onSubmit={onUploadPhoto}>
                <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" multiple required />
                <button type="submit">Загрузить фото</button>
              </form>
              <p className="desc">Перетаскивай карточки мышкой: первая станет обложкой.</p>
              <div className="manager-photo-grid">
                {orderedPhotos.map((photo) => (
                  <article
                    key={photo.id}
                    className={`manager-photo-item ${dragPhotoId === photo.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={() => setDragPhotoId(photo.id)}
                    onDragEnd={() => setDragPhotoId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => void onDropPhoto(photo.id)}
                  >
                    <img src={`${API_URL}${photo.file_url}`} alt={`Фото ${photo.id}`} />
                    <div className="manager-photo-actions">
                      <div className="manager-photo-order">
                        <button type="button" className="ghost-btn" onClick={() => onMovePhoto(photo.id, "left")}>
                          {"<-"} Влево
                        </button>
                        <button type="button" className="ghost-btn" onClick={() => onMovePhoto(photo.id, "right")}>
                          Вправо {"->"}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => onSetCoverPhoto(photo.id)}
                        disabled={photo.is_cover}
                      >
                        {photo.is_cover ? "Обложка" : "Сделать обложкой"}
                      </button>
                      <button type="button" className="ghost-btn" onClick={() => onDeletePhoto(photo.id)}>
                        Удалить
                      </button>
                    </div>
                  </article>
                ))}
                {photos.length === 0 ? <p className="desc">Пока нет фото. Добавьте минимум одно.</p> : null}
              </div>
            </section>
          ) : null}
          </div>
        </article>

        <aside className="property-detail">
          <h3>Мои объекты</h3>
          <div className="view-toggle manager-tab-strip">
            <button type="button" className={`view-toggle-btn ${managerTab === "listings" ? "active" : ""}`} onClick={() => setManagerTab("listings")}>
              Объекты
            </button>
            {managerFeatures.reservations ? (
              <button type="button" className={`view-toggle-btn ${managerTab === "reservations" ? "active" : ""}`} onClick={() => setManagerTab("reservations")}>
                Брони
              </button>
            ) : null}
            <button type="button" className={`view-toggle-btn ${managerTab === "communications" ? "active" : ""}`} onClick={() => setManagerTab("communications")}>
              Коммуникации
            </button>
            <button type="button" className={`view-toggle-btn ${managerTab === "instay" ? "active" : ""}`} onClick={() => setManagerTab("instay")}>
              In-stay
            </button>
            <button type="button" className={`view-toggle-btn ${managerTab === "support" ? "active" : ""}`} onClick={() => setManagerTab("support")}>
              Поддержка
            </button>
          </div>

          {managerTab === "communications" ? (
            <>
              {managerFeatures.notifications ? (
                <ManagerNotificationsSection
                  unreadCount={unreadNotificationCount}
                  notifications={notifications}
                  readNotificationIds={readNotificationIds}
                  onRefresh={() => void loadNotifications(token)}
                  onMarkAllRead={markAllNotificationsRead}
                  onMarkRead={markNotificationRead}
                  money={money}
                  defaultExpanded
                />
              ) : null}
              <ManagerCommunicationsSection
                events={communicationEvents}
                channelFilter={communicationChannelFilter}
                statusFilter={communicationStatusFilter}
                onChannelFilterChange={setCommunicationChannelFilter}
                onStatusFilterChange={setCommunicationStatusFilter}
                onRefresh={() => void loadCommunicationEvents(token)}
                onRetryEvent={(eventId) => void onRetryCommunicationEvent(eventId)}
                onRetryFailedFiltered={(eventIds) => void onRetryFailedCommunicationEvents(eventIds)}
                onRetryFailedFromLastBatch={(eventIds) => void onRetryOnlyFailedFromLastBatch(eventIds)}
                lastBatchResult={communicationBatchResult}
                refreshState={communicationRefreshState}
                defaultExpanded
              />
            </>
          ) : null}

          {managerTab === "support" ? (
            <ManagerSupportTicketsSection
              tickets={supportTickets}
              priorityFilter={supportPriorityFilter}
              onPriorityFilterChange={setSupportPriorityFilter}
              onRefresh={() => void loadSupportTickets(token)}
              onSetStatus={(ticketId, status) => void onSetSupportTicketStatus(ticketId, status)}
              defaultExpanded
            />
          ) : null}

          {managerTab === "instay" ? (
            <ManagerInStaySection
              listings={items}
              selectedListingId={inStayListingId}
              onSelectListing={setInStayListingId}
              menuItems={inStayMenuItems}
              restaurants={inStayRestaurants}
              restaurantBookings={filteredInStayRestaurantBookings}
              restaurantBookingEvents={filteredInStayRestaurantBookingEvents}
              orderItems={filteredInStayOrders}
              tableBookingStatusFilter={inStayTableBookingStatusFilter}
              orderStatusFilter={inStayOrderStatusFilter}
              onTableBookingStatusFilterChange={setInStayTableBookingStatusFilter}
              onOrderStatusFilterChange={setInStayOrderStatusFilter}
              menuDraft={inStayMenuDraft}
              restaurantDraft={inStayRestaurantDraft}
              onMenuDraftChange={onInStayMenuDraftChange}
              onRestaurantDraftChange={onInStayRestaurantDraftChange}
              onCreateMenuItem={(event) => void onCreateInStayMenuItem(event)}
              onCreateRestaurant={(event) => void onCreateInStayRestaurant(event)}
              onUpdateMenuItem={(item, payload) => void onUpdateInStayMenuItem(item, payload)}
              onUpdateRestaurant={(item, payload) => void onUpdateInStayRestaurant(item, payload)}
              onToggleMenuItem={(item) => void onToggleInStayMenuItem(item)}
              onToggleRestaurant={(item) => void onToggleInStayRestaurant(item)}
              onRefresh={() => {
                void loadInStayMenu(token, inStayListingId);
                void loadInStayRestaurants(token, inStayListingId);
                void loadInStayRestaurantBookings(token);
                void loadInStayRestaurantBookingEvents(token);
                void loadInStayOrders(token);
              }}
              onUpdateRestaurantBookingStatus={(bookingId, nextStatus) => void onUpdateInStayRestaurantBookingStatus(bookingId, nextStatus)}
              onUpdateOrderStatus={(orderId, nextStatus) => void onUpdateInStayOrderStatus(orderId, nextStatus)}
            />
          ) : null}

          {managerTab === "listings" ? (
            <>
              <div className="booking-form">
                <input
                  value={listingQuery}
                  onChange={(e) => setListingQuery(e.target.value)}
                  placeholder="Поиск по ID, названию, городу"
                />
                <select
                  value={listingStateFilter}
                  onChange={(e) => setListingStateFilter(e.target.value as "all" | "active" | "hidden")}
                >
                  <option value="all">Все статусы</option>
                  <option value="active">Только активные</option>
                  <option value="hidden">Только скрытые</option>
                </select>
              </div>
              <div className="manager-toolbar">
                <button type="button" className="ghost-btn" onClick={selectAll}>Выделить все</button>
                <button type="button" className="ghost-btn" onClick={clearSelection}>Снять выделение</button>
                <button type="button" className="ghost-btn" onClick={() => onBulkStatus(true)} disabled={selectedIds.length === 0}>Активировать</button>
                <button type="button" className="ghost-btn" onClick={() => onBulkStatus(false)} disabled={selectedIds.length === 0}>Скрыть</button>
              </div>
              <p className="desc">Показано: {filteredItems.length} из {items.length}</p>
              <div className="manager-list manager-listings">
                {filteredItems.map((item) => (
                  <article key={item.id} className={`manager-item ${editingId === item.id ? "is-editing" : ""}`}>
                    <div className="manager-item-head">
                      <label className="manager-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={(e) => toggleSelect(item.id, e.target.checked)}
                        />
                        <span>#{item.id}</span>
                      </label>
                      <div className="manager-item-actions">
                        <button type="button" className="ghost-btn" onClick={() => startEdit(item)}>Редактировать</button>
                        <button type="button" className="ghost-btn" onClick={() => onDelete(item.id)}>Удалить</button>
                      </div>
                    </div>
                    <b>{item.title}</b>
                    <div className="manager-item-meta">
                      <span>{item.city}, {item.district}</span>
                      <span>{item.nightly_price} KZT / ночь</span>
                    </div>
                    <span className={`status-pill ${editingId === item.id || item.is_active ? "status-confirmed" : "status-cancelled"}`}>
                      {editingId === item.id ? "Редактируется" : item.is_active ? "Активно" : "Скрыто"}
                    </span>
                  </article>
                ))}
                {items.length === 0 ? <p className="desc">Пока нет объектов. Добавьте первый вариант.</p> : null}
                {items.length > 0 && filteredItems.length === 0 ? (
                  <p className="desc">По текущим фильтрам объектов не найдено.</p>
                ) : null}
              </div>
            </>
          ) : null}

          {managerTab === "reservations" && managerFeatures.reservations ? (
            <ManagerReservationsSection
              lang={lang}
              currency={currency}
              items={items}
              reservations={reservations}
              summary={summary}
              summaryPeriodDays={summaryPeriodDays}
              setSummaryPeriodDays={setSummaryPeriodDays}
              reservationStatusFilter={reservationStatusFilter}
              setReservationStatusFilter={setReservationStatusFilter}
              reservationPaymentFilter={reservationPaymentFilter}
              setReservationPaymentFilter={setReservationPaymentFilter}
              reservationListingFilter={reservationListingFilter}
              setReservationListingFilter={setReservationListingFilter}
              reservationGuestQuery={reservationGuestQuery}
              setReservationGuestQuery={setReservationGuestQuery}
              reservationCheckInFrom={reservationCheckInFrom}
              setReservationCheckInFrom={setReservationCheckInFrom}
              reservationCheckOutTo={reservationCheckOutTo}
              setReservationCheckOutTo={setReservationCheckOutTo}
              onApplyFilters={() => void loadReservations(token)}
              onResetFilters={() => {
                setReservationStatusFilter("all");
                setReservationPaymentFilter("all");
                setReservationListingFilter("all");
                setReservationGuestQuery("");
                setReservationCheckInFrom("");
                setReservationCheckOutTo("");
              }}
              cancellationTermsByReservation={cancellationTermsByReservation}
              onPartnerCancelReservation={(reservation) => void onPartnerCancelReservation(reservation)}
              onPartnerConfirmReservation={onPartnerConfirmReservation}
              reservationStatusLabel={reservationStatusLabel}
              reservationStatusClass={reservationStatusClass}
              money={money}
              defaultExpanded
            />
          ) : null}
        </aside>
      </section>
      </div>
    </StayPilotShell>
  );
}
