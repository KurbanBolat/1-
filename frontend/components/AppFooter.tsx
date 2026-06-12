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
          demo: "Демо",
          hotel: "Для отелей",
          account: "Кабинет",
          partner: "Партнер",
          privacy: "Конфиденциальность",
          terms: "Условия",
          refunds: "Возвраты",
          contacts: "Контакты",
        }
      : {
          search: "Search",
          catalog: "Catalog",
          concierge: "AI concierge",
          demo: "Demo",
          hotel: "For hotels",
          account: "Account",
          partner: "Partner",
          privacy: "Privacy",
          terms: "Terms",
          refunds: "Refunds",
          contacts: "Contacts",
        };

  return (
    <footer className="site-footer">
      <p>© {new Date().getFullYear()} StayPilot</p>
      <div className="site-footer-links">
        <Link href={`/?lang=${lang}&currency=${currency}#search`}>{labels.search}</Link>
        <Link href={`/?lang=${lang}&currency=${currency}#results`}>{labels.catalog}</Link>
        <Link href={`/?lang=${lang}&currency=${currency}#ai`}>{labels.concierge}</Link>
        <Link href={`/demo?lang=${lang}&currency=${currency}`}>{labels.demo}</Link>
        <Link href={`/for-hotels?lang=${lang}&currency=${currency}`}>{labels.hotel}</Link>
        <Link href={`/account?lang=${lang}&currency=${currency}`}>{labels.account}</Link>
        <Link href={`/login?lang=${lang}&currency=${currency}`}>{labels.partner}</Link>
        <Link href={`/privacy?lang=${lang}&currency=${currency}`}>{labels.privacy}</Link>
        <Link href={`/terms?lang=${lang}&currency=${currency}`}>{labels.terms}</Link>
        <Link href={`/refund-policy?lang=${lang}&currency=${currency}`}>{labels.refunds}</Link>
        <Link href={`/contacts?lang=${lang}&currency=${currency}`}>{labels.contacts}</Link>
      </div>
    </footer>
  );
}

