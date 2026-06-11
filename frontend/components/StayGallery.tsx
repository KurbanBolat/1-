"use client";

import { useMemo, useState } from "react";

type GalleryImage = {
  id: number;
  url: string;
  alt: string;
};

export default function StayGallery({
  city,
  rating,
  ratingLabel,
  images,
  openLabel,
  closeLabel,
}: {
  city: string;
  rating: number;
  ratingLabel: string;
  images: GalleryImage[];
  openLabel: string;
  closeLabel?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

  const normalized = useMemo(() => {
    if (images.length > 0) return images;
    return [
      { id: -1, url: "", alt: "Demo image 1" },
      { id: -2, url: "", alt: "Demo image 2" },
      { id: -3, url: "", alt: "Demo image 3" },
      { id: -4, url: "", alt: "Demo image 4" },
      { id: -5, url: "", alt: "Demo image 5" },
    ];
  }, [images]);

  const active = normalized[activeIndex] || normalized[0];
  const thumbs = Array.from({ length: 4 }, (_, idx) => normalized[(idx + 1) % normalized.length]);

  return (
    <div className="stay-gallery">
      <button
        type="button"
        className="stay-cover stay-cover-main stay-cover-button"
        onClick={() => setIsFullscreenOpen(true)}
        aria-label={openLabel}
      >
        {active.url ? <img className="stay-cover-image" src={active.url} alt={active.alt} /> : null}
        <span>{city}</span>
        <b>{rating.toFixed(1)} {ratingLabel}</b>
      </button>

      <div className="stay-gallery-strip">
        {thumbs.map((photo, idx) => (
          <button
            key={`${photo.id}-${idx}`}
            type="button"
            className={`stay-thumb stay-thumb-button ${!photo.url ? `stay-thumb-${idx + 1}` : ""}`}
            onClick={() => setActiveIndex(idx + 1)}
            aria-label={`${openLabel} ${idx + 2}`}
          >
            {photo.url ? <img src={photo.url} alt={photo.alt} /> : null}
          </button>
        ))}
      </div>

      <div className="stay-gallery-mobile">
        <div className="stay-gallery-mobile-track">
          {normalized.map((photo, idx) => (
            <button
              key={`${photo.id}-${idx}`}
              type="button"
              className="stay-gallery-mobile-slide"
              onClick={() => {
                setActiveIndex(idx);
                setIsFullscreenOpen(true);
              }}
              aria-label={`${openLabel} ${idx + 1}`}
            >
              {photo.url ? (
                <img src={photo.url} alt={photo.alt} />
              ) : (
                <div className={`stay-thumb stay-thumb-${(idx % 4) + 1}`} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>

      {isFullscreenOpen ? (
        <div className="gallery-modal" role="dialog" aria-modal="true" onClick={() => setIsFullscreenOpen(false)}>
          <div className="gallery-modal-inner" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="gallery-modal-close" onClick={() => setIsFullscreenOpen(false)}>
              {closeLabel || "Close"}
            </button>
            {active.url ? (
              <img className="gallery-modal-image" src={active.url} alt={active.alt} />
            ) : (
              <div className="gallery-modal-fallback" />
            )}
            <div className="gallery-modal-strip">
              {normalized.map((photo, idx) => (
                <button
                  key={`${photo.id}-${idx}`}
                  type="button"
                  className={`gallery-modal-thumb ${idx === activeIndex ? "active" : ""}`}
                  onClick={() => setActiveIndex(idx)}
                  aria-label={`${openLabel} ${idx + 1}`}
                >
                  {photo.url ? <img src={photo.url} alt={photo.alt} /> : <div className={`stay-thumb stay-thumb-${(idx % 4) + 1}`} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


