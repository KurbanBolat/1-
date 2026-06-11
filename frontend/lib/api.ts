export type Listing = {
  id: number;
  title: string;
  city: string;
  district: string;
  property_type: string;
  nightly_price: number;
  cleaning_fee: number;
  service_fee_percent: number;
  cancellation_policy: string;
  rating: number;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  amenities: string;
  description: string;
  is_active: boolean;
  owner_id: number | null;
  cover_photo_url?: string | null;
};

export type ListingList = {
  items: Listing[];
  total: number;
  page: number;
  page_size: number;
};

export type Reservation = {
  id: number;
  listing_id: number;
  room_type_id?: number | null;
  room_type_name?: string | null;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  check_in: string;
  check_out: string;
  guests: number;
  tariff_plan: "basic" | "smart" | "flex";
  total_price: number;
  status: "draft" | "pending_payment" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired";
  access_token?: string | null;
};

export type CancellationTerms = {
  days_before_check_in: number;
  penalty_percent: number;
  penalty_amount: number;
  refund_amount: number;
  refundable: boolean;
  reason: string;
};

export type ReservationCancelResult = Reservation & {
  cancellation_terms: CancellationTerms;
};

export type PartnerReservation = Reservation & {
  listing_title: string;
  city: string;
  district: string;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  payment_method: "card" | "kaspi" | "apple_pay" | null;
};

export type ReservationPayment = {
  reservation_id: number;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  payment_method: "card" | "kaspi" | "apple_pay" | null;
  amount: number;
  currency: string;
  attempted_at: string | null;
  updated_at: string;
  attempt_status?: "pending" | "paid" | "failed" | null;
  reservation_status?: "draft" | "pending_payment" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired";
  idempotency_reused?: boolean;
};

export type PartnerNotification = {
  event_id: string;
  event: string;
  created_at: string;
  partner_email: string;
  partner_id: number;
  listing_id: number;
  listing_title: string;
  reservation_id: number;
  check_in: string;
  check_out: string;
  guests: number;
  total_price: number;
  currency: string;
  status: "draft" | "pending_payment" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired";
  read?: boolean;
};

export type PartnerCommunicationEvent = {
  event_id: string;
  created_at: string;
  channel: "webhook" | "email" | "telegram";
  event: string;
  reservation_id: number | null;
  listing_id: number | null;
  listing_title: string | null;
  status: "sent" | "failed" | "skipped";
  reason: string;
  attempts: number;
  retry_applied: boolean;
};

export type PartnerCommunicationRetryResult = {
  previous_event: PartnerCommunicationEvent;
  retried_event: PartnerCommunicationEvent;
};

export type PartnerCommunicationBatchRetryItem = {
  event_id: string;
  success: boolean;
  error: string | null;
  previous_event: PartnerCommunicationEvent | null;
  retried_event: PartnerCommunicationEvent | null;
};

export type PartnerCommunicationBatchRetryResult = {
  requested: number;
  retried: number;
  failed: number;
  items: PartnerCommunicationBatchRetryItem[];
};

export type SupportTicket = {
  id: number;
  source: string;
  status: "open" | "in_progress" | "resolved";
  priority: "low" | "medium" | "high";
  topic: "payment" | "refund" | "complaint" | "other";
  lang: string;
  message: string;
  reservation_id: number | null;
  listing_id: number | null;
  city: string | null;
  check_in: string | null;
  check_out: string | null;
  guests: number | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
};

export type MenuItem = {
  id: number;
  listing_id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  is_active: boolean;
  sort_order: number;
};

export type RoomServiceOrderItemIn = {
  menu_item_id: number;
  quantity: number;
  note?: string;
};

export type RoomServiceOrderItemOut = {
  menu_item_id: number;
  item_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  note: string;
};

export type RoomServiceOrder = {
  id: number;
  listing_id: number;
  reservation_id: number;
  guest_email: string;
  guest_name: string;
  status: "submitted" | "accepted" | "preparing" | "delivered" | "closed" | "cancelled";
  total_price: number;
  currency: string;
  delivery_note: string;
  created_at: string;
  updated_at: string;
  items: RoomServiceOrderItemOut[];
};

export type Restaurant = {
  id: number;
  listing_id: number;
  name: string;
  cuisine: string;
  description: string;
  open_from: string;
  open_to: string;
  avg_check_kzt: number;
  is_active: boolean;
};

export type RestaurantBooking = {
  id: number;
  listing_id: number;
  restaurant_id: number;
  restaurant_name: string;
  reservation_id: number;
  guest_email: string;
  guest_name: string;
  booking_date: string;
  booking_time: string;
  guests: number;
  note: string;
  status: "submitted" | "confirmed" | "seated" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
};

export type RestaurantBookingEvent = {
  id: number;
  booking_id: number;
  listing_id: number;
  reservation_id: number;
  restaurant_id: number;
  guest_email: string;
  event_type: string;
  status: "submitted" | "confirmed" | "seated" | "completed" | "cancelled";
  message: string;
  actor_role: string;
  created_at: string;
};

export type RestaurantPayload = {
  name: string;
  cuisine: string;
  description: string;
  open_from: string;
  open_to: string;
  avg_check_kzt: number;
  is_active: boolean;
};

export type MenuItemPayload = {
  name: string;
  description: string;
  price: number;
  category: string;
  is_active: boolean;
  sort_order: number;
};

export type InStayConciergeAction = {
  type: "add_item" | "submit_room_order" | "submit_draft_order" | "select_restaurant" | "book_table" | "none";
  label: string;
  item_id?: number | null;
  restaurant_id?: number | null;
  quantity?: number | null;
  booking_date?: string | null;
  booking_time?: string | null;
  guests?: number | null;
  note?: string | null;
};

export type InStayConciergeResponse = {
  mode: "openai" | "fallback";
  answer: string;
  action?: InStayConciergeAction | null;
  follow_up_prompts: string[];
  context: {
    listing_id: number;
    reservation_id?: number | null;
    menu_count: number;
    restaurant_count: number;
    active_order_count: number;
    active_table_booking_count: number;
  };
};

export type ListingPerformance = {
  listing_id: number;
  listing_title: string;
  city: string;
  district: string;
  reservations_period: number;
  revenue_period: number;
  adr_period: number;
  occupancy_period: number;
};

export type DailyOps = {
  date: string;
  reservations: number;
  cancellations: number;
  revenue: number;
};

export type PartnerOpsSummary = {
  period_days: number;
  arrivals_today: number;
  departures_today: number;
  active_stays_today: number;
  cancellations_period: number;
  reservations_period: number;
  revenue_period: number;
  adr_period: number;
  occupancy_period: number;
  daily_stats: DailyOps[];
  listing_performance: ListingPerformance[];
};

export type FunnelStep = {
  event_name: "chat_open" | "filters_collected" | "checkout_clicked" | "payment_started" | "paid";
  label: string;
  count: number;
  conversion_from_open: number;
};

export type PartnerFunnelSummary = {
  period_days: number;
  total_events: number;
  steps: FunnelStep[];
};

export type PartnerAbVariantSummary = {
  variant: "A" | "B";
  exposed: number;
  listing_open_clicked: number;
  checkout_clicked: number;
  payment_started: number;
  paid: number;
  ctr_from_exposed: number;
  checkout_from_exposed: number;
  paid_from_exposed: number;
  paid_from_checkout: number;
};

export type PartnerAbSummary = {
  period_days: number;
  variants: PartnerAbVariantSummary[];
};

export type Quote = {
  listing_id: number;
  room_type_id: number | null;
  room_type_name: string | null;
  available: boolean;
  check_in: string;
  check_out: string;
  guests: number;
  nights: number;
  nightly_price: number;
  subtotal: number;
  cleaning_fee: number;
  service_fee: number;
  total: number;
  dynamic_multiplier: number;
  tariff_plan: "basic" | "smart" | "flex";
  cancellation_policy: string;
  cancellation_text: string;
  quote_token: string | null;
  quote_expires_at: string | null;
};

export type Availability = {
  listing_id: number;
  from_date: string;
  to_date: string;
  booked_ranges: Array<{ check_in: string; check_out: string }>;
};

export type RoomAvailabilityWindow = {
  check_in: string;
  check_out: string;
  nights: number;
  available_count: number;
};

export type RoomTypeAvailability = {
  id: number;
  listing_id: number;
  name: string;
  description: string;
  nightly_price: number;
  total_inventory: number;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  amenities: string;
  is_active: boolean;
  sort_order: number;
  available_count: number;
  available_windows: RoomAvailabilityWindow[];
};

export type RoomAvailability = {
  listing_id: number;
  from_date: string;
  to_date: string;
  guests: number | null;
  room_types: RoomTypeAvailability[];
};

export type RoomType = {
  id: number;
  listing_id: number;
  name: string;
  description: string;
  nightly_price: number;
  total_inventory: number;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  amenities: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type RoomTypePayload = {
  name: string;
  description: string;
  nightly_price: number;
  total_inventory: number;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  amenities: string;
  is_active: boolean;
  sort_order: number;
};

export type ConciergeFilters = {
  city?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guests?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  trip_purpose?: string | null;
  property_type?: "hotel" | "apartment" | string | null;
  amenities?: string[] | string | null;
  q?: string | null;
};

export type ConciergeSuggestion = {
  listing_id: number;
  title: string;
  city: string;
  district: string;
  nightly_price: number;
  rating: number;
  max_guests: number;
  reason: string;
  cover_photo_url?: string | null;
  room_type_id?: number | null;
  room_type_name?: string | null;
  room_nightly_price?: number | null;
  room_available_count?: number | null;
  room_max_guests?: number | null;
};

export type ConciergeAlternative = {
  listing_id: number;
  title: string;
  city: string;
  district: string;
  nightly_price: number;
  unavailable_reason: string;
  suggested_check_in: string;
  suggested_check_out: string;
  cover_photo_url?: string | null;
};

export type ConciergeBookingState = {
  listing_id?: number | null;
  room_type_id?: number | null;
  room_type_name?: string | null;
  title?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guests?: number | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  check_in_time?: string | null;
  step?: string | null;
};

export type ConciergeResponse = {
  stage: "collect" | "search" | "availability" | "pricing" | "booking" | "payment_link" | "handoff";
  answer: string;
  selection_summary: string;
  reasoning: string;
  filters: ConciergeFilters;
  suggestions: ConciergeSuggestion[];
  alternatives: ConciergeAlternative[];
  total_found: number;
  follow_up_prompts: string[];
  workflow_steps: string[];
  next_action?: {
    type: "apply_filters" | "start_booking" | "apply_alternative_dates" | "go_checkout" | "handoff_contact" | "none";
    label: string;
    listing_id?: number | null;
    room_type_id?: number | null;
    room_type_name?: string | null;
    title?: string | null;
    city?: string | null;
    check_in?: string | null;
    check_out?: string | null;
    guests?: number | null;
  } | null;
  session_id?: string | null;
  booking_state?: ConciergeBookingState | null;
};

export type ListingBlock = {
  id: number;
  listing_id: number;
  room_type_id: number | null;
  check_in: string;
  check_out: string;
  blocked_inventory: number | null;
  reason: string;
  created_by: number | null;
  created_at: string;
};

export type ListingPhoto = {
  id: number;
  listing_id: number;
  file_url: string;
  is_cover: boolean;
  sort_order: number;
  created_at: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const UNSAFE_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return null;
  return decodeURIComponent(entry.slice(prefix.length));
}

function appendCsrfHeader(init: RequestInit = {}): RequestInit {
  const method = (init.method || "GET").toUpperCase();
  if (!UNSAFE_HTTP_METHODS.has(method)) return init;

  const token = readCookie("fa_csrf");
  if (!token) return init;

  const headers = new Headers(init.headers || {});
  if (!headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", token);
  }
  return { ...init, headers };
}

function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestInit = appendCsrfHeader(init || {});
  return globalThis.fetch(input, { credentials: "include", ...requestInit });
}

function loopbackFallbackApiUrl(): string | null {
  if (API_URL.includes("127.0.0.1")) return API_URL.replace("127.0.0.1", "localhost");
  if (API_URL.includes("localhost")) return API_URL.replace("localhost", "127.0.0.1");
  return null;
}

async function fetchWithLoopbackFallback(path: string, init: RequestInit): Promise<Response> {
  try {
    return await apiFetch(`${API_URL}${path}`, init);
  } catch (error) {
    const fallback = loopbackFallbackApiUrl();
    if (!fallback) throw error;
    return apiFetch(`${fallback}${path}`, init);
  }
}

export type ApiErrorPayload = {
  code?: string;
  message: string;
  details?: unknown;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const message = payload?.error?.message || payload?.detail || payload?.message;
      if (typeof message === "string" && message.trim().length > 0) return message;
    } else {
      const text = await response.text();
      if (text.trim().length > 0) return text;
    }
  } catch {
    // ignore parse errors, fallback below
  }
  return fallback;
}

async function readApiErrorPayload(response: Response, fallback: string): Promise<ApiErrorPayload> {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return { message: text.trim().length > 0 ? text : fallback };
    }
    const payload = await response.json();
    const message =
      (typeof payload?.error?.message === "string" && payload.error.message.trim()) ||
      (typeof payload?.detail === "string" && payload.detail.trim()) ||
      (typeof payload?.message === "string" && payload.message.trim()) ||
      fallback;
    const code = typeof payload?.error?.code === "string" ? payload.error.code : undefined;
    const details = payload?.error?.details;
    return { message, code, details };
  } catch {
    return { message: fallback };
  }
}

export type ListingPayload = {
  title: string;
  city: string;
  district: string;
  property_type: string;
  nightly_price: number;
  cleaning_fee: number;
  service_fee_percent: number;
  cancellation_policy: string;
  rating: number;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  amenities: string;
  description: string;
  is_active: boolean;
};

export async function getListings(params: Record<string, string | number | undefined> = {}): Promise<ListingList> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });

  const path = query.toString() ? `/listings?${query.toString()}` : "/listings";
  const response = await fetchWithLoopbackFallback(path, { cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch listings"));
  return response.json();
}

export async function getListing(id: number): Promise<Listing> {
  const response = await fetchWithLoopbackFallback(`/listings/${id}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response, "Listing not found"));
  return response.json();
}

export async function getListingQuote(params: {
  listing_id: number;
  check_in: string;
  check_out: string;
  guests: number;
  tariff?: "basic" | "smart" | "flex";
  room_type_id?: number;
}): Promise<Quote> {
  const query = new URLSearchParams({
    check_in: params.check_in,
    check_out: params.check_out,
    guests: String(params.guests),
    tariff: params.tariff || "smart",
  });
  if (params.room_type_id) query.set("room_type_id", String(params.room_type_id));
  const response = await fetchWithLoopbackFallback(`/listings/${params.listing_id}/quote?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response, "Quote failed"));
  return response.json();
}

export async function getListingAvailability(params: {
  listing_id: number;
  from_date: string;
  to_date: string;
}): Promise<Availability> {
  const query = new URLSearchParams({
    from_date: params.from_date,
    to_date: params.to_date,
  });
  const response = await fetchWithLoopbackFallback(`/listings/${params.listing_id}/availability?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response, "Availability failed"));
  return response.json();
}

export async function getListingRoomAvailability(params: {
  listing_id: number;
  from_date: string;
  to_date: string;
  guests?: number;
}): Promise<RoomAvailability> {
  const query = new URLSearchParams({
    from_date: params.from_date,
    to_date: params.to_date,
  });
  if (params.guests) query.set("guests", String(params.guests));
  const response = await fetchWithLoopbackFallback(`/listings/${params.listing_id}/room-availability?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Room availability failed"));
  return response.json();
}

export async function createReservation(payload: {
  listing_id: number;
  room_type_id?: number;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  check_in: string;
  check_out: string;
  guests: number;
  tariff_plan?: "basic" | "smart" | "flex";
  quote_token?: string;
}): Promise<Reservation> {
  const response = await apiFetch(`${API_URL}/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await readApiErrorPayload(response, "Reservation failed");
    throw new ApiError(error.message, response.status, error.code, error.details);
  }

  return response.json();
}

export async function cancelReservation(
  reservationId: number,
  guestEmail: string,
  accessToken?: string | null,
): Promise<ReservationCancelResult> {
  const response = await apiFetch(`${API_URL}/reservations/${reservationId}/cancel`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guest_email: guestEmail, access_token: accessToken || undefined }),
  });

  if (!response.ok) throw new Error(await readApiError(response, "Cancellation failed"));

  return response.json();
}

export async function getReservationCancellationTerms(
  reservationId: number,
  accessToken?: string | null,
): Promise<CancellationTerms> {
  const query = new URLSearchParams();
  if (accessToken?.trim()) query.set("access_token", accessToken.trim());
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`${API_URL}/reservations/${reservationId}/cancellation-terms${suffix}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch cancellation terms"));
  return response.json();
}

export async function getPartnerReservations(
  token: string,
  params: {
    status?: "draft" | "pending_payment" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired";
    payment_status?: "pending" | "paid" | "failed" | "refunded";
    listing_id?: number;
    guest_query?: string;
    check_in_from?: string;
    check_out_to?: string;
  } = {},
): Promise<PartnerReservation[]> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.payment_status) query.set("payment_status", params.payment_status);
  if (params.listing_id) query.set("listing_id", String(params.listing_id));
  if (params.guest_query) query.set("guest_query", params.guest_query);
  if (params.check_in_from) query.set("check_in_from", params.check_in_from);
  if (params.check_out_to) query.set("check_out_to", params.check_out_to);
  const url = query.toString() ? `${API_URL}/reservations/mine?${query}` : `${API_URL}/reservations/mine`;

  const response = await apiFetch(url, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch partner reservations"));
  return response.json();
}

export async function getReservationsByEmail(guestEmail: string, accessTokens: string[] = []): Promise<Reservation[]> {
  const normalized = guestEmail.trim();
  if (!normalized) return [];
  const query = new URLSearchParams();
  accessTokens.filter(Boolean).forEach((token) => query.append("access_token", token));
  if (!query.toString()) return [];
  const response = await apiFetch(`${API_URL}/reservations/by-email/${encodeURIComponent(normalized)}?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch reservations"));
  return response.json();
}

export async function getPartnerNotifications(token: string, limit = 50): Promise<PartnerNotification[]> {
  const response = await apiFetch(`${API_URL}/reservations/mine/notifications?limit=${limit}`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch partner notifications"));
  return response.json();
}

export async function markPartnerNotificationsRead(token: string, eventIds: string[]): Promise<{ marked: number; event_ids: string[] }> {
  const response = await apiFetch(`${API_URL}/reservations/mine/notifications/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_ids: eventIds }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to mark notifications read"));
  return response.json();
}

export async function getPartnerCommunicationEvents(
  token: string,
  params: {
    limit?: number;
    channel?: "webhook" | "email" | "telegram";
    status?: "sent" | "failed" | "skipped";
  } = {},
): Promise<PartnerCommunicationEvent[]> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.channel) query.set("channel", params.channel);
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`${API_URL}/reservations/mine/communications${suffix}`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch communication events"));
  return response.json();
}

export async function retryPartnerCommunicationEvent(
  token: string,
  eventId: string,
): Promise<PartnerCommunicationRetryResult> {
  const response = await apiFetch(`${API_URL}/reservations/mine/communications/${eventId}/retry`, {
    method: "POST",
    headers: undefined,
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to retry communication event"));
  return response.json();
}

export async function retryPartnerCommunicationEventsBatch(
  token: string,
  eventIds: string[],
): Promise<PartnerCommunicationBatchRetryResult> {
  const response = await apiFetch(`${API_URL}/reservations/mine/communications/retry-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify({ event_ids: eventIds }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to batch retry communication events"));
  return response.json();
}

export async function getSupportTickets(
  token: string,
  params: { status?: "open" | "in_progress" | "resolved"; priority?: "low" | "medium" | "high" } = {},
): Promise<SupportTicket[]> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.priority) query.set("priority", params.priority);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`${API_URL}/support/tickets${suffix}`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch support tickets"));
  return response.json();
}

export async function updateSupportTicketStatus(
  ticketId: number,
  status: "open" | "in_progress" | "resolved",
  token: string,
): Promise<SupportTicket> {
  const response = await apiFetch(`${API_URL}/support/tickets/${ticketId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update support ticket"));
  return response.json();
}

export async function partnerCancelReservation(reservationId: number, token: string): Promise<ReservationCancelResult> {
  const response = await apiFetch(`${API_URL}/reservations/${reservationId}/partner-cancel`, {
    method: "PATCH",
    headers: undefined,
  });

  if (!response.ok) throw new Error(await readApiError(response, "Failed to cancel reservation"));
  return response.json();
}

export async function partnerConfirmReservation(reservationId: number, token: string): Promise<Reservation> {
  const response = await apiFetch(`${API_URL}/reservations/${reservationId}/partner-confirm`, {
    method: "PATCH",
    headers: undefined,
  });

  if (!response.ok) throw new Error(await readApiError(response, "Failed to confirm reservation"));
  return response.json();
}

export async function getReservationPayment(reservationId: number, accessToken?: string | null): Promise<ReservationPayment> {
  const query = new URLSearchParams();
  if (accessToken?.trim()) query.set("access_token", accessToken.trim());
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`${API_URL}/reservations/${reservationId}/payment${suffix}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await readApiErrorPayload(response, "Failed to fetch reservation payment");
    throw new ApiError(error.message, response.status, error.code, error.details);
  }
  return response.json();
}

export async function attemptReservationPayment(
  reservationId: number,
  method: "card" | "kaspi" | "apple_pay",
  idempotencyKey: string,
  accessToken?: string | null,
  forceFail = false,
): Promise<ReservationPayment> {
  const response = await apiFetch(`${API_URL}/reservations/${reservationId}/payment/attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, idempotency_key: idempotencyKey, access_token: accessToken || undefined, force_fail: forceFail }),
  });
  if (!response.ok) {
    const error = await readApiErrorPayload(response, "Failed to attempt payment");
    throw new ApiError(error.message, response.status, error.code, error.details);
  }
  return response.json();
}

export async function getPartnerOpsSummary(
  token: string,
  periodDays: 7 | 30 | 90 = 30,
): Promise<PartnerOpsSummary> {
  const response = await apiFetch(`${API_URL}/reservations/mine/summary?period_days=${periodDays}`, {
    headers: undefined,
    cache: "no-store",
  });

  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch partner summary"));
  return response.json();
}

export async function getPartnerFunnelSummary(
  token: string,
  periodDays: 7 | 30 | 90 = 30,
  listingId?: number,
): Promise<PartnerFunnelSummary> {
  const query = new URLSearchParams({ period_days: String(periodDays) });
  if (listingId) query.set("listing_id", String(listingId));
  const response = await apiFetch(`${API_URL}/analytics/funnel/mine?${query.toString()}`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch funnel analytics"));
  return response.json();
}

export async function getPartnerAbSummary(
  token: string,
  periodDays: 7 | 30 | 90 = 30,
  listingId?: number,
): Promise<PartnerAbSummary> {
  const query = new URLSearchParams({ period_days: String(periodDays) });
  if (listingId) query.set("listing_id", String(listingId));
  const response = await apiFetch(`${API_URL}/analytics/ab/mine?${query.toString()}`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch A/B analytics"));
  return response.json();
}

export async function getMyListings(token: string): Promise<Listing[]> {
  const response = await apiFetch(`${API_URL}/listings/mine`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch manager listings"));
  return response.json();
}

export async function createListing(payload: ListingPayload, token: string): Promise<Listing> {
  const response = await apiFetch(`${API_URL}/listings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to create listing"));
  return response.json();
}

export async function updateListing(listingId: number, payload: ListingPayload, token: string): Promise<Listing> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update listing"));
  return response.json();
}

export async function deleteListing(listingId: number, token: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}`, {
    method: "DELETE",
    headers: undefined,
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to delete listing"));
}

export async function setListingsActiveBulk(listingIds: number[], isActive: boolean, token: string): Promise<Listing[]> {
  const response = await apiFetch(`${API_URL}/listings/bulk/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify({ listing_ids: listingIds, is_active: isActive }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update listing statuses"));
  return response.json();
}

export async function getListingBlocks(listingId: number, token: string): Promise<ListingBlock[]> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/blocks`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch listing blocks"));
  return response.json();
}

export async function createListingBlock(
  listingId: number,
  payload: { check_in: string; check_out: string; reason: string; room_type_id?: number | null; blocked_inventory?: number | null },
  token: string,
): Promise<ListingBlock> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/blocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to create listing block"));
  return response.json();
}

export async function deleteListingBlock(listingId: number, blockId: number, token: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/blocks/${blockId}`, {
    method: "DELETE",
    headers: undefined,
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to delete listing block"));
}

export async function getListingRoomTypes(listingId: number, token: string): Promise<RoomType[]> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/room-types`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch room types"));
  return response.json();
}

export async function createListingRoomType(listingId: number, payload: RoomTypePayload, token: string): Promise<RoomType> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/room-types`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to create room type"));
  return response.json();
}

export async function updateListingRoomType(
  listingId: number,
  roomTypeId: number,
  payload: Partial<RoomTypePayload>,
  token: string,
): Promise<RoomType> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/room-types/${roomTypeId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update room type"));
  return response.json();
}

export async function deleteListingRoomType(listingId: number, roomTypeId: number, token: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/room-types/${roomTypeId}`, {
    method: "DELETE",
    headers: undefined,
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to delete room type"));
}

export async function getListingPhotos(listingId: number, token?: string): Promise<ListingPhoto[]> {
  const url = token ? `${API_URL}/listings/${listingId}/photos/mine` : `${API_URL}/listings/${listingId}/photos`;
  const response = await apiFetch(url, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch listing photos"));
  return response.json();
}

export async function uploadListingPhoto(listingId: number, file: File, token: string): Promise<ListingPhoto> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch(`${API_URL}/listings/${listingId}/photos`, {
    method: "POST",
    headers: undefined,
    body: formData,
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to upload listing photo"));
  return response.json();
}

export async function setListingCoverPhoto(listingId: number, photoId: number, token: string): Promise<ListingPhoto> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/photos/${photoId}/cover`, {
    method: "PATCH",
    headers: undefined,
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to set cover photo"));
  return response.json();
}

export async function deleteListingPhoto(listingId: number, photoId: number, token: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/photos/${photoId}`, {
    method: "DELETE",
    headers: undefined,
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to delete listing photo"));
}

export async function reorderListingPhotos(listingId: number, photoIds: number[], token: string): Promise<ListingPhoto[]> {
  const response = await apiFetch(`${API_URL}/listings/${listingId}/photos/reorder`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify({ photo_ids: photoIds }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to reorder listing photos"));
  return response.json();
}

export async function askConcierge(payload: {
  message: string;
  lang: "ru" | "en";
  currency: "KZT" | "USD";
  context_messages?: string[];
  session_id?: string;
  booking_state?: ConciergeBookingState;
}): Promise<ConciergeResponse> {
  const response = await fetchWithLoopbackFallback("/chat/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to get concierge response"));
  return response.json();
}

export async function trackAnalyticsEvent(payload: {
  event_name: string;
  session_id?: string | null;
  listing_id?: number | null;
  reservation_id?: number | null;
  lang?: "ru" | "en";
  currency?: "KZT" | "USD";
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  try {
    await apiFetch(`${API_URL}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // analytics must never break user flow
  }
}

export async function askInStayConcierge(payload: {
  message: string;
  lang: "ru" | "en";
  currency: "KZT" | "USD";
  listing_id?: number;
  reservation_id?: number;
  guest_email?: string;
  access_token?: string;
  history?: Array<{ role: "assistant" | "user"; text: string }>;
  draft_items?: Array<Record<string, unknown>>;
}): Promise<InStayConciergeResponse> {
  const response = await fetchWithLoopbackFallback("/ai/in-stay/concierge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to get in-stay concierge response"));
  return response.json();
}

export async function getInStayMenu(listingId: number): Promise<MenuItem[]> {
  const response = await apiFetch(`${API_URL}/in-stay/listings/${listingId}/menu?only_active=true`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch in-stay menu"));
  return response.json();
}

export async function getInStayMenuForListing(listingId: number, onlyActive = true): Promise<MenuItem[]> {
  const response = await apiFetch(`${API_URL}/in-stay/listings/${listingId}/menu?only_active=${onlyActive ? "true" : "false"}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch in-stay menu"));
  return response.json();
}

export async function createInStayMenuItem(
  listingId: number,
  payload: MenuItemPayload,
  token: string,
): Promise<MenuItem> {
  const response = await apiFetch(`${API_URL}/in-stay/listings/${listingId}/menu`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to create menu item"));
  return response.json();
}

export async function updateInStayMenuItem(
  menuItemId: number,
  payload: MenuItemPayload,
  token: string,
): Promise<MenuItem> {
  const response = await apiFetch(`${API_URL}/in-stay/menu/${menuItemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update menu item"));
  return response.json();
}

export async function createRoomServiceOrder(payload: {
  reservation_id: number;
  guest_email: string;
  access_token?: string;
  items: RoomServiceOrderItemIn[];
  delivery_note?: string;
}): Promise<RoomServiceOrder> {
  const response = await fetchWithLoopbackFallback("/in-stay/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to create room service order"));
  return response.json();
}

export async function getRoomServiceOrdersByReservation(
  reservationId: number,
  guestEmail: string,
  accessToken?: string | null,
): Promise<RoomServiceOrder[]> {
  const query = new URLSearchParams({ guest_email: guestEmail });
  if (accessToken?.trim()) query.set("access_token", accessToken.trim());
  const response = await apiFetch(`${API_URL}/in-stay/orders/by-reservation/${reservationId}?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch room service orders"));
  return response.json();
}

export async function getPartnerRoomServiceOrders(
  token: string,
  params: { status?: "submitted" | "accepted" | "preparing" | "delivered" | "closed" | "cancelled" } = {},
): Promise<RoomServiceOrder[]> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`${API_URL}/in-stay/orders/mine${suffix}`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch room service orders"));
  return response.json();
}

export async function updateRoomServiceOrderStatus(
  orderId: number,
  status: "submitted" | "accepted" | "preparing" | "delivered" | "closed" | "cancelled",
  token: string,
): Promise<RoomServiceOrder> {
  const response = await apiFetch(`${API_URL}/in-stay/orders/${orderId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update room service order"));
  return response.json();
}

export async function getListingRestaurants(listingId: number, onlyActive = true): Promise<Restaurant[]> {
  const response = await apiFetch(`${API_URL}/in-stay/listings/${listingId}/restaurants?only_active=${onlyActive ? "true" : "false"}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch restaurants"));
  return response.json();
}

export async function createRestaurant(
  listingId: number,
  payload: RestaurantPayload,
  token: string,
): Promise<Restaurant> {
  const response = await apiFetch(`${API_URL}/in-stay/listings/${listingId}/restaurants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to create restaurant"));
  return response.json();
}

export async function updateRestaurant(
  restaurantId: number,
  payload: RestaurantPayload,
  token: string,
): Promise<Restaurant> {
  const response = await apiFetch(`${API_URL}/in-stay/restaurants/${restaurantId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update restaurant"));
  return response.json();
}

export async function createRestaurantBooking(payload: {
  reservation_id: number;
  restaurant_id: number;
  guest_email: string;
  access_token?: string;
  booking_date: string;
  booking_time: string;
  guests: number;
  note?: string;
}): Promise<RestaurantBooking> {
  const response = await fetchWithLoopbackFallback("/in-stay/restaurant-bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to create restaurant booking"));
  return response.json();
}

export async function getRestaurantBookingsByReservation(
  reservationId: number,
  guestEmail: string,
  accessToken?: string | null,
): Promise<RestaurantBooking[]> {
  const query = new URLSearchParams({ guest_email: guestEmail });
  if (accessToken?.trim()) query.set("access_token", accessToken.trim());
  const response = await apiFetch(`${API_URL}/in-stay/restaurant-bookings/by-reservation/${reservationId}?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch restaurant bookings"));
  return response.json();
}

export async function getRestaurantBookingEventsByReservation(
  reservationId: number,
  guestEmail: string,
  accessToken?: string | null,
): Promise<RestaurantBookingEvent[]> {
  const query = new URLSearchParams({ guest_email: guestEmail });
  if (accessToken?.trim()) query.set("access_token", accessToken.trim());
  const response = await apiFetch(`${API_URL}/in-stay/restaurant-bookings/events/by-reservation/${reservationId}?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch restaurant booking updates"));
  return response.json();
}

export async function getPartnerRestaurantBookings(
  token: string,
  params: { status?: "submitted" | "confirmed" | "seated" | "completed" | "cancelled" } = {},
): Promise<RestaurantBooking[]> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`${API_URL}/in-stay/restaurant-bookings/mine${suffix}`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch partner restaurant bookings"));
  return response.json();
}

export async function updateRestaurantBookingStatus(
  bookingId: number,
  status: "submitted" | "confirmed" | "seated" | "completed" | "cancelled",
  token: string,
): Promise<RestaurantBooking> {
  const response = await apiFetch(`${API_URL}/in-stay/restaurant-bookings/${bookingId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",    },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to update restaurant booking status"));
  return response.json();
}

export async function getPartnerRestaurantBookingEvents(
  token: string,
): Promise<RestaurantBookingEvent[]> {
  const response = await apiFetch(`${API_URL}/in-stay/restaurant-bookings/events/mine`, {
    headers: undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response, "Failed to fetch restaurant booking updates"));
  return response.json();
}



