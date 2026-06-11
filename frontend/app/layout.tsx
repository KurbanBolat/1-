import "./globals.css";
import type { Metadata } from "next";
import React from "react";
import LayoutFrame from "../components/LayoutFrame";

export const metadata: Metadata = {
  title: "FindApart - search and booking",
  description: "Find and book apartments and hotels with transparent pricing.",
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

