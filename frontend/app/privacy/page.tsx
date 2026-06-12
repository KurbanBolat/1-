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
  title: "Privacy Policy - StayPilot",
  description: "StayPilot privacy policy template for guests, hotels, and deployment owners.",
};

export default function PrivacyPage({ searchParams }: { searchParams: PageSearchParams }) {
  const lang = normalizeLegalLang(searchParams.lang);
  const currency = normalizeLegalCurrency(searchParams.currency);

  const sections: LegalSection[] =
    lang === "ru"
      ? [
          {
            title: "Какие данные обрабатываются",
            paragraphs: [
              "StayPilot обрабатывает данные, которые нужны для поиска, бронирования, оплаты и обслуживания гостя во время проживания.",
            ],
            bullets: [
              "Контактные данные гостя: имя, email, телефон и параметры бронирования.",
              "Данные брони: объект, тип номера, даты, количество гостей, тариф, статус и access token для гостевого кабинета.",
              "Платежные статусы: сумма, валюта, способ оплаты, статус попытки и идентификатор провайдера.",
              "Сообщения AI-консьержу, заказы в номер, брони столиков и статусы сервисных запросов.",
              "Технические данные: cookies, local storage, request id, логи ошибок и базовая аналитика работы сервиса.",
            ],
          },
          {
            title: "Зачем это используется",
            bullets: [
              "Чтобы показать доступные номера и создать бронь.",
              "Чтобы провести гостя через оплату и подтвердить статус платежа.",
              "Чтобы открыть гостевой кабинет, историю бронирований и сервисы во время проживания.",
              "Чтобы дать партнеру операционный экран для управления бронями, номерами, ресторанами и заказами.",
              "Чтобы защищать сервис от злоупотреблений, расследовать ошибки и улучшать качество продукта.",
            ],
          },
          {
            title: "Платежные данные",
            paragraphs: [
              "StayPilot хранит бизнес-статус платежа, сумму, валюту и технический идентификатор попытки. Данные банковских карт и платежные учетные данные должны обрабатываться платежным провайдером, подключенным владельцем развертывания.",
            ],
          },
          {
            title: "AI-консьерж",
            paragraphs: [
              "В текущей поставке live GPT отключен по умолчанию, а консьерж работает в deterministic stub mode. Если владелец развертывания включает live-режим, сообщения пользователя могут передаваться AI-провайдеру для генерации ответа.",
              "Не отправляйте в чат паспортные данные, платежные реквизиты, медицинскую информацию и другие чувствительные данные, если оператор сервиса отдельно не подтвердил такую обработку.",
            ],
          },
          {
            title: "Хранение и безопасность",
            paragraphs: [
              "Сроки хранения определяются владельцем развертывания, требованиями закона, бухгалтерскими правилами и операционной необходимостью. Для production-запуска должны использоваться защищенные cookies, CSRF-защита, ограниченный CORS, надежный SECRET_KEY и доступ к базе только по роли.",
            ],
          },
          {
            title: "Права пользователя",
            bullets: [
              "Запросить доступ к своим данным.",
              "Попросить исправить неточные данные.",
              "Запросить удаление или ограничение обработки, если это не конфликтует с обязательным хранением.",
              "Получить объяснение по платежу, отмене или сервисному запросу.",
              "Связаться с оператором развертывания через страницу контактов.",
            ],
          },
        ]
      : [
          {
            title: "Data We Process",
            paragraphs: ["StayPilot processes data required for hotel search, booking, payment, and in-stay service workflows."],
            bullets: [
              "Guest contact details: name, email, phone, and booking parameters.",
              "Reservation data: property, room type, dates, guest count, tariff, status, and guest account access token.",
              "Payment status data: amount, currency, payment method, attempt status, and provider reference.",
              "AI concierge messages, room-service orders, table bookings, and service request statuses.",
              "Technical data: cookies, local storage, request id, error logs, and basic service analytics.",
            ],
          },
          {
            title: "How We Use It",
            bullets: [
              "To show available rooms and create reservations.",
              "To guide guests through payment and confirm payment status.",
              "To power the guest account, booking history, and in-stay services.",
              "To provide partner managers with reservation, room, restaurant, and order operations.",
              "To protect the service, investigate errors, and improve product quality.",
            ],
          },
          {
            title: "Payment Data",
            paragraphs: [
              "StayPilot stores payment business status, amount, currency, and technical attempt identifiers. Card details and payment credentials should be handled by the payment provider configured by the deployment owner.",
            ],
          },
          {
            title: "AI Concierge",
            paragraphs: [
              "Live GPT is disabled by default in this package, and the concierge runs in deterministic stub mode. If the deployment owner enables live mode, user messages may be sent to the AI provider to generate a response.",
              "Do not send passport data, payment credentials, medical information, or other sensitive data into chat unless the service operator explicitly confirms that processing.",
            ],
          },
          {
            title: "Retention and Security",
            paragraphs: [
              "Retention periods are controlled by the deployment owner, legal requirements, accounting rules, and operational needs. Production deployments should use secure cookies, CSRF protection, restricted CORS, a strong SECRET_KEY, and role-based database access.",
            ],
          },
          {
            title: "User Rights",
            bullets: [
              "Request access to your data.",
              "Ask to correct inaccurate data.",
              "Request deletion or restricted processing where mandatory retention does not apply.",
              "Request clarification on payment, cancellation, or service requests.",
              "Contact the deployment operator through the contacts page.",
            ],
          },
        ];

  return (
    <LegalPage
      lang={lang}
      currency={currency}
      title={lang === "ru" ? "Политика конфиденциальности" : "Privacy Policy"}
      subtitle={
        lang === "ru"
          ? "Шаблонная политика для production-развертывания StayPilot. Перед публичным запуском оператор должен добавить свои реквизиты и проверить текст с юристом."
          : "A production deployment template for StayPilot. Before public launch, the operator should add legal entity details and review the text with counsel."
      }
      updated={lang === "ru" ? "12 июня 2026" : "June 12, 2026"}
      sections={sections}
      asideTitle={lang === "ru" ? "Важно перед запуском" : "Before Launch"}
      asideItems={
        lang === "ru"
          ? ["Заменить контакты и реквизиты оператора.", "Проверить локальные privacy и hotel regulations.", "Подключить реального платежного провайдера только после compliance-review."]
          : ["Replace operator contact and legal details.", "Review local privacy and hotel regulations.", "Enable a real payment provider only after compliance review."]
      }
      actions={[
        { href: withLegalLocale("/contacts", lang, currency), label: lang === "ru" ? "Контакты" : "Contacts", primary: true },
        { href: withLegalLocale("/terms", lang, currency), label: lang === "ru" ? "Условия" : "Terms" },
      ]}
    />
  );
}
