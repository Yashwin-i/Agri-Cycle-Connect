/**
 * negotiationApi.ts — chat-based price negotiation helpers.
 */
import type { FactoryDemand } from "./pickupApi";

export interface NegotiationMessage {
  id: number;
  negotiationId: number;
  senderId: number;
  senderRole: "aggregator" | "factory";
  type: "text" | "offer" | "accept" | "reject";
  price: number | null;
  text: string | null;
  createdAt: string;
}

export interface Negotiation {
  id: number;
  demandId: number;
  aggregatorId: number;
  aggregatorName: string;
  factoryId: number;
  status: "active" | "accepted" | "rejected" | "cancelled";
  finalPrice: number | null;
  createdAt: string;
  updatedAt: string;
  demand?: FactoryDemand | null;
  messages?: NegotiationMessage[];
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

export async function startNegotiation(
  demandId: number,
  initialPrice: number,
  message?: string,
): Promise<Negotiation> {
  const data = await jfetch(`${BASE}/factory-demands/${demandId}/negotiations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initialPrice, message }),
  });
  return data.negotiation;
}

export async function listNegotiations(): Promise<Negotiation[]> {
  const data = await jfetch(`${BASE}/negotiations`);
  return data.negotiations;
}

export async function getNegotiation(id: number): Promise<Negotiation> {
  const data = await jfetch(`${BASE}/negotiations/${id}`);
  return data.negotiation;
}

export async function sendNegotiationMessage(
  id: number,
  payload: { type: "text" | "offer" | "accept" | "reject"; price?: number; text?: string },
): Promise<Negotiation> {
  const data = await jfetch(`${BASE}/negotiations/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.negotiation;
}
