import type { Metadata } from "next";
import LegalPage, {
  normalizeLegalCurrency,
  normalizeLegalLang,
  withLegalLocale,
  type LegalSection,
} from "../../components/LegalPage";

type PageSearchParams = {
  lang?: string;
  currency?: string;
};

export const metadata: Metadata = {
  title: "Contacts - StayPilot",
  description: "StayPilot contact handoff for guest support, hotel partners, and legal requests.",
};

export default function ContactsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const lang = normalizeLegalLang(searchParams.lang);
  const currency = normalizeLegalCurrency(searchParams.currency);

  const sections: LegalSection[] =
    lang === "ru"
      ? [
          {
            title: "Поддержка гостей",
            paragraphs: [
              "По вопросам бронирования, оплаты, отмены, гостевого кабинета и сервисов во время проживания используйте канал поддержки оператора развертывания.",
            ],
            bullets: [
              "Перед запуском подключите рабочий inbox поддержки владельца развертывания.",
              "Укажите номер брони, email гостя, объект и краткое описание вопроса.",
              "Для срочных вопросов во время проживания также свяжитесь напрямую с отелем.",
            ],
          },
          {
            title: "Партнеры и отели",
            paragraphs: [
              "Для подключения объекта, проверки manager workspace, настройки номеров, тарифов, ресторанов и сервисов используйте партнерский канал.",
            ],
            bullets: ["Перед запуском подключите рабочий партнерский inbox.", "Демо для отелей: /for-hotels", "Партнерский вход: /login"],
          },
          {
            title: "Юридические и privacy-запросы",
            bullets: [
              "Перед запуском подключите рабочий legal/privacy inbox.",
              "В запросе укажите страну, юридическое лицо оператора и тип запроса.",
              "Для production-запуска добавьте реальные контакты владельца развертывания.",
            ],
          },
          {
            title: "Оператор сервиса",
            paragraphs: [
              "Юридическое лицо, адрес, регистрационный номер, налоговые реквизиты и платежный провайдер должны быть добавлены владельцем production-развертывания перед публичным запуском.",
            ],
          },
        ]
      : [
          {
            title: "Guest Support",
            paragraphs: ["For booking, payment, cancellation, guest account, and in-stay service questions, use the deployment operator support channel."],
            bullets: [
              "Before launch, connect the deployment owner's real support inbox.",
              "Include reservation number, guest email, property, and a short issue description.",
              "For urgent in-stay questions, also contact the hotel directly.",
            ],
          },
          {
            title: "Partners and Hotels",
            paragraphs: [
              "For property onboarding, manager workspace review, rooms, tariffs, restaurants, and service setup, use the partner channel.",
            ],
            bullets: ["Before launch, connect the real partner inbox.", "Hotel demo: /for-hotels", "Partner login: /login"],
          },
          {
            title: "Legal and Privacy Requests",
            bullets: [
              "Before launch, connect the real legal/privacy inbox.",
              "Include country, service operator legal entity, and request type.",
              "Before production launch, add the deployment owner's real contact details.",
            ],
          },
          {
            title: "Service Operator",
            paragraphs: [
              "Legal entity, address, registration number, tax details, and payment provider should be added by the production deployment owner before public launch.",
            ],
          },
        ];

  return (
    <LegalPage
      lang={lang}
      currency={currency}
      title={lang === "ru" ? "Контакты StayPilot" : "StayPilot Contacts"}
      subtitle={
        lang === "ru"
          ? "Единая страница для поддержки гостей, партнерских вопросов и юридических запросов."
          : "A single page for guest support, partner questions, and legal requests."
      }
      updated={lang === "ru" ? "18 июня 2026" : "June 18, 2026"}
      sections={sections}
      asideTitle={lang === "ru" ? "Перед production" : "Before Production"}
      asideItems={
        lang === "ru"
          ? ["Подключить реальные inbox для поддержки, партнеров и legal.", "Добавить юридические реквизиты оператора.", "Согласовать SLA поддержки с отелями."]
          : ["Connect real inboxes for support, partners, and legal.", "Add operator legal details.", "Align support SLA with hotels."]
      }
      actions={[
        { href: withLegalLocale("/for-hotels", lang, currency), label: lang === "ru" ? "Для отелей" : "For hotels", primary: true },
        { href: withLegalLocale("/privacy", lang, currency), label: lang === "ru" ? "Конфиденциальность" : "Privacy" },
      ]}
    />
  );
}
