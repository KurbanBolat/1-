#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ".env.production"
DEFAULT_COMPOSE_FILE = "docker-compose.prod.yml"
DEFAULT_BACKUP_DIR = "backups"
DEFAULT_POSTGRES_SERVICE = "postgres"


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def compose_base_command(args: argparse.Namespace) -> list[str]:
    return [
        "docker",
        "compose",
        "--env-file",
        str(resolve_path(args.env_file)),
        "-f",
        str(resolve_path(args.compose_file)),
    ]


def db_config(args: argparse.Namespace) -> tuple[str, str]:
    env = parse_env_file(resolve_path(args.env_file))
    db_name = args.db_name or env.get("POSTGRES_DB") or "staypilot"
    db_user = args.db_user or env.get("POSTGRES_USER") or "staypilot"
    return db_name, db_user


def run_check(command: list[str]) -> None:
    subprocess.run(command, cwd=PROJECT_ROOT, check=True)


def command_backup(args: argparse.Namespace) -> int:
    db_name, db_user = db_config(args)
    backup_dir = resolve_path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    suffix = ".sql.gz" if args.gzip else ".sql"
    output_path = backup_dir / f"{db_name}_{timestamp}{suffix}"

    command = compose_base_command(args) + [
        "exec",
        "-T",
        args.postgres_service,
        "pg_dump",
        "-U",
        db_user,
        "-d",
        db_name,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
    ]

    print(f"Creating backup: {output_path}")
    proc = subprocess.Popen(command, cwd=PROJECT_ROOT, stdout=subprocess.PIPE, stderr=sys.stderr)
    assert proc.stdout is not None
    opener = gzip.open if args.gzip else open
    with opener(output_path, "wb") as target:
        shutil.copyfileobj(proc.stdout, target)
    return_code = proc.wait()
    if return_code != 0:
        output_path.unlink(missing_ok=True)
        print(f"Backup failed with exit code {return_code}", file=sys.stderr)
        return return_code

    print(f"Backup created: {output_path}")
    return 0


def command_list(args: argparse.Namespace) -> int:
    backup_dir = resolve_path(args.backup_dir)
    if not backup_dir.exists():
        print(f"No backup directory: {backup_dir}")
        return 0

    backups = sorted(
        [path for path in backup_dir.iterdir() if path.is_file() and (path.suffix == ".sql" or path.name.endswith(".sql.gz"))],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not backups:
        print(f"No database backups in {backup_dir}")
        return 0

    for path in backups:
        stat = path.stat()
        modified = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        print(f"{modified}  {stat.st_size:>12}  {path}")
    return 0


def command_restore(args: argparse.Namespace) -> int:
    if not args.yes:
        print("Restore is destructive. Re-run with --yes after verifying the target and backup file.", file=sys.stderr)
        return 2

    backup_path = resolve_path(args.backup_file)
    if not backup_path.exists():
        print(f"Backup file not found: {backup_path}", file=sys.stderr)
        return 1

    db_name, db_user = db_config(args)
    command = compose_base_command(args) + [
        "exec",
        "-T",
        args.postgres_service,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        db_user,
        "-d",
        db_name,
    ]

    print(f"Restoring {backup_path} into database {db_name!r} as {db_user!r}")
    proc = subprocess.Popen(command, cwd=PROJECT_ROOT, stdin=subprocess.PIPE, stderr=sys.stderr)
    assert proc.stdin is not None
    opener = gzip.open if backup_path.name.endswith(".gz") else open
    with opener(backup_path, "rb") as source:
        shutil.copyfileobj(source, proc.stdin)
    proc.stdin.close()
    return_code = proc.wait()
    if return_code != 0:
        print(f"Restore failed with exit code {return_code}", file=sys.stderr)
        return return_code

    print("Restore completed.")
    return 0


def command_check(args: argparse.Namespace) -> int:
    db_name, db_user = db_config(args)
    command = compose_base_command(args) + [
        "exec",
        "-T",
        args.postgres_service,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        db_user,
        "-d",
        db_name,
        "-c",
        "SELECT 1;",
    ]
    run_check(command)
    print("Database check passed.")
    return 0


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--compose-file", default=DEFAULT_COMPOSE_FILE)
    parser.add_argument("--backup-dir", default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--postgres-service", default=DEFAULT_POSTGRES_SERVICE)
    parser.add_argument("--db-name")
    parser.add_argument("--db-user")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="StayPilot production database maintenance.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup_parser = subparsers.add_parser("backup", help="Create a pg_dump backup through docker compose")
    add_common_args(backup_parser)
    backup_parser.add_argument("--gzip", action=argparse.BooleanOptionalAction, default=True)
    backup_parser.set_defaults(func=command_backup)

    list_parser = subparsers.add_parser("list", help="List local backup files")
    add_common_args(list_parser)
    list_parser.set_defaults(func=command_list)

    restore_parser = subparsers.add_parser("restore", help="Restore a backup through docker compose and psql")
    add_common_args(restore_parser)
    restore_parser.add_argument("backup_file")
    restore_parser.add_argument("--yes", action="store_true", help="Confirm destructive restore")
    restore_parser.set_defaults(func=command_restore)

    check_parser = subparsers.add_parser("check", help="Run SELECT 1 against the configured database")
    add_common_args(check_parser)
    check_parser.set_defaults(func=command_check)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except FileNotFoundError as exc:
        print(f"Command not found: {exc.filename}", file=sys.stderr)
        return 127
    except subprocess.CalledProcessError as exc:
        print(f"Command failed with exit code {exc.returncode}", file=sys.stderr)
        return int(exc.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
