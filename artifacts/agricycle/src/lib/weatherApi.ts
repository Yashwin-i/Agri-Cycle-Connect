import { useEffect, useState } from "react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

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

export async function fetchWeatherForecast(lat: number, lng: number): Promise<WeatherForecast> {
  const res = await fetch(`${API_BASE}/weather/forecast?lat=${lat}&lng=${lng}`);
  if (!res.ok) throw new Error("Failed to fetch weather");
  return res.json();
}

export function useWeatherForecast(lat: number | null | undefined, lng: number | null | undefined) {
  const [data, setData] = useState<WeatherForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lng == null) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWeatherForecast(lat, lng)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("weather_unavailable"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lat == null ? null : Math.round(lat * 100) / 100, lng == null ? null : Math.round(lng * 100) / 100]);

  return { data, loading, error };
}

export function weatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code >= 1 && code <= 3) return "⛅";
  if (code >= 45 && code <= 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌦️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

export function shortDay(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}
