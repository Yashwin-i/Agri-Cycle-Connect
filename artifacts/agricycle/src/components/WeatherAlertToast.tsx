import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CloudRain, AlertTriangle, X } from "lucide-react";
import { useWeatherForecast } from "@/lib/weatherApi";
import { cn } from "@/lib/utils";

interface Props {
  lat: number | null | undefined;
  lng: number | null | undefined;
  pendingCount: number;
  audience: "farmer" | "aggregator";
  storageKey: string;
}

export function WeatherAlertToast({ lat, lng, pendingCount, audience, storageKey }: Props) {
  const { data } = useWeatherForecast(lat, lng);
  const [dismissed, setDismissed] = useState(false);

  const shouldAlert =
    !!data &&
    data.nextRainDays !== null &&
    data.nextRainDays <= 2 &&
    (data.nextRainProbability >= 60 || data.nextRainMm >= 5) &&
    pendingCount > 0;

  // alert key changes when forecast date or pending count changes meaningfully
  const alertKey = data?.nextRainDate ? `${storageKey}:${data.nextRainDate}` : null;

  useEffect(() => {
    if (!alertKey) return;
    const seen = sessionStorage.getItem(alertKey);
    setDismissed(!!seen);
  }, [alertKey]);

  if (!shouldAlert || dismissed || !data || !alertKey) return null;

  const dismiss = () => {
    sessionStorage.setItem(alertKey, "1");
    setDismissed(true);
  };

  const isToday = data.nextRainDays === 0;
  const message =
    audience === "aggregator"
      ? isToday
        ? `Rain today (${data.nextRainProbability}% chance). You have ${pendingCount} pending pickup${pendingCount === 1 ? "" : "s"} — dispatch now to avoid wet stubble.`
        : `Rain in ${data.nextRainDays} day${data.nextRainDays === 1 ? "" : "s"} (${data.nextRainProbability}%). Schedule and complete your ${pendingCount} pending pickup${pendingCount === 1 ? "" : "s"} before then.`
      : isToday
      ? `Rain expected today. Lock in your ${pendingCount} pickup negotiation${pendingCount === 1 ? "" : "s"} now to protect your stubble value.`
      : `Rain in ${data.nextRainDays} day${data.nextRainDays === 1 ? "" : "s"}. Close negotiation on your ${pendingCount} pickup${pendingCount === 1 ? "" : "s"} so the buyer can collect in time.`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        className="fixed top-4 right-4 left-4 sm:left-auto sm:max-w-sm z-[60]"
      >
        <div className={cn(
          "rounded-2xl border-2 shadow-xl backdrop-blur p-4 flex items-start gap-3",
          isToday ? "bg-red-600 text-white border-red-700" : "bg-amber-500 text-white border-amber-600",
        )}>
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            {isToday ? <AlertTriangle className="w-5 h-5" /> : <CloudRain className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-xs uppercase tracking-wider opacity-90">
              {isToday ? "Weather alert · Urgent" : "Weather alert"}
            </p>
            <p className="text-sm font-semibold mt-0.5">{message}</p>
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 transition-colors flex items-center justify-center"
            aria-label="Dismiss alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
