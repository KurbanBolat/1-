"use client";

import React, { Suspense } from "react";
import { usePathname } from "next/navigation";
import TopNavBar from "./TopNavBar";
import AppFooter from "./AppFooter";

function NavFallback() {
  return <header style={{ height: "64px", background: "linear-gradient(135deg,#0B1E30 0%,#0F3356 100%)" }} />;
}

export default function LayoutFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const pathSegments = pathname.split("/").filter(Boolean);
  const isStayDetails = pathSegments[0] === "stays" && pathSegments.length === 2;
  const isStayRestaurant = pathSegments[0] === "stays" && pathSegments[2] === "restaurants" && pathSegments.length === 4;
  const isAccount = pathname.startsWith("/account");
  const isLogin = pathname.startsWith("/login");
  const isManager = pathname.startsWith("/manager");
  const isHotelSite = pathname.startsWith("/for-hotels");
  const isStayPilotRoute =
    isHome || isHotelSite || pathname.startsWith("/checkout") || isStayDetails || isStayRestaurant || isAccount || isLogin || isManager;
  const containerClassName = isHotelSite ? "container container-hotel-site" : isStayPilotRoute ? "container container-home" : "container";

  return (
    <>
      {!isStayPilotRoute ? (
        <Suspense fallback={<NavFallback />}>
          <TopNavBar />
        </Suspense>
      ) : null}
      <main className={containerClassName}>{children}</main>
      {!isStayPilotRoute ? (
        <Suspense fallback={null}>
          <AppFooter />
        </Suspense>
      ) : null}
    </>
  );
}
