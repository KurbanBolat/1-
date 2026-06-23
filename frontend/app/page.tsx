import Link from "next/link";

import { getListings, type ListingList } from "../lib/api";
import AIConcierge from "../components/AIConcierge";
import { SearchExposureTracker, TrackedStayLink } from "../components/AnalyticsTrackers";
import CatalogPreviewLightbox from "../components/CatalogPreviewLightbox";
import CityMapPanel from "../components/CityMapPanel";
import DateRangePicker from "../components/DateRangePicker";
import HomeChatRail from "../components/HomeChatRail";
import { resolveTrustVariant } from "../lib/explainability";
import { resolveMediaUrl } from "../lib/media";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";
type ViewMode = "list" | "map";

type SearchParams = {
  q?: string;
  city?: string;
  property_type?: string;
  min_bedrooms?: string;
  min_rating?: string;
  amenities?: string | string[];
  trip_purpose?: string;
  check_in?: string;
  check_out?: string;
  guests?: string;
  min_price?: string;
  max_price?: string;
  sort_by?: string;
  sort_order?: string;
  page?: string;
  lang?: string;
  currency?: string;
  view?: string;
  map_safe?: string;
  exp_variant?: string;
};

const USD_RATE = 500;
const STAYPILOT_HERO_IMAGE =
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1800&q=86";
const STAYPILOT_FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=720&q=82",
];
const SHOWCASE_TITLES = {
  en: ["Address Beach Resort", "Jumeirah Al Naseem", "Taj Dubai", "SLS Dubai Hotel & Residences"],
  ru: ["Address Beach Resort", "Jumeirah Al Naseem", "Taj Dubai", "SLS Dubai Hotel & Residences"],
} as const;

type SpIconName =
  | "sparkle"
  | "home"
  | "search"
  | "hotel"
  | "apartment"
  | "villa"
  | "tag"
  | "restaurant"
  | "car"
  | "bell"
  | "headphones"
  | "globe"
  | "heart"
  | "calendar"
  | "users"
  | "briefcase"
  | "dots"
  | "location"
  | "wallet"
  | "chevron"
  | "send"
  | "x";

function SpIcon({ name }: { name: SpIconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "sparkle") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3z" fill="currentColor" />
        <path d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15z" fill="currentColor" opacity=".65" />
      </svg>
    );
  }

  const paths: Record<Exclude<SpIconName, "sparkle">, JSX.Element> = {
    home: <><path {...common} d="M4 11.5 12 5l8 6.5" /><path {...common} d="M6.5 10.5V20h11v-9.5" /><path {...common} d="M10 20v-5h4v5" /></>,
    search: <><circle {...common} cx="10.8" cy="10.8" r="5.8" /><path {...common} d="m16 16 4 4" /></>,
    hotel: <><path {...common} d="M4.5 20V5.5h10V20" /><path {...common} d="M14.5 10.5h5V20" /><path {...common} d="M7.5 8h1.5M11 8h1.5M7.5 11h1.5M11 11h1.5M7.5 14h1.5M17 14h.1" /></>,
    apartment: <><path {...common} d="M6 20V7l6-3 6 3v13" /><path {...common} d="M9 10h2M13 10h2M9 13h2M13 13h2M10 20v-4h4v4" /></>,
    villa: <><path {...common} d="M4 12.5 12 6l8 6.5" /><path {...common} d="M6 11.5V20h12v-8.5" /><path {...common} d="M9 20v-5h6v5M15 8.5V5h3v6" /></>,
    tag: <><path {...common} d="M4.5 12.2 12.2 4.5H20v7.8L12.3 20 4.5 12.2z" /><circle cx="16.5" cy="8" r="1.2" fill="currentColor" /></>,
    restaurant: <><path {...common} d="M7 4v16M4.5 4v5.5a2.5 2.5 0 0 0 5 0V4M16 4v16M16 4c2 1.4 3.2 3.8 3.2 6.3 0 1.9-1 3.2-3.2 3.2" /></>,
    car: <><path {...common} d="M5 14h14l-1.4-4.2A2.6 2.6 0 0 0 15.1 8H8.9a2.6 2.6 0 0 0-2.5 1.8L5 14z" /><path {...common} d="M6 14v4M18 14v4M7 18h1.2M15.8 18H17" /></>,
    bell: <><path {...common} d="M6.5 17h11l-1.2-2V10a4.3 4.3 0 0 0-8.6 0v5L6.5 17z" /><path {...common} d="M10 19a2.2 2.2 0 0 0 4 0" /></>,
    headphones: <><path {...common} d="M4 13a8 8 0 0 1 16 0" /><path {...common} d="M5 13h3v6H6a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2zM19 13h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2z" /></>,
    globe: <><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16" /></>,
    heart: <path {...common} d="M20 8.8c0 5-8 9.2-8 9.2S4 13.8 4 8.8A4.1 4.1 0 0 1 11.3 6 4.1 4.1 0 0 1 20 8.8z" />,
    calendar: <><path {...common} d="M6 5h12a2 2 0 0 1 2 2v11H4V7a2 2 0 0 1 2-2zM4 10h16M8 3v4M16 3v4" /></>,
    users: <><path {...common} d="M9.5 11.5a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6zM3.8 19a5.8 5.8 0 0 1 11.4 0" /><path {...common} d="M16 11.5a2.8 2.8 0 1 0 0-5.6M15.8 14.2A4.6 4.6 0 0 1 20.2 19" /></>,
    briefcase: <><path {...common} d="M4 8h16v11H4zM9 8V5h6v3M4 12h16" /></>,
    dots: <><circle cx="6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18" cy="12" r="1.5" fill="currentColor" /></>,
    location: <><path {...common} d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle {...common} cx="12" cy="10" r="2.4" /></>,
    wallet: <><path {...common} d="M4 7h16v11H4z" /><path {...common} d="M7 7V5h9M16.5 12h.1" /></>,
    chevron: <path {...common} d="m8 10 4 4 4-4" />,
    send: <><path {...common} d="M4 11.8 20 4l-5.2 16-3.2-6.7L4 11.8z" /><path {...common} d="m11.6 13.3 4.1-4.1" /></>,
    x: <><path {...common} d="M6.5 6.5 17.5 17.5" /><path {...common} d="m17.5 6.5-11 11" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function mediaUrl(path: string | null | undefined): string | null {
  return resolveMediaUrl(path);
}

function showcaseImage(index: number, path?: string | null): string {
  return mediaUrl(path) || STAYPILOT_FALLBACK_IMAGES[index % STAYPILOT_FALLBACK_IMAGES.length];
}

function showcaseTitle(title: string, index: number, lang: Lang): string {
  return SHOWCASE_TITLES[lang][index] || title;
}

const t = {
  en: {
    kickerLabel: "Curated stays for confident booking",
    title: "Stay Finder For Real Trips",
    subtitle: "Fast date search, transparent price per night, and instant reservation from listing page.",
    partnerLogin: "Partner Login",
    staysAvailable: "stays available",
    activeRegion: "active region",
    allCities: "All cities",
    searchPlaceholder: "Search by district, landmark, amenities",
    checkIn: "Check-in",
    checkOut: "Check-out",
    guests: "Guests",
    minPrice: "Min price",
    maxPrice: "Max price",
    recommended: "Best match",
    price: "Price",
    rating: "Rating",
    newest: "Newest",
    highToLow: "High to low",
    lowToHigh: "Low to high",
    searchStays: "Search stays",
    perNight: "/ night",
    bedroomsShort: "bd",
    upTo: "up to",
    viewStay: "View stay",
    back: "Back",
    next: "Next",
    page: "Page",
    of: "of",
    stays: "stays",
    allRegion: "All cities",
    totalForPeriod: "Total for",
    nights: "nights",
    totalHint: "Includes cleaning and service fee",
    trustNoHidden: "No hidden fees",
    trustPolicy: "Cancellation",
    trustCheckIn: "Check-in",
    trustCheckOut: "Check-out",
    trustCheckInWindow: "from 14:00",
    trustCheckOutWindow: "until 12:00",
    subtotal: "Subtotal",
    cleaning: "Cleaning fee",
    service: "Service fee",
    total: "Total",
    bestValue: "Best value",
    listMode: "List",
    mapMode: "Map",
    mapTitle: "City map",
    mapHint: "Pins show nightly price and are grouped around selected districts",
    searchTitle: "Smart search",
    searchSectionTitle: "Search stays",
    destination: "Destination",
    city: "City",
    propertyType: "Property type",
    anyType: "Any type",
    apartment: "Apartment",
    hotel: "Hotel",
    minBedrooms: "Min bedrooms",
    minRating: "Min rating",
    amenities: "Amenities",
    amenityWifi: "Wifi",
    amenityParking: "Parking",
    amenityKitchen: "Kitchen",
    amenityPool: "Pool",
    sortBy: "Sort by",
    order: "Order",
    advancedFilters: "Advanced filters",
    resetFilters: "Reset filters",
    quickFilters: "Quick filters",
    popularCities: "Popular cities",
    budget: "Budget",
    budgetLow: "Affordable",
    budgetMid: "Comfort",
    budgetHigh: "Premium",
    dateShortcuts: "Date shortcuts",
    shortTrip: "Short trip",
    weekTrip: "Week stay",
    monthTrip: "Month stay",
    groupSize: "Guests preset",
    solo: "Solo",
    couple: "Couple",
    family: "Family",
    activeFilters: "Active filters",
    clearAll: "Clear all",
    datesLabel: "Dates",
    guestsLabel: "Guests",
    tripPurpose: "Trip type",
    familyTrip: "Family",
    businessTrip: "Business",
    soloTrip: "Solo",
    coupleTrip: "Couple",
    recommendationsFor: "Recommendations for",
    rankingHint: "Ranking tuned by trip type, price and rating.",
    rankingExplainTitle: "Why these are best match",
    rankingExplainCity: "Matched to selected city and district intent.",
    rankingExplainDates: "Availability and trip duration are considered for your dates.",
    rankingExplainBudget: "Prioritized options that better fit your budget and value.",
    rankingExplainPurpose: "Adjusted by trip goal for more relevant options.",
    expVariant: "Variant",
    autoPurposeByGuests: "Auto-selected by guests count",
    noResultsTitle: "No stays found",
    noResultsHint: "Try changing dates, city, or budget filters.",
    openFilters: "Filters",
    closeFilters: "Close",
    applyFilters: "Apply",
    hotelRestaurants: "Hotel restaurants",
    restaurantsNearby: "Nearby restaurants",
    noHotelRestaurants: "No restaurant data yet",
  },
  ru: {
    kickerLabel: "Проверенные варианты для уверенного бронирования",
    title: "Поиск проживания для реальных поездок",
    subtitle: "Быстрый поиск по датам, прозрачная цена за ночь и мгновенное бронирование со страницы объекта.",
    partnerLogin: "Вход партнера",
    staysAvailable: "вариантов доступно",
    activeRegion: "выбранный регион",
    allCities: "Все города",
    searchPlaceholder: "Поиск по району, ориентиру, удобствам",
    checkIn: "Заезд",
    checkOut: "Выезд",
    guests: "Гости",
    minPrice: "Цена от",
    maxPrice: "Цена до",
    recommended: "Лучшее совпадение",
    price: "Цена",
    rating: "Рейтинг",
    newest: "Новые",
    highToLow: "По убыванию",
    lowToHigh: "По возрастанию",
    searchStays: "Найти варианты",
    perNight: "/ ночь",
    bedroomsShort: "сп",
    upTo: "до",
    viewStay: "Открыть",
    back: "Назад",
    next: "Далее",
    page: "Страница",
    of: "из",
    stays: "вариантов",
    allRegion: "Все города",
    totalForPeriod: "Итого за",
    nights: "ночей",
    totalHint: "Включая уборку и сервисный сбор",
    trustNoHidden: "Без скрытых платежей",
    trustPolicy: "Условия отмены",
    trustCheckIn: "Заезд",
    trustCheckOut: "Выезд",
    trustCheckInWindow: "с 14:00",
    trustCheckOutWindow: "до 12:00",
    subtotal: "Подытог",
    cleaning: "Уборка",
    service: "Сервисный сбор",
    total: "Итого",
    bestValue: "Лучшая цена-качество",
    listMode: "Список",
    mapMode: "Карта",
    mapTitle: "Карта города",
    mapHint: "Пины показывают цену за ночь и сгруппированы по районам",
    searchTitle: "Умный поиск",
    searchSectionTitle: "Поиск жилья",
    destination: "Направление",
    city: "Город",
    propertyType: "Тип объекта",
    anyType: "Любой тип",
    apartment: "Квартира",
    hotel: "Отель",
    minBedrooms: "Спален от",
    minRating: "Рейтинг от",
    amenities: "Удобства",
    amenityWifi: "Wifi",
    amenityParking: "Парковка",
    amenityKitchen: "Кухня",
    amenityPool: "Бассейн",
    sortBy: "Сортировка",
    order: "Порядок",
    advancedFilters: "Расширенные фильтры",
    resetFilters: "Сбросить фильтры",
    quickFilters: "Быстрые фильтры",
    popularCities: "Популярные города",
    budget: "Бюджет",
    budgetLow: "Бюджетно",
    budgetMid: "Комфорт",
    budgetHigh: "Премиум",
    dateShortcuts: "Быстрые даты",
    shortTrip: "Короткая поездка",
    weekTrip: "На неделю",
    monthTrip: "На месяц",
    groupSize: "Быстрый выбор гостей",
    solo: "Соло",
    couple: "Пара",
    family: "Семья",
    activeFilters: "Активные фильтры",
    clearAll: "Очистить все",
    datesLabel: "Даты",
    guestsLabel: "Гости",
    tripPurpose: "Тип поездки",
    familyTrip: "Семья",
    businessTrip: "Бизнес",
    soloTrip: "Соло",
    coupleTrip: "Пара",
    recommendationsFor: "Рекомендации для",
    rankingHint: "Порядок подобран с учетом цели поездки, цены и рейтинга.",
    rankingExplainTitle: "Почему это лучшее совпадение",
    rankingExplainCity: "Учтен выбранный город и контекст по району.",
    rankingExplainDates: "Проверена доступность и длительность проживания на ваши даты.",
    rankingExplainBudget: "В приоритете варианты, которые лучше попадают в бюджет и ценность.",
    rankingExplainPurpose: "Ранжирование подстроено под цель поездки.",
    expVariant: "Вариант",
    autoPurposeByGuests: "Подобрано автоматически по числу гостей",
    noResultsTitle: "Варианты не найдены",
    noResultsHint: "Попробуйте изменить даты, город или бюджет.",
    openFilters: "Фильтры",
    closeFilters: "Закрыть",
    applyFilters: "Применить",
    hotelRestaurants: "Рестораны отеля",
    restaurantsNearby: "Рестораны рядом",
    noHotelRestaurants: "Данных о ресторанах пока нет",
  },
} as const;

const CITY_LABELS_RU: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
  karagandy: "Караганда",
  istanbul: "Стамбул",
  vienna: "Вена",
  toronto: "Торонто",
  milan: "Милан",
  tbilisi: "Тбилиси",
  paris: "Париж",
  berlin: "Берлин",
  madrid: "Мадрид",
  rome: "Рим",
  london: "Лондон",
  dubai: "Дубай",
  antalya: "Анталья",
  baku: "Баку",
  bishkek: "Бишкек",
  tashkent: "Ташкент",
  moscow: "Москва",
  "saint petersburg": "Санкт-Петербург",
  "new york": "Нью-Йорк",
  "los angeles": "Лос-Анджелес",
};

const CITY_OPTIONS_EN = [
  "Almaty",
  "Astana",
  "Shymkent",
  "Karagandy",
  "Istanbul",
  "Antalya",
  "Vienna",
  "Toronto",
  "Milan",
  "Tbilisi",
  "Baku",
  "Paris",
  "Berlin",
  "Madrid",
  "Rome",
  "London",
  "Dubai",
  "Bishkek",
  "Tashkent",
  "Moscow",
  "Saint Petersburg",
  "New York",
  "Los Angeles",
];

function localizeCityName(city: string | undefined, lang: Lang): string {
  const raw = (city || "").trim();
  if (!raw) return "";
  if (lang === "en") return raw;
  const key = raw.toLowerCase();
  return CITY_LABELS_RU[key] || raw;
}

function localizeCityTokensInTitle(title: string, lang: Lang): string {
  if (lang !== "ru") return title;
  let next = title;
  for (const [enName, ruName] of Object.entries(CITY_LABELS_RU)) {
    const escaped = enName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`\\b${escaped}\\b`, "gi"), ruName);
  }
  return next;
}


function presentListingTitle(raw: string, city: string, id: number, lang: Lang): string {
  const title = (raw || "").trim();
  if (!title) return lang === "ru" ? `Вариант #${id}` : `Stay #${id}`;
  const low = title.toLowerCase();
  if (low.includes("test") || low.includes("e2e") || low.includes("bulkdelete")) {
    const cityName = localizeCityName(city, lang);
    return lang === "ru" ? `${cityName} Residence #${id}` : `${cityName} Residence #${id}`;
  }
  return localizeCityTokensInTitle(title, lang);
}

function localizeCancellationPolicy(policy: string | undefined, lang: Lang): string {
  const normalized = (policy || "").trim().toLowerCase();
  if (!normalized) return lang === "ru" ? "Условия отмены уточняются" : "Cancellation terms on request";
  if (lang === "ru") {
    if (normalized.includes("flex")) return "Отмена: гибкая";
    if (normalized.includes("moderate")) return "Отмена: умеренная";
    if (normalized.includes("strict")) return "Отмена: строгая";
    return `Отмена: ${policy}`;
  }
  if (normalized.includes("flex")) return "Cancellation: flexible";
  if (normalized.includes("moderate")) return "Cancellation: moderate";
  if (normalized.includes("strict")) return "Cancellation: strict";
  return `Cancellation: ${policy}`;
}


function normalizeCityParam(city: string | undefined): string {
  const value = (city || "").trim();
  if (!value) return "";
  const byKey: Record<string, string> = {
    almaty: "Almaty",
    алматы: "Almaty",
    astana: "Astana",
    астана: "Astana",
    shymkent: "Shymkent",
    шымкент: "Shymkent",
    karagandy: "Karagandy",
    караганда: "Karagandy",
    istanbul: "Istanbul",
    стамбул: "Istanbul",
    antalya: "Antalya",
    анталья: "Antalya",
    vienna: "Vienna",
    вена: "Vienna",
    toronto: "Toronto",
    торонто: "Toronto",
    milan: "Milan",
    милан: "Milan",
    tbilisi: "Tbilisi",
    тбилиси: "Tbilisi",
    baku: "Baku",
    баку: "Baku",
  };
  return byKey[value.toLowerCase()] || value;
}

function normalizeAmenityValues(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const tokens: string[] = [];
  for (const value of values) {
    tokens.push(...value.split(",").map((x) => x.trim()).filter(Boolean));
  }
  return Array.from(new Set(tokens));
}

function appendQueryParam(query: URLSearchParams, key: string, value: string | string[] | undefined): void {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item) query.append(key, item);
    }
    return;
  }
  if (value) query.set(key, value);
}

function ensureCoreQuery(query: URLSearchParams, params: SearchParams): void {
  const lang = params.lang === "en" ? "en" : "ru";
  const currency = params.currency === "USD" ? "USD" : "KZT";
  const view = params.view === "map" ? "map" : "list";
  query.set("lang", lang);
  query.set("currency", currency);
  query.set("view", view);
  if (view === "map") query.set("map_safe", "1");
  else query.delete("map_safe");
}

function pageLink(params: SearchParams, page: number): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    appendQueryParam(query, key, value);
  });
  ensureCoreQuery(query, params);
  query.set("page", String(page));
  return `/?${query.toString()}`;
}

function viewLink(params: SearchParams, view: ViewMode): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (key === "page") return;
    appendQueryParam(query, key, value);
  });
  query.set("view", view);
  if (view === "map") query.set("map_safe", "1");
  if (view === "list") query.delete("map_safe");
  ensureCoreQuery(query, { ...params, view });
  return `/?${query.toString()}`;
}

function resetFiltersLink(params: SearchParams): string {
  const query = new URLSearchParams();
  const lang = params.lang === "en" ? "en" : "ru";
  const currency = params.currency === "USD" ? "USD" : "KZT";
  const view = params.view === "map" ? "map" : "list";
  query.set("lang", lang);
  query.set("currency", currency);
  query.set("view", view);
  if (params.exp_variant === "b") query.set("exp_variant", "b");
  return `/?${query.toString()}`;
}

function quickFilterLink(
  params: SearchParams,
  patch: Partial<Record<keyof SearchParams, string | undefined>>,
): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (key === "page") return;
    appendQueryParam(query, key, value);
  });
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined || value === "") {
      query.delete(key);
    } else {
      query.set(key, value);
    }
  });
  const nextView = (patch.view as string | undefined) || params.view;
  ensureCoreQuery(query, { ...params, ...patch, view: nextView });
  if (nextView !== "map") query.delete("map_safe");
  return `/?${query.toString()}`;
}

function formatPrice(valueKzt: number, currency: Currency, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (currency === "USD") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(valueKzt / USD_RATE);
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(valueKzt);
}

function formatUiDate(value: string | undefined, lang: Lang): string {
  if (!value) return "-";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  if (lang === "ru") return `${d}.${m}.${y}`;
  return `${d}.${m}.${y}`;
}

function getNights(checkIn?: string, checkOut?: string): number {
  if (!checkIn || !checkOut) return 0;
  const start = new Date(`${checkIn}T00:00:00Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86400000);
}

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDaysToIsoDate(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return toIsoDay(date);
}

function normalizeGuests(value: string | undefined, fallback = 2): number {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(12, Math.max(1, Math.round(parsed)));
}


function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) % 100000;
  }
  return h;
}

function syntheticPoint(city: string, district: string, id: number): { x: number; y: number } {
  const seed = hash(`${city}-${district}-${id}`);
  const x = 14 + (seed % 70);
  const y = 18 + (Math.floor(seed / 97) % 62);
  return { x, y };
}

function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysIso(base: Date, offset: number): string {
  const next = new Date(base);
  next.setDate(base.getDate() + offset);
  return toIsoDay(next);
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const page = Number(searchParams.page || "1");
  const lang: Lang = searchParams.lang === "en" ? "en" : "ru";
  const currency: Currency = searchParams.currency === "USD" ? "USD" : "KZT";
  const rawView: ViewMode = searchParams.view === "map" ? "map" : "list";
  const view: ViewMode = rawView === "map" && searchParams.map_safe === "1" ? "map" : "list";
  const currentCity = normalizeCityParam(searchParams.city);
  const selectedAmenities = normalizeAmenityValues(searchParams.amenities);
  const amenitiesQuery = selectedAmenities.join(",");
  const guestsCount = normalizeGuests(searchParams.guests, 2);
  const uiMinPrice = Number.isFinite(Number(searchParams.min_price)) ? Number(searchParams.min_price) : undefined;
  const uiMaxPrice = Number.isFinite(Number(searchParams.max_price)) ? Number(searchParams.max_price) : undefined;
  const minPriceForApi =
    uiMinPrice !== undefined ? String(currency === "USD" ? Math.round(uiMinPrice * USD_RATE) : uiMinPrice) : undefined;
  const maxPriceForApi =
    uiMaxPrice !== undefined ? String(currency === "USD" ? Math.round(uiMaxPrice * USD_RATE) : uiMaxPrice) : undefined;
  const budgetQuick = {
    lowMin: currency === "USD" ? "30" : "15000",
    lowMax: currency === "USD" ? "60" : "30000",
    midMin: currency === "USD" ? "60" : "30000",
    midMax: currency === "USD" ? "120" : "60000",
    highMin: currency === "USD" ? "120" : "60000",
  };
  const tr = t[lang];
  const guestsWord = lang === "ru" ? "гостей" : "guests";
  const explicitTripPurpose = searchParams.trip_purpose || "";
  const autoTripPurpose = !explicitTripPurpose
    ? guestsCount >= 4
      ? "family"
      : guestsCount === 1
        ? "solo"
        : guestsCount === 2
          ? "couple"
          : ""
    : "";
  const effectiveTripPurpose = explicitTripPurpose || autoTripPurpose;
  const tripPurposeForApi = explicitTripPurpose || undefined;
  const now = new Date();
  const shortTripCheckIn = addDaysIso(now, 1);
  const shortTripCheckOut = addDaysIso(now, 3);
  const explicitCheckIn = isIsoDate(searchParams.check_in) ? searchParams.check_in : "";
  const explicitCheckOut =
    isIsoDate(searchParams.check_out) && explicitCheckIn && searchParams.check_out > explicitCheckIn
      ? searchParams.check_out
      : "";
  const heroCheckIn = explicitCheckIn || shortTripCheckIn;
  const heroCheckOut = explicitCheckOut || (explicitCheckIn ? addDaysToIsoDate(heroCheckIn, 2) : shortTripCheckOut);
  const heroGuests = String(guestsCount);
  const weekTripCheckIn = addDaysIso(now, 1);
  const weekTripCheckOut = addDaysIso(now, 8);
  const monthTripCheckIn = addDaysIso(now, 1);
  const monthTripCheckOut = addDaysIso(now, 31);
  const destinationHints =
    lang === "ru"
      ? ["Центр", "Аэропорт", "ЖД вокзал", "Медеу", "Бостандык", "WiFi", "Парковка", "Кухня"]
      : ["City center", "Airport", "Train station", "Medeu", "Bostandyk", "Wifi", "Parking", "Kitchen"];
  const trustVariant = resolveTrustVariant(searchParams.exp_variant);
  const moreFiltersLabel = lang === "ru" ? "Больше фильтров" : "More filters";

  let result: ListingList = { items: [], total: 0, page, page_size: 12 };
  try {
    result = await getListings({
      q: searchParams.q,
      city: currentCity || undefined,
      property_type: searchParams.property_type,
      min_bedrooms: searchParams.min_bedrooms,
      min_rating: searchParams.min_rating,
      amenities: amenitiesQuery || undefined,
      trip_purpose: tripPurposeForApi,
      check_in: explicitCheckIn || undefined,
      check_out: explicitCheckOut || undefined,
      guests: heroGuests,
      min_price: minPriceForApi,
      max_price: maxPriceForApi,
      sort_by: searchParams.sort_by || "best_match",
      sort_order: searchParams.sort_order || "desc",
      page,
      page_size: 12,
    });
  } catch {
    result = { items: [], total: 0, page, page_size: 12 };
  }
  let mapItems = result.items;
  if (view === "map" && result.total > result.items.length) {
    try {
      const mapResult = await getListings({
        q: searchParams.q,
        city: currentCity || undefined,
        property_type: searchParams.property_type,
        min_bedrooms: searchParams.min_bedrooms,
        min_rating: searchParams.min_rating,
        amenities: amenitiesQuery || undefined,
        trip_purpose: tripPurposeForApi,
        check_in: explicitCheckIn || undefined,
        check_out: explicitCheckOut || undefined,
        guests: heroGuests,
        min_price: minPriceForApi,
        max_price: maxPriceForApi,
        sort_by: searchParams.sort_by || "best_match",
        sort_order: searchParams.sort_order || "desc",
        page: 1,
        page_size: Math.min(Math.max(result.total, 12), 200),
      });
      mapItems = mapResult.items;
    } catch {
      mapItems = result.items;
    }
  }
  const sortBy = searchParams.sort_by || "best_match";
  const sortOrder = searchParams.sort_order || "desc";
  const showBestValueBadges = sortBy === "best_match" || sortBy === "recommended" || sortBy === "best_value";
  const bestValueIds = new Set(result.items.slice(0, 3).map((x) => x.id));
  const purposeLabelByKey: Record<string, string> = {
    family: tr.familyTrip,
    business: tr.businessTrip,
    solo: tr.soloTrip,
    couple: tr.coupleTrip,
  };
  const totalPages = Math.max(1, Math.ceil(result.total / result.page_size));
  const activeFilters: Array<{ key: string; label: string; href: string }> = [];
  const cityOptions = Array.from(
    new Set([
      ...CITY_OPTIONS_EN,
      ...result.items.map((item) => normalizeCityParam(item.city)).filter(Boolean),
    ]),
  ).sort((a, b) => localizeCityName(a, lang).localeCompare(localizeCityName(b, lang), lang === "ru" ? "ru" : "en"));
  const cityValueInForm = cityOptions.includes(currentCity) ? currentCity : "";
  const hasCustomCityValue = Boolean(currentCity && !cityOptions.includes(currentCity));
  if (searchParams.q) {
    activeFilters.push({ key: "q", label: searchParams.q, href: quickFilterLink(searchParams, { q: undefined }) });
  }
  if (currentCity) {
    activeFilters.push({
      key: "city",
      label: `${tr.city}: ${localizeCityName(currentCity, lang)}`,
      href: quickFilterLink(searchParams, { city: undefined }),
    });
  }
  if (searchParams.property_type) {
    activeFilters.push({
      key: "property_type",
      label: `${tr.propertyType}: ${searchParams.property_type === "hotel" ? tr.hotel : tr.apartment}`,
      href: quickFilterLink(searchParams, { property_type: undefined }),
    });
  }
  if (searchParams.min_bedrooms) {
    activeFilters.push({
      key: "min_bedrooms",
      label: `${tr.minBedrooms}: ${searchParams.min_bedrooms}`,
      href: quickFilterLink(searchParams, { min_bedrooms: undefined }),
    });
  }
  if (searchParams.min_rating) {
    activeFilters.push({
      key: "min_rating",
      label: `${tr.minRating}: ${searchParams.min_rating}`,
      href: quickFilterLink(searchParams, { min_rating: undefined }),
    });
  }
  if (selectedAmenities.length > 0) {
    activeFilters.push({
      key: "amenities",
      label: `${tr.amenities}: ${selectedAmenities.join(", ")}`,
      href: quickFilterLink(searchParams, { amenities: undefined }),
    });
  }
  if (explicitTripPurpose) {
    const labelByPurpose: Record<string, string> = {
      family: tr.familyTrip,
      business: tr.businessTrip,
      solo: tr.soloTrip,
      couple: tr.coupleTrip,
    };
    activeFilters.push({
      key: "trip_purpose",
      label: `${tr.tripPurpose}: ${labelByPurpose[explicitTripPurpose] || explicitTripPurpose}`,
      href: quickFilterLink(searchParams, { trip_purpose: undefined }),
    });
  }
  if (explicitCheckIn || explicitCheckOut) {
    activeFilters.push({
      key: "dates",
      label: `${tr.datesLabel}: ${formatUiDate(explicitCheckIn, lang)} -> ${formatUiDate(explicitCheckOut, lang)}`,
      href: quickFilterLink(searchParams, { check_in: undefined, check_out: undefined }),
    });
  }
  if (searchParams.guests && searchParams.guests !== "2") {
    activeFilters.push({
      key: "guests",
      label: `${tr.guestsLabel}: ${searchParams.guests}`,
      href: quickFilterLink(searchParams, { guests: undefined }),
    });
  }
  if (searchParams.min_price || searchParams.max_price) {
    const minLabel =
      uiMinPrice !== undefined
        ? formatPrice(currency === "USD" ? uiMinPrice * USD_RATE : uiMinPrice, currency, lang)
        : "0";
    const maxLabel =
      uiMaxPrice !== undefined
        ? formatPrice(currency === "USD" ? uiMaxPrice * USD_RATE : uiMaxPrice, currency, lang)
        : "?";
    activeFilters.push({
      key: "price",
      label: `${tr.price}: ${minLabel} - ${maxLabel}`,
      href: quickFilterLink(searchParams, { min_price: undefined, max_price: undefined }),
    });
  }
  const selectedGuestsInUi = heroGuests;
  const lowMinNum = Number(budgetQuick.lowMin);
  const lowMaxNum = Number(budgetQuick.lowMax);
  const midMinNum = Number(budgetQuick.midMin);
  const midMaxNum = Number(budgetQuick.midMax);
  const highMinNum = Number(budgetQuick.highMin);
  const isBudgetLowActive = uiMinPrice === lowMinNum && uiMaxPrice === lowMaxNum;
  const isBudgetMidActive = uiMinPrice === midMinNum && uiMaxPrice === midMaxNum;
  const isBudgetHighActive = uiMinPrice === highMinNum && uiMaxPrice === undefined;
  const heroImageSrc = STAYPILOT_HERO_IMAGE;
  const featuredCards = result.items.slice(0, 4);
  const rightRailCards = result.items.slice(0, 3);
  function stayDetailsHref(listingId: number): string {
    const query = new URLSearchParams({
      lang,
      currency,
      exp_variant: trustVariant,
      check_in: heroCheckIn,
      check_out: heroCheckOut,
      guests: heroGuests,
    });
    return `/stays/${listingId}?${query.toString()}#available-rooms`;
  }
  const rightRailShowcaseCards = rightRailCards.map((item, index) => {
    const displayTitle = showcaseTitle(presentListingTitle(item.title, item.city, item.id, lang), index, lang);
    return {
      id: item.id,
      title: displayTitle,
      city: item.city,
      district: item.district,
      nightlyPrice: item.nightly_price,
      coverPhotoUrl: showcaseImage(index + 1, item.cover_photo_url),
      href: stayDetailsHref(item.id),
    };
  });
  const rightRailQuickPrompts =
    lang === "ru"
      ? ["Показать ещё варианты", "Отели с видом на море", "Бюджетные варианты"]
      : ["Show more options", "Sea-view hotels", "Budget options"];
  const langToggleHref = quickFilterLink(searchParams, { lang: lang === "ru" ? "en" : "ru" });
  const currencyToggleHref = quickFilterLink(searchParams, { currency: currency === "USD" ? "KZT" : "USD" });

  return (
    <div className="sp-shell">
      <SearchExposureTracker lang={lang} currency={currency} variant={trustVariant} total={result.total} />

      <aside className="sp-left-rail">
        <div className="sp-brand-card">
          <div className="sp-brand-mark"><SpIcon name="sparkle" /></div>
          <div>
            <strong>StayPilot</strong>
            <small>AI Concierge for Hotels</small>
          </div>
        </div>

        <nav className="sp-side-nav" aria-label="Primary">
          <Link href={quickFilterLink(searchParams, { page: "1", property_type: undefined })} className={!searchParams.property_type ? "active" : ""}><SpIcon name="home" />{lang === "ru" ? "Главная" : "Home"}</Link>
          <a href="#search"><SpIcon name="search" />{lang === "ru" ? "Поиск" : "Search"}</a>
          <Link href={quickFilterLink(searchParams, { property_type: "hotel" })} className={searchParams.property_type === "hotel" ? "active" : ""}><SpIcon name="hotel" />{lang === "ru" ? "Отели" : "Hotels"}</Link>
          <Link href={quickFilterLink(searchParams, { property_type: "apartment" })} className={searchParams.property_type === "apartment" ? "active" : ""}><SpIcon name="apartment" />{lang === "ru" ? "Апартаменты" : "Apartments"}</Link>
          <Link href={quickFilterLink(searchParams, { property_type: "villa" })} className={searchParams.property_type === "villa" ? "active" : ""}><SpIcon name="villa" />{lang === "ru" ? "Виллы" : "Villas"}</Link>
        </nav>
      </aside>

      <div className="sp-main-col">
        <header className="sp-topbar">
          <div className="sp-topbar-actions">
            <Link href={langToggleHref}><SpIcon name="globe" />{lang === "ru" ? "Русский" : "English"}<SpIcon name="chevron" /></Link>
            <Link href={currencyToggleHref}>{currency}<SpIcon name="chevron" /></Link>
            <Link href={`/account?lang=${lang}&currency=${currency}`}><SpIcon name="calendar" />{lang === "ru" ? "Мои бронирования" : "My bookings"}</Link>
            <Link href={`/for-hotels?lang=${lang}&currency=${currency}`}><SpIcon name="briefcase" />{lang === "ru" ? "Для отелей" : "For hotels"}</Link>
          </div>
          <Link href="/login" className="sp-topbar-user" aria-label={tr.partnerLogin}>
            <span className="sp-user-avatar" />
            <SpIcon name="chevron" />
          </Link>
        </header>

        <section className="sp-hero" style={{ backgroundImage: `linear-gradient(112deg, rgba(8,18,30,0.58), rgba(21,31,48,0.08)), url(${heroImageSrc})` }}>
          <div className="sp-hero-copy">
            <h1>
              {lang === "ru" ? (
                <>
                  Путешествуйте с комфортом,
                  <br />а мы позаботимся обо всём
                </>
              ) : (
                <>
                  Travel in comfort,
                  <br />we handle every detail
                </>
              )}
            </h1>
            <p>{lang === "ru" ? "AI-консьерж подберёт лучшие варианты и поможет с бронированием за секунды." : "AI concierge shortlists the best stays and guides you to booking in seconds."}</p>
            <div className="sp-hero-perks">
              <span><SpIcon name="sparkle" />{lang === "ru" ? "Лучшие цены" : "Best rates"}</span>
              <span><SpIcon name="wallet" />{lang === "ru" ? "Без скрытых платежей" : "No hidden fees"}</span>
              <span><SpIcon name="headphones" />{lang === "ru" ? "Поддержка 24/7" : "24/7 support"}</span>
            </div>
          </div>

          <form id="search" className="sp-hero-search" method="GET">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="currency" value={currency} />
            <input type="hidden" name="view" value={view} />
            {view === "map" ? <input type="hidden" name="map_safe" value="1" /> : null}
            <input type="hidden" name="exp_variant" value={trustVariant} />
            <input type="hidden" name="page" value="1" />
            {searchParams.q ? <input type="hidden" name="q" value={searchParams.q} /> : null}
            {searchParams.property_type ? <input type="hidden" name="property_type" value={searchParams.property_type} /> : null}
            {searchParams.trip_purpose ? <input type="hidden" name="trip_purpose" value={searchParams.trip_purpose} /> : null}
            {searchParams.min_bedrooms ? <input type="hidden" name="min_bedrooms" value={searchParams.min_bedrooms} /> : null}
            {searchParams.min_rating ? <input type="hidden" name="min_rating" value={searchParams.min_rating} /> : null}
            {amenitiesQuery ? <input type="hidden" name="amenities" value={amenitiesQuery} /> : null}
            {searchParams.min_price ? <input type="hidden" name="min_price" value={searchParams.min_price} /> : null}
            {searchParams.max_price ? <input type="hidden" name="max_price" value={searchParams.max_price} /> : null}
            {searchParams.sort_by ? <input type="hidden" name="sort_by" value={searchParams.sort_by} /> : null}
            {searchParams.sort_order ? <input type="hidden" name="sort_order" value={searchParams.sort_order} /> : null}
            <label>
              <span><SpIcon name="location" />{lang === "ru" ? "Куда" : "Where"}</span>
              <select name="city" defaultValue={cityValueInForm}>
                <option value="">{tr.allCities}</option>
                {hasCustomCityValue ? <option value={currentCity}>{localizeCityName(currentCity, lang)}</option> : null}
                {cityOptions.map((city) => (
                  <option key={city} value={city}>
                    {localizeCityName(city, lang)}
                  </option>
                ))}
              </select>
            </label>
            <DateRangePicker
              lang={lang}
              variant="hero"
              defaultCheckIn={heroCheckIn}
              defaultCheckOut={heroCheckOut}
              checkInName="check_in"
              checkOutName="check_out"
              checkInLabel={tr.checkIn}
              checkOutLabel={tr.checkOut}
            />
            <label>
              <span><SpIcon name="users" />{lang === "ru" ? "Гости и номера" : "Guests and rooms"}</span>
              <input name="guests" type="number" min={1} max={12} placeholder="2" defaultValue={selectedGuestsInUi} />
            </label>
            <button type="submit">{lang === "ru" ? "Найти" : "Search"}</button>
          </form>
        </section>

        <section className="sp-categories">
          <Link href={quickFilterLink(searchParams, { page: "1" })} className={!searchParams.property_type ? "active" : ""}>
            <SpIcon name="hotel" />{lang === "ru" ? "Все" : "All"}
          </Link>
          <Link href={quickFilterLink(searchParams, { property_type: "hotel" })} className={searchParams.property_type === "hotel" ? "active" : ""}>
            <SpIcon name="hotel" />{tr.hotel}
          </Link>
          <Link href={quickFilterLink(searchParams, { property_type: "apartment" })} className={searchParams.property_type === "apartment" ? "active" : ""}>
            <SpIcon name="apartment" />{tr.apartment}
          </Link>
          <Link href={quickFilterLink(searchParams, { property_type: "villa" })} className={searchParams.property_type === "villa" ? "active" : ""}>
            <SpIcon name="villa" />{lang === "ru" ? "Виллы" : "Villas"}
          </Link>
          <Link href={quickFilterLink(searchParams, { trip_purpose: "family" })} className={searchParams.trip_purpose === "family" ? "active" : ""}>
            <SpIcon name="users" />{lang === "ru" ? "Для семьи" : "Family"}
          </Link>
          <Link href={quickFilterLink(searchParams, { trip_purpose: "couple" })} className={searchParams.trip_purpose === "couple" ? "active" : ""}>
            <SpIcon name="heart" />{lang === "ru" ? "Романтика" : "Romance"}
          </Link>
          <Link href={quickFilterLink(searchParams, { trip_purpose: "business" })} className={searchParams.trip_purpose === "business" ? "active" : ""}>
            <SpIcon name="briefcase" />{tr.businessTrip}
          </Link>
          <a href="#results"><SpIcon name="dots" />{lang === "ru" ? "Ещё" : "More"}</a>
        </section>

        <section id="results" className="sp-results">
          <header className="sp-results-head">
            <div>
              <h2>{lang === "ru" ? "Рекомендуем для вас" : "Recommended for you"}</h2>
              <p>
                {lang === "ru"
                  ? "Подборка лучших вариантов на основе ваших предпочтений"
                  : "A curated shortlist based on your preferences"}
              </p>
            </div>
            <div className="sp-results-tools">
              <Link className="sp-see-all" href={pageLink(searchParams, 1)}>
                {lang === "ru" ? "Смотреть все" : "See all"} <span>→</span>
              </Link>
              <div className="sp-view-toggle">
                <Link href={viewLink(searchParams, "list")} className={view === "list" ? "active" : ""}>{tr.listMode}</Link>
                <Link href={viewLink(searchParams, "map")} className={view === "map" ? "active" : ""}>{tr.mapMode}</Link>
              </div>
            </div>
          </header>

          {view === "map" ? (
            <CityMapPanel
              lang={lang}
              currency={currency}
              variant={trustVariant}
              city={currentCity || undefined}
              title={tr.mapTitle}
              hint={tr.mapHint}
              pins={mapItems.map((item) => {
                const pt = syntheticPoint(item.city, item.district, item.id);
                return {
                  id: item.id,
                  href: stayDetailsHref(item.id),
                  title: `${presentListingTitle(item.title, item.city, item.id, lang)} • ${localizeCityName(item.city, lang)}, ${item.district}`,
                  priceLabel: formatPrice(item.nightly_price, currency, lang),
                  x: pt.x,
                  y: pt.y,
                };
              })}
            />
          ) : null}

          <div className="sp-card-grid">
            {featuredCards.map((item, index) => {
              const itemHref = stayDetailsHref(item.id);
              const rawDisplayTitle = presentListingTitle(item.title, item.city, item.id, lang);
              const displayTitle = showcaseTitle(rawDisplayTitle, index, lang);
              const imageSrc = showcaseImage(index, item.cover_photo_url);
              const isBestValue = showBestValueBadges && bestValueIds.has(item.id);
              const policyLabel =
                index === 2
                  ? lang === "ru" ? "Бесплатная отмена" : "Free cancellation"
                  : lang === "ru" ? "Завтрак включён" : "Breakfast included";
              return (
                <article key={item.id} className="sp-card property-card">
                  <CatalogPreviewLightbox
                    className="sp-card-cover card-cover"
                    imageUrl={imageSrc}
                    title={displayTitle}
                    subtitle={`${localizeCityName(item.city, lang)}, ${item.district}`}
                    priceLabel={`${formatPrice(item.nightly_price, currency, lang)} ${tr.perNight}`}
                    stayHref={itemHref}
                    listingId={item.id}
                    position={index + 1}
                    variant={trustVariant}
                    lang={lang}
                    currency={currency}
                    openLabel={lang === "ru" ? "Быстрый просмотр" : "Quick preview"}
                    closeLabel={lang === "ru" ? "Закрыть" : "Close"}
                    ctaLabel={tr.viewStay}
                  >
                    <img className="sp-card-cover-image" src={imageSrc} alt={displayTitle} loading="lazy" decoding="async" />
                    <b className="sp-card-rating">{item.rating.toFixed(1)}</b>
                    {isBestValue ? <em className="sp-card-badge">{index === 2 ? (lang === "ru" ? "Популярный" : "Popular") : "-15%"}</em> : null}
                  </CatalogPreviewLightbox>
                  <div className="sp-card-body">
                    <h3>
                      <TrackedStayLink href={itemHref} listingId={item.id} position={index + 1} variant={trustVariant} lang={lang} currency={currency}>
                        {displayTitle}
                      </TrackedStayLink>
                    </h3>
                    <p>{localizeCityName(item.city, lang)}, {item.district}</p>
                    <div className="sp-card-stars" aria-label={`${item.rating.toFixed(1)} rating`}>
                      <span>★★★★★</span>
                      <b>{item.rating.toFixed(1)}</b>
                    </div>
                    <div className="sp-card-price">
                      <small>{lang === "ru" ? "от" : "from"}</small>
                      <strong>{formatPrice(item.nightly_price, currency, lang)}</strong>
                      <small>{tr.perNight}</small>
                    </div>
                    <div className="sp-card-meta">
                      <span>{item.bedrooms} {tr.bedroomsShort}</span>
                      <span>{tr.upTo} {item.max_guests} {guestsWord}</span>
                    </div>
                    <small className={`sp-card-policy ${index === 2 ? "positive" : ""}`}>{policyLabel}</small>
                    <div className="actions">
                      <TrackedStayLink href={itemHref} listingId={item.id} position={index + 1} variant={trustVariant} lang={lang} currency={currency}>
                        {tr.viewStay}
                      </TrackedStayLink>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {result.items.length === 0 ? (
            <article className="sp-empty">
              <h3>{tr.noResultsTitle}</h3>
              <p>{tr.noResultsHint}</p>
              <Link href={resetFiltersLink(searchParams)}>{tr.resetFilters}</Link>
            </article>
          ) : null}

          <nav className="sp-pager" aria-label="Pagination">
            <Link href={page > 1 ? pageLink(searchParams, page - 1) : "#"} className={page <= 1 ? "disabled" : ""}>{tr.back}</Link>
            <span>{tr.page} {page} {tr.of} {totalPages}</span>
            <Link href={page < totalPages ? pageLink(searchParams, page + 1) : "#"} className={page >= totalPages ? "disabled" : ""}>{tr.next}</Link>
          </nav>
        </section>

        <section className="sp-features">
          <article>
            <span className="sp-feature-icon"><SpIcon name="sparkle" /></span>
            <h4>{lang === "ru" ? "Лучшие цены" : "Best rates"}</h4>
            <p>{lang === "ru" ? "Мы сравниваем цены на 100+ сайтах, чтобы найти лучшее предложение" : "We compare prices across 100+ sites to find the best offer."}</p>
          </article>
          <article>
            <span className="sp-feature-icon"><SpIcon name="wallet" /></span>
            <h4>{lang === "ru" ? "Без скрытых платежей" : "No hidden fees"}</h4>
            <p>{lang === "ru" ? "Цена, которую вы видите, окончательная. Никаких дополнительных сборов" : "The price you see is final, with no extra charges."}</p>
          </article>
          <article>
            <span className="sp-feature-icon"><SpIcon name="calendar" /></span>
            <h4>{lang === "ru" ? "Мгновенное подтверждение" : "Instant confirmation"}</h4>
            <p>{lang === "ru" ? "Бронируйте за секунды и мгновенно получайте подтверждение на email" : "Book in seconds and get confirmation instantly."}</p>
          </article>
          <article>
            <span className="sp-feature-icon"><SpIcon name="headphones" /></span>
            <h4>{lang === "ru" ? "Поддержка 24/7" : "24/7 support"}</h4>
            <p>{lang === "ru" ? "Наша команда и AI-консьерж на связи круглосуточно" : "Our team and AI concierge are always available."}</p>
          </article>
        </section>
      </div>

      <HomeChatRail
        title={lang === "ru" ? "AI-консьерж" : "AI concierge"}
        status={lang === "ru" ? "Онлайн" : "Online"}
        moreLabel={lang === "ru" ? "Еще" : "More"}
        closeLabel={lang === "ru" ? "Закрыть" : "Close"}
        openLabel={lang === "ru" ? "Открыть AI-консьерж" : "Open AI concierge"}
        searchLabel={lang === "ru" ? "Изменить поиск" : "Adjust search"}
        resultsLabel={lang === "ru" ? "Смотреть варианты" : "View stays"}
        defaultCollapsed
      >
        <AIConcierge
          lang={lang}
          currency={currency}
          variant="rail"
          showcaseCards={rightRailShowcaseCards}
          quickPrompts={rightRailQuickPrompts}
          initialUserPrompt={lang === "ru" ? "Нужен отель в Дубае на 3 ночи, 2 взрослых" : "Need a hotel in Dubai for 3 nights, 2 adults"}
        />
      </HomeChatRail>
    </div>
  );
}
