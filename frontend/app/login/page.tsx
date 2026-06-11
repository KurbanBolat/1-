import Link from "next/link";
import LoginForm from "../../components/LoginForm";
import StayPilotShell from "../../components/StayPilotShell";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { lang?: string; currency?: string };
}) {
  const lang: Lang = searchParams.lang === "en" ? "en" : "ru";
  const currency: Currency = searchParams.currency === "USD" ? "USD" : "KZT";
  const tr =
    lang === "ru"
      ? {
          title: "Вход партнера StayPilot",
          subtitle: "Управляйте объектами, бронями, ресторанами и сервисами отеля из одного кабинета.",
          back: "Назад",
          kicker: "Партнерский кабинет",
        }
      : {
          title: "StayPilot partner login",
          subtitle: "Manage stays, bookings, restaurants and hotel services from one workspace.",
          back: "Back",
          kicker: "Partner workspace",
        };

  return (
    <StayPilotShell lang={lang} currency={currency}>
      <div className="sp-login-page">
        <Link href={`/?lang=${lang}&currency=${currency}`} className="sp-back-link">
          {tr.back}
        </Link>
        <section className="property-detail sp-login-card">
          <div className="sp-login-copy">
            <span>{tr.kicker}</span>
            <h1>{tr.title}</h1>
            <p className="desc">{tr.subtitle}</p>
          </div>
          <LoginForm lang={lang} currency={currency} />
        </section>
      </div>
    </StayPilotShell>
  );
}
