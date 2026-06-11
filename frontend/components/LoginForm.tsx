"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Lang = "en" | "ru";
type Currency = "KZT" | "USD";

export default function LoginForm({ lang, currency }: { lang: Lang; currency: Currency }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const tr =
    lang === "ru"
      ? {
          password: "Пароль",
          submit: "Войти",
          authFailed: "Неверные данные или email не подтвержден",
        }
      : {
          password: "Password",
          submit: "Sign in",
          authFailed: "Invalid credentials or email is not verified",
        };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const formData = new URLSearchParams();
      formData.append("username", email);
      formData.append("password", password);

      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.error?.message || payload?.detail || tr.authFailed;
        setError(String(detail));
        return;
      }

      await response.json().catch(() => null);
      router.push(`/manager?lang=${lang}&currency=${currency}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="booking-form" noValidate>
      <label className="field-stack">
        <span>Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field-stack">
        <span>{tr.password}</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" disabled={submitting}>{submitting ? "..." : tr.submit}</button>
      {error ? <p className="warn-text">{error}</p> : null}
    </form>
  );
}
