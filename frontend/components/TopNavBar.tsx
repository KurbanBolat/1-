"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16" cy="12" r="1.4" fill="currentColor" />
      <path d="M7 6V4h9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export default function TopNavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const lang: Lang = searchParams.get("lang") === "ru" ? "ru" : "en";
  const currency: Currency = searchParams.get("currency") === "KZT" ? "KZT" : "USD";
  const nav = lang === "ru"
      ? {
          search: "Поиск",
          stays: "Каталог",
          concierge: "AI-консьерж",
          hotel: "Для отелей",
          account: "Кабинет",
          stay: "Объект",
          checkout: "Оформление",
          manager: "Партнер",
        }
      : {
          search: "Search",
          stays: "Catalog",
          concierge: "AI concierge",
          hotel: "For hotels",
          account: "Account",
          stay: "Stay",
          checkout: "Checkout",
          manager: "Partner",
        };

  const isHome = pathname === "/";
  const isStay = pathname.startsWith("/stays/");
  const isCheckout = pathname.startsWith("/checkout");
  const isAccount = pathname.startsWith("/account");
  const isManager = pathname.startsWith("/manager") || pathname.startsWith("/login");
  const isHotelSite = pathname.startsWith("/for-hotels");
  const [hash, setHash] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncHash = () => setHash(window.location.hash || "");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const homeActiveTab = useMemo<"search" | "catalog" | "ai">(() => {
    if (hash === "#results") return "catalog";
    if (hash === "#ai") return "ai";
    return "search";
  }, [hash]);

  function updateParam(key: "lang" | "currency", value: string) {
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
    <header className="topnav-wrap">
      <div className="topnav topnav-minimal">
        <Link href={`/?lang=${lang}&currency=${currency}`} className="topnav-brand-minimal">
          StayPilot
        </Link>

        <nav className="topnav-nav" aria-label={lang === "ru" ? "Навигация" : "Navigation"}>
          <Link href={`/?lang=${lang}&currency=${currency}`} className={`topnav-nav-link ${isHome && homeActiveTab === "search" ? "active" : ""}`}>{nav.search}</Link>
          <Link href={`/?lang=${lang}&currency=${currency}#results`} className={`topnav-nav-link ${isHome && homeActiveTab === "catalog" ? "active" : ""}`}>{nav.stays}</Link>
          <Link href={`/?lang=${lang}&currency=${currency}#ai`} className={`topnav-nav-link ${isHome && homeActiveTab === "ai" ? "active" : ""}`}>{nav.concierge}</Link>
          <Link href={`/for-hotels?lang=${lang}&currency=${currency}`} className={`topnav-nav-link ${isHotelSite ? "active" : ""}`}>{nav.hotel}</Link>
          <Link href={`/account?lang=${lang}&currency=${currency}`} className={`topnav-nav-link ${isAccount ? "active" : ""}`}>{nav.account}</Link>
          {isStay ? <span className="topnav-nav-link active">{nav.stay}</span> : null}
          {isCheckout ? <span className="topnav-nav-link active">{nav.checkout}</span> : null}
          {isManager ? <span className="topnav-nav-link active">{nav.manager}</span> : null}
        </nav>

        <div className="topnav-tools">
          <label className="icon-select" aria-label={lang === "ru" ? "Валюта" : "Currency"}>
            <span className="icon-select-icon"><WalletIcon /></span>
            <select value={currency} onChange={(e) => updateParam("currency", e.target.value)}>
              <option value="KZT">KZT</option>
              <option value="USD">USD</option>
            </select>
          </label>

          <label className="icon-select" aria-label={lang === "ru" ? "Язык" : "Language"}>
            <span className="icon-select-icon"><GlobeIcon /></span>
            <select value={lang} onChange={(e) => updateParam("lang", e.target.value)}>
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </label>
        </div>
      </div>
    </header>
  );
}
