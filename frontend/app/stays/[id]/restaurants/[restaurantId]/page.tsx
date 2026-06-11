import Link from "next/link";
import { notFound } from "next/navigation";

import RestaurantBookingForm from "../../../../../components/RestaurantBookingForm";
import StayPilotShell from "../../../../../components/StayPilotShell";
import { getListing, getListingRestaurants } from "../../../../../lib/api";
import { formatPriceFromKzt } from "../../../../../lib/moneyUi";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

const t = {
  en: {
    backToStay: "Back to stay",
    title: "Restaurant",
    cuisine: "Cuisine",
    openHours: "Open hours",
    avgCheck: "Average check",
    about: "About restaurant",
    bookPrompt: "Reserve a table using the confirmed reservation context.",
    goToBooking: "Open stay page",
    bookingRequiresStay: "To reserve a table, open this page from an active reservation link.",
    bookingMissingTitle: "Reservation required",
    reservationReady: "Reservation connected",
  },
  ru: {
    backToStay: "Назад к объекту",
    title: "Ресторан",
    cuisine: "Кухня",
    openHours: "Часы работы",
    avgCheck: "Средний чек",
    about: "О ресторане",
    bookPrompt: "Забронируйте столик в контексте подтвержденной брони.",
    goToBooking: "Открыть объект",
    bookingRequiresStay: "Чтобы забронировать столик, откройте страницу из активной брони.",
    bookingMissingTitle: "Нужна активная бронь",
    reservationReady: "Бронь подключена",
  },
} as const;

function presentRestaurantName(raw: string, lang: Lang): string {
  const name = (raw || "").trim();
  if (!name) return lang === "ru" ? "Ресторан" : "Restaurant";
  const normalized = name.replace(/\s+\d{6,}$/g, "");
  const low = normalized.toLowerCase();
  if (low.includes("e2e") || low.includes("test")) return "Signature Restaurant";
  return normalized;
}

function presentRestaurantCuisine(raw: string, lang: Lang): string {
  const cuisine = (raw || "").trim();
  if (!cuisine) return lang === "ru" ? "Авторская кухня" : "Signature cuisine";
  const low = cuisine.toLowerCase();
  if (low.includes("test") || low.includes("e2e")) {
    return lang === "ru" ? "Авторская кухня" : "Signature cuisine";
  }
  return cuisine;
}

function cleanDescription(raw: string, lang: Lang): string {
  const value = (raw || "").trim();
  if (!value || /(?:test|e2e|demo)/i.test(value)) {
    return lang === "ru"
      ? "Ресторан отеля готов принять гостей на ужин, деловую встречу или спокойный вечер после заезда."
      : "The hotel restaurant is ready for dinner, a business meeting, or a quiet evening after check-in.";
  }
  return value;
}

function appendContextParams(
  params: URLSearchParams,
  context: { reservationId: number; guestEmail: string; accessToken: string },
) {
  if (context.reservationId > 0) params.set("reservation_id", String(context.reservationId));
  if (context.guestEmail) params.set("guest_email", context.guestEmail);
  if (context.accessToken) params.set("access_token", context.accessToken);
}

export default async function RestaurantPage({
  params,
  searchParams,
}: {
  params: { id: string; restaurantId: string };
  searchParams: {
    lang?: string;
    currency?: string;
    reservation_id?: string;
    guest_email?: string;
    access_token?: string;
    exp_variant?: string;
  };
}) {
  const listingId = Number(params.id);
  const restaurantId = Number(params.restaurantId);
  if (!Number.isFinite(listingId) || !Number.isFinite(restaurantId)) notFound();

  const lang: Lang = searchParams.lang === "ru" ? "ru" : "en";
  const currency: Currency = searchParams.currency === "KZT" ? "KZT" : "USD";
  const reservationId = Number(searchParams.reservation_id || "0");
  const guestEmail = searchParams.guest_email?.trim() || "";
  const accessToken = searchParams.access_token || "";
  const expVariant = searchParams.exp_variant === "b" ? "b" : "a";
  const tr = t[lang];
  const context = { reservationId, guestEmail, accessToken };

  try {
    const listing = await getListing(listingId);
    const restaurants = await getListingRestaurants(listingId, true);
    const restaurant = restaurants.find((x) => x.id === restaurantId);
    if (!restaurant) notFound();

    const stayParams = new URLSearchParams({ lang, currency, exp_variant: expVariant });
    appendContextParams(stayParams, context);
    if (reservationId > 0 && guestEmail) stayParams.set("concierge", "1");
    const backToStayHref = `/stays/${listingId}?${stayParams.toString()}#hotel-restaurants`;

    const accountParams = new URLSearchParams({ lang, currency });
    appendContextParams(accountParams, context);
    const accountHref = guestEmail ? `/account?${accountParams.toString()}` : undefined;

    const restaurantName = presentRestaurantName(restaurant.name, lang);
    const cuisine = presentRestaurantCuisine(restaurant.cuisine, lang);
    const averageCheck = formatPriceFromKzt(restaurant.avg_check_kzt, currency, lang);
    const hasReservationContext = reservationId > 0 && Boolean(guestEmail);

    return (
      <StayPilotShell lang={lang} currency={currency} active="restaurants" accountHref={accountHref}>
        <div className="sp-restaurant-page">
          <Link href={backToStayHref} className="sp-back-link">
            {tr.backToStay}
          </Link>

          <section className="sp-restaurant-layout">
            <article className="property-detail sp-restaurant-hero">
              <div className="sp-restaurant-copy">
                <p className="sp-restaurant-kicker">{tr.title}</p>
                <h1>{restaurantName}</h1>
                <p className="desc">
                  {listing.title} · {listing.city}, {listing.district}
                </p>
                <div className="pill-row">
                  <span>
                    {tr.cuisine}: {cuisine}
                  </span>
                  <span>
                    {tr.openHours}: {restaurant.open_from} - {restaurant.open_to}
                  </span>
                  <span>
                    {tr.avgCheck}: {averageCheck}
                  </span>
                  {hasReservationContext ? <span>{tr.reservationReady}: #{reservationId}</span> : null}
                </div>
                <h3>{tr.about}</h3>
                <p className="desc">{cleanDescription(restaurant.description, lang)}</p>
                <p className="desc">{tr.bookPrompt}</p>
                <div className="actions actions-modern">
                  <Link href={backToStayHref}>{tr.goToBooking}</Link>
                </div>
              </div>
              <div className="sp-restaurant-visual" aria-hidden="true">
                <span>{cuisine}</span>
                <strong>{averageCheck}</strong>
              </div>
            </article>

            <div className="sp-restaurant-booking-col">
              {hasReservationContext ? (
                <RestaurantBookingForm
                  reservationId={reservationId}
                  restaurantId={restaurant.id}
                  guestEmail={guestEmail}
                  accessToken={accessToken}
                  lang={lang}
                />
              ) : (
                <section className="property-detail restaurant-booking-card">
                  <h3>{tr.bookingMissingTitle}</h3>
                  <p className="desc">{tr.bookingRequiresStay}</p>
                  <div className="actions actions-modern">
                    <Link href={backToStayHref}>{tr.goToBooking}</Link>
                  </div>
                </section>
              )}
            </div>
          </section>
        </div>
      </StayPilotShell>
    );
  } catch {
    notFound();
  }
}
