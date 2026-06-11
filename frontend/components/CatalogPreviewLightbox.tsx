"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { TrackedStayLink } from "./AnalyticsTrackers";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

export default function CatalogPreviewLightbox({
  className,
  children,
  imageUrl,
  title,
  subtitle,
  priceLabel,
  stayHref,
  listingId,
  position,
  variant,
  lang,
  currency,
  openLabel,
  closeLabel,
  ctaLabel,
}: {
  className: string;
  children: ReactNode;
  imageUrl?: string | null;
  title: string;
  subtitle: string;
  priceLabel: string;
  stayHref: string;
  listingId: number;
  position: number;
  variant: "a" | "b";
  lang: Lang;
  currency: Currency;
  openLabel: string;
  closeLabel: string;
  ctaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, mounted]);

  return (
    <>
      <div className={`${className} catalog-cover-shell`}>
        <TrackedStayLink
          href={stayHref}
          listingId={listingId}
          position={position}
          variant={variant}
          lang={lang}
          currency={currency}
          className="catalog-cover-link"
          title={ctaLabel}
        >
          {children}
        </TrackedStayLink>
        <button
          type="button"
          className="catalog-preview-fab"
          onClick={() => setOpen(true)}
          aria-label={openLabel}
          title={openLabel}
        >
          <span aria-hidden="true">&#x29C9;</span>
        </button>
      </div>

      {open && mounted
        ? createPortal(
            <div className="catalog-lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
              <div className="catalog-lightbox-inner" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="catalog-lightbox-close" onClick={() => setOpen(false)}>
                  {closeLabel}
                </button>

                <div className="catalog-lightbox-media">
                  {imageUrl ? <img src={imageUrl} alt={title} /> : <div className="catalog-lightbox-fallback" aria-hidden="true" />}
                </div>

                <div className="catalog-lightbox-info">
                  <h3>{title}</h3>
                  <p>{subtitle}</p>
                  <strong>{priceLabel}</strong>
                  <TrackedStayLink
                    href={stayHref}
                    listingId={listingId}
                    position={position}
                    variant={variant}
                    lang={lang}
                    currency={currency}
                    className="catalog-lightbox-cta"
                  >
                    {ctaLabel}
                  </TrackedStayLink>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
