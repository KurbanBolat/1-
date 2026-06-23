import Link from "next/link";
import { notFound } from "next/navigation";

import StayBookingCard from "../../../components/StayBookingCard";
import StayGallery from "../../../components/StayGallery";
import MobileBookBar from "../../../components/MobileBookBar";
import InStayConcierge from "../../../components/InStayConcierge";
import StayPilotShell from "../../../components/StayPilotShell";
import TrustLayerCard from "../../../components/TrustLayerCard";
import {
  getListing,
  getListingPhotos,
  getListingQuote,
  getListingRestaurants,
  getListingRoomAvailability,
  getListings,
  type RoomAvailabilityWindow,
  type RoomTypeAvailability,
} from "../../../lib/api";
import { resolveMediaUrl } from "../../../lib/media";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

const USD_RATE = 500;
const STAY_FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1200&q=84",
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=900&q=82",
];

const t = {
  en: {
    back: "Back to search",
    bookingPanelTitle: "Complete reservation",
    continue: "Continue to checkout",
    similar: "Similar stays in",
    openStay: "Open stay",
    perNight: "/ night",
    bedrooms: "bedrooms",
    bathrooms: "bathrooms",
    guests: "Guests",
    amenities: "Amenities",
    upTo: "up to",
    checkIn: "Check-in",
    checkOut: "Check-out",
    policy: "Cancellation policy",
    maxGuests: "Maximum guests",
    booked: "Booked periods",
    pickDates: "Choose dates",
    bookedLegend: "Booked",
    selectedLegend: "Selected range",
    nights: "Nights",
    nearestWindow: "Nearest free window",
    fromToday: "from today",
    noBlocksSoon: "No blocked dates in the nearest horizon",
    nextBusy: "Next busy period",
    gallery: "Property gallery",
    photos: "photos",
    demoGallery: "demo gallery",
    openGallery: "Open gallery",
    closeGallery: "Close",
    bookNow: "Book now",
    selection: "Selected stay",
    noSimilar: "No similar stays found yet",
    dateFormatLocale: "en-US",
    calendarHorizon: "next 60 days",
    availableRoomsTitle: "Available rooms",
    availableRoomsLead: "Choose a room category with live availability",
    availableRoomsLeadSelected: "Rooms available for your selected dates",
    availableRoomsNextStep: "Next: choose a room, review details, then pay securely.",
    mobileRoomsCta: "See available rooms",
    mobileRoomsHint: "Pick a room before checkout",
    dateSearchTitle: "Search available rooms",
    dateSearchHint: "Pick dates and guests, then choose a room below",
    showRooms: "Show rooms",
    oneRoomAvailable: "1 room available",
    noRoomsAvailable: "No rooms available",
    roomOption: "Stay option",
    roomCategory: "Room category",
    roomWindow: "Available dates",
    roomOccupancy: "Sleeps",
    roomChoice: "Your choices",
    roomSelect: "Select",
    roomTotalLabel: "Total for these dates",
    roomRateLabel: "Nightly rate",
    noPrepayment: "No prepayment",
    freeCancellation: "Free cancellation",
    availableUntil: "Available until",
    chooseDates: "Choose room",
    soldOutHorizon: "No rooms are available in the next 60 days.",
    soldOutHint: "Try later dates or another stay.",
    busyDates: "Booked dates",
    todayLabel: "Today",
    summary: "Price summary",
    subtotal: "Subtotal",
    cleaning: "Cleaning fee",
    service: "Service fee",
    total: "Total estimate",
    estimateHint: "Estimated total before dynamic pricing and tariff rules.",
    trustTitle: "Transparent price preview",
    trustSelectedNote: "Calculated for your selected dates",
    trustDefaultNote: "Preview for 1 night",
    checkInWindow: "from 14:00",
    checkOutWindow: "until 12:00",
    restaurantsAtHotel: "Restaurants at this hotel",
    openRestaurant: "Open restaurant",
    noRestaurants: "No restaurants added yet",
    avgCheck: "Average check",
    openHours: "Open",
    ratingLabel: "rating",
    amenitiesEmpty: "No amenities listed",
  },
  ru: {
    back: "Назад к поиску",
    bookingPanelTitle: "Оформление бронирования",
    continue: "Перейти к оформлению",
    similar: "Похожие варианты в",
    openStay: "Открыть",
    perNight: "/ ночь",
    bedrooms: "спальни",
    bathrooms: "ванные",
    guests: "гостей",
    amenities: "Удобства",
    upTo: "до",
    checkIn: "Заезд",
    checkOut: "Выезд",
    policy: "Политика отмены",
    maxGuests: "Максимум гостей",
    booked: "Занятые периоды",
    pickDates: "Выберите даты",
    bookedLegend: "Занято",
    selectedLegend: "Выбранный диапазон",
    nights: "Ночей",
    nearestWindow: "Ближайшее свободное окно",
    fromToday: "от сегодня",
    noBlocksSoon: "В ближайшем горизонте нет занятых дат",
    nextBusy: "Следующий занятый период",
    gallery: "Галерея объекта",
    photos: "фото",
    demoGallery: "демо-галерея",
    openGallery: "Открыть галерею",
    closeGallery: "Закрыть",
    bookNow: "Забронировать",
    selection: "Выбранный вариант",
    noSimilar: "Похожие варианты пока не найдены",
    dateFormatLocale: "ru-RU",
    calendarHorizon: "ближайшие 60 дней",
    availableRoomsTitle: "Свободные номера",
    availableRoomsLead: "Выберите категорию номера с актуальной доступностью",
    availableRoomsLeadSelected: "Номера, доступные на выбранные даты",
    availableRoomsNextStep: "Дальше: выберите номер, проверьте детали и оплатите безопасно.",
    mobileRoomsCta: "Смотреть свободные номера",
    mobileRoomsHint: "Сначала выберите номер",
    dateSearchTitle: "Поиск свободных номеров",
    dateSearchHint: "Выберите даты и гостей, затем забронируйте номер ниже",
    showRooms: "Показать номера",
    oneRoomAvailable: "1 номер доступен",
    noRoomsAvailable: "Нет свободных номеров",
    roomOption: "Вариант проживания",
    roomCategory: "Категория номера",
    roomWindow: "Свободные даты",
    roomOccupancy: "Гостей",
    roomChoice: "Ваши условия",
    roomSelect: "Выбор",
    roomTotalLabel: "Итого за даты",
    roomRateLabel: "Цена за ночь",
    noPrepayment: "Без предоплаты",
    freeCancellation: "Бесплатная отмена",
    availableUntil: "Доступно до",
    chooseDates: "Выбрать номер",
    soldOutHorizon: "В ближайшие 60 дней свободных номеров нет.",
    soldOutHint: "Попробуйте более поздние даты или другой объект.",
    busyDates: "Занятые даты",
    todayLabel: "Сегодня",
    summary: "Сводка цены",
    subtotal: "Подытог",
    cleaning: "Уборка",
    service: "Сервисный сбор",
    total: "Предварительный итог",
    estimateHint: "Оценка до применения динамической цены и правил тарифа.",
    trustTitle: "Прозрачная стоимость",
    trustSelectedNote: "Расчет для выбранных дат",
    trustDefaultNote: "Пример для 1 ночи",
    checkInWindow: "с 14:00",
    checkOutWindow: "до 12:00",
    restaurantsAtHotel: "Рестораны в этом отеле",
    openRestaurant: "Открыть ресторан",
    noRestaurants: "Рестораны пока не добавлены",
    avgCheck: "Средний чек",
    openHours: "Часы работы",
    ratingLabel: "рейтинг",
    amenitiesEmpty: "Удобства не указаны",
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

function localizeCityName(city: string | undefined, lang: Lang): string {
  const raw = (city || "").trim();
  if (!raw) return "";
  if (lang === "en") return raw;
  const key = raw.toLowerCase();
  return CITY_LABELS_RU[key] || raw;
}

function formatAmenities(amenities: string): string[] {
  return amenities
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cleanListingDescription(raw: string, lang: Lang): string {
  const stripped = (raw || "").replace(/\[seed:[^\]]+\]/gi, "").trim();
  const low = stripped.toLowerCase();
  const looksTestData =
    !stripped ||
    low === "desc" ||
    low === "test" ||
    low === "description" ||
    /(?:e2e|qa\s*flow|bulk\s*status|bulkdelete|partner\s*cabinet|updated\s*listing|block\s*flow)/i.test(low);
  if (looksTestData) {
    return lang === "ru"
      ? "Описание объекта пока дополняется. Доступны все базовые условия проживания."
      : "Listing description is being updated. Core stay details are available.";
  }
  return stripped;
}

function presentListingTitle(raw: string, city: string, id: number, lang: Lang): string {
  const title = (raw || "").trim();
  if (!title) return lang === "ru" ? `Вариант #${id}` : `Stay #${id}`;
  const low = title.toLowerCase();
  if (low.includes("test") || low.includes("e2e") || low.includes("bulkdelete")) {
    const cityName = localizeCityName(city, lang);
    return `${cityName} Residence #${id}`;
  }
  return title;
}

function presentRestaurantName(raw: string, lang: Lang): string {
  const name = (raw || "").trim();
  if (!name) return lang === "ru" ? "Ресторан" : "Restaurant";
  const normalized = name.replace(/\s+\d{6,}$/g, "");
  const low = normalized.toLowerCase();
  if (low.includes("e2e") || low.includes("test")) {
    return lang === "ru" ? "Signature Restaurant" : "Signature Restaurant";
  }
  return normalized;
}

function presentRestaurantCuisine(raw: string, lang: Lang): string {
  const cuisine = (raw || "").trim();
  if (!cuisine) return lang === "ru" ? "Кухня" : "Cuisine";
  const low = cuisine.toLowerCase();
  if (low.includes("test") || low.includes("e2e")) {
    return lang === "ru" ? "Авторская кухня" : "Signature cuisine";
  }
  return cuisine;
}

function formatPrice(valueKzt: number, currency: Currency, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (currency === "USD") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(valueKzt / USD_RATE);
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(valueKzt);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDay(isoDate: string, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(new Date(`${isoDate}T00:00:00`));
}

function formatRange(checkIn: string, checkOut: string, lang: Lang): string {
  return `${formatDay(checkIn, lang)} - ${formatDay(checkOut, lang)}`;
}

function formatNightsCount(nights: number, lang: Lang): string {
  if (lang === "en") return `${nights} ${nights === 1 ? "night" : "nights"}`;
  const mod10 = nights % 10;
  const mod100 = nights % 100;
  if (mod10 === 1 && mod100 !== 11) return `${nights} ночь`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${nights} ночи`;
  return `${nights} ночей`;
}

function formatBedroomsCount(bedrooms: number, lang: Lang): string {
  if (lang === "en") return `${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}`;
  const mod10 = bedrooms % 10;
  const mod100 = bedrooms % 100;
  if (mod10 === 1 && mod100 !== 11) return `${bedrooms} спальня`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${bedrooms} спальни`;
  return `${bedrooms} спален`;
}

function formatRoomsAvailable(count: number, lang: Lang): string {
  if (lang === "en") return `${count} ${count === 1 ? "room" : "rooms"} available`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} номер доступен`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} номера доступны`;
  return `${count} номеров доступно`;
}

function formatRoomInventoryBadge(count: number, lang: Lang): string {
  if (lang === "en") {
    if (count === 1) return "Only 1 room left";
    if (count <= 3) return `Only ${count} rooms left`;
    return formatRoomsAvailable(count, lang);
  }
  if (count === 1) return "Остался 1 номер";
  if (count >= 2 && count <= 4) return `Осталось ${count} номера`;
  return formatRoomsAvailable(count, lang);
}

function formatRoomTypesCount(count: number, lang: Lang): string {
  if (lang === "en") return `${count} ${count === 1 ? "room type" : "room types"} available`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} тип номера доступен`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} типа номеров доступно`;
  return `${count} типов номеров доступно`;
}

function toLocalIsoDate(input: Date): string {
  const y = input.getFullYear();
  const m = String(input.getMonth() + 1).padStart(2, "0");
  const d = String(input.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function StayDetails({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    lang?: string;
    currency?: string;
    reservation_id?: string;
    guest_email?: string;
    access_token?: string;
    guests?: string;
    exp_variant?: string;
    check_in?: string;
    check_out?: string;
    room_type_id?: string;
    from_payment?: string;
    concierge?: string;
  };
}) {
  const listingId = Number(params.id);
  if (!Number.isFinite(listingId)) notFound();

  const lang: Lang = searchParams.lang === "ru" ? "ru" : "en";
  const currency: Currency = searchParams.currency === "KZT" ? "KZT" : "USD";
  const reservationId = Number(searchParams.reservation_id || "0");
  const guestEmail = searchParams.guest_email?.trim() || "";
  const accessToken = searchParams.access_token || "";
  const expVariant = searchParams.exp_variant === "b" ? "b" : "a";
  const selectedCheckIn = searchParams.check_in || "";
  const selectedCheckOut = searchParams.check_out || "";
  const selectedGuestsRaw = Number(searchParams.guests || "0");
  const selectedGuests = Number.isFinite(selectedGuestsRaw) && selectedGuestsRaw >= 1 ? selectedGuestsRaw : undefined;
  const selectedRoomTypeRaw = Number(searchParams.room_type_id || "0");
  const selectedRoomTypeId = Number.isFinite(selectedRoomTypeRaw) && selectedRoomTypeRaw > 0 ? selectedRoomTypeRaw : undefined;
  const postPaymentHandoff = searchParams.from_payment === "1" || searchParams.concierge === "1";
  const tr = t[lang];

  try {
    const listing = await getListing(listingId);
    const displayTitle = presentListingTitle(listing.title, listing.city, listing.id, lang);
    let selectedQuote: Awaited<ReturnType<typeof getListingQuote>> | null = null;
    if (selectedCheckIn && selectedCheckOut && selectedCheckOut > selectedCheckIn) {
      try {
        selectedQuote = await getListingQuote({
          listing_id: listingId,
          check_in: selectedCheckIn,
          check_out: selectedCheckOut,
          guests: selectedGuests || 2,
          tariff: "smart",
          room_type_id: selectedRoomTypeId,
        });
      } catch {
        selectedQuote = null;
      }
    }

    const previewNights = 1;
    const previewSubtotal = listing.nightly_price;
    const previewServiceFee = Math.round(previewSubtotal * (listing.service_fee_percent / 100));
    const previewCleaningFee = listing.cleaning_fee;
    const previewTotal = previewSubtotal + previewCleaningFee + previewServiceFee;
    const similar = await getListings({ city: listing.city, page: 1, page_size: 4, sort_by: "rating", sort_order: "desc" });
    const restaurants = await getListingRestaurants(listingId, true);
    const photos = await getListingPhotos(listingId);
    const orderedPhotos = [...photos].sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort_order - b.sort_order);
    const galleryImages =
      orderedPhotos.length > 0
        ? orderedPhotos.map((photo) => ({
            id: photo.id,
            url: resolveMediaUrl(photo.file_url) || "",
            alt: displayTitle,
          }))
        : STAY_FALLBACK_IMAGES.map((url, index) => ({
            id: -(index + 1),
            url,
            alt: `${displayTitle} ${index + 1}`,
          }));

    const today = new Date();
    const fromDate = toLocalIsoDate(today);
    const toDate = toLocalIsoDate(new Date(today.getTime() + 1000 * 60 * 60 * 24 * 180));
    const availabilityGuests = Math.min(selectedGuests || 2, Math.max(listing.max_guests, 1));
    const selectedRangeValid = Boolean(
      selectedCheckIn &&
        selectedCheckOut &&
        selectedCheckOut > selectedCheckIn &&
        selectedCheckIn >= fromDate,
    );
    const roomAvailabilityFrom = selectedRangeValid ? selectedCheckIn : fromDate;
    const roomAvailabilityTo = selectedRangeValid ? selectedCheckOut : addDays(fromDate, 60);
    const roomAvailability = await getListingRoomAvailability({
      listing_id: listingId,
      from_date: roomAvailabilityFrom,
      to_date: roomAvailabilityTo,
      guests: availabilityGuests,
    });
    const amenitiesList = formatAmenities(listing.amenities);
    const availableRoomTypes = roomAvailability.room_types.filter((room) =>
      room.available_windows.some((window) => window.available_count > 0),
    );
    const roomOptions = (selectedRangeValid
      ? roomAvailability.room_types.flatMap((room) => {
          const exactWindow = room.available_windows.find(
            (window) =>
              window.check_in === selectedCheckIn &&
              window.check_out === selectedCheckOut &&
              window.available_count > 0,
          );
          return exactWindow ? [{ room, window: exactWindow }] : [];
        })
      : availableRoomTypes.flatMap((room) =>
          room.available_windows.slice(0, 2).map((window) => ({
            room,
            window,
          })),
        )
    )
      .sort(
        (a, b) =>
          a.window.check_in.localeCompare(b.window.check_in) ||
          a.room.nightly_price - b.room.nightly_price ||
          a.room.sort_order - b.room.sort_order,
      )
      .slice(0, selectedRangeValid ? 12 : 6);
    const availabilityRoomHref = (room: RoomTypeAvailability, window: RoomAvailabilityWindow) => {
      const ctaCheckIn = selectedRangeValid ? selectedCheckIn : window.check_in;
      const ctaCheckOut = selectedRangeValid
        ? selectedCheckOut
        : addDays(window.check_in, Math.min(Math.max(window.nights, 1), 2));
      const params = new URLSearchParams({
        listing_id: String(listing.id),
        room_type_id: String(room.id),
        lang,
        currency,
        exp_variant: expVariant,
        check_in: ctaCheckIn,
        check_out: ctaCheckOut,
        guests: String(availabilityGuests),
      });
      return `/checkout?${params.toString()}`;
    };
    const availableRoomsSection = (
      <div className="available-rooms-card" id="available-rooms">
        <div className="available-rooms-head">
          <div>
            <p className="desc">
              <b>{tr.availableRoomsTitle}</b> · {selectedRangeValid ? formatRange(selectedCheckIn, selectedCheckOut, lang) : tr.calendarHorizon}
            </p>
            <small className="available-rooms-note">{selectedRangeValid ? tr.availableRoomsLeadSelected : tr.availableRoomsLead}</small>
          </div>
          <span className={`available-room-status ${roomOptions.length > 0 ? "available" : "sold-out"}`}>
            {roomOptions.length > 0 ? formatRoomTypesCount(selectedRangeValid ? roomOptions.length : availableRoomTypes.length, lang) : tr.noRoomsAvailable}
          </span>
        </div>
        {roomOptions.length > 0 ? (
          <div className="available-room-list">
            <p className="available-rooms-next-step">{tr.availableRoomsNextStep}</p>
            {roomOptions.map(({ room, window }, index) => {
              const nightlyRate = formatPrice(room.nightly_price, currency, lang);
              const totalForWindow = formatPrice(room.nightly_price * Math.max(window.nights, 1), currency, lang);
              const lowInventory = window.available_count <= 3;
              return (
                <article key={`${room.id}-${window.check_in}-${window.check_out}`} className="available-room-card">
                  <div className="available-room-card-main">
                    <div className="available-room-titleline">
                      <span>{index === 0 && !selectedRangeValid ? tr.nearestWindow : tr.roomOption}</span>
                      <small className={lowInventory ? "low-stock" : undefined}>{formatRoomInventoryBadge(window.available_count, lang)}</small>
                    </div>
                    <h3>{room.name}</h3>
                    <div className="available-room-facts">
                      <span>{formatBedroomsCount(room.bedrooms, lang)}</span>
                      <span>{room.bathrooms} {tr.bathrooms}</span>
                      <span>{tr.upTo} {room.max_guests} {tr.guests.toLowerCase()}</span>
                      <span>{formatNightsCount(window.nights, lang)}</span>
                    </div>
                    <div className="available-room-benefits">
                      <span>{tr.noPrepayment}</span>
                      <span>{tr.freeCancellation}</span>
                    </div>
                  </div>
                  <div className="available-room-booking">
                    <span>{formatRange(window.check_in, window.check_out, lang)}</span>
                    <b>{totalForWindow}</b>
                    <small>
                      {formatNightsCount(window.nights, lang)} · {nightlyRate} {tr.perNight}
                    </small>
                    <Link
                      href={availabilityRoomHref(room, window)}
                      className="available-room-cta"
                      aria-label={`${tr.bookNow}: ${room.name}, ${formatRange(window.check_in, window.check_out, lang)}`}
                    >
                      {tr.bookNow}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="available-room-empty">
            <b>{tr.soldOutHorizon}</b>
            <span>{tr.soldOutHint}</span>
          </div>
        )}
      </div>
    );

    return (
      <StayPilotShell lang={lang} currency={currency} active="hotels">
        <div className="sp-stay-page">
          <Link href={`/?lang=${lang}&currency=${currency}&exp_variant=${expVariant}`} className="sp-back-link">
            {tr.back}
        </Link>

        <section className="stay-grid">
          <div className="stay-main">
            <StayGallery
              city={localizeCityName(listing.city, lang)}
              rating={listing.rating}
              ratingLabel={tr.ratingLabel}
              images={galleryImages}
              openLabel={tr.openGallery}
              closeLabel={tr.closeGallery}
            />

            <div className="property-detail">
              <div className="stay-title-wrap">
                <h1>{displayTitle}</h1>
                <p className="detail-location">
                  {localizeCityName(listing.city, lang)}, {listing.district} | {listing.property_type}
                </p>
              </div>
              <div className="stay-kpi-row">
                <span>{formatPrice(listing.nightly_price, currency, lang)} {tr.perNight}</span>
                <span>{listing.bedrooms} {tr.bedrooms}</span>
                <span>{listing.bathrooms} {tr.bathrooms}</span>
                <span>{tr.upTo} {listing.max_guests} {tr.guests.toLowerCase()}</span>
              </div>
              {availableRoomsSection}
              {orderedPhotos.length > 0 ? <p className="desc"><b>{tr.gallery}:</b> {orderedPhotos.length} {tr.photos}</p> : null}
              <p className="desc">{cleanListingDescription(listing.description, lang)}</p>
              <div className="stay-amenities">
                <p className="desc amenities"><b>{tr.amenities}:</b></p>
                <div className="pill-row">
                  {amenitiesList.length > 0 ? (
                    amenitiesList.map((amenity) => <span key={amenity}>{amenity}</span>)
                  ) : (
                    <span>{tr.amenitiesEmpty}</span>
                  )}
                </div>
              </div>
              <TrustLayerCard
                lang={lang}
                currency={currency}
                title={tr.trustTitle}
                note={tr.trustDefaultNote}
                nights={previewNights}
                nightlyPriceKzt={listing.nightly_price}
                cleaningFeeKzt={previewCleaningFee}
                serviceFeeKzt={previewServiceFee}
                totalKzt={previewTotal}
                cancellationText={listing.cancellation_policy}
                checkInWindow={tr.checkInWindow}
                checkOutWindow={tr.checkOutWindow}
              />
            </div>
          </div>

          <aside className="stay-book" id="booking-panel">
            <p className="kicker stay-book-kicker">{tr.selection}</p>
            <h3>{tr.bookingPanelTitle}</h3>
            <StayBookingCard
              listingId={listing.id}
              lang={lang}
              currency={currency}
              expVariant={expVariant}
              nightlyPrice={listing.nightly_price}
              cleaningFee={listing.cleaning_fee}
              serviceFeePercent={listing.service_fee_percent}
              maxGuests={listing.max_guests}
              initialCheckIn={selectedCheckIn || undefined}
              initialCheckOut={selectedCheckOut || undefined}
              initialGuests={selectedGuests}
              initialPricedQuote={
                selectedQuote
                  ? {
                      checkIn: selectedQuote.check_in,
                      checkOut: selectedQuote.check_out,
                      guests: selectedQuote.guests,
                      nights: selectedQuote.nights,
                      nightlyPrice: selectedQuote.nightly_price,
                      subtotal: selectedQuote.subtotal,
                      cleaningFee: selectedQuote.cleaning_fee,
                      serviceFee: selectedQuote.service_fee,
                      total: selectedQuote.total,
                      dynamicMultiplier: selectedQuote.dynamic_multiplier,
                    }
                  : undefined
              }
              labels={{
                continue: tr.continue,
                checkIn: tr.checkIn,
                checkOut: tr.checkOut,
                guests: tr.guests,
                maxGuests: tr.maxGuests,
                pickDates: tr.pickDates,
                bookedLegend: tr.bookedLegend,
                selectedLegend: tr.selectedLegend,
                selectedRange: lang === "ru" ? "Выбранные даты" : "Selected dates",
                nights: tr.nights,
                completeDates: lang === "ru" ? "выберите диапазон" : "select a range",
                summary: tr.summary,
                subtotal: tr.subtotal,
                cleaning: tr.cleaning,
                service: tr.service,
                total: tr.total,
                estimateHint: tr.estimateHint,
                dateSearchTitle: tr.dateSearchTitle,
                dateSearchHint: tr.dateSearchHint,
                showRooms: tr.showRooms,
              }}
            />
          </aside>
        </section>

        <MobileBookBar targetId="available-rooms" label={tr.mobileRoomsCta} hint={tr.mobileRoomsHint} hideWhenIds={["booking-panel", "in-stay-concierge"]} />

        <section className="similar-grid">
          <h3>{tr.similar} {localizeCityName(listing.city, lang)}</h3>
          <div className="similar-list">
            {similar.items.filter((x) => x.id !== listing.id).slice(0, 3).map((x) => (
              <article key={x.id} className="similar-card">
                <div>
                  <h4>{presentListingTitle(x.title, x.city, x.id, lang)}</h4>
                  <p>
                    {x.district} | {formatPrice(x.nightly_price, currency, lang)} {tr.perNight}
                  </p>
                </div>
                <Link href={`/stays/${x.id}?lang=${lang}&currency=${currency}&exp_variant=${expVariant}`} className="stay-link-btn">
                  {tr.openStay}
                </Link>
              </article>
            ))}
            {similar.items.filter((x) => x.id !== listing.id).length === 0 ? <p className="desc">{tr.noSimilar}</p> : null}
          </div>
        </section>
        <section className="similar-grid" id="hotel-restaurants">
          <h3>{tr.restaurantsAtHotel}</h3>
          <div className="similar-list">
            {restaurants.map((restaurant) => (
              <article key={restaurant.id} className="similar-card">
                <div>
                  <h4>{presentRestaurantName(restaurant.name, lang)}</h4>
                  <p>{presentRestaurantCuisine(restaurant.cuisine, lang)}</p>
                  <p>
                    {tr.openHours}: {restaurant.open_from} - {restaurant.open_to}
                  </p>
                  <p>
                    {tr.avgCheck}: {formatPrice(restaurant.avg_check_kzt, currency, lang)}
                  </p>
                </div>
                <Link
                  href={`/stays/${listing.id}/restaurants/${restaurant.id}?lang=${lang}&currency=${currency}&exp_variant=${expVariant}${reservationId > 0 ? `&reservation_id=${reservationId}` : ""}${guestEmail ? `&guest_email=${encodeURIComponent(guestEmail)}` : ""}${accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : ""}`}
                  className="stay-link-btn"
                >
                  {tr.openRestaurant}
                </Link>
              </article>
            ))}
            {restaurants.length === 0 ? <p className="desc">{tr.noRestaurants}</p> : null}
          </div>
        </section>
        {reservationId > 0 && guestEmail ? (
          <InStayConcierge
            listingId={listing.id}
            reservationId={reservationId}
            guestEmail={guestEmail}
            accessToken={accessToken}
            lang={lang}
            currency={currency}
            postPayment={postPaymentHandoff}
          />
        ) : null}
        </div>
      </StayPilotShell>
    );
  } catch {
    notFound();
  }
}
