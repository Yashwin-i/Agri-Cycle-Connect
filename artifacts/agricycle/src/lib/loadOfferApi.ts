/**
 * loadOfferApi.ts — Aggregator → Factory load offer client helpers.
 */

export interface LoadOffer {
  id: number;
  aggregatorId: number;
  aggregatorName: string;
  aggregatorPhone: string;
  aggregatorLocation: string;
  aggregatorLat: number | null;
  aggregatorLng: number | null;
  factoryId: number;
  factoryName: string;
  factoryLocation: string;
  cropType: string;
  cropIcon: string;
  quantityTons: number;
  askingPricePerTon: number;
  availableUntil: string;
  notes: string | null;
  status: "pending" | "accepted" | "rejected" | "fulfilled" | "cancelled";
  agreedPricePerTon: number | null;
  rejectionReason: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FactoryDirectoryEntry {
  id: number;
  name: string;
  location: string;
  lat: number | null;
  lng: number | null;
}

const BASE = "/api";

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `API error ${res.status}`);
  }
  return res.json();
}

export async function listFactories(): Promise<FactoryDirectoryEntry[]> {
  const data = await jfetch(`${BASE}/users/factories`);
  return data.factories;
}

export async function listLoadOffers(): Promise<LoadOffer[]> {
  const data = await jfetch(`${BASE}/load-offers`);
  return data.offers;
}

export interface CreateLoadOfferPayload {
  factoryId: number;
  cropType: string;
  cropIcon?: string;
  quantityTons: number;
  askingPricePerTon: number;
  availableUntil: string; // ISO date
  notes?: string;
}

export async function createLoadOffer(payload: CreateLoadOfferPayload): Promise<LoadOffer> {
  const data = await jfetch(`${BASE}/load-offers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.offer;
}

export async function acceptLoadOffer(id: number, agreedPricePerTon?: number): Promise<LoadOffer> {
  const data = await jfetch(`${BASE}/load-offers/${id}/accept`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agreedPricePerTon ? { agreedPricePerTon } : {}),
  });
  return data.offer;
}

export async function rejectLoadOffer(id: number, reason?: string): Promise<LoadOffer> {
  const data = await jfetch(`${BASE}/load-offers/${id}/reject`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  return data.offer;
}

export async function fulfillLoadOffer(id: number): Promise<LoadOffer> {
  const data = await jfetch(`${BASE}/load-offers/${id}/fulfill`, {
    method: "PATCH",
  });
  return data.offer;
}

export async function cancelLoadOffer(id: number): Promise<LoadOffer> {
  const data = await jfetch(`${BASE}/load-offers/${id}`, {
    method: "DELETE",
  });
  return data.offer;
}
