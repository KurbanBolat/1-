#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str], *, cwd: Path = PROJECT_ROOT, env: dict[str, str] | None = None) -> None:
    printable = " ".join(command)
    print(f"\n==> {printable}")
    run_env = os.environ.copy()
    if env:
        run_env.update(env)
    if os.name == "nt":
        subprocess.run(subprocess.list2cmdline(command), cwd=cwd, env=run_env, shell=True, check=True)
    else:
        subprocess.run(command, cwd=cwd, env=run_env, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run StayPilot pre-production release gate checks.")
    parser.add_argument("--env-file", default=".env.production")
    parser.add_argument("--compose-file", default="docker-compose.prod.yml")
    parser.add_argument("--allow-placeholders", action="store_true", help="Only for .env.production.example validation")
    parser.add_argument("--backend-url", help="Backend API origin for smoke checks")
    parser.add_argument("--frontend-url", help="Frontend origin for smoke checks")
    parser.add_argument("--admin-token", help="Optional admin token for /ops/status smoke check")
    parser.add_argument("--local-checks", action="store_true", help="Run backend tests and frontend typecheck/build")
    parser.add_argument("--e2e", action="store_true", help="Run Playwright E2E tests")
    parser.add_argument("--db-check", action="store_true", help="Run SELECT 1 through docker compose postgres")
    parser.add_argument("--skip-compose", action="store_true")
    parser.add_argument("--payment-reservation-id", type=int, help="Optional reservation id for payment webhook probe")
    parser.add_argument("--payment-status", choices=["pending", "paid", "failed"], default="failed")
    parser.add_argument("--payment-amount", type=float)
    parser.add_argument("--payment-currency", default="KZT")
    parser.add_argument("--payment-method", choices=["card", "kaspi", "apple_pay"])
    parser.add_argument("--payment-expect-http-status", type=int, default=200)
    args = parser.parse_args()

    try:
        run(
            [
                sys.executable,
                "-m",
                "py_compile",
                "scripts/check_production_env.py",
                "scripts/smoke_production.py",
                "scripts/db_maintenance.py",
                "scripts/payment_webhook_probe.py",
                "scripts/preprod_gate.py",
            ]
        )

        env_check = [sys.executable, "scripts/check_production_env.py", "--file", args.env_file]
        if args.allow_placeholders:
            env_check.append("--allow-placeholders")
        run(env_check)

        if not args.skip_compose:
            run(["docker", "compose", "--env-file", args.env_file, "-f", args.compose_file, "config"])

        if args.local_checks:
            run([sys.executable, "-m", "compileall", "app", "tests", "alembic"], cwd=PROJECT_ROOT / "backend")
            run([sys.executable, "-m", "pytest", "-q"], cwd=PROJECT_ROOT / "backend")
            run(["npm", "run", "typecheck"], cwd=PROJECT_ROOT / "frontend")
            run(
                ["npm", "run", "build"],
                cwd=PROJECT_ROOT / "frontend",
                env={"NEXT_TELEMETRY_DISABLED": "1", "NEXT_PUBLIC_API_URL": args.backend_url or "http://127.0.0.1:8000"},
            )

        if args.db_check:
            run([sys.executable, "scripts/db_maintenance.py", "check", "--env-file", args.env_file])

        if args.backend_url:
            smoke = [sys.executable, "scripts/smoke_production.py", "--backend-url", args.backend_url]
            if args.frontend_url:
                smoke.extend(["--frontend-url", args.frontend_url])
            if args.admin_token:
                smoke.extend(["--admin-token", args.admin_token])
            run(smoke)

        if args.payment_reservation_id:
            if not args.backend_url:
                raise SystemExit("--backend-url is required with --payment-reservation-id")
            webhook = [
                sys.executable,
                "scripts/payment_webhook_probe.py",
                "--api-url",
                args.backend_url,
                "--env-file",
                args.env_file,
                "--reservation-id",
                str(args.payment_reservation_id),
                "--status",
                args.payment_status,
                "--currency",
                args.payment_currency,
                "--expect-http-status",
                str(args.payment_expect_http_status),
                "--yes",
            ]
            if args.payment_amount is not None:
                webhook.extend(["--amount", str(args.payment_amount)])
            if args.payment_method:
                webhook.extend(["--method", args.payment_method])
            run(webhook)

        if args.e2e:
            run(["npm", "run", "test:e2e"], cwd=PROJECT_ROOT / "frontend", env={"PW_PYTHON_BIN": "python"})

    except subprocess.CalledProcessError as exc:
        print(f"\nPre-production gate failed: {exc}", file=sys.stderr)
        return int(exc.returncode or 1)

    print("\nPre-production gate passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
