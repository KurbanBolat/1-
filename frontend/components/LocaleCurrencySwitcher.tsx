"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function LocaleCurrencySwitcher({
  lang,
  currency,
}: {
  lang: "en" | "ru";
  currency: "KZT" | "USD";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    const query = next.toString();

    if (typeof window !== "undefined") {
      if (key === "lang") localStorage.setItem("findapart_lang", value);
      if (key === "currency") localStorage.setItem("findapart_currency", value);
    }

    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="switcher-inline" aria-label={lang === "ru" ? "Язык и валюта" : "Language and currency"}>
      <select
        className="switch-mini"
        value={currency}
        onChange={(e) => updateParam("currency", e.target.value)}
        aria-label={lang === "ru" ? "Валюта" : "Currency"}
      >
        <option value="KZT">KZT</option>
        <option value="USD">USD</option>
      </select>

      <select
        className="switch-mini"
        value={lang}
        onChange={(e) => updateParam("lang", e.target.value)}
        aria-label={lang === "ru" ? "Язык" : "Language"}
      >
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}
