export type ExplainLang = "en" | "ru";
export type TrustVariant = "a" | "b";

export function resolveTrustVariant(raw?: string): TrustVariant {
  return raw === "b" ? "b" : "a";
}

export function trustKicker(lang: ExplainLang, variant: TrustVariant): string {
  if (lang === "ru") {
    return variant === "b" ? "Финальная сумма до оплаты" : "Без скрытых платежей";
  }
  return variant === "b" ? "Final amount before payment" : "No hidden fees";
}

export function bestMatchTitle(lang: ExplainLang, variant: TrustVariant): string {
  if (lang === "ru") {
    return variant === "b" ? "Почему эти варианты вверху выдачи" : "Почему это лучшее совпадение";
  }
  return variant === "b" ? "Why these options rank first" : "Why these are best match";
}

export function bestMatchBullets(
  lang: ExplainLang,
  variant: TrustVariant,
  flags: { hasDates: boolean; hasBudget: boolean; hasPurpose: boolean },
): string[] {
  if (lang === "ru") {
    const base = [
      variant === "b"
        ? "Сначала проверяем релевантность по городу и району."
        : "Учтены выбранный город и контекст по району.",
    ];
    if (flags.hasDates) {
      base.push(
        variant === "b"
          ? "Показываем варианты, которые реально доступны на ваши даты."
          : "Проверена доступность и длительность проживания на ваши даты.",
      );
    }
    if (flags.hasBudget) {
      base.push(
        variant === "b"
          ? "Выше ранжируются варианты с лучшим балансом цена/качество."
          : "В приоритете варианты, которые лучше попадают в бюджет.",
      );
    }
    if (flags.hasPurpose) {
      base.push(
        variant === "b"
          ? "Рекомендации подстроены под цель поездки."
          : "Ранжирование подстроено под цель поездки.",
      );
    }
    return base;
  }

  const base = [variant === "b" ? "We start with city and district relevance." : "Matched to selected city and district intent."];
  if (flags.hasDates) {
    base.push(
      variant === "b"
        ? "We prioritize places actually available for your dates."
        : "Availability and trip duration are considered for your dates.",
    );
  }
  if (flags.hasBudget) {
    base.push(
      variant === "b"
        ? "Higher positions favor better value for your budget."
        : "Prioritized options that better fit your budget and value.",
    );
  }
  if (flags.hasPurpose) {
    base.push(
      variant === "b"
        ? "Results are tuned to your trip purpose."
        : "Adjusted by trip goal for more relevant options.",
    );
  }
  return base;
}

export function humanPolicyLabel(policy: string, lang: ExplainLang): string {
  const normalized = policy.toLowerCase();
  if (lang === "ru") {
    if (normalized.includes("flex")) return "Гибкая";
    if (normalized.includes("moder")) return "Умеренная";
    if (normalized.includes("strict")) return "Строгая";
    if (normalized.includes("smart")) return "Оптимальная";
    return policy;
  }
  if (normalized.includes("flex")) return "Flexible";
  if (normalized.includes("moder")) return "Moderate";
  if (normalized.includes("strict")) return "Strict";
  if (normalized.includes("smart")) return "Smart";
  return policy;
}

export function humanSuggestionReason(reason: string, lang: ExplainLang): string {
  const cleaned = reason
    .replace(/rules?:/gi, "")
    .replace(/logic|подбора|pipeline/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > 0) return cleaned;
  return lang === "ru"
    ? "Подходит по локации, бюджету и общему качеству."
    : "Good fit by location, budget, and overall quality.";
}
