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
  title: "Refund Policy - StayPilot",
  description: "StayPilot cancellation and refund policy template for Basic, Smart, and Flex tariffs.",
};

export default function RefundPolicyPage({ searchParams }: { searchParams: PageSearchParams }) {
  const lang = normalizeLegalLang(searchParams.lang);
  const currency = normalizeLegalCurrency(searchParams.currency);

  const sections: LegalSection[] =
    lang === "ru"
      ? [
          {
            title: "Как считается штраф",
            paragraphs: [
              "Штраф зависит от тарифа и количества дней до даты заезда. Если отмена происходит после даты заезда или в день заезда, применяется правило same-day/after.",
              "Финальный расчет может учитывать платежного провайдера, комиссию оператора, правила отеля и статус фактического заселения.",
            ],
          },
          {
            title: "Тариф Basic",
            bullets: [
              "Отмена за 14 дней или раньше до заезда: штраф 50% от суммы брони.",
              "Отмена за 7-13 дней до заезда: штраф 75% от суммы брони.",
              "Отмена менее чем за 7 дней до заезда, в день заезда или после заезда: штраф 100%.",
            ],
          },
          {
            title: "Тариф Smart",
            bullets: [
              "Отмена за 7 дней или раньше до заезда: штраф 0%.",
              "Отмена за 3-6 дней до заезда: штраф 30%.",
              "Отмена за 1-2 дня до заезда: штраф 60%.",
              "Отмена в день заезда или после заезда: штраф 100%.",
            ],
          },
          {
            title: "Тариф Flex",
            bullets: [
              "Отмена за 1 день или раньше до заезда: штраф 0%.",
              "Отмена в день заезда или после заезда: штраф 20%.",
            ],
          },
          {
            title: "Когда возврат может быть задержан",
            bullets: [
              "Платежный провайдер проверяет операцию или требует дополнительное подтверждение.",
              "Отель должен вручную подтвердить отмену, no-show или факт оказания услуги.",
              "Нужна проверка подозрительной операции, спорного платежа или ошибки в данных.",
              "Банк гостя обрабатывает возврат дольше стандартного срока.",
            ],
          },
          {
            title: "Невозвратные суммы",
            paragraphs: [
              "Платежные комиссии, банковские сборы, городские налоги, туристические сборы и дополнительные услуги могут быть невозвратными, если это предусмотрено правилами провайдера, отеля или закона.",
            ],
          },
          {
            title: "Как запросить отмену",
            bullets: [
              "Откройте гостевой кабинет по ссылке бронирования или обратитесь в поддержку оператора.",
              "Укажите номер брони, email гостя и причину отмены.",
              "Дождитесь расчета штрафа и подтверждения статуса отмены.",
              "Проверьте статус возврата в платежном канале или у поддержки.",
            ],
          },
        ]
      : [
          {
            title: "How Penalties Are Calculated",
            paragraphs: [
              "The penalty depends on tariff and days before check-in. If cancellation happens on or after check-in day, the same-day/after rule applies.",
              "The final calculation may consider the payment provider, operator fee, hotel rules, and actual stay status.",
            ],
          },
          {
            title: "Basic Tariff",
            bullets: [
              "Cancellation 14 or more days before check-in: 50% penalty.",
              "Cancellation 7-13 days before check-in: 75% penalty.",
              "Cancellation less than 7 days before check-in, on check-in day, or after check-in: 100% penalty.",
            ],
          },
          {
            title: "Smart Tariff",
            bullets: [
              "Cancellation 7 or more days before check-in: 0% penalty.",
              "Cancellation 3-6 days before check-in: 30% penalty.",
              "Cancellation 1-2 days before check-in: 60% penalty.",
              "Cancellation on or after check-in day: 100% penalty.",
            ],
          },
          {
            title: "Flex Tariff",
            bullets: ["Cancellation 1 or more days before check-in: 0% penalty.", "Cancellation on or after check-in day: 20% penalty."],
          },
          {
            title: "When Refunds May Be Delayed",
            bullets: [
              "The payment provider reviews the transaction or requires additional confirmation.",
              "The hotel must manually confirm cancellation, no-show, or service delivery status.",
              "A suspicious transaction, disputed payment, or data issue needs review.",
              "The guest bank processes the refund longer than the standard window.",
            ],
          },
          {
            title: "Non-Refundable Amounts",
            paragraphs: [
              "Payment fees, bank fees, city taxes, tourism fees, and additional services may be non-refundable if required by the provider, hotel rules, or applicable law.",
            ],
          },
          {
            title: "How To Request Cancellation",
            bullets: [
              "Open the guest account through the booking link or contact operator support.",
              "Provide reservation number, guest email, and cancellation reason.",
              "Wait for penalty calculation and cancellation status confirmation.",
              "Check refund status in the payment channel or with support.",
            ],
          },
        ];

  return (
    <LegalPage
      lang={lang}
      currency={currency}
      title={lang === "ru" ? "Политика отмены и возвратов" : "Cancellation and Refund Policy"}
      subtitle={
        lang === "ru"
          ? "Правила для тарифов Basic, Smart и Flex. Перед запуском оператор должен сверить их с договорами отелей и платежного провайдера."
          : "Rules for Basic, Smart, and Flex tariffs. Before launch, the operator should align them with hotel contracts and payment provider terms."
      }
      updated={lang === "ru" ? "12 июня 2026" : "June 12, 2026"}
      sections={sections}
      asideTitle={lang === "ru" ? "Операционный контроль" : "Operational Control"}
      asideItems={
        lang === "ru"
          ? ["Матрица должна совпадать с backend-расчетом.", "Провайдер возврата должен быть подключен отдельно.", "Служба поддержки должна видеть бронь, платеж и причину отмены."]
          : ["The matrix must match backend calculation.", "The refund provider must be connected separately.", "Support should see reservation, payment, and cancellation reason."]
      }
      actions={[
        { href: withLegalLocale("/contacts", lang, currency), label: lang === "ru" ? "Связаться" : "Contact", primary: true },
        { href: withLegalLocale("/terms", lang, currency), label: lang === "ru" ? "Условия" : "Terms" },
      ]}
    />
  );
}
