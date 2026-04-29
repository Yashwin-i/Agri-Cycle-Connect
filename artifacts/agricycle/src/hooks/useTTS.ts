/**
 * useTTS.ts — Text-to-Speech hook using the Web Speech API
 *
 * RURAL USABILITY RATIONALE
 * ──────────────────────────
 * Many farmers in rural Punjab have limited reading ability or low
 * confidence reading text on a screen, especially in English.  Reading
 * key instructions and results aloud in their native language removes
 * this barrier entirely — they can listen while looking at the field.
 *
 * Implementation:
 *   • Uses window.speechSynthesis (built into all modern mobile browsers —
 *     Chrome Android, Safari iOS — no library or download needed).
 *   • Selects the best available voice for the requested BCP-47 language tag
 *     (e.g. "pa-IN" for Punjabi, "hi-IN" for Hindi).
 *   • For Hindi specifically, prefers Google Hindi voices over Microsoft
 *     because Google's mobile voices sound noticeably more natural and
 *     handle Devanagari diacritics better. Rate is also slowed for Hindi
 *     to give listeners time to absorb numerals and units (टन, रुपये).
 *   • Falls back to the device default voice if the locale voice is absent.
 *   • Exposes `speak(text)`, `stop()`, and `isSpeaking` state so the
 *     SpeakButton component can show a live pulsing indicator.
 *
 * Limitations:
 *   • Voice availability depends on the OS language pack installed on the
 *     device.  Punjabi (pa-IN) may not be available on all Android versions.
 *   • Safari requires a user gesture before the first speak() call — the
 *     SpeakButton satisfies this because it's a <button> onClick handler.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { LOCALE_BCP47, type Locale } from "@/lib/i18n";

/** Voice-name fragments we prefer, in priority order, when several
 *  voices match the target language. Google's neural mobile voices are
 *  the most natural for Indian languages by a wide margin. */
const VOICE_NAME_PREFERENCE = [
  "google",       // Google Indic neural voices — best Hindi pronunciation
  "natural",      // Some Android builds expose "Natural" voices
  "neural",
  "hi-in",
  "india",
  "microsoft",    // Microsoft Hindi (Madhur/Swara) — acceptable fallback
];

export function useTTS(locale: Locale) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    // Check support once on mount; SSR-safe
    setIsSupported(typeof window !== "undefined" && "speechSynthesis" in window);

    return () => {
      // Cancel any in-progress speech when the component unmounts
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /**
   * Selects the best available SpeechSynthesisVoice for the current locale.
   * Tries exact BCP-47 match first, then language prefix match, and within
   * each tier ranks candidates by a preferred-name list (Google > Microsoft).
   * This makes Hindi speech sound far more natural than the default.
   */
  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    const target = LOCALE_BCP47[locale];
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    /** Score a voice; higher = more preferred. */
    const score = (v: SpeechSynthesisVoice) => {
      const name = (v.name + " " + v.voiceURI).toLowerCase();
      for (let i = 0; i < VOICE_NAME_PREFERENCE.length; i++) {
        if (name.includes(VOICE_NAME_PREFERENCE[i])) {
          return VOICE_NAME_PREFERENCE.length - i;
        }
      }
      return 0;
    };

    // 1. Exact locale match (e.g. "hi-IN") — pick the best-scoring one.
    const exactMatches = voices.filter(v => v.lang === target);
    if (exactMatches.length) {
      return exactMatches.sort((a, b) => score(b) - score(a))[0];
    }

    // 2. Language-prefix match (e.g. "hi" inside "hi-Latn-IN").
    const langPrefix = target.split("-")[0];
    const prefixMatches = voices.filter(v =>
      v.lang.toLowerCase().startsWith(langPrefix.toLowerCase()),
    );
    if (prefixMatches.length) {
      return prefixMatches.sort((a, b) => score(b) - score(a))[0];
    }

    // 3. Use device default — better than silence
    return null;
  }, [locale]);

  const speak = useCallback((text: string) => {
    if (!isSupported) return;

    // Cancel any speech already in progress before starting a new one
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Voices may load asynchronously — wait for them if not yet available
    const startSpeaking = () => {
      // IMPORTANT: set lang BEFORE voice. Some engines (notably Chrome on
      // Android) ignore the voice if lang is set after, falling back to
      // the system default. This was the main reason Hindi sounded
      // robotic on phones.
      utterance.lang = LOCALE_BCP47[locale];
      const voice = pickVoice();
      if (voice) utterance.voice = voice;

      // Hindi/Punjabi TTS engines need a slower rate than English to
      // articulate Devanagari conjuncts and numerals clearly. 0.85 is the
      // sweet spot from local listening tests — slow enough to be clear,
      // fast enough not to feel sluggish to a confident listener.
      utterance.rate  = locale === "en" ? 0.95 : 0.85;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend   = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      startSpeaking();
    } else {
      // Chrome loads voices asynchronously; wait for the event
      window.speechSynthesis.addEventListener("voiceschanged", startSpeaking, { once: true });
    }
  }, [isSupported, locale, pickVoice]);

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isSupported]);

  return { speak, stop, isSpeaking, isSupported };
}
