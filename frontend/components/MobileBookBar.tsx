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
    const watchedIds = [targetId, ...extraIds];
    let frameId: number | null = null;

    const updateHiddenState = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const hasVisibleTarget = watchedIds
          .map((id) => document.getElementById(id))
          .filter((target): target is HTMLElement => Boolean(target))
          .some((target) => {
            const rect = target.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
          });
        setIsHidden(hasVisibleTarget);
      });
    };

    updateHiddenState();
    window.addEventListener("scroll", updateHiddenState, { passive: true });
    window.addEventListener("resize", updateHiddenState);
    window.addEventListener("hashchange", updateHiddenState);
    const mutationObserver = new MutationObserver(updateHiddenState);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updateHiddenState);
      window.removeEventListener("resize", updateHiddenState);
      window.removeEventListener("hashchange", updateHiddenState);
      mutationObserver.disconnect();
    };
  }, [targetId, hideWhenIdsKey]);

  return (
    <a href={`#${targetId}`} className={`mobile-bookbar ${isHidden ? "is-hidden" : ""}`}>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </a>
  );
}
