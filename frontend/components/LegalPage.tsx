import Link from "next/link";

export type LegalLang = "ru" | "en";
export type LegalCurrency = "KZT" | "USD";

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalAction = {
  href: string;
  label: string;
  primary?: boolean;
};

type LegalPageProps = {
  lang: LegalLang;
  currency: LegalCurrency;
  title: string;
  subtitle: string;
  updated: string;
  sections: LegalSection[];
  asideTitle: string;
  asideItems: string[];
  actions?: LegalAction[];
};

export function normalizeLegalLang(value?: string): LegalLang {
  return value === "en" ? "en" : "ru";
}

export function normalizeLegalCurrency(value?: string): LegalCurrency {
  return value === "USD" ? "USD" : "KZT";
}

export function withLegalLocale(path: string, lang: LegalLang, currency: LegalCurrency): string {
  return `${path}?lang=${lang}&currency=${currency}`;
}

export default function LegalPage({
  lang,
  currency,
  title,
  subtitle,
  updated,
  sections,
  asideTitle,
  asideItems,
  actions = [],
}: LegalPageProps) {
  const homeLabel = lang === "ru" ? "Вернуться в StayPilot" : "Back to StayPilot";
  const updatedLabel = lang === "ru" ? "Обновлено" : "Updated";

  return (
    <section className="legal-page">
      <header className="legal-hero">
        <Link className="legal-home-link" href={withLegalLocale("/", lang, currency)}>
          {homeLabel}
        </Link>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <span className="legal-updated">
          {updatedLabel}: {updated}
        </span>
      </header>

      <div className="legal-layout">
        <div className="legal-main">
          {sections.map((section) => (
            <article className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets ? (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>

        <aside className="legal-aside">
          <h2>{asideTitle}</h2>
          <ul>
            {asideItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {actions.length ? (
            <div className="legal-actions">
              {actions.map((action) => (
                <Link className={action.primary ? "legal-action legal-action-primary" : "legal-action"} href={action.href} key={action.href}>
                  {action.label}
                </Link>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
