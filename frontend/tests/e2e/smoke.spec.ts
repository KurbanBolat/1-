import { expect, Locator, Page, test } from "@playwright/test";

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(y || 1970, (m || 1) - 1, d || 1);
  base.setDate(base.getDate() + days);
  return toIsoDate(base);
}

function isoToday(): string {
  return toIsoDate(new Date());
}

function e2eApiBase(): string {
  return process.env.E2E_API_BASE || "http://localhost:8000";
}

function cookieValueFromSetCookie(headers: string[], name: string): string {
  const prefix = `${name}=`;
  const raw = headers.find((header) => header.startsWith(prefix));
  const value = raw?.slice(prefix.length).split(";")[0] || "";
  if (!value) throw new Error(`Missing ${name} cookie in API login response`);
  return decodeURIComponent(value);
}

function buildBookedSet(bookedRanges: Array<{ check_in: string; check_out: string }>): Set<string> {
  const set = new Set<string>();
  for (const range of bookedRanges) {
    let cursor = range.check_in;
    while (cursor < range.check_out) {
      set.add(cursor);
      cursor = addDaysIso(cursor, 1);
    }
  }
  return set;
}

async function findBookableRangeFromApi(
  page: Page,
  listingId: number,
): Promise<{ checkIn: string; checkOut: string } | null> {
  const room = await findBookableRoomFromApi(page, listingId);
  if (room) return { checkIn: room.checkIn, checkOut: room.checkOut };
  return null;
}

async function findBookableRoomFromApi(
  page: Page,
  listingId: number,
  guests = 2,
): Promise<{ checkIn: string; checkOut: string; roomTypeId: number; roomTypeName: string } | null> {
  const fromDate = addDaysIso(isoToday(), 1);
  const toDate = addDaysIso(fromDate, 120);
  const apiBase = e2eApiBase();
  const roomResponse = await page.request
    .get(`${apiBase}/listings/${listingId}/room-availability?from_date=${fromDate}&to_date=${toDate}&guests=${guests}`)
    .catch(() => null);
  if (roomResponse?.ok()) {
    const payload = (await roomResponse.json()) as {
      room_types?: Array<{
        id: number;
        name: string;
        sort_order?: number;
        nightly_price?: number;
        available_windows?: Array<{ check_in: string; check_out: string; nights: number; available_count: number }>;
      }>;
    };
    const roomTypes = [...(payload.room_types || [])].sort(
      (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.nightly_price || 0) - (b.nightly_price || 0),
    );
    for (const roomType of roomTypes) {
      const windows = [...(roomType.available_windows || [])].sort((a, b) => a.check_in.localeCompare(b.check_in));
      const window = windows.find((item) => item.available_count > 0 && item.nights >= 1);
      if (!window) continue;
      const nights = Math.min(2, Math.max(1, window.nights));
      return {
        checkIn: window.check_in,
        checkOut: addDaysIso(window.check_in, nights),
        roomTypeId: roomType.id,
        roomTypeName: roomType.name,
      };
    }
  }

  const response = await page.request
    .get(`${apiBase}/listings/${listingId}/availability?from_date=${fromDate}&to_date=${toDate}`)
    .catch(() => null);
  if (!response || !response.ok()) return null;

  const payload = (await response.json()) as { booked_ranges?: Array<{ check_in: string; check_out: string }> };
  const booked = buildBookedSet(payload.booked_ranges || []);
  for (let offset = 0; offset < 90; offset += 1) {
    const d1 = addDaysIso(fromDate, offset);
    const d2 = addDaysIso(d1, 1);
    const d3 = addDaysIso(d1, 2);
    if (!booked.has(d1) && !booked.has(d2) && !booked.has(d3)) {
      return { checkIn: d1, checkOut: d3, roomTypeId: 0, roomTypeName: "" };
    }
  }
  return null;
}

async function applyBookableDatesFromApi(
  page: Page,
  scope: Locator,
  listingId: number,
  labels: { checkInLabel: RegExp; checkOutLabel: RegExp; continueButtonName: RegExp },
): Promise<boolean> {
  const range = await findBookableRangeFromApi(page, listingId);
  if (!range) return false;
  await scope.getByLabel(labels.checkInLabel).fill(range.checkIn);
  await scope.getByLabel(labels.checkOutLabel).fill(range.checkOut);
  await page.waitForTimeout(80);
  const searchButton = scope.getByRole("button", { name: /show rooms|показать номера|continue to checkout|перейти к оформлению/i });
  if (!(await searchButton.isEnabled())) return false;
  await searchButton.click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect.poll(() => new URL(page.url()).searchParams.get("check_in")).toBe(range.checkIn);
  await expect.poll(() => new URL(page.url()).searchParams.get("check_out")).toBe(range.checkOut);
  return (await page.locator('.available-room-cta[href*="/checkout"]').count()) > 0;
}

async function pickBookableDates(
  page: Page,
  opts: { checkInLabel: RegExp; checkOutLabel: RegExp; continueButtonName: RegExp; scope?: Locator },
): Promise<void> {
  const scope = opts.scope ?? page;
  const listingId = Number(new URL(page.url()).pathname.match(/\/stays\/(\d+)/)?.[1] || "0");
  if (!listingId) throw new Error("Could not resolve listing id from stay URL");
  const range = await findBookableRangeFromApi(page, listingId);
  if (!range) throw new Error("Could not find a bookable room range from API");
  await scope.getByLabel(opts.checkInLabel).fill(range.checkIn);
  await scope.getByLabel(opts.checkOutLabel).fill(range.checkOut);
  const searchButton = scope.getByRole("button", { name: /show rooms|показать номера|continue to checkout|перейти к оформлению/i });
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect.poll(() => new URL(page.url()).searchParams.get("check_in")).toBe(range.checkIn);
  await expect.poll(() => new URL(page.url()).searchParams.get("check_out")).toBe(range.checkOut);
  await expect(page.locator('.available-room-cta[href*="/checkout"]').first()).toBeVisible({ timeout: 15000 });
}

async function ensureCheckoutReady(page: Page): Promise<void> {
  const confirm = page.getByRole("button", { name: /confirm booking|подтвердить бронирование/i });
  if (await confirm.isEnabled()) return;
  const refresh = page.getByRole("button", { name: /refresh quote|обновить цену/i });
  if (await refresh.count()) {
    await refresh.first().click();
    await expect(confirm).toBeEnabled({ timeout: 15000 });
  }
}

async function resolveBookingScope(page: Page): Promise<Locator> {
  const bookingPanel = page.locator("#booking-panel");
  if (await bookingPanel.count()) {
    await expect(bookingPanel.first()).toBeVisible();
    return bookingPanel.first();
  }
  return page.locator("main");
}

async function proceedToCheckout(page: Page, _continueButtonName: RegExp, scope?: Locator): Promise<void> {
  const bookingScope = scope ?? (await resolveBookingScope(page));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const roomCta = page.locator('.available-room-cta[href*="/checkout"]').first();
    if ((await roomCta.count()) > 0 && (await roomCta.isVisible().catch(() => false))) {
      await roomCta.click();
    } else {
      const continueButton = bookingScope.getByRole("button", { name: /show rooms|показать номера|continue to checkout|перейти к оформлению/i });
      await continueButton.click();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.locator('.available-room-cta[href*="/checkout"]').first().click();
    }
    try {
      await page.waitForURL(/\/checkout\?/, { timeout: 10000 });
      return;
    } catch {
      if (attempt === 3) throw new Error("Continue to checkout did not navigate to checkout");
    }
  }
}

async function openFirstStay(page: Page): Promise<void> {
  const links = page.locator(".property-card .actions a");
  if ((await links.count()) === 0) return;
  const href = await links.first().getAttribute("href");
  if (href) {
    await page.goto(href);
    return;
  }
  await links.first().click();
}

async function openFirstBookableStay(page: Page): Promise<void> {
  const hrefs = await page
    .locator(".property-card .actions a")
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute("href"))
        .filter((href): href is string => Boolean(href))
        .slice(0, 12),
    );

  for (const href of hrefs) {
    const listingId = Number(href.match(/\/stays\/(\d+)/)?.[1] || "0");
    if (!listingId) continue;
    const room = await findBookableRoomFromApi(page, listingId);
    if (!room) continue;
    const url = new URL(href, "http://localhost:3000");
    url.searchParams.set("check_in", room.checkIn);
    url.searchParams.set("check_out", room.checkOut);
    url.searchParams.set("guests", "2");
    await page.goto(`${url.pathname}?${url.searchParams.toString()}#available-rooms`);
    await expect(page).toHaveURL(/\/stays\/\d+/);
    await expect(page.locator('.available-room-cta[href*="/checkout"]').first()).toBeVisible({ timeout: 15000 });
    return;
  }

  throw new Error("Could not find a stay with an available room");
}

async function openBookableStayFromCandidates(page: Page, ids: number[]): Promise<number> {
  for (const listingId of ids) {
    const room = await findBookableRoomFromApi(page, listingId);
    if (!room) continue;
    await page.goto(`/stays/${listingId}?lang=en&currency=USD&check_in=${room.checkIn}&check_out=${room.checkOut}&guests=2#available-rooms`);
    await expect(page).toHaveURL(new RegExp(`/stays/${listingId}`));
    if ((await page.locator('.available-room-cta[href*="/checkout"]').count()) > 0) return listingId;
  }
  throw new Error("Could not find a partner-owned bookable stay from candidate list");
}

async function clearClientSession(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.removeItem("findapart_token");
    sessionStorage.clear();
  });
}

async function loginManagerByApi(page: Page): Promise<void> {
  const response = await page.request.post(`${e2eApiBase()}/auth/login`, {
    form: {
      username: "admin@local.dev",
      password: "Admin12345!",
    },
  });
  expect(response.ok()).toBeTruthy();
  const setCookieHeaders = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
  const accessCookie = cookieValueFromSetCookie(setCookieHeaders, "fa_access");
  const csrfCookie = cookieValueFromSetCookie(setCookieHeaders, "fa_csrf");
  await page.context().addCookies([
    { name: "fa_access", value: accessCookie, url: "http://localhost:8000", httpOnly: true, sameSite: "Lax" },
    { name: "fa_csrf", value: csrfCookie, url: "http://localhost:8000", sameSite: "Lax" },
    { name: "fa_access", value: accessCookie, url: "http://127.0.0.1:8000", httpOnly: true, sameSite: "Lax" },
    { name: "fa_csrf", value: csrfCookie, url: "http://127.0.0.1:8000", sameSite: "Lax" },
  ]);
}

async function pickBookableManagerListingFromApi(
  page: Page,
): Promise<{ listingId: number; range: { checkIn: string; checkOut: string }; roomTypeId?: number }> {
  const response = await page.request.get(`${e2eApiBase()}/listings/mine`);
  expect(response.ok()).toBeTruthy();
  const listings = (await response.json()) as Array<{ id: number; is_active?: boolean }>;

  for (const listing of listings) {
    if (!listing.id || listing.is_active === false) continue;
    const room = await findBookableRoomFromApi(page, listing.id);
    if (room) {
      const publicListing = await page.request.get(`${e2eApiBase()}/listings/${listing.id}`).catch(() => null);
      if (!publicListing?.ok()) continue;
      const publicStayPage = await page.request.get(`/stays/${listing.id}?lang=ru&currency=KZT`).catch(() => null);
      if (!publicStayPage?.ok()) continue;
      return {
        listingId: listing.id,
        range: { checkIn: room.checkIn, checkOut: room.checkOut },
        roomTypeId: room.roomTypeId || undefined,
      };
    }
  }

  throw new Error("Could not find an active manager listing with a free booking range");
}

async function createConfirmedReservationByApi(
  page: Page,
  params: { listingId: number; checkIn: string; checkOut: string; guestEmail: string; roomTypeId?: number },
): Promise<{ reservationId: number; accessToken: string }> {
  const createResponse = await page.request.post(`${e2eApiBase()}/reservations`, {
    data: {
      listing_id: params.listingId,
      room_type_id: params.roomTypeId,
      guest_name: "Room Service Flow E2E",
      guest_email: params.guestEmail,
      guest_phone: "+77006667788",
      check_in: params.checkIn,
      check_out: params.checkOut,
      guests: 2,
      tariff_plan: "smart",
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const draft = (await createResponse.json()) as { id: number; access_token?: string | null };

  const confirmResponse = await page.request.patch(`${e2eApiBase()}/reservations/${draft.id}/partner-confirm`);
  expect(confirmResponse.ok()).toBeTruthy();
  const confirmed = (await confirmResponse.json()) as { id: number; access_token?: string | null; status: string };
  expect(confirmed.status).toBe("confirmed");

  return { reservationId: confirmed.id, accessToken: confirmed.access_token || draft.access_token || "" };
}

async function payUntilConfirmed(page: Page, maxAttempts = 3): Promise<URLSearchParams> {
  async function readPaymentSnapshot(): Promise<{
    payment_status?: string;
    payment_method?: string | null;
    reservation_status?: string | null;
    attempt_status?: string | null;
  } | null> {
    const current = new URL(page.url());
    const reservationId = current.searchParams.get("reservation_id");
    if (!reservationId) return null;
    const accessToken = current.searchParams.get("access_token") || "";
    const suffix = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : "";
    const response = await page.request.get(`${e2eApiBase()}/reservations/${reservationId}/payment${suffix}`).catch(() => null);
    if (!response?.ok()) return null;
    return response.json();
  }

  async function goToSuccessFromPayment(snapshot: {
    payment_status?: string;
    payment_method?: string | null;
    reservation_status?: string | null;
    attempt_status?: string | null;
  }): Promise<URLSearchParams> {
    const current = new URL(page.url());
    const params = new URLSearchParams(current.searchParams);
    params.set("payment_status", snapshot.payment_status || "paid");
    params.set("payment_method", snapshot.payment_method || "");
    params.set("reservation_status", snapshot.reservation_status || "confirmed");
    params.set("attempt_status", snapshot.attempt_status || "");
    await page.goto(`/checkout/success?${params.toString()}`);
    await expect(page).toHaveURL(/\/checkout\/success\?/);
    return new URL(page.url()).searchParams;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await expect(page).toHaveURL(/\/checkout\/payment\?/);
    const alreadyPaid = await readPaymentSnapshot();
    if (alreadyPaid?.payment_status === "paid" || alreadyPaid?.reservation_status === "confirmed") {
      return goToSuccessFromPayment(alreadyPaid);
    }
    for (let clickTry = 1; clickTry <= 3; clickTry += 1) {
      const payButton = page.getByRole("button", { name: /pay now|оплатить сейчас/i }).first();
      await payButton.click();
      try {
        await page.waitForURL(/\/checkout\/success\?/, { timeout: 8000 });
        break;
      } catch {
        const goNow = page.getByRole("button", { name: /go now|перейти сейчас/i }).first();
        if ((await goNow.count()) > 0 && (await goNow.isVisible().catch(() => false))) {
          await goNow.click();
          await page.waitForURL(/\/checkout\/success\?/, { timeout: 8000 });
          break;
        }
        const snapshot = await readPaymentSnapshot();
        if (snapshot?.payment_status === "paid" || snapshot?.reservation_status === "confirmed") {
          return goToSuccessFromPayment(snapshot);
        }
        if (clickTry === 3) throw new Error("Payment page did not redirect to success");
      }
    }
    const params = new URL(page.url()).searchParams;
    if (params.get("payment_status") === "paid") return params;
    if (attempt < maxAttempts) {
      await page.getByRole("button", { name: /retry payment|повторить оплату/i }).click();
    }
  }
  throw new Error("Payment did not reach paid status within retry limit");
}

async function fillGuestDetails(page: Page, mode: "e2e" | "validation" | "cancel"): Promise<void> {
  const stamp = Date.now();
  if (mode === "e2e") {
    await page.getByPlaceholder(/full name/i).fill("E2E Test User");
    await page.getByPlaceholder(/email/i).fill(`e2e_${stamp}@example.com`);
  } else if (mode === "validation") {
    await page.getByPlaceholder(/full name/i).fill("Validation User");
    await page.getByPlaceholder(/email/i).fill(`validation_${stamp}@example.com`);
  } else {
    await page.getByPlaceholder(/full name/i).fill("Cancellation E2E");
    await page.getByPlaceholder(/email/i).fill(`cancel_e2e_${stamp}@example.com`);
  }
  await page.getByPlaceholder(/phone/i).fill("+77001112233");
  const checkInTimeInput = page.getByPlaceholder(/check-in time|время заезда/i);
  if (await checkInTimeInput.count()) {
    await checkInTimeInput.first().fill("18:00");
  }
}

test("home renders and has listing cards", async ({ page }) => {
  await page.goto("/?lang=en&currency=USD");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".property-card").first()).toBeVisible();
});

test("direct map url does not break page render", async ({ page }) => {
  await page.goto("/?view=map&lang=ru&currency=USD");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".property-card").first()).toBeVisible();
});

test("city labels are localized for russian", async ({ page }) => {
  await page.goto("/?lang=ru&currency=USD");
  await expect(page.locator(".property-card .card-cover span").first()).toBeVisible();
  await expect(page.locator("body")).toContainText(/Алматы|Астана|Шымкент|Стамбул|Вена|Торонто|Милан|Тбилиси/);
});

test("home search preserves dates and opens available rooms", async ({ page }) => {
  await page.goto("/?lang=ru&currency=KZT");
  const candidateHrefs = await page
    .locator(".property-card .actions a")
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute("href"))
        .filter((href): href is string => Boolean(href))
        .slice(0, 12),
    );
  let selected: { listingId: number; checkIn: string; checkOut: string; href: string } | null = null;

  for (const href of candidateHrefs) {
    const listingId = Number(href.match(/\/stays\/(\d+)/)?.[1] || "0");
    if (!listingId) continue;
    const room = await findBookableRoomFromApi(page, listingId);
    if (!room) continue;
    await page.goto(`/?lang=ru&currency=KZT&guests=2&check_in=${room.checkIn}&check_out=${room.checkOut}`);
    const link = page.locator(`.property-card .actions a[href*="/stays/${listingId}"]`).first();
    if ((await link.count()) === 0) continue;
    const nextHref = await link.getAttribute("href");
    if (!nextHref) continue;
    selected = { listingId, checkIn: room.checkIn, checkOut: room.checkOut, href: nextHref };
    break;
  }

  if (!selected) throw new Error("Could not find a bookable stay on the filtered home page");
  expect(selected.href).toContain(`check_in=${selected.checkIn}`);
  expect(selected.href).toContain(`check_out=${selected.checkOut}`);
  expect(selected.href).toContain("guests=2");
  expect(selected.href).toContain("#available-rooms");

  await page.locator('input[name="guests"]').fill("4");
  await page.locator(".sp-hero-search").getByRole("button", { name: /найти|search/i }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("guests")).toBe("4");
  await expect.poll(() => new URL(page.url()).searchParams.get("check_in")).toBe(selected.checkIn);
  await expect.poll(() => new URL(page.url()).searchParams.get("check_out")).toBe(selected.checkOut);

  await page.goto(selected.href);
  await expect(page).toHaveURL(/\/stays\/\d+.*#available-rooms/);
  await expect(page.locator(".available-room-table-head")).toContainText(/Категория номера|Room category/i);
});

test("manager page opens login or manager content", async ({ page }) => {
  await page.goto("/manager?lang=en&currency=USD");
  await expect(page.locator("body")).toContainText(/findapart|manager|login|partner|token/i);
});

test("booking flow works end-to-end", async ({ page }) => {
  await page.goto("/?lang=en&currency=USD");
  const cards = page.locator(".property-card .actions a");
  if ((await cards.count()) === 0) {
    await expect(page.locator("body")).toContainText(/no stays found|варианты не найдены/i);
    return;
  }
  await openFirstBookableStay(page);

  await expect(page).toHaveURL(/\/stays\/\d+/);
  const bookingPanel = await resolveBookingScope(page);
  await bookingPanel.getByLabel(/guests/i).fill("2");
  await pickBookableDates(page, {
    checkInLabel: /check-in/i,
    checkOutLabel: /check-out/i,
    continueButtonName: /continue to checkout/i,
    scope: bookingPanel,
  });
  await expect(page.locator(".available-room-table-head")).toContainText(/Room category/i);
  const firstRoomHref = await page.locator('.available-room-cta[href*="/checkout"]').first().getAttribute("href");
  expect(firstRoomHref).toContain("room_type_id=");
  await proceedToCheckout(page, /continue to checkout/i, bookingPanel);
  expect(new URL(page.url()).searchParams.get("room_type_id")).toBeTruthy();
  await expect(page.locator(".checkout-room-summary")).toContainText(/Selected room/i);
  await expect(page.locator(".checkout-room-summary")).toContainText(/Selected dates/i);
  await ensureCheckoutReady(page);
  await fillGuestDetails(page, "e2e");
  await page.getByRole("button", { name: /confirm booking/i }).click();

  await expect(page).toHaveURL(/\/checkout\/payment\?/);
  await expect(page.locator(".payment-booking-summary")).toContainText(/Payment summary/i);
  await expect(page.locator(".payment-method-card")).toHaveCount(3);
  const successParams = await payUntilConfirmed(page);
  expect(successParams.get("room_type_id")).toBeTruthy();
  await expect(page).toHaveURL(/\/checkout\/success\?/);
  await expect(page.locator("body")).toContainText(/booking confirmed/i);
  await expect(page.locator(".success-result-card")).toContainText(/Payment completed/i);
  await expect(page.locator(".success-booking-summary")).toContainText(/Room/i);
  await expect(page.locator(".success-next-card")).toContainText(/AI concierge/i);
});

test("checkout shows required-field errors and then allows booking", async ({ page }) => {
  await page.goto("/?lang=en&currency=USD");
  const cards = page.locator(".property-card .actions a");
  if ((await cards.count()) === 0) {
    await expect(page.locator("body")).toContainText(/no stays found|варианты не найдены/i);
    return;
  }
  await openFirstBookableStay(page);

  await expect(page).toHaveURL(/\/stays\/\d+/);
  const bookingPanel = await resolveBookingScope(page);
  await bookingPanel.getByLabel(/guests/i).fill("2");
  await pickBookableDates(page, {
    checkInLabel: /check-in/i,
    checkOutLabel: /check-out/i,
    continueButtonName: /continue to checkout/i,
    scope: bookingPanel,
  });
  await proceedToCheckout(page, /continue to checkout/i, bookingPanel);
  await ensureCheckoutReady(page);
  await page.getByRole("button", { name: /confirm booking/i }).click();

  await expect(page.locator(".form-status")).toContainText(/please complete required fields/i);
  await expect(page.locator(".field-error")).toHaveCount(3);

  await fillGuestDetails(page, "validation");
  await page.getByRole("button", { name: /confirm booking/i }).click();

  await expect(page).toHaveURL(/\/checkout\/payment\?/);
  await payUntilConfirmed(page);
  await expect(page).toHaveURL(/\/checkout\/success\?/);
});

test("checkout required-field errors are readable in russian", async ({ page }) => {
  await page.goto("/?lang=ru&currency=KZT");
  const cards = page.locator(".property-card .actions a");
  if ((await cards.count()) === 0) {
    await expect(page.locator("body")).toContainText(/варианты не найдены/i);
    return;
  }
  await openFirstBookableStay(page);

  await expect(page).toHaveURL(/\/stays\/\d+/);
  const bookingPanel = await resolveBookingScope(page);
  await bookingPanel.getByLabel(/гост/i).fill("2");
  await pickBookableDates(page, {
    checkInLabel: /заезд/i,
    checkOutLabel: /выезд/i,
    continueButtonName: /перейти к оформлению/i,
    scope: bookingPanel,
  });
  await proceedToCheckout(page, /перейти к оформлению/i, bookingPanel);
  await ensureCheckoutReady(page);
  await page.getByRole("button", { name: /подтвердить бронирование/i }).click();
  await expect(page.locator(".form-status")).toContainText(/заполните обязательные поля/i);
});

test("manager reservations dashboard exposes kpis and resets filters", async ({ page }) => {
  await page.goto("/login?lang=ru&currency=KZT");
  await page.getByLabel(/email/i).fill("admin@local.dev");
  await page.getByLabel(/password|пароль/i).fill("Admin12345!");
  await page.getByRole("button", { name: /войти|sign in/i }).click();
  await expect(page).toHaveURL(/\/manager/);

  await page.locator(".manager-tab-strip .view-toggle-btn").nth(1).click();
  await expect(page.locator(".manager-reservation-kpis article")).toHaveCount(4);
  await expect(page.locator(".payment-pill").first()).toBeVisible();
  await expect(page.locator(".manager-room-pill").first()).toBeVisible();

  const reservationSelects = page.locator(".manager-reservations select");
  const statusSelect = reservationSelects.nth(0);
  const paymentSelect = reservationSelects.nth(1);
  await expect(paymentSelect).toContainText(/Возврат/);

  await statusSelect.selectOption("confirmed");
  await paymentSelect.selectOption("paid");
  await expect(statusSelect).toHaveValue("confirmed");
  await expect(paymentSelect).toHaveValue("paid");

  await page.getByRole("button", { name: /сбросить/i }).click();
  await expect(statusSelect).toHaveValue("all");
  await expect(paymentSelect).toHaveValue("all");
});

test("partner manager shows cancellation terms preview and cancellation result", async ({ page }) => {
  await loginManagerByApi(page);
  const { listingId, range, roomTypeId } = await pickBookableManagerListingFromApi(page);
  const cancellationGuestEmail = `cancel_e2e_${Date.now()}@example.com`;
  const { reservationId } = await createConfirmedReservationByApi(page, {
    listingId,
    checkIn: range.checkIn,
    checkOut: range.checkOut,
    guestEmail: cancellationGuestEmail,
    roomTypeId,
  });

  await page.goto("/manager?lang=ru&currency=KZT");
  await expect(page).toHaveURL(/\/manager/);

  await page.getByRole("button", { name: /брон/i }).click();
  await page.getByPlaceholder(/имя, email, телефон/i).fill(cancellationGuestEmail);
  await page.getByRole("button", { name: /применить фильтры/i }).click();
  const reservationCard = page.locator(`#reservation-${reservationId}`);
  await expect(reservationCard).toBeVisible();

  await expect(reservationCard).toContainText(/KZT|\u20B8|%/i);

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await reservationCard.getByRole("button", { name: /Отменить бронь|Cancel booking/i }).click();

  await expect(reservationCard).toContainText(/Отменено|Cancelled/i);
  await expect(reservationCard).toContainText(/KZT|\u20B8|%/i);
});

test("ai concierge stage drives CTA visibility", async ({ page }) => {
  await page.route("**/chat/recommend*", async (route) => {
    let message = "";
    try {
      const raw = route.request().postData() || "{}";
      const requestBody = JSON.parse(raw) as { message?: string };
      message = (requestBody?.message || "").toLowerCase();
    } catch {
      message = "";
    }

    if (message.includes("book in almaty")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stage: "pricing",
          answer: "Подобрал варианты и могу перевести к оформлению.",
          selection_summary: "Этап: цена и условия",
          reasoning: "Лучший вариант по цене и рейтингу.",
          filters: {
            city: "Almaty",
            check_in: "2026-05-01",
            check_out: "2026-05-04",
            guests: 2,
            min_price: null,
            max_price: null,
            trip_purpose: null,
            q: null,
          },
          suggestions: [
            {
              listing_id: 161,
              title: "Partner Test Listing",
              city: "Almaty",
              district: "Medeu",
              nightly_price: 30000,
              rating: 4.8,
              max_guests: 3,
              reason: "Хороший баланс цены и качества.",
              amenities: "wifi, parking",
              cover_photo_url: null,
            },
          ],
          alternatives: [],
          total_found: 1,
          follow_up_prompts: ["Показать дешевле"],
          workflow_steps: [],
          next_action: {
            type: "go_checkout",
            label: "Перейти к оформлению",
            listing_id: 161,
            title: "Partner Test Listing",
            city: "Almaty",
            check_in: "2026-05-01",
            check_out: "2026-05-04",
            guests: 2,
          },
          session_id: "e2e_mock_session",
          booking_state: null,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: "collect",
        answer: "На какие даты нужен заезд и выезд?",
        selection_summary: "Этап: сбор данных",
        reasoning: "Нужны даты, чтобы проверить доступность.",
        filters: {
          city: "Almaty",
          check_in: null,
          check_out: null,
          guests: null,
          min_price: null,
          max_price: null,
          trip_purpose: null,
          q: null,
        },
        suggestions: [],
        alternatives: [],
        total_found: 0,
        follow_up_prompts: ["1-5 мая"],
        workflow_steps: [],
        next_action: {
          type: "none",
          label: "none",
        },
        session_id: "e2e_mock_session",
        booking_state: null,
      }),
    });
  });

  await page.goto("/?lang=en&currency=USD&e2e_stage=1");

  const chatForm = page.locator(".ai-concierge-form");
  await expect(chatForm).toBeVisible();

  const chatInput = chatForm.locator("input").first();
  await chatInput.click();
  await chatInput.fill("find options in almaty");
  await expect(chatInput).toHaveValue("find options in almaty");
  await chatInput.press("Enter");
  await expect(page.locator(".ai-message.ai-message-user")).toHaveCount(1, { timeout: 10000 });

  const collectMessage = page.locator(".ai-message.ai-message-assistant").last();
  await expect(collectMessage).toContainText(/dates|даты|заезд/i, { timeout: 15000 });
  await expect(collectMessage.locator(".ai-next-action-btn")).toHaveCount(0);

  await chatInput.fill("book in almaty 2026-05-01 to 2026-05-04 for 2 guests");
  await expect(chatInput).toHaveValue("book in almaty 2026-05-01 to 2026-05-04 for 2 guests");
  await chatInput.press("Enter");

  const pricingMessage = page.locator(".ai-message.ai-message-assistant").last();
  await expect(pricingMessage).toContainText(/подобрал|found|вариант|good options/i, { timeout: 15000 });
  await expect(pricingMessage.locator(".ai-next-action-btn")).toHaveCount(1);
});

test("ai concierge booking reaches account and stay services", async ({ page }) => {
  const guestEmail = `ai_regression_${Date.now()}@example.com`;

  await page.goto("/?lang=ru&currency=KZT&city=Dubai&guests=2");
  const chatForm = page.locator(".ai-concierge-form");
  await expect(chatForm).toBeVisible();

  const chatInput = chatForm.locator("input").first();
  await chatInput.fill("Dubai hotel 2026-06-13 to 2026-06-16 for 2 guests");
  await chatInput.press("Enter");

  const firstBookButton = page.locator(".ai-apply-btn").first();
  await expect(firstBookButton).toBeVisible({ timeout: 20000 });
  const firstStayHref = await page.locator('.ai-message.ai-message-assistant a[href*="room_type_id"]').first().getAttribute("href");
  expect(firstStayHref).toContain("room_type_id=");
  expect(firstStayHref).toContain("#available-rooms");

  await firstBookButton.click();
  const bookingForm = page.locator(".ai-booking-form");
  await expect(bookingForm).toBeVisible({ timeout: 10000 });
  const bookingInputs = bookingForm.locator("input");
  await bookingInputs.nth(0).fill("AI Regression Guest");
  await bookingInputs.nth(1).fill(guestEmail);
  await bookingInputs.nth(2).fill("+77001234567");
  await bookingInputs.nth(3).fill("15:30");
  await bookingForm.locator("button").first().click();

  await expect(page).toHaveURL(/\/checkout\/payment\?/);
  const paymentParams = new URL(page.url()).searchParams;
  expect(paymentParams.get("room_type_id")).toBeTruthy();
  expect(paymentParams.get("room_type_name")).toBeTruthy();
  expect(paymentParams.get("access_token")).toBeTruthy();

  const successParams = await payUntilConfirmed(page);
  const reservationId = successParams.get("reservation_id") || "";
  expect(successParams.get("payment_status")).toBe("paid");
  expect(successParams.get("reservation_status")).toBe("confirmed");
  expect(successParams.get("room_type_id")).toBeTruthy();
  expect(successParams.get("access_token")).toBeTruthy();

  await page.locator('.actions a[href^="/account"]').first().click();
  await expect(page).toHaveURL(/\/account\?/);

  const focusCard = page.locator(".account-focus-card").first();
  await expect(focusCard).toBeVisible({ timeout: 15000 });
  await expect(focusCard).toContainText(`#${reservationId}`);
  await expect(focusCard.locator('a[href*="#in-stay-concierge"]').first()).toBeVisible();

  const serviceHub = page.locator(".account-service-hub").first();
  await expect(serviceHub).toBeVisible({ timeout: 15000 });
  await expect(serviceHub).toContainText(/Сервисы проживания|Stay services/i);
  await expect(serviceHub.locator('a[href*="#in-stay-concierge"]').first()).toBeVisible();

  const reservationCard = page.locator(".account-booking-card").filter({ hasText: `#${reservationId}` }).first();
  await expect(reservationCard).toBeVisible({ timeout: 15000 });
  await expect(reservationCard).toHaveClass(/highlighted/);
  await expect(reservationCard).toContainText(/Apartment Standard|Категория/i);

  const stayServicesLink = reservationCard.locator('a[href*="#in-stay-concierge"]').first();
  await expect(stayServicesLink).toBeVisible();
  const stayServicesHref = await stayServicesLink.getAttribute("href");
  expect(stayServicesHref).toContain("from_payment=1");
  expect(stayServicesHref).toContain("concierge=1");

  await stayServicesLink.click();
  await expect(page).toHaveURL(/#in-stay-concierge/);
  await expect(page.locator("#in-stay-concierge")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#in-stay-concierge")).toContainText(/AI-консьерж|AI concierge/i);
});

test("partner creates restaurant and guest books a table via in-stay concierge", async ({ page }) => {
  await loginManagerByApi(page);
  await page.goto("/manager?lang=ru&currency=KZT");
  await expect(page).toHaveURL(/\/manager/);
  await page.getByRole("button", { name: /In-stay/i }).click();

  const inStayDetails = page
    .locator("details.manager-collapsible")
    .filter({ hasText: /In-stay сервис|In-stay service/i })
    .first();
  await expect(inStayDetails).toBeVisible();
  const isOpen = await inStayDetails.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) {
    await inStayDetails.locator("summary").click();
  }
  const { listingId } = await pickBookableManagerListingFromApi(page);
  const listingSelect = inStayDetails.locator("select").first();
  await listingSelect.selectOption(String(listingId));

  const restaurantName = `E2E Bistro ${Date.now()}`;
  const restaurantDescription = `E2E restaurant ${Date.now()} for table booking flow`;
  const restaurantForm = inStayDetails
    .locator("form")
    .filter({ hasText: /Добавить ресторан|Add restaurant/i })
    .first();
  await restaurantForm.getByPlaceholder(/Название ресторана|Restaurant name/i).fill(restaurantName);
  await restaurantForm.getByPlaceholder(/Кухня|Cuisine/i).fill("Fusion");
  await restaurantForm.getByPlaceholder(/Средний чек|Average bill/i).fill("12000");
  await restaurantForm.getByPlaceholder(/Описание|Description/i).fill(restaurantDescription);
  const restaurantCreateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/in-stay/listings/${listingId}/restaurants`),
    { timeout: 15000 },
  );
  await restaurantForm.getByRole("button", { name: /Добавить ресторан|Add restaurant/i }).click();
  const restaurantCreateResponse = await restaurantCreateResponsePromise;
  expect(restaurantCreateResponse.ok()).toBeTruthy();
  await inStayDetails.getByRole("button", { name: /Обновить|Refresh/i }).click();
  await expect(inStayDetails).toContainText(restaurantDescription);

  await page.evaluate(() => {
    localStorage.removeItem("findapart_token");
  });

  await page.goto(`/stays/${listingId}?lang=en&currency=USD`);
  await expect(page).toHaveURL(/\/stays\/\d+/);
  await page.getByLabel(/guests|гост/i).fill("2");
  await pickBookableDates(page, {
    checkInLabel: /check-in|заезд/i,
    checkOutLabel: /check-out|выезд/i,
    continueButtonName: /continue to checkout|перейти к оформлению/i,
  });
  await proceedToCheckout(page, /continue to checkout|перейти к оформлению/i);

  const guestEmail = `restaurant_flow_${Date.now()}@example.com`;
  await ensureCheckoutReady(page);
  await page.getByPlaceholder(/full name|имя и фамилия/i).fill("Restaurant Flow E2E");
  await page.getByPlaceholder(/email/i).fill(guestEmail);
  await page.getByPlaceholder(/phone|телефон/i).fill("+77007779900");
  await page.getByRole("button", { name: /confirm booking|подтвердить бронирование/i }).click();
  await expect(page).toHaveURL(/\/checkout\/payment\?/, { timeout: 15000 });

  const successParams = await payUntilConfirmed(page, 3);
  const reservationId = Number(successParams.get("reservation_id") || "0");
  const accessToken = successParams.get("access_token") || "";
  expect(reservationId).toBeGreaterThan(0);

  await page.goto(`/stays/${listingId}?lang=ru&currency=USD&reservation_id=${reservationId}&guest_email=${encodeURIComponent(guestEmail)}&access_token=${encodeURIComponent(accessToken)}`);
  await expect(page.locator("body")).toContainText(/AI-консьерж/i);
  await expect(page.locator("body")).toContainText(restaurantDescription);

  const tableForm = page
    .locator("section.property-detail")
    .filter({ hasText: /AI-консьерж/i })
    .locator(".booking-form")
    .first();

  const optionLabel = ((await tableForm.locator("select option:not([disabled])").first().textContent()) || "").trim();
  expect(optionLabel.length).toBeGreaterThan(0);

  const concierge = page.locator("#in-stay-concierge");
  const chatForm = concierge.locator(".in-stay-chat-form");
  await chatForm.locator("input").fill("какие рестораны есть у этого отеля?");
  await chatForm.getByRole("button", { name: /Отправить/i }).click();
  const restaurantListAnswer = concierge.locator(".ai-message.ai-message-assistant").last();
  await expect(restaurantListAnswer).toContainText(/Доступные рестораны отеля/i);
  await expect(restaurantListAnswer).toContainText(optionLabel);

  await chatForm.locator("input").fill(`забронируй столик в ${restaurantName} завтра в 20:15 на 3 гостей`);
  await chatForm.getByRole("button", { name: /Отправить/i }).click();
  const chatBookButton = concierge.locator(".in-stay-message-actions button").filter({ hasText: /Забронировать столик/i }).last();
  await expect(chatBookButton).toBeVisible({ timeout: 10000 });
  const restaurantBookingResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/in-stay/restaurant-bookings"),
    { timeout: 15000 },
  );
  await chatBookButton.click();
  const restaurantBookingResponse = await restaurantBookingResponsePromise;
  expect(restaurantBookingResponse.ok()).toBeTruthy();
  const restaurantBookingPayload = (await restaurantBookingResponse.json()) as { restaurant_name?: string; guests?: number; booking_time?: string };
  expect(restaurantBookingPayload.restaurant_name).toBe(restaurantName);
  expect(restaurantBookingPayload.guests).toBe(3);
  expect(restaurantBookingPayload.booking_time).toBe("20:15");
  const bookedRestaurantName = restaurantBookingPayload.restaurant_name || restaurantName;

  await expect(page.locator(".form-status")).toContainText(/Столик забронирован/i);
  const tableBookingsSection = page
    .locator("section.property-detail")
    .filter({ hasText: /Ваши брони столиков/i })
    .first();
  await expect(tableBookingsSection).toContainText(bookedRestaurantName);
  await expect(page.locator(".form-status")).not.toContainText(/Failed to fetch/i);

  await loginManagerByApi(page);
  await page.goto("/manager?lang=ru&currency=KZT");
  await expect(page).toHaveURL(/\/manager/);
  await page.getByRole("button", { name: /In-stay/i }).click();
  const managerInStay = page
    .locator("details.manager-collapsible")
    .filter({ hasText: /In-stay сервис|In-stay service/i })
    .first();
  await managerInStay.locator("select").first().selectOption(String(listingId));
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/in-stay/restaurant-bookings/mine") && response.ok(), {
      timeout: 15000,
    }),
    managerInStay.getByRole("button", { name: /Обновить|Refresh/i }).click(),
  ]);
  const commandCenter = managerInStay.locator(".manager-service-command-center");
  await expect(commandCenter).toBeVisible();
  const tableCommand = commandCenter.locator(".manager-service-command-row").filter({ hasText: guestEmail }).first();
  await expect(tableCommand).toBeVisible({ timeout: 15000 });
  await expect(tableCommand).toContainText(/Столик/i);
  await expect(tableCommand).toContainText(bookedRestaurantName);
  await expect(tableCommand.locator(".manager-sla-pill")).toBeVisible();
  const confirmTableResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/in-stay/restaurant-bookings/") &&
      response.url().includes("/status") &&
      response.ok(),
    { timeout: 15000 },
  );
  await tableCommand.getByRole("button", { name: /Подтвердить/i }).click();
  await confirmTableResponsePromise;
  await expect(tableCommand).toContainText(/Подтвержден[ао]/i);
});

test("room service order moves from guest to manager and back to guest status", async ({ page }) => {
  const menuItemName = `E2E Burger ${Date.now()}`;
  const guestEmail = `room_service_flow_${Date.now()}@example.com`;

  await loginManagerByApi(page);
  const { listingId, range, roomTypeId } = await pickBookableManagerListingFromApi(page);
  const menuResponse = await page.request.post(`${e2eApiBase()}/in-stay/listings/${listingId}/menu`, {
    data: {
      name: menuItemName,
      price: 7900,
      category: "food",
      description: "E2E room service burger",
      is_active: true,
      sort_order: 0,
    },
  });
  expect(menuResponse.ok()).toBeTruthy();

  const { reservationId, accessToken } = await createConfirmedReservationByApi(page, {
    listingId,
    checkIn: range.checkIn,
    checkOut: range.checkOut,
    guestEmail,
    roomTypeId,
  });
  expect(accessToken).toBeTruthy();

  await clearClientSession(page);

  const stayUrl = `/stays/${listingId}?lang=ru&currency=KZT&reservation_id=${reservationId}&guest_email=${encodeURIComponent(guestEmail)}&access_token=${encodeURIComponent(accessToken)}&concierge=1#in-stay-concierge`;
  await page.goto(stayUrl);
  const guestInStay = page.locator("#in-stay-concierge");
  await expect(guestInStay).toBeVisible({ timeout: 15000 });
  await expect(guestInStay).toContainText(menuItemName);
  const chatForm = guestInStay.locator(".in-stay-chat-form");
  await chatForm.locator("input").fill(`закажи ${menuItemName} в номер`);
  await chatForm.getByRole("button", { name: /Отправить/i }).click();
  const chatOrderButton = guestInStay.locator(".in-stay-message-actions button").filter({ hasText: /Отправить заказ/i }).last();
  await expect(chatOrderButton).toBeVisible({ timeout: 10000 });
  const roomOrderResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/in-stay/orders"),
    { timeout: 15000 },
  );
  await chatOrderButton.click();
  const roomOrderResponse = await roomOrderResponsePromise;
  expect(roomOrderResponse.ok()).toBeTruthy();
  await expect(page.locator(".form-status")).toContainText(/Заказ отправлен/i);
  const guestOrderRow = guestInStay.locator(".in-stay-history-row").filter({ hasText: menuItemName }).first();
  await expect(guestOrderRow).toContainText(/Отправлен/i);

  await loginManagerByApi(page);
  await page.goto("/manager?lang=ru&currency=KZT");
  await expect(page).toHaveURL(/\/manager/);
  await page.getByRole("button", { name: /In-stay/i }).click();
  const managerInStay = page
    .locator("details.manager-collapsible")
    .filter({ hasText: /In-stay сервис|In-stay service/i })
    .first();
  await managerInStay.locator("select").first().selectOption(String(listingId));
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/in-stay/orders/mine") && response.ok(), {
      timeout: 15000,
    }),
    managerInStay.getByRole("button", { name: /Обновить/i }).click(),
  ]);
  const commandCenter = managerInStay.locator(".manager-service-command-center");
  await expect(commandCenter).toBeVisible();
  const roomCommand = commandCenter.locator(".manager-service-command-row").filter({ hasText: menuItemName }).first();
  await expect(roomCommand).toBeVisible({ timeout: 15000 });
  await expect(roomCommand).toContainText(/Room service/i);
  await expect(roomCommand.locator(".manager-sla-pill")).toBeVisible();
  const managerFocus = managerInStay.locator(".manager-instay-focus");
  await expect(managerFocus).toContainText(/Операционный фокус/i);
  await expect(managerFocus).toContainText(/Room service/i);
  await expect(roomCommand).toContainText(/Ожидает|Ждет|В норме/i);
  const managerOrderRecord = managerInStay.locator(".manager-room-order-row").filter({ hasText: menuItemName }).first();
  await expect(managerOrderRecord).toBeVisible();
  const acceptOrderResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/in-stay/orders/") &&
      response.url().includes("/status") &&
      response.ok(),
    { timeout: 15000 },
  );
  await roomCommand.getByRole("button", { name: /Принять/i }).click();
  await acceptOrderResponsePromise;
  await expect(managerOrderRecord).toContainText(/Принят/i);

  await page.goto(stayUrl);
  await expect(page.locator("#in-stay-concierge")).toBeVisible({ timeout: 15000 });
  await page.locator("#in-stay-concierge").getByRole("button", { name: /Обновить/i }).click();
  const updatedGuestOrder = page.locator("#in-stay-concierge .in-stay-history-row").filter({ hasText: menuItemName }).first();
  await expect(updatedGuestOrder).toContainText(/Принят/i);
  const statusChatForm = page.locator("#in-stay-concierge .in-stay-chat-form");
  await statusChatForm.locator("input").fill("покажи статус заявок");
  await statusChatForm.getByRole("button", { name: /Отправить/i }).click();
  const statusAnswer = page.locator("#in-stay-concierge .ai-message.ai-message-assistant").last();
  await expect(statusAnswer).toContainText(/По этой брони/i);
  await expect(statusAnswer).toContainText(menuItemName);
  await expect(statusAnswer).toContainText(/Принят/i);

  const accountUrl = `/account?lang=ru&currency=KZT&guest_email=${encodeURIComponent(guestEmail)}&reservation_id=${reservationId}&access_token=${encodeURIComponent(accessToken)}`;
  await page.goto(accountUrl);
  const accountReservation = page.locator(".account-booking-card").filter({ hasText: `#${reservationId}` }).first();
  await expect(accountReservation).toBeVisible({ timeout: 15000 });
  const accountInStay = accountReservation.locator(".account-instay-card");
  await expect(accountInStay).toContainText(/Сервисы проживания/i);
  await expect(accountInStay.locator(".account-instay-stats")).toContainText(/Room service/i);
  await expect(accountInStay).toContainText(menuItemName, { timeout: 15000 });
  await expect(accountInStay).toContainText(/Принят/i);
});

test("manager edits and hides in-stay catalog items", async ({ page }) => {
  await loginManagerByApi(page);
  const { listingId } = await pickBookableManagerListingFromApi(page);
  const suffix = Date.now();
  const menuItemName = `Catalog Pasta ${suffix}`;
  const editedMenuItemName = `${menuItemName} Edited`;
  const restaurantName = `Catalog Bistro QA${suffix}`;
  const editedRestaurantName = `${restaurantName} Edited`;

  const menuResponse = await page.request.post(`${e2eApiBase()}/in-stay/listings/${listingId}/menu`, {
    data: {
      name: menuItemName,
      price: 5100,
      category: "food",
      description: "Manager catalog edit menu item",
      is_active: true,
      sort_order: 0,
    },
  });
  expect(menuResponse.ok()).toBeTruthy();
  const menuPayload = (await menuResponse.json()) as { id: number };

  const restaurantResponse = await page.request.post(`${e2eApiBase()}/in-stay/listings/${listingId}/restaurants`, {
    data: {
      name: restaurantName,
      cuisine: "Italian",
      description: "Manager catalog edit restaurant",
      open_from: "08:00",
      open_to: "23:00",
      avg_check_kzt: 15000,
      is_active: true,
    },
  });
  expect(restaurantResponse.ok()).toBeTruthy();
  const restaurantPayload = (await restaurantResponse.json()) as { id: number };

  await page.goto("/manager?lang=ru&currency=KZT");
  await page.getByRole("button", { name: /In-stay/i }).click();
  const inStayDetails = page
    .locator("details.manager-collapsible")
    .filter({ hasText: /In-stay сервис|In-stay service/i })
    .first();
  await expect(inStayDetails).toBeVisible();
  await inStayDetails.locator("select").first().selectOption(String(listingId));
  await expect(inStayDetails).toContainText(menuItemName);
  await expect(inStayDetails).toContainText(restaurantName);

  await inStayDetails.locator('input[placeholder="Поиск по меню"]').fill(menuItemName);
  let menuRow = inStayDetails.locator(".manager-catalog-list .manager-item").filter({ hasText: menuItemName }).first();
  await expect(menuRow).toBeVisible();
  await menuRow.getByRole("button", { name: /Редактировать/i }).click();
  const menuEditRow = inStayDetails.locator(".manager-catalog-list .manager-item.is-editing").first();
  await expect(menuEditRow).toBeVisible();
  await menuEditRow.getByPlaceholder("Название позиции").fill(editedMenuItemName);
  const menuPatchPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/in-stay/menu/${menuPayload.id}`) &&
      response.ok(),
    { timeout: 15000 },
  );
  await menuEditRow.getByRole("button", { name: /Сохранить/i }).click();
  await menuPatchPromise;
  await inStayDetails.locator('input[placeholder="Поиск по меню"]').fill(editedMenuItemName);
  menuRow = inStayDetails.locator(".manager-catalog-list .manager-item").filter({ hasText: editedMenuItemName }).first();
  await expect(menuRow).toBeVisible();
  const menuHidePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/in-stay/menu/${menuPayload.id}`) &&
      response.ok(),
    { timeout: 15000 },
  );
  await menuRow.getByRole("button", { name: /Скрыть/i }).click();
  await menuHidePromise;

  await inStayDetails.locator('input[placeholder="Поиск по ресторанам"]').fill(restaurantName);
  let restaurantRow = inStayDetails.locator(".manager-catalog-list .manager-item").filter({ hasText: restaurantName }).first();
  await expect(restaurantRow).toBeVisible();
  await restaurantRow.getByRole("button", { name: /Редактировать/i }).click();
  const restaurantEditRow = inStayDetails.locator(".manager-catalog-list .manager-item.is-editing").first();
  await expect(restaurantEditRow).toBeVisible();
  await restaurantEditRow.getByPlaceholder("Название ресторана").fill(editedRestaurantName);
  const restaurantPatchPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/in-stay/restaurants/${restaurantPayload.id}`) &&
      response.ok(),
    { timeout: 15000 },
  );
  await restaurantEditRow.getByRole("button", { name: /Сохранить/i }).click();
  await restaurantPatchPromise;
  await inStayDetails.locator('input[placeholder="Поиск по ресторанам"]').fill(editedRestaurantName);
  restaurantRow = inStayDetails.locator(".manager-catalog-list .manager-item").filter({ hasText: editedRestaurantName }).first();
  await expect(restaurantRow).toBeVisible();
  const restaurantHidePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/in-stay/restaurants/${restaurantPayload.id}`) &&
      response.ok(),
    { timeout: 15000 },
  );
  await restaurantRow.getByRole("button", { name: /Скрыть/i }).click();
  await restaurantHidePromise;

  const activeMenuResponse = await page.request.get(`${e2eApiBase()}/in-stay/listings/${listingId}/menu?only_active=true`);
  expect(activeMenuResponse.ok()).toBeTruthy();
  const activeMenu = (await activeMenuResponse.json()) as Array<{ name: string }>;
  expect(activeMenu.some((item) => item.name === editedMenuItemName)).toBe(false);

  const activeRestaurantsResponse = await page.request.get(`${e2eApiBase()}/in-stay/listings/${listingId}/restaurants?only_active=true`);
  expect(activeRestaurantsResponse.ok()).toBeTruthy();
  const activeRestaurants = (await activeRestaurantsResponse.json()) as Array<{ name: string }>;
  expect(activeRestaurants.some((item) => item.name === editedRestaurantName)).toBe(false);
});








