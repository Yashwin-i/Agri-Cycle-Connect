import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import translations, { type Locale, type TranslationKey } from "@/lib/i18n";

interface LanguageContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, ...args: any[]) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "agricycle_locale";

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "hi") return stored;
  } catch { /* private browsing — no localStorage */ }
  return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const translate = useCallback(
    (key: TranslationKey, ...args: any[]): string => {
      const val =
        (translations[locale] as any)[key] ??
        (translations.en as any)[key];
      if (typeof val === "function") return val(...args);
      return val ?? key;
    },
    [locale],
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t: translate }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used inside <LanguageProvider>");
  return ctx;
}
