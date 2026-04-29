import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface CachedForecast {
  fetchedAt: number;
  data: WeatherForecast;
}

export interface WeatherDay {
  date: string;
  precipitationMm: number;
  precipitationProbability: number;
  weatherCode: number;
  tempMaxC: number;
  tempMinC: number;
}

export interface WeatherForecast {
  lat: number;
  lng: number;
  generatedAt: string;
  days: WeatherDay[];
  nextRainDate: string | null;
  nextRainDays: number | null;
  nextRainProbability: number;
  nextRainMm: number;
  rainExpectedSoon: boolean;
  riskLevel: "low" | "moderate" | "high";
  summary: string;
}

const cache = new Map<string, CachedForecast>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function buildSummary(days: WeatherDay[]): {
  nextRainDate: string | null;
  nextRainDays: number | null;
  nextRainProbability: number;
  nextRainMm: number;
  rainExpectedSoon: boolean;
  riskLevel: "low" | "moderate" | "high";
  summary: string;
} {
  let nextRainDate: string | null = null;
  let nextRainDays: number | null = null;
  let nextRainProbability = 0;
  let nextRainMm = 0;

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const isRainy = d.precipitationMm >= 1 || d.precipitationProbability >= 50;
    if (isRainy) {
      nextRainDate = d.date;
      nextRainDays = i;
      nextRainProbability = d.precipitationProbability;
      nextRainMm = d.precipitationMm;
      break;
    }
  }

  let riskLevel: "low" | "moderate" | "high" = "low";
  if (nextRainDays !== null) {
    if (nextRainDays <= 2 && (nextRainProbability >= 60 || nextRainMm >= 5)) riskLevel = "high";
    else if (nextRainDays <= 4) riskLevel = "moderate";
    else riskLevel = "low";
  }

  let summary: string;
  if (nextRainDays === null) {
    summary = "No significant rain expected in the next 7 days.";
  } else if (nextRainDays === 0) {
    summary = `Rain expected today (${nextRainProbability}% chance, ~${nextRainMm.toFixed(1)} mm).`;
  } else if (nextRainDays === 1) {
    summary = `Rain expected tomorrow (${nextRainProbability}% chance, ~${nextRainMm.toFixed(1)} mm).`;
  } else {
    summary = `Rain expected in ${nextRainDays} days (${nextRainProbability}% chance, ~${nextRainMm.toFixed(1)} mm).`;
  }

  return {
    nextRainDate,
    nextRainDays,
    nextRainProbability,
    nextRainMm,
    rainExpectedSoon: nextRainDays !== null && nextRainDays <= 3,
    riskLevel,
    summary,
  };
}

router.get("/forecast", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng query params required" });
  }

  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return res.status(502).json({ error: "Weather provider error" });
    }
    const json: any = await resp.json();
    const daily = json.daily ?? {};
    const dates: string[] = daily.time ?? [];
    const days: WeatherDay[] = dates.map((date, i) => ({
      date,
      precipitationMm: Number(daily.precipitation_sum?.[i] ?? 0),
      precipitationProbability: Number(daily.precipitation_probability_max?.[i] ?? 0),
      weatherCode: Number(daily.weathercode?.[i] ?? 0),
      tempMaxC: Number(daily.temperature_2m_max?.[i] ?? 0),
      tempMinC: Number(daily.temperature_2m_min?.[i] ?? 0),
    }));

    const summary = buildSummary(days);
    const data: WeatherForecast = {
      lat,
      lng,
      generatedAt: new Date().toISOString(),
      days,
      ...summary,
    };
    cache.set(key, { fetchedAt: Date.now(), data });
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: "Failed to fetch weather forecast" });
  }
});

export default router;
