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
  title: "Terms of Use - StayPilot",
  description: "StayPilot terms for hotel booking, partner management, and in-stay services.",
};

export default function TermsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const lang = normalizeLegalLang(searchParams.lang);
  const currency = normalizeLegalCurrency(searchParams.currency);

  const sections: LegalSection[] =
    lang === "ru"
      ? [
          {
            title: "Назначение сервиса",
            paragraphs: [
              "StayPilot предоставляет интерфейс для поиска объектов размещения, просмотра свободных номеров, оформления брони, оплаты, гостевого кабинета и сервисов во время проживания.",
              "Фактическим оператором бронирования, платежей и размещения является владелец production-развертывания или подключенный отель.",
            ],
          },
          {
            title: "Бронирования и доступность",
            bullets: [
              "Наличие номеров, цены, тарифы и правила отмены показываются на основании данных, доступных сервису в момент запроса.",
              "Бронь считается созданной после успешного сохранения заявки и присвоения статуса системой.",
              "Подтверждение партнером, платежный статус и гостевой access token могут использоваться для доступа к кабинету и услугам проживания.",
              "Оператор должен исправлять ошибки в цене, доступности или описании, если они обнаружены до или после создания брони.",
            ],
          },
          {
            title: "Платежи",
            paragraphs: [
              "В demo-поставке платежи работают в безопасном тестовом режиме без реальных списаний. Реальные списания возможны только после подключения платежного провайдера владельцем развертывания.",
              "Провайдер платежей может применять свои комиссии, проверки, лимиты, правила возврата и сроки зачисления.",
            ],
          },
          {
            title: "Отмена и возвраты",
            paragraphs: [
              "Правила отмены зависят от выбранного тарифа и состояния бронирования. Подробная матрица находится в политике отмены и возвратов.",
            ],
          },
          {
            title: "AI-консьерж и сервисные запросы",
            bullets: [
              "AI-консьерж помогает с поиском, бронью, заказом еды, бронью столиков и статусами запросов.",
              "Ответы AI-консьержа не являются юридической, медицинской, финансовой или иной профессиональной консультацией.",
              "Сервисные запросы во время проживания зависят от фактической доступности отеля, ресторана, кухни, трансфера или другого исполнителя.",
              "Live GPT отключен по умолчанию. При включении live-режима оператор отвечает за настройки модели, промпты, логи и privacy review.",
            ],
          },
          {
            title: "Аккаунты и безопасность",
            paragraphs: [
              "Пользователь отвечает за корректность предоставленных данных и сохранность ссылок доступа к гостевому кабинету. Партнер отвечает за доступ сотрудников к manager workspace и актуальность операционных данных.",
            ],
          },
          {
            title: "Ограничения",
            bullets: [
              "Нельзя использовать сервис для мошенничества, спама, обхода платежей, атак на инфраструктуру или незаконных бронирований.",
              "Нельзя загружать вредоносные данные, пытаться получить доступ к чужим броням или извлекать закрытые данные отеля.",
              "Сервис может быть временно недоступен из-за обслуживания, интеграций, провайдеров или инфраструктурных сбоев.",
            ],
          },
          {
            title: "Изменения условий",
            paragraphs: [
              "Оператор production-развертывания может обновлять эти условия. Для публичного запуска текст должен быть синхронизирован с юридическим лицом, платежным провайдером и правилами подключенных отелей.",
            ],
          },
        ]
      : [
          {
            title: "Service Purpose",
            paragraphs: [
              "StayPilot provides an interface for property search, available room browsing, reservation checkout, payment status, guest accounts, and in-stay services.",
              "The actual operator of bookings, payments, and accommodation is the production deployment owner or the connected hotel.",
            ],
          },
          {
            title: "Bookings and Availability",
            bullets: [
              "Room availability, prices, tariffs, and cancellation rules are shown from data available to the service at request time.",
              "A reservation is created after the system successfully stores the request and assigns a status.",
              "Partner confirmation, payment status, and guest access tokens may be used for account and in-stay service access.",
              "The operator should correct price, availability, or description errors if discovered before or after reservation creation.",
            ],
          },
          {
            title: "Payments",
            paragraphs: [
              "The demo package uses a safe test payment mode with no real charges. Real charges are possible only after the deployment owner connects a payment provider.",
              "The payment provider may apply its own fees, checks, limits, refund rules, and settlement timing.",
            ],
          },
          {
            title: "Cancellation and Refunds",
            paragraphs: ["Cancellation rules depend on the selected tariff and reservation state. The full matrix is listed in the refund policy."],
          },
          {
            title: "AI Concierge and Service Requests",
            bullets: [
              "The AI concierge helps with search, booking, room service, table reservations, and request statuses.",
              "AI concierge responses are not legal, medical, financial, or other professional advice.",
              "In-stay service requests depend on actual hotel, restaurant, kitchen, transfer, or vendor availability.",
              "Live GPT is disabled by default. If live mode is enabled, the operator is responsible for model settings, prompts, logs, and privacy review.",
            ],
          },
          {
            title: "Accounts and Security",
            paragraphs: [
              "Users are responsible for accurate submitted data and for protecting guest account access links. Partners are responsible for staff access to the manager workspace and the accuracy of operational data.",
            ],
          },
          {
            title: "Restrictions",
            bullets: [
              "Do not use the service for fraud, spam, payment bypass, infrastructure attacks, or illegal bookings.",
              "Do not upload malicious data, attempt to access another guest's booking, or extract private hotel data.",
              "The service may be temporarily unavailable due to maintenance, integrations, providers, or infrastructure incidents.",
            ],
          },
          {
            title: "Terms Changes",
            paragraphs: [
              "The production deployment operator may update these terms. Before public launch, this text should be aligned with the legal entity, payment provider, and connected hotel rules.",
            ],
          },
        ];

  return (
    <LegalPage
      lang={lang}
      currency={currency}
      title={lang === "ru" ? "Условия использования" : "Terms of Use"}
      subtitle={
        lang === "ru"
          ? "Базовые условия для сервиса бронирования, партнерского кабинета и AI-консьержа StayPilot."
          : "Baseline terms for the StayPilot booking service, partner workspace, and AI concierge."
      }
      updated={lang === "ru" ? "18 июня 2026" : "June 18, 2026"}
      sections={sections}
      asideTitle={lang === "ru" ? "Связанные документы" : "Related Documents"}
      asideItems={
        lang === "ru"
          ? ["Политика конфиденциальности описывает данные и cookies.", "Политика возвратов описывает тарифы Basic, Smart и Flex.", "Контакты нужны для платежных, юридических и сервисных вопросов."]
          : ["The privacy policy explains data and cookies.", "The refund policy covers Basic, Smart, and Flex tariffs.", "Contacts cover payment, legal, and service questions."]
      }
      actions={[
        { href: withLegalLocale("/refund-policy", lang, currency), label: lang === "ru" ? "Возвраты" : "Refunds", primary: true },
        { href: withLegalLocale("/privacy", lang, currency), label: lang === "ru" ? "Конфиденциальность" : "Privacy" },
      ]}
    />
  );
}
