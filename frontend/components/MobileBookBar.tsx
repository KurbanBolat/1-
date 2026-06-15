"use client";

import { useEffect, useState } from "react";

export default function MobileBookBar({
  targetId,
  label,
  hint,
  hideWhenIds = [],
}: {
  targetId: string;
  label: string;
  hint?: string;
  hideWhenIds?: string[];
}) {
  const [isHidden, setIsHidden] = useState(false);
  const hideWhenIdsKey = hideWhenIds.join("|");

  useEffect(() => {
    const extraIds = hideWhenIdsKey ? hideWhenIdsKey.split("|") : [];
    const targets = [targetId, ...extraIds]
      .map((id) => document.getElementById(id))
      .filter((target): target is HTMLElement => Boolean(target));
    if (targets.length === 0) return;

    const visibleTargets = new Map<string, boolean>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibleTargets.set((entry.target as HTMLElement).id, entry.isIntersecting);
        });
        setIsHidden(Array.from(visibleTargets.values()).some(Boolean));
      },
      { threshold: 0.2 },
    );

    targets.forEach((target) => {
      visibleTargets.set(target.id, false);
      observer.observe(target);
    });
    return () => observer.disconnect();
  }, [targetId, hideWhenIdsKey]);

  return (
    <a href={`#${targetId}`} className={`mobile-bookbar ${isHidden ? "is-hidden" : ""}`}>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </a>
  );
}
