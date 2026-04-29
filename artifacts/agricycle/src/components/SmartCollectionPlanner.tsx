import { useMemo } from "react";
import { motion } from "framer-motion";
import { Sparkles, CloudRain, Sun, AlertTriangle, Truck, Calendar, MapPin, Wand2 } from "lucide-react";
import { useWeatherForecast, type WeatherForecast } from "@/lib/weatherApi";
import { useLang } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface PlannerFarm {
  id: number;
  farmerName: string;
  location: string;
  biomass: number;
  lat: number;
  lng: number;
  status: string;
  holdUntilDate?: string | null;
}

interface Props {
  farms: PlannerFarm[];
  aggregatorLat: number | null;
  aggregatorLng: number | null;
  truckCapacityTons: number;
  selectedIds: number[];
  onApplySuggestion: (ids: number[]) => void;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

interface ScoredFarm {
  farm: PlannerFarm;
  distanceKm: number;
  daysToDeadline: number | null;
  urgency: number;
  score: number;
  reasons: string[];
}

function buildPlan(
  farms: PlannerFarm[],
  depot: { lat: number; lng: number },
  capacity: number,
  weather: WeatherForecast | null,
): { picks: ScoredFarm[]; rest: ScoredFarm[]; dryDays: number; rainDate: string | null; totalBiomass: number } {
  const dryDays = weather?.nextRainDays ?? 99;
  const rainDate = weather?.nextRainDate ?? null;

  const scored: ScoredFarm[] = farms
    .filter((f) => f.status === "available")
    .map((f) => {
      const distanceKm = haversineKm(depot, f);
      const daysToDeadline = f.holdUntilDate
        ? Math.max(0, Math.ceil((new Date(f.holdUntilDate).getTime() - Date.now()) / 86400000))
        : null;

      let urgency = 0;
      const reasons: string[] = [];

      if (daysToDeadline !== null) {
        if (daysToDeadline <= 1) { urgency += 80; reasons.push("Deadline ≤ 1 day"); }
        else if (daysToDeadline <= 3) { urgency += 50; reasons.push(`Deadline in ${daysToDeadline}d`); }
        else if (daysToDeadline <= 7) { urgency += 25; }
      }

      if (dryDays <= 1) { urgency += 60; reasons.push("Rain within 24h"); }
      else if (dryDays <= 3) { urgency += 35; reasons.push(`Rain in ${dryDays}d`); }

      if (daysToDeadline !== null && daysToDeadline <= dryDays) {
        urgency += 20;
        reasons.push("Deadline before next dry window");
      }

      const efficiency = f.biomass / Math.max(distanceKm, 1);
      if (efficiency >= 1) reasons.push("High tons/km");
      if (distanceKm <= 5) reasons.push("Very close");

      const score = urgency + efficiency * 8 + f.biomass * 0.5 - distanceKm * 0.3;

      return { farm: f, distanceKm, daysToDeadline, urgency, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const picks: ScoredFarm[] = [];
  let load = 0;
  for (const s of scored) {
    if (load + s.farm.biomass <= capacity) {
      picks.push(s);
      load += s.farm.biomass;
    }
  }
  if (picks.length === 0 && scored.length > 0) picks.push(scored[0]);

  const pickedIds = new Set(picks.map((p) => p.farm.id));
  const rest = scored.filter((s) => !pickedIds.has(s.farm.id));

  return { picks, rest, dryDays, rainDate, totalBiomass: load };
}

function dispatchAdvice(dryDays: number, picks: number): string {
  if (picks === 0) return "No available pickups in your region right now.";
  if (dryDays >= 99) return "Skies look clear all week — plan a relaxed route, fuel-efficient ordering.";
  if (dryDays === 0) return "Rain expected today. Dispatch immediately and prioritize closest stops.";
  if (dryDays === 1) return "Rain by tomorrow. Dispatch today; complete all pickups within 24h.";
  if (dryDays <= 3) return `Dry window of ${dryDays} day${dryDays === 1 ? "" : "s"}. Dispatch by tomorrow morning to clear the route safely.`;
  return `Dry window of ${dryDays} days. Schedule the run within the next ${Math.min(dryDays - 1, 5)} days to stay ahead of the weather.`;
}

export function SmartCollectionPlanner({
  farms,
  aggregatorLat,
  aggregatorLng,
  truckCapacityTons,
  selectedIds,
  onApplySuggestion,
}: Props) {
  const { t } = useLang();
  const { data: weather } = useWeatherForecast(aggregatorLat, aggregatorLng);

  const plan = useMemo(() => {
    if (aggregatorLat == null || aggregatorLng == null) return null;
    return buildPlan(farms, { lat: aggregatorLat, lng: aggregatorLng }, truckCapacityTons, weather);
  }, [farms, aggregatorLat, aggregatorLng, truckCapacityTons, weather]);

  if (!plan) {
    return (
      <div className="bg-card rounded-3xl border shadow-sm p-5 text-sm text-muted-foreground">
        Save your location to see weather-aware pickup suggestions.
      </div>
    );
  }

  const { picks, rest, dryDays, totalBiomass } = plan;
  const isUrgent = dryDays <= 2;

  const suggestionMatchesSelection =
    picks.length > 0 &&
    picks.length === selectedIds.length &&
    picks.every((p) => selectedIds.includes(p.farm.id));

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-3xl border shadow-sm overflow-hidden"
    >
      <div className={cn(
        "px-5 py-4 border-b flex items-start gap-3",
        isUrgent ? "bg-gradient-to-r from-red-50 to-orange-50" : "bg-gradient-to-r from-indigo-50 to-emerald-50",
      )}>
        <div className={cn(
          "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
          isUrgent ? "bg-red-600 text-white" : "bg-indigo-600 text-white",
        )}>
          <Wand2 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            {t("smartPlanTitle")}
            {isUrgent && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white tracking-wider">
                {t("smartPlanUrgent")}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("smartPlanDesc")}
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Weather strip */}
        <div className="flex items-center gap-3 rounded-2xl border bg-muted/30 px-4 py-3 text-sm">
          {dryDays >= 99 ? <Sun className="w-4 h-4 text-amber-600" /> : isUrgent ? <AlertTriangle className="w-4 h-4 text-red-600" /> : <CloudRain className="w-4 h-4 text-blue-600" />}
          <span className="flex-1 font-semibold text-foreground">
            {weather?.summary ?? t("smartPlanWeatherNa")}
          </span>
        </div>

        <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-3 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-foreground font-medium">{dispatchAdvice(dryDays, picks.length)}</p>
        </div>

        {/* Top picks */}
        {picks.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-foreground uppercase tracking-wider">
                {t("smartPlanRecommended")}
              </p>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                <Truck className="w-3 h-3" /> {totalBiomass.toFixed(1)}t / {truckCapacityTons}t
              </span>
            </div>
            <ul className="space-y-2">
              {picks.map((s, i) => (
                <li
                  key={s.farm.id}
                  className="flex items-start gap-3 rounded-2xl border bg-white p-3"
                >
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground truncate">{s.farm.farmerName}</span>
                      <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" /> {s.distanceKm.toFixed(1)} km
                      </span>
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        {s.farm.biomass}t
                      </span>
                      {s.daysToDeadline !== null && (
                        <span className={cn(
                          "text-[11px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5",
                          s.daysToDeadline <= 1 ? "bg-red-100 text-red-800" :
                          s.daysToDeadline <= 3 ? "bg-amber-100 text-amber-800" :
                          "bg-slate-100 text-slate-700",
                        )}>
                          <Calendar className="w-3 h-3" /> {s.daysToDeadline}d left
                        </span>
                      )}
                    </div>
                    {s.reasons.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {s.reasons.join(" · ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No available farms to pick from yet.</p>
        )}

        {rest.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">
              Wait list — {rest.length} more farm{rest.length === 1 ? "" : "s"} (over capacity / lower priority)
            </summary>
            <ul className="mt-2 space-y-1.5">
              {rest.slice(0, 6).map((s) => (
                <li key={s.farm.id} className="flex items-center gap-2 text-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                  <span className="font-semibold">{s.farm.farmerName}</span>
                  <span className="text-muted-foreground">· {s.farm.biomass}t · {s.distanceKm.toFixed(1)} km</span>
                  {s.daysToDeadline !== null && (
                    <span className="text-muted-foreground">· {s.daysToDeadline}d left</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {picks.length > 0 && (
          <button
            type="button"
            onClick={() => onApplySuggestion(picks.map((p) => p.farm.id))}
            disabled={suggestionMatchesSelection}
            className={cn(
              "w-full rounded-xl py-3 font-bold text-sm transition-colors flex items-center justify-center gap-2",
              suggestionMatchesSelection
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200 cursor-default"
                : isUrgent
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-indigo-600 hover:bg-indigo-700 text-white",
            )}
          >
            <Sparkles className="w-4 h-4" />
            {suggestionMatchesSelection ? "Suggestion already selected" : "Use this suggestion"}
          </button>
        )}
      </div>
    </motion.div>
  );
}
