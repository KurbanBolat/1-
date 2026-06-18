"use client";

import { type ReactNode, useState } from "react";

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3z" fill="currentColor" />
      <path d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15z" fill="currentColor" opacity=".65" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 6.5 17.5 17.5" />
      <path d="m17.5 6.5-11 11" />
    </svg>
  );
}

export default function HomeChatRail({
  title,
  status,
  moreLabel,
  closeLabel,
  openLabel,
  searchLabel,
  resultsLabel,
  children,
}: {
  title: string;
  status: string;
  moreLabel: string;
  closeLabel: string;
  openLabel: string;
  searchLabel: string;
  resultsLabel: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (collapsed) {
    return (
      <aside id="ai" className="sp-right-rail sp-right-rail-collapsed">
        <button type="button" className="sp-chat-reopen" onClick={() => setCollapsed(false)}>
          <span className="sp-chat-avatar">
            <SparkleIcon />
          </span>
          <span>{openLabel}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside id="ai" className="sp-right-rail">
      <div className="sp-chat-head">
        <div className="sp-chat-title">
          <span className="sp-chat-avatar">
            <SparkleIcon />
          </span>
          <div>
            <h3>{title}</h3>
            <span>{status}</span>
          </div>
        </div>
        <div className="sp-chat-actions">
          <button
            type="button"
            aria-label={moreLabel}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <DotsIcon />
          </button>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => {
              setMenuOpen(false);
              setCollapsed(true);
            }}
          >
            <XIcon />
          </button>
          {menuOpen ? (
            <div className="sp-chat-menu" role="menu">
              <a role="menuitem" href="#search" onClick={() => setMenuOpen(false)}>
                {searchLabel}
              </a>
              <a role="menuitem" href="#results" onClick={() => setMenuOpen(false)}>
                {resultsLabel}
              </a>
            </div>
          ) : null}
        </div>
      </div>

      {children}
    </aside>
  );
}
