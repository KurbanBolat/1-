"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function AppFooter() {
  const searchParams = useSearchParams();
  const lang = searchParams.get("lang") === "ru" ? "ru" : "en";
  const currency = searchParams.get("currency") === "KZT" ? "KZT" : "USD";

  const labels =
    lang === "ru"
      ? {
          search: "Поиск",
          catalog: "Каталог",
          concierge: "AI-консьерж",
          account: "Кабинет",
          partner: "Партнер",
        }
      : {
          search: "Search",
          catalog: "Catalog",
          concierge: "AI concierge",
          account: "Account",
          partner: "Partner",
        };

  return (
    <footer className="site-footer">
      <p>© {new Date().getFullYear()} StayPilot</p>
      <div className="site-footer-links">
        <Link href={`/?lang=${lang}&currency=${currency}#search`}>{labels.search}</Link>
        <Link href={`/?lang=${lang}&currency=${currency}#results`}>{labels.catalog}</Link>
        <Link href={`/?lang=${lang}&currency=${currency}#ai`}>{labels.concierge}</Link>
        <Link href={`/account?lang=${lang}&currency=${currency}`}>{labels.account}</Link>
        <Link href={`/login?lang=${lang}&currency=${currency}`}>{labels.partner}</Link>
      </div>
    </footer>
  );
}

