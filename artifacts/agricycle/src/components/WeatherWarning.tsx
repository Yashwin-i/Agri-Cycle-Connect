import { motion } from "framer-motion";
import { CloudRain, Sun, AlertTriangle, MapPin } from "lucide-react";
import { useWeatherForecast, weatherIcon, shortDay, type WeatherForecast } from "@/lib/weatherApi";
import { useLang } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Audience = "farmer" | "aggregator";

interface Props {
  lat: number | null | undefined;
  lng: number | null | undefined;
  audience: Audience;
  className?: string;
}

/**
 * Builds the localised audience-specific advice line shown under the
 * weather header. We resolve the right translation key based on the
 * audience and how soon rain is expected, then substitute {0} with the
 * day count where applicable.
 */
function audienceMessage(
  audience: Audience,
  w: WeatherForecast,
  t: (k: TranslationKey, ...args: unknown[]) => string,
): string {
  const days = w.nextRainDays;
  if (days === null) {
    return audience === "farmer" ? t("weatherFarmerClear") : t("weatherAggClear");
  }
  if (audience === "farmer") {
    if (days <= 1) return t("weatherFarmerSoon");
    if (days <= 3) return t("weatherFarmerDays").replace("{0}", String(days));
    return t("weatherFarmerLater").replace("{0}", String(days));
  }
  if (days <= 1) return t("weatherAggSoon");
  if (days <= 3) return t("weatherAggDays").replace("{0}", String(days));
  return t("weatherAggLater").replace("{0}", String(days));
}

export function WeatherWarning({ lat, lng, audience, className }: Props) {
  const { t } = useLang();
  const { data, loading, error } = useWeatherForecast(lat, lng);

  if (lat == null || lng == null) {
    return (
      <div className={cn(
        "flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm",
        className,
      )}>
        <MapPin className="w-4 h-4 text-amber-700 shrink-0" />
        <span className="font-semibold text-amber-800">
          {t("weatherSaveGpsHint")}
        </span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600", className)}>
        {t("weatherLoading")}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn("rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600", className)}>
        {t("weatherUnavailable")}
      </div>
    );
  }

  const risk = data.riskLevel;
  const colors =
    risk === "high"
      ? "from-red-50 to-orange-50 border-red-300"
      : risk === "moderate"
      ? "from-amber-50 to-yellow-50 border-amber-300"
      : "from-sky-50 to-emerald-50 border-sky-200";

  const iconColor =
    risk === "high" ? "text-red-700" : risk === "moderate" ? "text-amber-700" : "text-sky-700";

  const titleColor =
    risk === "high" ? "text-red-900" : risk === "moderate" ? "text-amber-900" : "text-slate-800";

  const HeaderIcon = data.nextRainDays === null ? Sun : risk === "high" ? AlertTriangle : CloudRain;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-2xl border bg-gradient-to-r p-4 space-y-3",
        colors,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("w-9 h-9 rounded-full bg-white/70 flex items-center justify-center shrink-0", iconColor)}>
          <HeaderIcon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn("font-bold text-sm", titleColor)}>
            {data.nextRainDays === null ? t("weatherClearTitle") : t("weatherRainTitle")}
          </p>
          <p className="text-xs text-slate-700 mt-0.5">
            {audienceMessage(audience, data, t)}
          </p>
        </div>
        {risk === "high" && (
          <span className="text-[10px] font-black px-2 py-1 rounded-full bg-red-600 text-white tracking-wider shrink-0">
            {t("weatherUrgent")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {data.days.map((d, i) => {
          const isRain = d.precipitationMm >= 1 || d.precipitationProbability >= 50;
          return (
            <div
              key={d.date}
              className={cn(
                "rounded-lg px-1 py-2 text-center text-[10px] border",
                isRain
                  ? "bg-blue-100 border-blue-200 text-blue-900"
                  : "bg-white/70 border-slate-200 text-slate-700",
              )}
            >
              <div className="font-semibold uppercase">{i === 0 ? t("weatherToday") : shortDay(d.date)}</div>
              <div className="text-base leading-tight">{weatherIcon(d.weatherCode)}</div>
              <div className="font-bold text-[10px]">{Math.round(d.tempMaxC)}°</div>
              <div className={cn("text-[9px] font-semibold", isRain ? "text-blue-700" : "text-slate-500")}>
                {d.precipitationProbability}%
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
