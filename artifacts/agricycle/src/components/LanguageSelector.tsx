import { useLang } from "@/contexts/LanguageContext";
import { LOCALE_LABELS, LOCALE_FLAGS, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LOCALES: Locale[] = ["en", "hi"];

interface LanguageSelectorProps {
  compact?: boolean;
  className?: string;
}

export function LanguageSelector({ compact = false, className }: LanguageSelectorProps) {
  const { locale, setLocale } = useLang();

  return (
    <div
      role="radiogroup"
      aria-label="Select language"
      className={cn(
        "flex items-center gap-1.5 rounded-2xl bg-muted/60 p-1 border border-border",
        className,
      )}
    >
      {LOCALES.map((l) => {
        const active = locale === l;
        return (
          <button
            key={l}
            role="radio"
            aria-checked={active}
            onClick={() => setLocale(l)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-all duration-200 min-h-[44px]",
              active
                ? "bg-primary text-white shadow-sm shadow-primary/30"
                : "text-muted-foreground hover:text-foreground hover:bg-background",
              compact && "px-2 py-1.5 text-xs min-h-[36px]",
            )}
          >
            <span aria-hidden="true">{LOCALE_FLAGS[l]}</span>
            <span>{LOCALE_LABELS[l]}</span>
          </button>
        );
      })}
    </div>
  );
}
