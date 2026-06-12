import "./globals.css";
import type { Metadata } from "next";
import React from "react";
import LayoutFrame from "../components/LayoutFrame";

export const metadata: Metadata = {
  title: "StayPilot - AI concierge for hotels",
  description: "Find, book, and manage hotel stays with an AI concierge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <LayoutFrame>{children}</LayoutFrame>
      </body>
    </html>
  );
}
