const DEFAULT_API_MEDIA_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function resolveMediaUrl(path: string | null | undefined, base = DEFAULT_API_MEDIA_BASE): string | null {
  if (!path) return null;
  if (/^(https?:)?\/\//i.test(path) || /^(data|blob):/i.test(path)) return path;
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
