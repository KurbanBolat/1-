import { defineConfig, devices } from "@playwright/test";

const PYTHON_BIN = process.env.PW_PYTHON_BIN || "C:\\Python313\\python.exe";
const BACKEND_SERVER_CMD =
  process.env.PW_BACKEND_SERVER_CMD ||
  `${PYTHON_BIN} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: BACKEND_SERVER_CMD,
      cwd: "../backend",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        API_RATE_LIMIT_PER_MINUTE: "5000",
        API_RATE_LIMIT_WINDOW_SECONDS: "60",
        CHAT_RATE_LIMIT_PER_MINUTE: "5000",
        SEED_ADMIN_ENABLED: "true",
        SEED_ADMIN_EMAIL: "admin@local.dev",
        SEED_ADMIN_PASSWORD: "Admin12345!",
        SEED_ADMIN_FULL_NAME: "E2E Admin",
      },
    },
    {
      command: "npm run dev",
      cwd: ".",
      url: "http://localhost:3000/account?lang=ru&currency=KZT",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
