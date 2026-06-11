const STORAGE_KEY = "findapart_reservation_access";

type StoredReservationAccess = {
  reservationId: number;
  guestEmail: string;
  accessToken: string;
};

function readAll(): StoredReservationAccess[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredReservationAccess =>
        typeof item?.reservationId === "number" &&
        typeof item?.guestEmail === "string" &&
        typeof item?.accessToken === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(items: StoredReservationAccess[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-50)));
}

export function rememberReservationAccess(reservation: {
  id: number;
  guest_email: string;
  access_token?: string | null;
}) {
  if (!reservation.access_token) return;
  const nextEntry: StoredReservationAccess = {
    reservationId: reservation.id,
    guestEmail: reservation.guest_email.trim().toLowerCase(),
    accessToken: reservation.access_token,
  };
  const existing = readAll().filter((item) => item.reservationId !== nextEntry.reservationId);
  writeAll([...existing, nextEntry]);
}

export function getReservationAccessToken(reservationId: number): string | null {
  const match = readAll().find((item) => item.reservationId === reservationId);
  return match?.accessToken ?? null;
}

export function getReservationAccessTokensForEmail(guestEmail: string): string[] {
  const normalized = guestEmail.trim().toLowerCase();
  return readAll()
    .filter((item) => item.guestEmail === normalized)
    .map((item) => item.accessToken);
}
