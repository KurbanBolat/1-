"use client";

import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("Global UI error:", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "linear-gradient(140deg, #eef4fa 0%, #f8fbff 100%)",
      }}
    >
      <section
        style={{
          width: "min(560px, 100%)",
          borderRadius: "20px",
          border: "1px solid #d4e2f2",
          background: "#ffffff",
          boxShadow: "0 14px 36px rgba(16, 40, 72, 0.08)",
          padding: "28px 24px",
          color: "#0b2340",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#4d6788" }}>
          FindApart
        </p>
        <h1 style={{ marginTop: 10, marginBottom: 10, fontSize: 28, lineHeight: 1.15 }}>Something went wrong</h1>
        <p style={{ marginTop: 0, marginBottom: 18, color: "#425d80" }}>
          We could not render this screen. Please retry, and if it repeats, return to the main page.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "none",
              borderRadius: 12,
              padding: "10px 16px",
              background: "#0c72a8",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              borderRadius: 12,
              padding: "10px 16px",
              border: "1px solid #c7d9ee",
              color: "#0b2340",
              textDecoration: "none",
              fontWeight: 700,
              background: "#f6fbff",
            }}
          >
            Go home
          </a>
        </div>
      </section>
    </main>
  );
}
