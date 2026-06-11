export type MoneyLang = "en" | "ru";
export type MoneyCurrency = "KZT" | "USD";

const DEFAULT_USD_RATE = 500;

export function formatPriceFromKzt(
  valueKzt: number,
  currency: MoneyCurrency,
  lang: MoneyLang,
  usdRate: number = DEFAULT_USD_RATE,
): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (currency === "USD") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(valueKzt / usdRate);
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(valueKzt);
}
