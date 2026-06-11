import Link from "next/link";
import { redirect } from "next/navigation";

import CheckoutShell from "../../components/CheckoutShell";
import StayPilotShell from "../../components/StayPilotShell";
import { getListing, getListingQuote } from "../../lib/api";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";
type Tariff = "basic" | "smart" | "flex";

const t = {
  en: {
    back: "Back to stay",
    title: "Complete booking",
    unavailable: "Selected dates are unavailable.",
    unavailableAction: "Choose another room",
    summary: "Final price breakdown",
    nights: "Nights",
    subtotal: "Subtotal",
    cleaning: "Cleaning fee",
    service: "Service fee",
    total: "Total",
    dynamicPricing: "Demand pricing",
    dynamicPricingHint: "Weekend/season coefficient",
    policy: "Cancellation policy",
    bookingDetails: "Booking details",
    tariff: "Tariff",
    basic: "Basic",
    smart: "Smart",
    flex: "Flex",
    guests: "guests",
    completeBooking: "Complete booking",
    included: "Included with booking",
    support: "24/7 support",
    instant: "Instant confirmation",
    secure: "Secure payment flow",
    trustTitle: "Final amount with no hidden fees",
    checkInWindow: "from 14:00",
    checkOutWindow: "until 12:00",
    basicHint: "Best price, stricter cancellation",
    smartHint: "Balanced flexibility and value",
    flexHint: "Higher flexibility, easiest cancellation",
    lockTitle: "Price lock",
    lockExpired: "Price lock expired. Refresh quote before confirming.",
    lockActive: "Price is locked for current dates and guests.",
    lockExpiredAction: "Refresh and unlock",
    refreshQuote: "Refresh quote",
    refreshingQuote: "Refreshing...",
    quoteRefreshed: "Quote updated.",
    quoteAutoRefreshed: "Price lock was refreshed automatically.",
    quoteRefreshFailed: "Failed to refresh quote. Try again.",
    adjustTitle: "Adjust dates and guests",
    applyAdjustments: "Apply changes",
    checkInLabel: "Check-in",
    checkOutLabel: "Check-out",
    guestsLabel: "Guests",
    selectedRoom: "Selected room",
    selectedDates: "Selected dates",
    selectedTariff: "Selected tariff",
    roomFallback: "Room category",
  },
  ru: {
    back: "Назад к объекту",
    title: "Подтверждение брони",
    unavailable: "Выбранные даты недоступны.",
    unavailableAction: "Выбрать другой номер",
    summary: "Итоговая стоимость",
    nights: "Ночей",
    subtotal: "Подытог",
    cleaning: "Уборка",
    service: "Сервисный сбор",
    total: "Итого",
    dynamicPricing: "Динамическая цена",
    dynamicPricingHint: "Коэффициент сезонности/выходных",
    policy: "Политика отмены",
    bookingDetails: "Детали бронирования",
    tariff: "Тариф",
    basic: "Базовый",
    smart: "Оптимальный",
    flex: "Гибкий",
    guests: "гостей",
    completeBooking: "Подтверждение брони",
    included: "В стоимость входит",
    support: "Поддержка 24/7",
    instant: "Мгновенное подтверждение",
    secure: "Безопасный платежный процесс",
    trustTitle: "Итог к оплате без скрытых сборов",
    checkInWindow: "с 14:00",
    checkOutWindow: "до 12:00",
    basicHint: "Лучшая цена, более строгая отмена",
    smartHint: "Баланс гибкости и стоимости",
    flexHint: "Максимальная гибкость, удобная отмена",
    lockTitle: "Фиксация цены",
    lockExpired: "Фиксация истекла. Обновите квоту перед подтверждением.",
    lockActive: "Цена зафиксирована для текущих дат и гостей.",
    lockExpiredAction: "Обновить и разблокировать",
    refreshQuote: "Обновить цену",
    refreshingQuote: "Обновляем...",
    quoteRefreshed: "Квота обновлена.",
    quoteAutoRefreshed: "Фиксация цены обновлена автоматически.",
    quoteRefreshFailed: "Не удалось обновить квоту. Попробуйте снова.",
    adjustTitle: "Изменить даты и гостей",
    applyAdjustments: "Применить изменения",
    checkInLabel: "Заезд",
    checkOutLabel: "Выезд",
    guestsLabel: "Гости",
    selectedRoom: "Выбранный номер",
    selectedDates: "Выбранные даты",
    selectedTariff: "Выбранный тариф",
    roomFallback: "Категория номера",
  },
} as const;

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: {
    listing_id?: string;
    check_in?: string;
    check_out?: string;
    guests?: string;
    lang?: string;
    currency?: string;
    tariff?: string;
    room_type_id?: string;
    exp_variant?: string;
  };
}) {
  const listingId = Number(searchParams.listing_id || "0");
  const roomTypeIdRaw = Number(searchParams.room_type_id || "0");
  const roomTypeId = Number.isFinite(roomTypeIdRaw) && roomTypeIdRaw > 0 ? roomTypeIdRaw : undefined;
  const checkIn = searchParams.check_in || "";
  const checkOut = searchParams.check_out || "";
  const guests = Number(searchParams.guests || "2");
  const tariff: Tariff = searchParams.tariff === "basic" || searchParams.tariff === "flex" ? searchParams.tariff : "smart";
  const lang: Lang = searchParams.lang === "ru" ? "ru" : "en";
  const currency: Currency = searchParams.currency === "KZT" ? "KZT" : "USD";
  const expVariant = searchParams.exp_variant === "b" ? "b" : "a";
  const tr = t[lang];

  if (!listingId || !checkIn || !checkOut) {
    redirect(`/?lang=${lang}&currency=${currency}`);
  }

  const listing = await getListing(listingId);
  const quote = await getListingQuote({ listing_id: listingId, check_in: checkIn, check_out: checkOut, guests, tariff, room_type_id: roomTypeId });
  const stayBackParams = new URLSearchParams({
    lang,
    currency,
    exp_variant: expVariant,
    check_in: checkIn,
    check_out: checkOut,
    guests: String(guests),
  });
  if (roomTypeId) stayBackParams.set("room_type_id", String(roomTypeId));
  const tariffOptions: Array<{ key: Tariff; label: string; hint: string }> = [
    { key: "basic", label: tr.basic, hint: tr.basicHint },
    { key: "smart", label: tr.smart, hint: tr.smartHint },
    { key: "flex", label: tr.flex, hint: tr.flexHint },
  ];

  return (
    <StayPilotShell lang={lang} currency={currency} active="checkout">
      <div className="sp-transaction-page">
        <Link href={`/stays/${listingId}?${stayBackParams.toString()}#available-rooms`} className="sp-back-link">
          {tr.back}
        </Link>
        <CheckoutShell
          listingId={listingId}
          checkIn={checkIn}
          checkOut={checkOut}
          guests={guests}
          roomTypeId={roomTypeId}
          lang={lang}
          currency={currency}
          expVariant={expVariant}
          initialQuote={quote}
          listingTitle={listing.title}
          tariffOptions={tariffOptions}
          copy={{
            unavailable: tr.unavailable,
            unavailableAction: tr.unavailableAction,
            summary: tr.summary,
            nights: tr.nights,
            subtotal: tr.subtotal,
            cleaning: tr.cleaning,
            service: tr.service,
            total: tr.total,
            dynamicPricing: tr.dynamicPricing,
            dynamicPricingHint: tr.dynamicPricingHint,
            policy: tr.policy,
            bookingDetails: tr.bookingDetails,
            tariff: tr.tariff,
            guests: tr.guests,
            completeBooking: tr.title,
            included: tr.included,
            support: tr.support,
            instant: tr.instant,
            secure: tr.secure,
            trustTitle: tr.trustTitle,
            checkInWindow: tr.checkInWindow,
            checkOutWindow: tr.checkOutWindow,
            lockTitle: tr.lockTitle,
            lockExpired: tr.lockExpired,
            lockActive: tr.lockActive,
            lockExpiredAction: tr.lockExpiredAction,
            refreshQuote: tr.refreshQuote,
            refreshingQuote: tr.refreshingQuote,
            quoteRefreshed: tr.quoteRefreshed,
            quoteAutoRefreshed: tr.quoteAutoRefreshed,
            quoteRefreshFailed: tr.quoteRefreshFailed,
            adjustTitle: tr.adjustTitle,
            applyAdjustments: tr.applyAdjustments,
            checkInLabel: tr.checkInLabel,
            checkOutLabel: tr.checkOutLabel,
            guestsLabel: tr.guestsLabel,
            selectedRoom: tr.selectedRoom,
            selectedDates: tr.selectedDates,
            selectedTariff: tr.selectedTariff,
            roomFallback: tr.roomFallback,
          }}
        />
      </div>
    </StayPilotShell>
  );
}
