/**
 * SpeakButton.tsx — Reads a block of text aloud in the current locale
 *
 * RURAL USABILITY RATIONALE
 * ──────────────────────────
 * A prominent "Listen" button next to key instructions lets farmers who
 * struggle with on-screen reading hear the information instead.  This is
 * especially important for:
 *
 *   • Upload instructions — the farmer needs to know what kind of photo
 *     to take before they open the camera.
 *   • AI result summary — hearing "Your field has 4.5 tonnes of wheat
 *     straw worth ₹5,175" is more immediately useful than scanning a
 *     data table.
 *
 * Visual design:
 *   • Large 44 px minimum tap target (WCAG 2.5.5)
 *   • Pulsing animation while speaking so the user knows it's active
 *   • Icon changes from 🔊 to ⏹ to make stop action obvious
 *   • Shown only when the Web Speech API is available (hides on unsupported browsers)
 */

import { useTTS } from "@/hooks/useTTS";
import { useLang } from "@/contexts/LanguageContext";
import { Volume2, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpeakButtonProps {
  /** The string to speak.  Can be a React-translated string or any text. */
  text: string;
  /** Optional extra classes for the button element */
  className?: string;
  /** When true renders as a small icon button; default is a labelled pill */
  iconOnly?: boolean;
}

export function SpeakButton({ text, className, iconOnly = false }: SpeakButtonProps) {
  const { locale, t } = useLang();
  const { speak, stop, isSpeaking, isSupported } = useTTS(locale);

  if (!isSupported) return null;

  const handleClick = () => {
    if (isSpeaking) {
      stop();
    } else {
      speak(text);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isSpeaking ? "Stop reading" : t("listenButton")}
      title={isSpeaking ? "Stop" : t("listenButton")}
      className={cn(
        /*
         * Large rounded pill with a gentle green tint — recognisable as
         * an audio / assistive control without needing to read the label.
         * min-h-[44px] satisfies WCAG 2.5.5 Target Size.
         */
        "inline-flex items-center gap-2 rounded-full border font-semibold transition-all duration-200",
        "min-h-[44px] px-4 text-sm select-none",
        isSpeaking
          ? "bg-primary text-white border-primary animate-pulse shadow-md shadow-primary/30"
          : "bg-primary/8 text-primary border-primary/30 hover:bg-primary/15 hover:border-primary/50",
        iconOnly && "px-3 min-w-[44px] justify-center",
        className,
      )}
    >
      {isSpeaking ? (
        <Square className="w-4 h-4 fill-white" />
      ) : (
        <Volume2 className="w-4 h-4" />
      )}
      {!iconOnly && (
        <span>{isSpeaking ? "Stop" : t("listenButton")}</span>
      )}
    </button>
  );
}
