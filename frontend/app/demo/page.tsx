import Link from "next/link";
import type { Metadata } from "next";
import { normalizeLegalCurrency, normalizeLegalLang } from "../../components/LegalPage";

type PageSearchParams = {
  lang?: string;
  currency?: string;
};

type DemoIconName = "sparkle" | "search" | "bed" | "card" | "account" | "manager" | "shield" | "check";

export const metadata: Metadata = {
  title: "Demo Guide - StayPilot",
  description: "Guided StayPilot demo scenarios for buyers, hotel partners, and technical reviewers.",
};

function DemoIcon({ name }: { name: DemoIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6" />
        <path d="M16 16l4 4" />
      </svg>
    );
  }
  if (name === "bed") {
    return (
      <svg {...common}>
        <path d="M4 11V6" />
        <path d="M20 18v-6a3 3 0 0 0-3-3H8a4 4 0 0 0-4 4v5" />
        <path d="M4 14h16" />
        <path d="M7 9h3" />
      </svg>
    );
  }
  if (name === "card") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="3" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
      </svg>
    );
  }
  if (name === "account") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
  }
  if (name === "manager") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M7 8h10" />
        <path d="M7 12h4" />
        <path d="M14 12h3" />
        <path d="M7 16h6" />
      </svg>
    );
  }
  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-5" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common}>
        <path d="M5 12l4 4L19 6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </svg>
  );
}

export default function DemoPage({ searchParams }: { searchParams: PageSearchParams }) {
  const lang = normalizeLegalLang(searchParams.lang);
  const currency = normalizeLegalCurrency(searchParams.currency);

  const query = `lang=${lang}&currency=${currency}`;
  const guestHref = `/?${query}&city=Dubai&guests=2`;
  const aiHref = `${guestHref}#ai`;
  const catalogHref = `${guestHref}#results`;
  const accountHref = `/account?${query}`;
  const loginHref = `/login?${query}`;
  const hotelHref = `/for-hotels?${query}`;
  const refundHref = `/refund-policy?${query}`;

  const copy = {
    ru: {
      back: "Вернуться в StayPilot",
      title: "Демо-сценарии StayPilot",
      subtitle:
        "Готовый маршрут для показа покупателю, отелю или техническому ревьюеру: от первого запроса гостя до оплаты, кабинета, сервисов проживания и менеджерской панели.",
      primary: "Открыть гостевое демо",
      secondary: "Войти партнеру",
      proofTitle: "Что демонстрировать",
      scriptTitle: "10-минутный сценарий показа",
      opsTitle: "Операционные заметки",
      proofItems: ["Backend-тесты", "E2E smoke-тесты", "CI при отправке в репозиторий", "Live-режим OpenAI безопасно отключен", "Демо-оплата без реальных списаний"],
      opsItems: [
        "Для продакшена подключите рабочие контакты, платежного провайдера и юридические реквизиты оператора.",
        "Партнерский доступ выдаёт владелец развертывания; публичная страница не показывает пароли.",
        "Live-режим GPT включать только после настройки `AI_CONCIERGE_MODE=live`, ключа и проверки приватности.",
      ],
      scenarios: [
        {
          icon: "search" as const,
          title: "AI-подбор и поиск",
          text: "Покажите стартовый запрос гостя, фильтр города Dubai, карточки объектов и AI-консьержа с контекстом поиска.",
          link: aiHref,
          cta: "Открыть AI",
        },
        {
          icon: "bed" as const,
          title: "Свободные номера вместо календаря",
          text: "Откройте каталог, выберите объект и покажите доступность по категориям: свободные номера, окна дат, цену и кнопку оформления.",
          link: catalogHref,
          cta: "Открыть каталог",
        },
        {
          icon: "card" as const,
          title: "Бронирование и демо-оплата",
          text: "Проведите гостя от выбора номера до оформления брони. Платежный экран показывает безопасный демо-режим и не выполняет реальные списания.",
          link: catalogHref,
          cta: "Начать бронь",
        },
        {
          icon: "account" as const,
          title: "Гостевой кабинет",
          text: "После успешной брони покажите аккаунт гостя: статус, платеж, доступ к бронированию и сервисам проживания.",
          link: accountHref,
          cta: "Открыть кабинет",
        },
        {
          icon: "manager" as const,
          title: "Панель менеджера",
          text: "Покажите партнерский кабинет: объекты, номера, доступность, брони, рестораны, заказы в номер и операционные статусы.",
          link: loginHref,
          cta: "Партнерский вход",
        },
        {
          icon: "shield" as const,
          title: "Коммерческий и юридический слой",
          text: "Покажите страницу для отелей, политику приватности, условия, правила возврата и контакты. Это закрывает базовую проверку перед продажей.",
          link: hotelHref,
          cta: "Для отелей",
        },
      ],
      script: [
        ["0-2 мин", "Откройте страницу для отелей и объясните ценность: прямые бронирования, AI-консьерж, панель менеджера."],
        ["2-4 мин", "Откройте гостевое демо: поиск Dubai, карточки объектов, AI-консьерж и быстрые фильтры."],
        ["4-6 мин", "Выберите объект, покажите свободные номера, тарифы, условия отмены и переход к оформлению."],
        ["6-8 мин", "Проведите демо-оплату, откройте кабинет гостя и покажите сервисы проживания."],
        ["8-10 мин", "Откройте партнерский вход и панель менеджера, затем покажите операционный контроль для отеля."],
      ],
      linksTitle: "Быстрые ссылки",
      links: [
        { label: "Гостевой демо", href: guestHref },
        { label: "AI-консьерж", href: aiHref },
        { label: "Партнерский вход", href: loginHref },
        { label: "Для отелей", href: hotelHref },
        { label: "Возвраты", href: refundHref },
      ],
    },
    en: {
      back: "Back to StayPilot",
      title: "StayPilot Demo Scenarios",
      subtitle:
        "A guided buyer, hotel partner, or technical reviewer path: from the first guest request to payment, account, in-stay services, and manager operations.",
      primary: "Open guest demo",
      secondary: "Partner login",
      proofTitle: "What to Show",
      scriptTitle: "10-Minute Demo Script",
      opsTitle: "Operational Notes",
      proofItems: ["Backend test suite", "E2E smoke suite", "CI on push", "OpenAI live safely disabled", "Safe demo payment flow"],
      opsItems: [
        "For production, connect real support contacts, payment provider, and operator legal details.",
        "Partner access is issued by the deployment owner; this public page does not expose passwords.",
        "Enable live GPT only after `AI_CONCIERGE_MODE=live`, API key setup, and privacy review.",
      ],
      scenarios: [
        {
          icon: "search" as const,
          title: "AI Search and Matching",
          text: "Show the guest prompt, Dubai filter, property cards, and AI concierge with search context.",
          link: aiHref,
          cta: "Open AI",
        },
        {
          icon: "bed" as const,
          title: "Available Rooms, Not Calendar Blocks",
          text: "Open the catalog, choose a property, and show room-type availability: free rooms, date windows, price, and checkout CTA.",
          link: catalogHref,
          cta: "Open catalog",
        },
        {
          icon: "card" as const,
          title: "Booking and Demo Payment",
          text: "Move the guest from room choice to checkout. The payment screen shows safe demo mode and does not make a real charge.",
          link: catalogHref,
          cta: "Start booking",
        },
        {
          icon: "account" as const,
          title: "Guest Account",
          text: "After a successful booking, show guest account status, payment, reservation access, and in-stay services.",
          link: accountHref,
          cta: "Open account",
        },
        {
          icon: "manager" as const,
          title: "Manager Workspace",
          text: "Show the partner workspace: properties, rooms, availability, reservations, restaurants, room service, and operations statuses.",
          link: loginHref,
          cta: "Partner login",
        },
        {
          icon: "shield" as const,
          title: "Commercial and Legal Layer",
          text: "Show the hotel page, privacy, terms, refund policy, and contacts. This covers baseline buyer due diligence.",
          link: hotelHref,
          cta: "For hotels",
        },
      ],
      script: [
        ["0-2 min", "Open the hotel page and explain the value: direct booking, AI concierge, manager workspace."],
        ["2-4 min", "Open guest demo: Dubai search, property cards, AI concierge, and quick filters."],
        ["4-6 min", "Choose a property, show available rooms, tariffs, cancellation logic, and checkout handoff."],
        ["6-8 min", "Run demo payment, open guest account, and show in-stay services."],
        ["8-10 min", "Open partner login/manager workspace and show hotel operations control."],
      ],
      linksTitle: "Quick Links",
      links: [
        { label: "Guest demo", href: guestHref },
        { label: "AI concierge", href: aiHref },
        { label: "Partner login", href: loginHref },
        { label: "For hotels", href: hotelHref },
        { label: "Refunds", href: refundHref },
      ],
    },
  }[lang];

  return (
    <section className="demo-guide-page">
      <header className="demo-guide-hero">
        <div>
          <Link className="demo-guide-back" href={`/?${query}`}>
            {copy.back}
          </Link>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
          <div className="demo-guide-actions">
            <Link className="demo-guide-primary" href={guestHref}>
              {copy.primary}
            </Link>
            <Link className="demo-guide-secondary" href={loginHref}>
              {copy.secondary}
            </Link>
          </div>
        </div>
        <aside className="demo-guide-proof">
          <span>
            <DemoIcon name="sparkle" />
          </span>
          <h2>{copy.proofTitle}</h2>
          <ul>
            {copy.proofItems.map((item) => (
              <li key={item}>
                <DemoIcon name="check" />
                {item}
              </li>
            ))}
          </ul>
        </aside>
      </header>

      <section className="demo-guide-grid" aria-label={copy.proofTitle}>
        {copy.scenarios.map((scenario) => (
          <article className="demo-guide-card" key={scenario.title}>
            <span className="demo-guide-card-icon">
              <DemoIcon name={scenario.icon} />
            </span>
            <h2>{scenario.title}</h2>
            <p>{scenario.text}</p>
            <Link href={scenario.link}>{scenario.cta}</Link>
          </article>
        ))}
      </section>

      <section className="demo-guide-bottom">
        <article className="demo-guide-script">
          <h2>{copy.scriptTitle}</h2>
          <ol>
            {copy.script.map(([time, text]) => (
              <li key={time}>
                <span>{time}</span>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </article>

        <aside className="demo-guide-side">
          <div>
            <h2>{copy.linksTitle}</h2>
            <nav aria-label={copy.linksTitle}>
              {copy.links.map((item) => (
                <Link href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div>
            <h2>{copy.opsTitle}</h2>
            <ul>
              {copy.opsItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </section>
  );
}
