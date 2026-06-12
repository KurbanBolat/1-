import { expect, test } from "@playwright/test";

function mockSearchResponse() {
  return {
    stage: "search",
    answer: "Подобрал варианты по вашему запросу.",
    selection_summary: "Этап: поиск",
    reasoning: "Лучшие варианты по релевантности.",
    filters: {
      city: "Almaty",
      check_in: "2026-05-10",
      check_out: "2026-05-13",
      guests: 2,
      min_price: null,
      max_price: 45000,
      trip_purpose: "business",
      q: null,
    },
    suggestions: [
      {
        listing_id: 161,
        title: "Skyline Suites Almaty #1",
        city: "Almaty",
        district: "Medeu",
        nightly_price: 42000,
        rating: 4.8,
        max_guests: 3,
        reason: "рядом с центром и стабильный wifi",
        cover_photo_url: null,
      },
      {
        listing_id: 162,
        title: "Central Loft Almaty #2",
        city: "Almaty",
        district: "Bostandyk",
        nightly_price: 39000,
        rating: 4.7,
        max_guests: 2,
        reason: "лучший баланс цена/качество",
        cover_photo_url: null,
      },
    ],
    alternatives: [],
    total_found: 2,
    follow_up_prompts: ["Покажи ближе к центру", "Покажи дешевле"],
    workflow_steps: [],
    next_action: {
      type: "start_booking",
      label: "Забронировать",
      listing_id: 161,
      title: "Skyline Suites Almaty #1",
      city: "Almaty",
      check_in: "2026-05-10",
      check_out: "2026-05-13",
      guests: 2,
    },
    session_id: "e2e_chat_session",
    booking_state: null,
  };
}

test("ai concierge explains why options were selected", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/chat/recommend", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockSearchResponse()),
    });
  });

  await page.goto("/?lang=ru&currency=USD");
  const chatInput = page.locator(".ai-concierge-form input").first();
  await chatInput.fill("Алматы, 2 гостя, 10-13 мая, до 45000");
  await chatInput.press("Enter");

  const assistantMsg = page.locator(".ai-message.ai-message-assistant").last();
  await expect(assistantMsg).toContainText(/подобрал|нашел|понял задачу|shortlisted|found|got it/i);
  await expect(assistantMsg).toContainText(/свободные номера|available rooms|free rooms/i);
  await expect(assistantMsg).toContainText(/баланс цена\/качество|wifi/i);

  await expect(page.locator(".ai-suggestion-card")).toHaveCount(2);
});

test("ai concierge recommends hotel restaurants and guides booking flow", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/chat/recommend", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockSearchResponse()),
    });
  });

  await page.route("**/in-stay/listings/161/restaurants?only_active=true", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 77,
          listing_id: 161,
          name: "Sky Bistro",
          cuisine: "European",
          description: "Panoramic city view",
          open_from: "08:00",
          open_to: "23:00",
          avg_check_kzt: 14000,
          is_active: true,
        },
      ]),
    });
  });

  await page.goto("/?lang=ru&currency=USD");
  const chatInput = page.locator(".ai-concierge-form input").first();
  await chatInput.fill("найди варианты в алматы 10-13 мая 2 гостя");
  await chatInput.press("Enter");
  await expect(page.locator(".ai-message.ai-message-assistant").last()).toContainText(
    /подобрал|нашел|понял задачу|shortlisted|found|got it/i,
  );

  await chatInput.fill("какие рестораны есть у этого отеля?");
  await chatInput.press("Enter");

  const assistantMsg = page.locator(".ai-message.ai-message-assistant").last();
  await expect(assistantMsg).toContainText(/ресторан|restaurant|sky bistro/i);
  await expect(assistantMsg).toContainText(/Sky Bistro/);
  await expect(assistantMsg).toContainText(/дата|время|гости|date|time|guests/i);
});

test("ai concierge recommends dishes with clear reasons", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/chat/recommend", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockSearchResponse()),
    });
  });

  await page.route("**/in-stay/listings/161/menu?only_active=true", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1,
          listing_id: 161,
          name: "Classic Burger",
          description: "Beef burger with fries",
          price: 5800,
          category: "main",
          is_active: true,
          sort_order: 1,
        },
        {
          id: 2,
          listing_id: 161,
          name: "Caesar Salad",
          description: "Fresh salad",
          price: 4900,
          category: "salad",
          is_active: true,
          sort_order: 2,
        },
        {
          id: 3,
          listing_id: 161,
          name: "Steak Plate",
          description: "Premium beef steak",
          price: 14500,
          category: "main",
          is_active: true,
          sort_order: 3,
        },
      ]),
    });
  });

  await page.goto("/?lang=en&currency=USD");
  const chatInput = page.locator(".ai-concierge-form input").first();
  await chatInput.fill("find options in almaty may 10-13 for 2 guests");
  await chatInput.press("Enter");
  await expect(page.locator(".ai-message.ai-message-assistant").last()).toContainText(
    /shortlisted|found|подобрал|нашел|понял задачу|got it/i,
  );

  await chatInput.fill("i want a cheap burger");
  await chatInput.press("Enter");

  const assistantMsg = page.locator(".ai-message.ai-message-assistant").last();
  await expect(assistantMsg).toContainText(/menu|dish|блюд|burger/i);
  await expect(assistantMsg).toContainText(/Classic Burger/);
  await expect(assistantMsg).toContainText(/matches your burger request|burger|дешев|budget|best/i);
});

test("ai quick replies update shortlist cards immediately", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/chat/recommend", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockSearchResponse()),
    });
  });

  await page.route("**/listings?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: 1999,
            title: "Budget Center Loft",
            city: "Almaty",
            district: "Almaly",
            property_type: "Apartment",
            nightly_price: 18000,
            cleaning_fee: 4000,
            service_fee_percent: 12,
            cancellation_policy: "flexible",
            rating: 4.7,
            max_guests: 2,
            bedrooms: 1,
            bathrooms: 1,
            amenities: "wifi,kitchen",
            description: "quick refresh test listing",
            is_active: true,
            owner_id: 1,
            cover_photo_url: null,
          },
          {
            id: 2000,
            title: "Cozy Center Studio",
            city: "Almaty",
            district: "Medeu",
            property_type: "Apartment",
            nightly_price: 21000,
            cleaning_fee: 4000,
            service_fee_percent: 12,
            cancellation_policy: "flexible",
            rating: 4.6,
            max_guests: 2,
            bedrooms: 1,
            bathrooms: 1,
            amenities: "wifi",
            description: "quick refresh test listing 2",
            is_active: true,
            owner_id: 1,
            cover_photo_url: null,
          },
        ],
        total: 2,
        page: 1,
        page_size: 24,
      }),
    });
  });

  await page.goto("/?lang=ru&currency=USD");
  const chatInput = page.locator(".ai-concierge-form input").first();
  await chatInput.fill("Алматы, 2 гостя, 10-13 мая, до 45000");
  await chatInput.press("Enter");
  await expect(page.locator(".ai-message.ai-message-assistant").last()).toContainText(/нашел|подобрал|понял задачу/i);

  await chatInput.fill("покажи дешевле");
  await chatInput.press("Enter");

  const assistantMsg = page.locator(".ai-message.ai-message-assistant").last();
  await expect(assistantMsg).toContainText(/дешевле|price/i);
  await expect(assistantMsg.locator(".ai-suggestion-card")).toHaveCount(2);
  await expect(assistantMsg.locator(".ai-suggestion-card").first()).toContainText("Budget Center Loft");
});

test("ai keeps one-step flow and accepts short numeric guest reply", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  let callCount = 0;

  await page.route("**/chat/recommend", async (route) => {
    callCount += 1;
    const payload = route.request().postDataJSON() as { message?: string };
    const message = payload?.message || "";

    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stage: "collect",
          answer: "Сколько будет гостей?",
          selection_summary: "collect guests",
          reasoning: "collect_guests",
          filters: {
            city: "Almaty",
            check_in: "2026-05-10",
            check_out: "2026-05-13",
            guests: null,
            min_price: null,
            max_price: null,
            trip_purpose: null,
            q: null,
          },
          suggestions: [],
          alternatives: [],
          total_found: 0,
          follow_up_prompts: [],
          workflow_steps: [],
          next_action: { type: "none", label: "Уточнить гостей" },
          session_id: "collect_guest_e2e",
          booking_state: null,
        }),
      });
      return;
    }

    const normalized = message.toLowerCase();
    const hasGuests = /(\b2\s*guest|\b2\s*гост)/i.test(normalized);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: "search",
        answer: hasGuests ? "Понял, продолжаю подбор." : "Нужны гости.",
        selection_summary: "search",
        reasoning: "search_ready",
        filters: {
          city: "Almaty",
          check_in: "2026-05-10",
          check_out: "2026-05-13",
          guests: hasGuests ? 2 : null,
          min_price: null,
          max_price: null,
          trip_purpose: null,
          q: null,
        },
        suggestions: hasGuests
          ? [
              {
                listing_id: 161,
                title: "Skyline Suites Almaty #1",
                city: "Almaty",
                district: "Medeu",
                nightly_price: 42000,
                rating: 4.8,
                max_guests: 3,
                reason: "подходит по датам и гостям",
                cover_photo_url: null,
              },
            ]
          : [],
        alternatives: [],
        total_found: hasGuests ? 1 : 0,
        follow_up_prompts: [],
        workflow_steps: [],
        next_action: hasGuests
          ? {
              type: "start_booking",
              label: "Забронировать",
              listing_id: 161,
              title: "Skyline Suites Almaty #1",
              city: "Almaty",
              check_in: "2026-05-10",
              check_out: "2026-05-13",
              guests: 2,
            }
          : { type: "none", label: "Уточнить гостей" },
        session_id: "collect_guest_e2e",
        booking_state: null,
      }),
    });
  });

  await page.goto("/?lang=ru&currency=USD");
  const chatInput = page.locator(".ai-concierge-form input").first();
  await chatInput.fill("Алматы, 10-13 мая");
  await chatInput.press("Enter");
  await expect(page.locator(".ai-message.ai-message-assistant").last()).toContainText(/гост|сколько/i);

  await chatInput.fill("2");
  await chatInput.press("Enter");
  const assistantMsg = page.locator(".ai-message.ai-message-assistant").last();
  await expect(assistantMsg).toContainText(/понял|подходящ|вариант|search/i);
  await expect(assistantMsg.locator(".ai-suggestion-card")).toHaveCount(1);
  await expect(assistantMsg.locator(".ai-suggestion-card").first()).toContainText("Skyline Suites Almaty #1");
});

test("ai concierge always shows only top 3 suggestions", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/chat/recommend", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: "search",
        answer: "Подобрал варианты.",
        selection_summary: "search",
        reasoning: "top_ranking",
        filters: {
          city: "Almaty",
          check_in: "2026-05-10",
          check_out: "2026-05-13",
          guests: 2,
          min_price: null,
          max_price: 50000,
          trip_purpose: "business",
          q: null,
        },
        suggestions: Array.from({ length: 6 }).map((_, idx) => ({
          listing_id: 3000 + idx,
          title: `Ranked Option #${idx + 1}`,
          city: "Almaty",
          district: "Medeu",
          nightly_price: 30000 + idx * 1000,
          rating: 4.8 - idx * 0.1,
          max_guests: 3,
          reason: "высокий рейтинг и цена",
          cover_photo_url: null,
        })),
        alternatives: [],
        total_found: 6,
        follow_up_prompts: ["Покажи дешевле"],
        workflow_steps: [],
        next_action: {
          type: "start_booking",
          label: "Забронировать",
          listing_id: 3000,
          title: "Ranked Option #1",
          city: "Almaty",
          check_in: "2026-05-10",
          check_out: "2026-05-13",
          guests: 2,
        },
        session_id: "top3_limit_e2e",
        booking_state: null,
      }),
    });
  });

  await page.goto("/?lang=ru&currency=USD");
  const chatInput = page.locator(".ai-concierge-form input").first();
  await chatInput.fill("алматы 2 гостя 10-13 мая до 50000");
  await chatInput.press("Enter");

  const assistantMsg = page.locator(".ai-message.ai-message-assistant").last();
  await expect(assistantMsg.locator(".ai-suggestion-card")).toHaveCount(3);
  await expect(assistantMsg).toContainText(/подобрал 3 варианта|3 good options|3 options/i);
  await expect(assistantMsg).not.toContainText("Ranked Option #4");
});

test("booking mode hides shortlist and focuses only on reservation steps", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/chat/recommend", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockSearchResponse()),
    });
  });

  await page.goto("/?lang=ru&currency=USD");
  const chatInput = page.locator(".ai-concierge-form input").first();
  await chatInput.fill("Алматы, 2 гостя, 10-13 мая, до 45000");
  await chatInput.press("Enter");
  await expect(page.locator(".ai-message.ai-message-assistant").last()).toContainText(/подобрал|варианта|found|got it/i);

  await chatInput.fill("готов бронировать");
  await chatInput.press("Enter");

  await expect(page.locator(".ai-booking-mode")).toContainText(/Режим бронирования|Booking mode/i);
  await expect(page.locator(".ai-suggestion-card")).toHaveCount(0);
  await expect(page.locator(".ai-booking-collapsible")).toBeVisible();

  await chatInput.fill("покажи дешевле");
  await chatInput.press("Enter");
  await expect(page.locator(".ai-message.ai-message-assistant").last()).toContainText(/имя|full name|email|почт/i);
  await expect(page.locator(".ai-suggestion-card")).toHaveCount(0);
});
