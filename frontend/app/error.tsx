"use client";

import { useEffect } from "react";
import RouteStateShell from "../components/RouteStateShell";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("Global UI error:", error);
  }, [error]);

  return (
    <RouteStateShell
      tone="warning"
      title="Не удалось открыть экран"
      description="Экран не отрисовался. Повторите попытку или вернитесь к поиску, чтобы продолжить бронирование."
      actions={
        <>
          <button type="button" className="route-state-action route-state-action-primary" onClick={reset}>
            Повторить
          </button>
          <a href="/" className="route-state-action">
            К поиску
          </a>
        </>
      }
    >
      <p className="route-state-note">Если ошибка повторится, сохраните страницу и время ошибки для менеджера.</p>
    </RouteStateShell>
  );
}
