import Link from "next/link";
import type { ReactNode } from "react";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";
type ShellLayout = "default" | "workspace";
type ActiveKey =
  | "home"
  | "search"
  | "hotels"
  | "apartments"
  | "villas"
  | "offers"
  | "restaurants"
  | "transfer"
  | "support"
  | "checkout";
type IconName =
  | "spark"
  | "home"
  | "search"
  | "hotel"
  | "apartment"
  | "villa"
  | "tag"
  | "restaurant"
  | "car"
  | "headphones"
  | "globe"
  | "heart"
  | "calendar"
  | "chevron"
  | "card"
  | "shield"
  | "message";

function ShellIcon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };
  const paths: Record<IconName, ReactNode> = {
    spark: (
      <>
        <path {...common} d="M12 2.8l1.8 5.2 5.4 1.9-5.4 1.8L12 17l-1.8-5.3-5.4-1.8 5.4-1.9L12 2.8z" />
        <path {...common} d="M5.2 15.4l.8 2.3 2.4.8-2.4.8-.8 2.3-.8-2.3-2.4-.8 2.4-.8.8-2.3z" />
      </>
    ),
    home: (
      <>
        <path {...common} d="M3.5 10.5 12 3.7l8.5 6.8" />
        <path {...common} d="M5.5 9.7V20h13V9.7" />
        <path {...common} d="M10 20v-6h4v6" />
      </>
    ),
    search: (
      <>
        <circle {...common} cx="11" cy="11" r="6.5" />
        <path {...common} d="m16 16 4 4" />
      </>
    ),
    hotel: (
      <>
        <path {...common} d="M5 20V5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5V20" />
        <path {...common} d="M3.5 20h17" />
        <path {...common} d="M8.5 8h.01M12 8h.01M15.5 8h.01M8.5 12h.01M12 12h.01M15.5 12h.01" />
      </>
    ),
    apartment: (
      <>
        <path {...common} d="M4.5 20V8l7.5-4 7.5 4v12" />
        <path {...common} d="M8 20v-8h8v8M8 12h8M12 12v8" />
      </>
    ),
    villa: (
      <>
        <path {...common} d="M4 13.5 12 5l8 8.5" />
        <path {...common} d="M6 11.5V20h12v-8.5" />
        <path {...common} d="M9.2 20v-5h5.6v5" />
        <path {...common} d="M16.5 6.8V4h2v5" />
      </>
    ),
    tag: (
      <>
        <path {...common} d="M4 12.5V5h7.5L20 13.5 13.5 20 4 10.5" />
        <circle {...common} cx="8" cy="8" r="1" />
      </>
    ),
    restaurant: (
      <>
        <path {...common} d="M7 4v16M4.5 4v5.5a2.5 2.5 0 0 0 5 0V4M16 4v16M16 4c2 1.4 3.2 3.8 3.2 6.3 0 1.9-1 3.2-3.2 3.2" />
      </>
    ),
    car: (
      <>
        <path {...common} d="M4.5 13.5 6 8h12l1.5 5.5" />
        <path {...common} d="M5 13h14v5H5z" />
        <path {...common} d="M7 18v2M17 18v2M7.5 15.5h.01M16.5 15.5h.01" />
      </>
    ),
    headphones: (
      <>
        <path {...common} d="M4 13a8 8 0 0 1 16 0" />
        <path {...common} d="M5 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2ZM19 13h-3v6h3a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z" />
      </>
    ),
    globe: (
      <>
        <circle {...common} cx="12" cy="12" r="8" />
        <path {...common} d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16" />
      </>
    ),
    heart: <path {...common} d="M20.2 8.7c0 5.1-8.2 9.8-8.2 9.8S3.8 13.8 3.8 8.7A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 8.2 1.4Z" />,
    calendar: (
      <>
        <rect {...common} x="4" y="5" width="16" height="15" rx="2.5" />
        <path {...common} d="M8 3.5V7M16 3.5V7M4 10h16" />
      </>
    ),
    chevron: <path {...common} d="m8.5 10 3.5 3.5 3.5-3.5" />,
    card: (
      <>
        <rect {...common} x="3.8" y="5.8" width="16.4" height="12.4" rx="3" />
        <path {...common} d="M4 10h16M8 14h4" />
      </>
    ),
    shield: (
      <>
        <path {...common} d="M12 3.5 19 6v5.5c0 4.3-2.7 7.1-7 9-4.3-1.9-7-4.7-7-9V6l7-2.5Z" />
        <path {...common} d="m9.4 12 1.8 1.8 3.8-4" />
      </>
    ),
    message: (
      <>
        <path {...common} d="M5 5h14v10H9l-4 4V5Z" />
        <path {...common} d="M8.5 9h7M8.5 12h4.5" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function StayPilotShell({
  children,
  lang,
  currency,
  active = "checkout",
  layout = "default",
  accountHref,
}: {
  children: ReactNode;
  lang: Lang;
  currency: Currency;
  active?: ActiveKey;
  layout?: ShellLayout;
  accountHref?: string;
}) {
  const isRu = lang === "ru";
  const shellClassName = `sp-shell sp-shell-transaction${layout === "workspace" ? " sp-shell-workspace" : ""}`;
  const resolvedAccountHref = accountHref || `/account?lang=${lang}&currency=${currency}`;
  const navItems: Array<{ key: ActiveKey; icon: IconName; label: string; href: string }> = [
    { key: "home", icon: "home", label: isRu ? "Главная" : "Home", href: `/?lang=${lang}&currency=${currency}` },
    { key: "search", icon: "search", label: isRu ? "Поиск" : "Search", href: `/?lang=${lang}&currency=${currency}` },
    { key: "hotels", icon: "hotel", label: isRu ? "Отели" : "Hotels", href: `/?lang=${lang}&currency=${currency}&property_type=hotel` },
    {
      key: "apartments",
      icon: "apartment",
      label: isRu ? "Апартаменты" : "Apartments",
      href: `/?lang=${lang}&currency=${currency}&property_type=apartment`,
    },
    { key: "villas", icon: "villa", label: isRu ? "Виллы" : "Villas", href: `/?lang=${lang}&currency=${currency}&property_type=villa` },
    {
      key: "offers",
      icon: "tag",
      label: isRu ? "Спецпредложения" : "Special offers",
      href: `/?lang=${lang}&currency=${currency}&sort_by=price&sort_order=asc`,
    },
    { key: "restaurants", icon: "restaurant", label: isRu ? "Рестораны" : "Restaurants", href: `/?lang=${lang}&currency=${currency}#ai` },
    { key: "transfer", icon: "car", label: isRu ? "Трансфер" : "Transfer", href: `/?lang=${lang}&currency=${currency}#ai` },
    { key: "support", icon: "headphones", label: isRu ? "Поддержка 24/7" : "24/7 support", href: `/?lang=${lang}&currency=${currency}#ai` },
  ];

  return (
    <div className={shellClassName}>
      <aside className="sp-left-rail">
        <Link href={`/?lang=${lang}&currency=${currency}`} className="sp-brand-card">
          <span className="sp-brand-mark">
            <ShellIcon name="spark" />
          </span>
          <span>
            <strong>StayPilot</strong>
            <small>AI Concierge for Hotels</small>
          </span>
        </Link>
        <nav className="sp-side-nav" aria-label={isRu ? "Навигация" : "Navigation"}>
          {navItems.map((item) => (
            <Link key={item.key} href={item.href} className={active === item.key ? "active" : ""}>
              <ShellIcon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <section className="sp-left-promo">
          <span className="sp-left-promo-mark">
            <ShellIcon name="spark" />
          </span>
          <h4>AI-консьерж</h4>
          <p>{isRu ? "Помогу завершить бронирование и подготовить сервисы к заезду." : "I can help complete booking and prepare stay services."}</p>
          <Link href={`/?lang=${lang}&currency=${currency}#ai`}>{isRu ? "Начать чат" : "Start chat"}</Link>
        </section>
      </aside>

      <div className="sp-main-col sp-transaction-main">
        <header className="sp-topbar">
          <div className="sp-topbar-actions">
            <span>
              <ShellIcon name="globe" />
              {isRu ? "Русский" : "English"}
              <ShellIcon name="chevron" />
            </span>
            <span>
              {currency}
              <ShellIcon name="chevron" />
            </span>
            <Link href={`/?lang=${lang}&currency=${currency}#favorites`}>
              <ShellIcon name="heart" />
              {isRu ? "Избранное" : "Favorites"}
            </Link>
            <Link href={resolvedAccountHref}>
              <ShellIcon name="calendar" />
              {isRu ? "Мои бронирования" : "My bookings"}
            </Link>
          </div>
          <Link href="/login" className="sp-topbar-user" aria-label={isRu ? "Профиль" : "Profile"}>
            <span className="sp-user-avatar" />
            <ShellIcon name="chevron" />
          </Link>
        </header>
        {children}
      </div>

      {layout === "workspace" ? null : (
      <aside className="sp-right-rail sp-transaction-rail">
        <div className="sp-chat-head">
          <div className="sp-chat-avatar">
            <ShellIcon name="spark" />
          </div>
          <div>
            <h3>{isRu ? "AI-консьерж" : "AI concierge"}</h3>
            <span>{isRu ? "Онлайн" : "Online"}</span>
          </div>
          <button type="button" aria-label={isRu ? "Меню" : "Menu"}>
            ...
          </button>
        </div>
        <article className="sp-transaction-assistant">
          <span>
            <ShellIcon name="message" />
          </span>
          <p>
            {isRu
              ? "Проверяю детали брони, оплату и сервисы отеля. После подтверждения сразу покажу рестораны и in-stay опции."
              : "I keep booking, payment and hotel services connected. After confirmation I can show restaurants and in-stay options."}
          </p>
        </article>
        <div className="sp-transaction-rail-list">
          <article>
            <ShellIcon name="card" />
            <strong>{isRu ? "Без скрытых платежей" : "No hidden fees"}</strong>
            <small>{isRu ? "Итог виден до оплаты" : "Total shown before payment"}</small>
          </article>
          <article>
            <ShellIcon name="shield" />
            <strong>{isRu ? "Безопасная оплата" : "Secure payment"}</strong>
            <small>{isRu ? "Токен доступа сохраняется" : "Access token is preserved"}</small>
          </article>
          <article>
            <ShellIcon name="restaurant" />
            <strong>{isRu ? "Сервисы после оплаты" : "Post-payment services"}</strong>
            <small>{isRu ? "Рестораны и room service" : "Restaurants and room service"}</small>
          </article>
        </div>
        <div className="sp-transaction-chat-input">
          <span>{isRu ? "Напишите сообщение..." : "Write a message..."}</span>
          <button type="button" aria-label={isRu ? "Отправить" : "Send"} />
        </div>
        <p className="sp-transaction-disclaimer">
          {isRu ? "AI может допускать ошибки. Проверяйте важную информацию." : "AI can make mistakes. Verify important information."}
        </p>
      </aside>
      )}
    </div>
  );
}
