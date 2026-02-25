import { writable } from "svelte/store";

export type Locale = "en" | "zh-CN";

const LOCALE_STORAGE_KEY = "ode.web.locale";

export const locale = writable<Locale>("en");

let initialized = false;

function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return null;
}

export function initLocale(): void {
  if (initialized) return;
  initialized = true;

  if (typeof window === "undefined") {
    locale.set("en");
    return;
  }

  const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  if (stored) {
    locale.set(stored);
    return;
  }

  const browserLocale = normalizeLocale(window.navigator.language);
  locale.set(browserLocale ?? "en");
}

export function setLocalePreference(nextLocale: Locale): void {
  locale.set(nextLocale);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  }
}
