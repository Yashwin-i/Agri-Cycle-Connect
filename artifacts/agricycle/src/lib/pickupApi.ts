/**
 * pickupApi.ts — Client-side helpers for the pickup requests and factory demands APIs.
 */

export interface PickupRequest {
  id: number;
  farmerId: number;
  farmerName: string;
  farmerPhone: string;
  location: string;
  lat: number | null;
  lng: number | null;
  cropType: string;
  cropKey: string;
  cropIcon: string;
  biomass: number;
  fieldArea: number;
  pricePerTon: number;
  confidence: number;
  /* AI analysis snapshot — present when farmer created from AI result */
  gradeLabel: string | null;
  qualityRating: number | null;
  residueFactor: number | null;
  residueColorNotes: string | null;
  recommendation: string | null;
  bestUse: string | null;
  aiNotes: string | null;
  aiIssues: string | null;
  status: "pending" | "accepted" | "collected" | "cancelled";
  aggregatorId: number | null;
  estimatedPickup: string | null;
  holdUntilDate: string | null;
  committedPickupDate: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  compensationCredits: number;
  createdAt: string;
  updatedAt: string;
}

export interface FactoryDemand {
  id: number;
  factoryId: number;
  factoryName: string;
  factoryLocation: string;
  factoryLat: number | null;
  factoryLng: number | null;
  cropType: string;
  cropIcon: string;
  quantityTons: number;
  pricePerTon: number;
  deadline: string;
  notes: string | null;
  status: "open" | "matched" | "fulfilled" | "closed";
  agreedPrice: number | null;
  matchedAggregatorId: number | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function markDemandFulfilled(id: number): Promise<FactoryDemand> {
  const res = await fetch(`/api/factory-demands/${id}/fulfill`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Could not mark fulfilled");
  return (await res.json()).demand;
}

export interface CreatePickupPayload {
  cropType:      string;
  cropKey:       string;
  cropIcon:      string;
  biomass:       number;
  fieldArea:     number;
  pricePerTon:   number;
  confidence:    number;
  lat?:          number;
  lng?:          number;
  holdUntilDays?: number;
  gradeLabel?:        string;
  qualityRating?:     number;
  residueFactor?:     number;
  residueColorNotes?: string;
  recommendation?:    string;
  bestUse?:           string;
  aiNotes?:           string;
  aiIssues?:          string[];
}

export interface CreateDemandPayload {
  cropType:     string;
  cropIcon:     string;
  quantityTons: number;
  pricePerTon:  number;
  deadline:     string;
  notes?:       string;
}

const PICKUP_BASE  = "/api/pickup-requests";
const DEMAND_BASE  = "/api/factory-demands";

async function apiFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `API error ${res.status}`);
  }
  return res.json();
}

/* ─── Pickup Requests ─────────────────────────────────────────── */

export async function createPickupRequest(payload: CreatePickupPayload): Promise<PickupRequest> {
  const data = await apiFetch(PICKUP_BASE, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  return data.request as PickupRequest;
}

export async function listPickupRequests(): Promise<PickupRequest[]> {
  const data = await apiFetch(PICKUP_BASE);
  return data.requests as PickupRequest[];
}

export async function updatePickupStatus(
  id: number,
  status: "pending" | "accepted" | "collected" | "cancelled",
  opts?: { estimatedPickup?: string; committedPickupDate?: string; cancelReason?: string },
): Promise<PickupRequest> {
  const data = await apiFetch(`${PICKUP_BASE}/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ status, ...opts }),
  });
  return data.request as PickupRequest;
}

export async function extendPickupDeadline(id: number, extraDays: number): Promise<PickupRequest> {
  const data = await apiFetch(`${PICKUP_BASE}/${id}/extend`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ extraDays }),
  });
  return data.request as PickupRequest;
}

/* ─── Factory Demands ─────────────────────────────────────────── */

export async function listFactoryDemands(): Promise<FactoryDemand[]> {
  const data = await apiFetch(DEMAND_BASE);
  return data.demands as FactoryDemand[];
}

export async function createFactoryDemand(payload: CreateDemandPayload): Promise<FactoryDemand> {
  const data = await apiFetch(DEMAND_BASE, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  return data.demand as FactoryDemand;
}

export async function deleteFactoryDemand(id: number): Promise<void> {
  await apiFetch(`${DEMAND_BASE}/${id}`, { method: "DELETE" });
}

export async function closeFactoryDemand(id: number): Promise<FactoryDemand> {
  const data = await apiFetch(`${DEMAND_BASE}/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ status: "closed" }),
  });
  return data.demand as FactoryDemand;
}

export async function bidFactoryDemand(id: number, agreedPrice: number): Promise<FactoryDemand> {
  const data = await apiFetch(`${DEMAND_BASE}/${id}/bid`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ agreedPrice }),
  });
  return data.demand as FactoryDemand;
}

/* ─── Profile Update ──────────────────────────────────────────── */

export async function updateProfile(payload: {
  name?: string;
  location?: string;
  lat?: number | null;
  lng?: number | null;
}) {
  return apiFetch("/api/users/profile", {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
}

/* ─── Geocoding helpers ───────────────────────────────────────── */

const PUNJAB_GEO: Record<string, { lat: number; lng: number }> = {
  ludhiana:    { lat: 30.9010, lng: 75.8573 },
  amritsar:    { lat: 31.6340, lng: 74.8723 },
  jalandhar:   { lat: 31.3260, lng: 75.5762 },
  patiala:     { lat: 30.3398, lng: 76.3869 },
  bathinda:    { lat: 30.2110, lng: 74.9455 },
  mohali:      { lat: 30.7046, lng: 76.7179 },
  hoshiarpur:  { lat: 31.5143, lng: 75.9114 },
  gurdaspur:   { lat: 32.0378, lng: 75.4010 },
  firozpur:    { lat: 30.9269, lng: 74.6117 },
  faridkot:    { lat: 30.6644, lng: 74.7557 },
  moga:        { lat: 30.8174, lng: 75.1742 },
  sangrur:     { lat: 30.2496, lng: 75.8434 },
  muktsar:     { lat: 30.4743, lng: 74.5155 },
  nawanshahr:  { lat: 31.1249, lng: 76.1158 },
  kapurthala:  { lat: 31.3788, lng: 75.3814 },
  ropar:       { lat: 30.9638, lng: 76.5186 },
  fatehgarh:   { lat: 30.6364, lng: 76.3892 },
  tarn:        { lat: 31.4508, lng: 74.9276 },
  barnala:     { lat: 30.3783, lng: 75.5476 },
  pathankot:   { lat: 32.2748, lng: 75.6522 },
};

const DEFAULT_COORD = PUNJAB_GEO.ludhiana;

export function geoFromLocation(location: string): { lat: number; lng: number } {
  const lower = location.toLowerCase().replace(/[^a-z ]/g, " ");
  for (const [key, coords] of Object.entries(PUNJAB_GEO)) {
    if (lower.includes(key)) return coords;
  }
  return DEFAULT_COORD;
}

/* ─── Date helpers — shared across the whole app ──────────────── */
/**
 * Consistent date formatting site-wide. Format: "21 Apr 2026"
 */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Days remaining until the given ISO date. Negative if past. */
export function daysUntil(iso: string | Date | null | undefined): number {
  if (!iso) return 0;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

/** Convert a Date to the local YYYY-MM-DD string used by <input type="date"> */
export function toDateInputValue(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)    return "Just now";
  if (mins < 60)   return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)  return `${hours}h ago`;
  const days  = Math.floor(hours / 24);
  return `${days}d ago`;
}
