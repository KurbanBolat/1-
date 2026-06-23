import type { ReactNode } from "react";

type RouteStateShellProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "warning";
};

export default function RouteStateShell({
  eyebrow = "StayPilot",
  title,
  description,
  actions,
  children,
  tone = "default",
}: RouteStateShellProps) {
  return (
    <section className={`route-state route-state-${tone}`} aria-live={tone === "warning" ? "assertive" : "polite"}>
      <div className="route-state-copy">
        <p className="route-state-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="route-state-body">{children}</div> : null}
      {actions ? <div className="route-state-actions">{actions}</div> : null}
    </section>
  );
}
