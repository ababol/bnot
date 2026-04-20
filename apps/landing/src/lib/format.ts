export function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export function tokenShort(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}
