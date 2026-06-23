import Link from "next/link";
import RouteStateShell from "../components/RouteStateShell";

export default function NotFound() {
  return (
    <RouteStateShell
      title="Страница не найдена"
      description="Ссылка устарела, объект снят с публикации или адрес введен с ошибкой."
      actions={
        <>
          <Link href="/?lang=ru&currency=KZT&city=Dubai&guests=2" className="route-state-action route-state-action-primary">
            Вернуться к поиску
          </Link>
          <Link href="/for-hotels" className="route-state-action">
            Для отелей
          </Link>
        </>
      }
    >
      <p className="route-state-note">Попробуйте открыть каталог заново или выберите другой объект из рекомендаций.</p>
    </RouteStateShell>
  );
}
