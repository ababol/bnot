const STORAGE_KEY = "bnot:soundEnabled";

export function isSoundEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

export function setSoundEnabled(on: boolean) {
  localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
}

export function playSound(src: string) {
  if (!isSoundEnabled()) return;
  new Audio(src).play().catch(() => {});
}
