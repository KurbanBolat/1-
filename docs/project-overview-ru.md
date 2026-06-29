# StayPilot: описание проекта

## Кратко

StayPilot — это booking-style платформа для отелей, апарт-отелей и управляющих компаний с AI-консьержем, каталогом объектов, доступными номерами, бронированием, оплатой, гостевым кабинетом, сервисами во время проживания и партнерской manager-панелью.

Проект уже не является просто лендингом или макетом: в нем есть связанный пользовательский путь от поиска объекта до оплаты, кабинета гостя и внутренних сервисов отеля.

## Для кого продукт

- Бутик-отели и небольшие гостиничные сети, которым нужны прямые бронирования без зависимости от OTA.
- Апарт-отели и управляющие компании, которым нужен каталог объектов, комнат и доступности.
- Digital-агентства, которые продают отелям сайты, CRM, автоматизацию и AI-консьержей.
- Hospitality/Travel стартапы, которым нужен готовый технический фундамент вместо разработки с нуля.
- Покупатели на маркетплейсах проектов, которым нужен рабочий SaaS/MVP с исходным кодом и документацией.

## Что уже реализовано

### Гостевой интерфейс

- Главная страница с каталогом объектов и поиском.
- Локализация RU/EN.
- Валюты KZT/USD.
- Карточки отелей, апартаментов, вилл и предложений.
- Страница объекта с галереей, описанием, доступными номерами и ценами.
- Выбор дат и гостей.
- Вывод свободных номеров вместо абстрактного календаря занятости.
- Переход к оформлению брони.

### AI-консьерж

- Чат-консьерж в гостевом интерфейсе.
- Сценарии подбора отелей.
- Сценарии бронирования.
- Сценарии in-stay сервисов: заказ еды в номер, бронирование столика, статусы заявок.
- Безопасный deterministic stub mode по умолчанию.
- Live OpenAI GPT режим предусмотрен архитектурно, но намеренно отключен для демо и продажи без ключей.

### Бронирование и оплата

- Checkout flow.
- Создание reservation draft.
- Выбор тарифа/комнаты.
- Payment step.
- Mock/manual/provider-ready платежная логика.
- Страница результата оплаты: success, pending, failed.
- Recovery UX для неуспешной оплаты.
- Повтор оплаты и возврат к редактированию брони.
- Guest account access token для безопасного доступа к брони.

### Гостевой кабинет

- Поиск броней по email при наличии access token.
- Сводка броней.
- Статусы бронирования и оплаты.
- Условия отмены.
- Отмена брони.
- Переход к объекту и AI-консьержу.
- Сервисы во время проживания.
- Профиль гостя для автозаполнения будущих форм.

### Сервисы во время проживания

- Room service orders.
- Hotel restaurants.
- Table bookings.
- События и статусы заявок.
- Отображение активных запросов в гостевом кабинете.
- Отображение заявок в manager-панели.

### Партнерская manager-панель

- Login для партнера.
- Управление объектами.
- Управление категориями номеров.
- Управление доступностью.
- Управление бронированиями.
- Подтверждение/отмена броней.
- Фильтры по статусам, оплате, объектам, датам и гостям.
- Управление ресторанами и меню.
- Управление заказами в номер.
- Коммуникации и support tickets.
- Operational dashboard/KPI.

### Публичные страницы

- `/for-hotels` — страница для продажи отелям.
- `/demo` — демо-гайд для показа покупателю.
- `/privacy` — privacy template.
- `/terms` — terms template.
- `/refund-policy` — refund policy template.
- `/contacts` — контакты/support template.

## Техническая архитектура

### Frontend

- Next.js App Router.
- TypeScript.
- Playwright E2E.
- Responsive UI.
- Локализация через локальные словари.
- Production build через `npm run build`.

### Backend

- FastAPI.
- SQLAlchemy.
- Alembic migrations.
- Postgres-ready архитектура.
- Health checks.
- Reservation lifecycle.
- Room inventory service.
- Payment service.
- In-stay service endpoints.
- Partner/ops API.

### База данных

- Postgres в production.
- Alembic migrations.
- Сущности: listings, room types, availability blocks, reservations, payments, restaurants, menu items, room service orders, support tickets, users, analytics events.

### Deployment

- Dockerfile для frontend.
- Dockerfile для backend.
- `docker-compose.yml` для локального окружения.
- `docker-compose.prod.yml` для production-like запуска.
- `.env.production.example`.
- Production runbook.
- Backup/restore docs.
- Pre-production gate script.

### CI и проверки

- Backend tests через pytest.
- Frontend typecheck.
- Frontend production build.
- Playwright E2E.
- Env validation.
- Docker Compose config validation.
- GitHub Actions CI.

## Демо-сценарий

1. Открыть гостевое приложение:
   ```text
   http://localhost:3000/?lang=ru&currency=KZT&city=Dubai&guests=2
   ```

2. Показать поиск и каталог объектов.

3. Открыть объект и показать свободные номера.

4. Выбрать номер, даты и гостей.

5. Пройти checkout.

6. Показать payment step.

7. Завершить mock payment.

8. Показать success page.

9. Открыть guest account.

10. Показать AI-консьержа во время проживания.

11. Открыть manager-панель и показать бронирования, номера, рестораны и заявки.

## Что намеренно заглушено

### Live OpenAI

По умолчанию используется:

```env
AI_CONCIERGE_MODE=stub
OPENAI_API_KEY=
```

Это сделано специально, чтобы проект можно было безопасно демонстрировать, продавать и запускать без привязки к чужому OpenAI аккаунту.

Для live GPT нужно:

1. Добавить `OPENAI_API_KEY`.
2. Переключить `AI_CONCIERGE_MODE=live`.
3. Добавить production prompt/tool policy.
4. Добавить guardrails для бронирований, платежей и персональных данных.
5. Прогнать eval/smoke сценарии.

### Реальные платежи

По умолчанию:

```env
PAYMENT_PROVIDER=mock
NEXT_PUBLIC_PAYMENT_MODE=mock
```

Проект уже готов к provider flow, но реальные Stripe/Kaspi credentials не входят в репозиторий. Для production нужно подключить провайдера и webhook:

```text
POST /payments/webhook
```

Контракт описан в `docs/payment-webhook.md`.

## Что нужно до полноценного production

### Обязательно

- Production domain.
- TLS/HTTPS.
- Hosted Postgres.
- Реальные secrets в `.env.production`.
- Non-wildcard CORS.
- Secure cookies.
- CSRF enforcement.
- Payment webhook secret.
- Production payment provider.
- Operator legal details.
- Финальный legal review.
- Monitoring/Sentry.
- Backup schedule.

### Желательно

- Live GPT concierge с guardrails.
- Admin onboarding для новых отелей.
- Импорт номеров/цен из CSV или PMS.
- Email/SMS уведомления.
- Rate limits под реальные нагрузки.
- Ролевые права для персонала отеля.
- Audit log для manager actions.
- Более глубокая аналитика конверсии.

## Как позиционировать при продаже

StayPilot стоит продавать не как шаблон, а как рабочий product base для hospitality SaaS.

Сильные стороны:

- есть guest app;
- есть manager workspace;
- есть room inventory;
- есть checkout/payment flow;
- есть guest account;
- есть in-stay services;
- есть AI concierge UX;
- есть backend, migrations, CI и production docs;
- есть понятный путь к live OpenAI и реальным платежам.

Слабые стороны, которые нужно честно обозначать:

- нет подключенного production OpenAI ключа;
- нет production payment credentials;
- нет hosted staging/domain внутри репозитория;
- legal pages являются шаблонами;
- перед запуском нужен production hardening и smoke test на реальном окружении.

## Где продавать

### Как SaaS/MVP

- Acquire.com.
- Flippa.
- SideProjectors.
- Indie Hackers/community outreach.

### Как готовый hospitality product base

- Прямые продажи отелям.
- Апарт-отельные управляющие компании.
- Digital-агентства для отелей.
- PMS/CRM интеграторы.
- Travel SaaS команды.

### Как кодовый asset

- Flippa.
- SideProjectors.
- GitHub/private sale.
- CodeCanyon только если упаковывать проект как шаблон, но это снижает чек.

## Оценка стоимости

Без выручки проект логичнее оценивать как рабочий MVP/codebase:

- Низкий диапазон: если продавать только исходники без поддержки.
- Средний диапазон: если добавить buyer handoff, setup call и deploy help.
- Верхний диапазон: если есть hosted demo, реальные пилоты, MRR или письма заинтересованности от отелей.

Главный фактор цены — не количество кода, а доказательство, что отели или управляющие компании готовы это использовать.

## Рекомендуемый план перед продажей

1. Поднять hosted staging.
2. Залить polished demo data.
3. Сделать 5-минутный demo script.
4. Подготовить скриншоты guest app, checkout, account, manager panel.
5. Подготовить короткое видео walkthrough.
6. Обновить seller pitch.
7. Подготовить buyer handoff.
8. Проверить CI.
9. Прогнать pre-production gate.
10. Выложить на Acquire/Flippa и параллельно делать прямой outreach.

## Основные команды

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Demo data

```bash
cd backend
python scripts/seed_demo_data.py --reset
```

### Проверки

```bash
cd backend
python -m pytest -q

cd ../frontend
npm run typecheck
npm run build
npm run test:e2e
```

### Production-like запуск

```bash
copy .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

## Итог

StayPilot — это готовая основа hospitality booking SaaS: гостевой интерфейс, бронирование, оплата, кабинет, AI-консьерж, in-stay сервисы и manager-панель уже связаны в один продуктовый поток.

Для продажи проект лучше показывать как работающий MVP с production scaffolding и понятным roadmap до live GPT, реальных платежей и запуска на домене.
