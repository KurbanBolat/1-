import Link from "next/link";
import type { Metadata } from "next";

type Lang = "ru" | "en";
type Currency = "KZT" | "USD";

type PageSearchParams = {
  lang?: string;
  currency?: string;
};

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1600&q=86";
const HOTEL_IMAGES = [
  "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=720&q=82",
  "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=720&q=82",
];

export const metadata: Metadata = {
  title: "StayPilot для отелей - AI-консьерж и прямые бронирования",
  description:
    "B2B-презентация StayPilot: AI-консьерж для отелей, прямые бронирования, in-stay сервисы и готовая продуктовая база для запуска.",
};

function normalizeLang(value?: string): Lang {
  return value === "en" ? "en" : "ru";
}

function normalizeCurrency(value?: string): Currency {
  return value === "USD" ? "USD" : "KZT";
}

function Icon({ name }: { name: "sparkle" | "chart" | "clock" | "shield" | "plug" | "check" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "chart") {
    return (
      <svg {...common}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M8 15v-4" />
        <path d="M12 15V8" />
        <path d="M16 15v-6" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
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
  if (name === "plug") {
    return (
      <svg {...common}>
        <path d="M7 7v4" />
        <path d="M17 7v4" />
        <path d="M9 11h6v2a3 3 0 0 1-6 0v-2z" />
        <path d="M12 16v5" />
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

export default function ForHotelsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const lang = normalizeLang(searchParams.lang);
  const currency = normalizeCurrency(searchParams.currency);
  const demoHref = `/?lang=${lang}&currency=${currency}&city=Dubai&guests=2`;
  const demoGuideHref = `/demo?lang=${lang}&currency=${currency}`;
  const loginHref = `/login?lang=${lang}&currency=${currency}`;

  const copy = {
    ru: {
      navProduct: "Продукт",
      navHotel: "Для отелей",
      navFlow: "Как работает",
      navPackage: "Что получает покупатель",
      navDemo: "Демо",
      demo: "Открыть демо",
      demoGuide: "Демо-сценарии",
      partner: "Войти партнеру",
      eyebrow: "AI-консьерж нового поколения",
      title: "AI-консьерж для отелей, который доводит гостя до брони",
      subtitle:
        "StayPilot объединяет витрину отеля, умный подбор, бронирование, оплату и сервисы во время проживания в одном понятном интерфейсе.",
      secondary: "Посмотреть для отеля",
      proofTitle: "Готовая база для запуска, пилота или продажи",
      proofSubtitle: "Проект уже покрывает ключевой путь гостя: поиск, выбор номера, бронь, оплата, аккаунт и in-stay сервисы.",
      sectionValue: "Что получает отель",
      sectionValueSub: "Меньше ручной нагрузки на команду и больше контроля над гостевым опытом.",
      sectionFlow: "Как это работает",
      sectionFlowSub: "Один непрерывный сценарий от первого вопроса до услуг во время проживания.",
      sectionBuyer: "Что получает покупатель проекта",
      sectionBuyerSub: "Не просто макет, а продуктовая основа с рабочими сценариями, тестами и архитектурой.",
      finalTitle: "Готовы увидеть StayPilot в деле?",
      finalText: "Откройте демо и проверьте AI-консьержа, каталог, бронь и личный кабинет на реальных сценариях.",
      guestQuestion: "Нужен отель в Дубае на 3 ночи, 2 взрослых",
      conciergeAnswer: "Нашел несколько вариантов с доступными номерами. Могу оформить бронь и подготовить оплату.",
      hotelCta: "Показать свободные номера",
      room: "Deluxe King Room",
      available: "Свободно: 4 номера",
      book: "Забронировать",
      footerNote: "Шаблон продукта для демо, пилота и дальнейшей production-настройки.",
      privacy: "Конфиденциальность",
      terms: "Условия",
      refunds: "Возвраты",
      contacts: "Контакты",
    },
    en: {
      navProduct: "Product",
      navHotel: "For hotels",
      navFlow: "How it works",
      navPackage: "Buyer package",
      navDemo: "Demo",
      demo: "Open demo",
      demoGuide: "Demo guide",
      partner: "Partner login",
      eyebrow: "Next-generation AI concierge",
      title: "AI concierge for hotels that moves guests from intent to booking",
      subtitle:
        "StayPilot brings the hotel storefront, smart matching, booking, payment, and in-stay services into one clear guest interface.",
      secondary: "View hotel value",
      proofTitle: "Launch-ready base for a pilot or acquisition",
      proofSubtitle: "The project covers the guest path: search, room choice, booking, payment, account, and in-stay services.",
      sectionValue: "What hotels get",
      sectionValueSub: "Less manual work for the team and more control over the guest experience.",
      sectionFlow: "How it works",
      sectionFlowSub: "One continuous flow from the first question to in-stay services.",
      sectionBuyer: "What a project buyer gets",
      sectionBuyerSub: "Not a static mockup, but a product base with working flows, tests, and architecture.",
      finalTitle: "Ready to see StayPilot live?",
      finalText: "Open the demo and test the AI concierge, catalog, booking, and guest account on realistic flows.",
      guestQuestion: "Need a hotel in Dubai for 3 nights, 2 adults",
      conciergeAnswer: "I found options with available rooms. I can complete the booking and prepare payment.",
      hotelCta: "Show available rooms",
      room: "Deluxe King Room",
      available: "Available: 4 rooms",
      book: "Book now",
      footerNote: "Product template for demos, pilots, and production setup.",
      privacy: "Privacy",
      terms: "Terms",
      refunds: "Refunds",
      contacts: "Contacts",
    },
  }[lang];

  const legalLinks = [
    { href: demoGuideHref, label: copy.demoGuide },
    { href: `/privacy?lang=${lang}&currency=${currency}`, label: copy.privacy },
    { href: `/terms?lang=${lang}&currency=${currency}`, label: copy.terms },
    { href: `/refund-policy?lang=${lang}&currency=${currency}`, label: copy.refunds },
    { href: `/contacts?lang=${lang}&currency=${currency}`, label: copy.contacts },
  ];

  const valueCards = [
    {
      icon: "chart" as const,
      title: lang === "ru" ? "Больше прямых бронирований" : "More direct bookings",
      text:
        lang === "ru"
          ? "Гость получает подбор, свободные номера и понятный следующий шаг без ухода на внешние сайты."
          : "Guests get recommendations, available rooms, and a clear next step without leaving the hotel flow.",
    },
    {
      icon: "clock" as const,
      title: lang === "ru" ? "Меньше нагрузки на персонал" : "Less staff load",
      text:
        lang === "ru"
          ? "Консьерж отвечает на типовые вопросы, помогает с бронью и принимает сервисные запросы 24/7."
          : "The concierge handles common questions, booking support, and service requests around the clock.",
    },
    {
      icon: "plug" as const,
      title: lang === "ru" ? "Сервисы после брони" : "Services after booking",
      text:
        lang === "ru"
          ? "Room service, рестораны, трансфер и события связаны с аккаунтом гостя и менеджерской панелью."
          : "Room service, restaurants, transfers, and events connect to the guest account and manager workspace.",
    },
    {
      icon: "shield" as const,
      title: lang === "ru" ? "Контроль и прозрачность" : "Control and transparency",
      text:
        lang === "ru"
          ? "Менеджер видит брони, отмены, доступность номеров, заказы и статусы в одном рабочем контуре."
          : "Managers see bookings, cancellations, room availability, orders, and statuses in one workspace.",
    },
  ];

  const flow = [
    {
      title: lang === "ru" ? "Поиск и подбор" : "Search and matching",
      text:
        lang === "ru"
          ? "Гость задает запрос естественным языком, а AI подбирает подходящие варианты."
          : "The guest asks naturally, and AI shortlists relevant options.",
    },
    {
      title: lang === "ru" ? "Свободные номера" : "Available rooms",
      text:
        lang === "ru"
          ? "Вместо абстрактного календаря интерфейс показывает номера, окна доступности и цену."
          : "Instead of an abstract calendar, the UI shows rooms, available windows, and price.",
    },
    {
      title: lang === "ru" ? "Бронь и оплата" : "Booking and payment",
      text:
        lang === "ru"
          ? "Консьерж собирает данные гостя, создает бронь и ведет к оплате."
          : "The concierge collects guest details, creates the reservation, and leads to payment.",
    },
    {
      title: lang === "ru" ? "Проживание" : "In-stay",
      text:
        lang === "ru"
          ? "После брони гость заказывает еду, бронирует столик и видит статусы в аккаунте."
          : "After booking, guests order food, reserve tables, and track statuses in their account.",
    },
  ];

  const buyerItems = [
    lang === "ru" ? "Рабочий guest app: каталог, поиск, AI-чат, бронь, checkout, аккаунт" : "Working guest app: catalog, search, AI chat, booking, checkout, account",
    lang === "ru" ? "Manager workspace: объекты, номера, доступность, заказы, рестораны" : "Manager workspace: properties, rooms, availability, orders, restaurants",
    lang === "ru" ? "64 backend теста и 24 e2e сценария для критичных путей" : "64 backend tests and 24 e2e scenarios for critical flows",
    lang === "ru" ? "GitHub Actions, миграции, SQLite dev-режим и Postgres-ready архитектура" : "GitHub Actions, migrations, SQLite dev mode, and Postgres-ready architecture",
    lang === "ru" ? "OpenAI-ready консьерж с fallback-логикой и сохранением состояния" : "OpenAI-ready concierge with fallback logic and state persistence",
    lang === "ru" ? "Демо-данные, локальный запуск и понятная зона дальнейшей интеграции" : "Demo data, local run path, and clear integration surface",
  ];

  return (
    <main className="hotel-site">
      <header className="hotel-site-header">
        <Link href={demoHref} className="hotel-site-brand" aria-label="StayPilot">
          <span className="hotel-site-brand-mark">
            <Icon name="sparkle" />
          </span>
          <span>
            <b>StayPilot</b>
            <small>AI Concierge for Hotels</small>
          </span>
        </Link>

        <nav className="hotel-site-nav" aria-label="StayPilot hotel site">
          <a href="#product">{copy.navProduct}</a>
          <a href="#value">{copy.navHotel}</a>
          <a href="#flow">{copy.navFlow}</a>
          <a href="#buyer">{copy.navPackage}</a>
          <Link href={demoGuideHref}>{copy.navDemo}</Link>
        </nav>

        <div className="hotel-site-header-actions">
          <Link href={demoHref}>{copy.demo}</Link>
          <Link href={loginHref}>{copy.partner}</Link>
        </div>
      </header>

      <section className="hotel-site-hero" id="product">
        <div className="hotel-site-hero-copy">
          <span className="hotel-site-eyebrow">
            <Icon name="sparkle" />
            {copy.eyebrow}
          </span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
          <div className="hotel-site-actions">
            <Link href={demoHref} className="hotel-site-primary">
              {copy.demo}
              <span aria-hidden="true">→</span>
          </Link>
          <Link href={demoGuideHref} className="hotel-site-secondary">
            {copy.demoGuide}
          </Link>
          <a href="#value" className="hotel-site-secondary">
            {copy.secondary}
          </a>
          </div>
          <div className="hotel-site-mini-proof" aria-label={copy.proofTitle}>
            <span>64 backend tests</span>
            <span>24 e2e flows</span>
            <span>CI ready</span>
          </div>
        </div>

        <div className="hotel-site-product" aria-label="StayPilot product preview">
          <div className="hotel-site-product-main">
            <div className="hotel-site-product-hero" style={{ backgroundImage: `url(${HERO_IMAGE})` }}>
              <span>StayPilot</span>
              <b>{lang === "ru" ? "Подбор, бронь и сервисы в одном интерфейсе" : "Matching, booking, and services in one interface"}</b>
            </div>
            <div className="hotel-site-room-row">
              <div>
                <small>{copy.room}</small>
                <b>{copy.available}</b>
              </div>
              <Link href={demoHref}>{copy.book}</Link>
            </div>
            <div className="hotel-site-hotel-grid">
              {HOTEL_IMAGES.map((src, index) => (
                <article key={src}>
                  <img src={src} alt="" />
                  <b>{["Address Beach", "Jumeirah Al Naseem", "Taj Dubai"][index]}</b>
                  <small>{index === 0 ? "от 186 000 KZT" : index === 1 ? "от 245 000 KZT" : "от 132 000 KZT"}</small>
                </article>
              ))}
            </div>
          </div>

          <aside className="hotel-site-chat-preview">
            <div className="hotel-site-chat-head">
              <span>
                <Icon name="sparkle" />
              </span>
              <div>
                <b>AI-консьерж</b>
                <small>Online</small>
              </div>
            </div>
            <p className="hotel-site-chat-user">{copy.guestQuestion}</p>
            <p className="hotel-site-chat-ai">{copy.conciergeAnswer}</p>
            <Link href={demoHref}>{copy.hotelCta}</Link>
          </aside>
        </div>
      </section>

      <section className="hotel-site-proof">
        <div>
          <h2>{copy.proofTitle}</h2>
          <p>{copy.proofSubtitle}</p>
        </div>
        <div className="hotel-site-proof-grid">
          <span>
            <b>Guest app</b>
            <small>Search, booking, account</small>
          </span>
          <span>
            <b>Manager</b>
            <small>Inventory and operations</small>
          </span>
          <span>
            <b>AI-ready</b>
            <small>OpenAI integration surface</small>
          </span>
          <span>
            <b>QA</b>
            <small>Unit, API and e2e coverage</small>
          </span>
        </div>
      </section>

      <section className="hotel-site-section" id="value">
        <div className="hotel-site-section-head">
          <h2>{copy.sectionValue}</h2>
          <p>{copy.sectionValueSub}</p>
        </div>
        <div className="hotel-site-value-grid">
          {valueCards.map((card) => (
            <article key={card.title} className="hotel-site-value-card">
              <span>
                <Icon name={card.icon} />
              </span>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="hotel-site-section" id="flow">
        <div className="hotel-site-section-head">
          <h2>{copy.sectionFlow}</h2>
          <p>{copy.sectionFlowSub}</p>
        </div>
        <div className="hotel-site-flow-grid">
          {flow.map((step, index) => (
            <article key={step.title} className="hotel-site-flow-card">
              <span>{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="hotel-site-section hotel-site-buyer" id="buyer">
        <div className="hotel-site-section-head">
          <h2>{copy.sectionBuyer}</h2>
          <p>{copy.sectionBuyerSub}</p>
        </div>
        <div className="hotel-site-buyer-grid">
          {buyerItems.map((item) => (
            <div key={item} className="hotel-site-buyer-item">
              <span>
                <Icon name="check" />
              </span>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="hotel-site-final">
        <div>
          <span className="hotel-site-final-mark">
            <Icon name="sparkle" />
          </span>
          <h2>{copy.finalTitle}</h2>
          <p>{copy.finalText}</p>
        </div>
        <Link href={demoHref} className="hotel-site-primary">
          {copy.demo}
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <footer className="hotel-site-footer">
        <p>
          <b>StayPilot</b>
          <span>{copy.footerNote}</span>
        </p>
        <nav aria-label={lang === "ru" ? "Юридические страницы" : "Legal pages"}>
          {legalLinks.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </footer>
    </main>
  );
}
