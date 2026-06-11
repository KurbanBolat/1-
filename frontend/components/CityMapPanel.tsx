"use client";

import { TrackedStayLink } from "./AnalyticsTrackers";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

type Pin = {
  id: number;
  href: string;
  title: string;
  priceLabel: string;
  x: number;
  y: number;
};

const CITY_CENTER: Record<string, { lat: number; lon: number }> = {
  almaty: { lat: 43.2383, lon: 76.9455 },
  astana: { lat: 51.1694, lon: 71.4491 },
  shymkent: { lat: 42.3417, lon: 69.5901 },
  karagandy: { lat: 49.8047, lon: 73.1094 },
  istanbul: { lat: 41.0082, lon: 28.9784 },
  antalya: { lat: 36.8969, lon: 30.7133 },
  vienna: { lat: 48.2082, lon: 16.3738 },
  toronto: { lat: 43.6532, lon: -79.3832 },
  milan: { lat: 45.4642, lon: 9.19 },
  tbilisi: { lat: 41.7151, lon: 44.8271 },
  baku: { lat: 40.4093, lon: 49.8671 },
};

function mapBounds(lat: number, lon: number, delta = 0.2): string {
  const left = lon - delta;
  const right = lon + delta;
  const top = lat + delta;
  const bottom = lat - delta;
  return `${left}%2C${bottom}%2C${right}%2C${top}`;
}

function worldBounds(): string {
  return "-170%2C-55%2C170%2C75";
}

export default function CityMapPanel({
  lang,
  currency,
  variant,
  city,
  title,
  hint,
  pins,
}: {
  lang: Lang;
  currency: Currency;
  variant: "a" | "b";
  city?: string;
  title: string;
  hint: string;
  pins: Pin[];
}) {
  const cityCenter = CITY_CENTER[(city || "").toLowerCase()];
  const src = cityCenter
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${mapBounds(cityCenter.lat, cityCenter.lon)}&layer=mapnik&marker=${cityCenter.lat}%2C${cityCenter.lon}`
    : `https://www.openstreetmap.org/export/embed.html?bbox=${worldBounds()}&layer=mapnik`;

  return (
    <aside className="map-panel">
      <div className="map-head">
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
      <div className="map-canvas map-canvas-real" role="img" aria-label={title}>
        <iframe title={title} src={src} loading="lazy" />
        <div className="map-pin-overlay">
          {pins.map((pin, index) => (
            <TrackedStayLink
              key={pin.id}
              href={pin.href}
              listingId={pin.id}
              position={index + 1}
              variant={variant}
              lang={lang}
              currency={currency}
              className="map-pin"
              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              title={pin.title}
            >
              {pin.priceLabel}
            </TrackedStayLink>
          ))}
        </div>
      </div>
    </aside>
  );
}
