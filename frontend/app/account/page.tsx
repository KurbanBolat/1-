import GuestAccountPage from "../../components/GuestAccountPage";
import StayPilotShell from "../../components/StayPilotShell";

type Lang = "ru" | "en";
type Currency = "KZT" | "USD";

export default function AccountPage({
  searchParams,
}: {
  searchParams: { lang?: string; currency?: string; guest_email?: string; reservation_id?: string; access_token?: string };
}) {
  const lang: Lang = searchParams.lang === "en" ? "en" : "ru";
  const currency: Currency = searchParams.currency === "USD" ? "USD" : "KZT";
  const reservationId = Number(searchParams.reservation_id || "0");
  const accountParams = new URLSearchParams({ lang, currency });
  if (searchParams.guest_email) accountParams.set("guest_email", searchParams.guest_email);
  if (Number.isFinite(reservationId) && reservationId > 0) accountParams.set("reservation_id", String(reservationId));
  if (searchParams.access_token) accountParams.set("access_token", searchParams.access_token);
  return (
    <StayPilotShell lang={lang} currency={currency} accountHref={`/account?${accountParams.toString()}`}>
      <GuestAccountPage
        lang={lang}
        currency={currency}
        initialGuestEmail={searchParams.guest_email || ""}
        initialReservationId={Number.isFinite(reservationId) && reservationId > 0 ? reservationId : undefined}
        initialAccessToken={searchParams.access_token || ""}
      />
    </StayPilotShell>
  );
}
