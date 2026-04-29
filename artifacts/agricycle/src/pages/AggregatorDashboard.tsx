import "leaflet/dist/leaflet.css";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Truck, MapPin, Phone, LogOut, Route, CheckCircle2,
  Clock, Wheat, Leaf, Filter, Calendar, ChevronRight,
  Zap, Navigation, PackageCheck, AlertCircle, Star,
  ArrowRight, Weight, SlidersHorizontal, Fuel, Timer,
  TrendingDown, RotateCcw, RefreshCw, UserCircle,
  Factory, ExternalLink, Info, X, FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  listPickupRequests,
  updatePickupStatus,
  type PickupRequest,
  updateProfile,
  geoFromLocation,
  formatTimeAgo,
  formatDate,
  daysUntil,
  toDateInputValue,
  listFactoryDemands,
  // bidFactoryDemand,  // replaced by chat-based negotiation
  type FactoryDemand,
} from "@/lib/pickupApi";
import { ProfilePanel } from "@/components/ProfilePanel";
import { WeatherWarning } from "@/components/WeatherWarning";
import { LocationPicker } from "@/components/LocationPicker";
import { SmartCollectionPlanner } from "@/components/SmartCollectionPlanner";
import { WeatherAlertToast } from "@/components/WeatherAlertToast";
import { useWeatherForecast } from "@/lib/weatherApi";
import { NegotiationChat } from "@/components/NegotiationChat";
import LoadOfferPanel from "@/components/LoadOfferPanel";
import { NotificationBell } from "@/components/NotificationBell";
import {
  startNegotiation,
  listNegotiations,
  type Negotiation,
} from "@/lib/negotiationApi";
import { Handshake, MessageSquare, IndianRupee } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { LanguageSelector } from "@/components/LanguageSelector";

/* ─── Farm Data ──────────────────────────────────────────────────── */
interface Farm {
  id: number;
  /** If non-null, this farm came from a real DB pickup request */
  requestId?: number;
  farmerName: string;
  farmerPhone?: string;
  location: string;
  cropType: string;
  cropIcon: string;
  biomass: number;
  quality: number;
  status: "available" | "scheduled" | "collected" | "cancelled";
  requestedAt: string;
  lat: number;
  lng: number;
  /** Latest date by which farmer needs the stubble picked up */
  holdUntilDate?: string | null;
  /** Aggregator-committed pickup date (ISO) */
  committedPickupDate?: string | null;
  cancelReason?: string | null;
  /* ── AI analysis snapshot (optional) ── */
  fieldArea?: number;
  pricePerTon?: number;
  confidence?: number;
  gradeLabel?: string | null;
  qualityRating?: number | null;
  residueFactor?: number | null;
  residueColorNotes?: string | null;
  recommendation?: string | null;
  bestUse?: string | null;
  aiNotes?: string | null;
  aiIssues?: string[];
}

const MOCK_FARMS: Farm[] = [];

// Depot: the aggregator's base of operations (Ludhiana)
const DEPOT = { lat: 30.9010, lng: 75.8573, name: "Your Base (Ludhiana)" };

/* ═══════════════════════════════════════════════════════════════════
 *  VEHICLE ROUTING PROBLEM — SIMULATION
 * ═══════════════════════════════════════════════════════════════════
 *
 * The problem being solved is a single-vehicle, single-depot VRP
 * (also known as the Travelling Salesman Problem when capacity is
 * ignored).  The goal is to find the shortest round-trip tour that
 * visits every selected farm exactly once and returns to the depot.
 *
 * Production systems (e.g. Google OR-Tools, Vroom, OptaPlanner) use
 * exact solvers or metaheuristics (Christofides, LKH-3) that scale
 * to thousands of nodes.  Here we simulate a two-phase heuristic
 * that gives near-optimal solutions for the small fleet sizes typical
 * in rural Punjab:
 *
 *   Phase 1 – Nearest-Neighbor construction heuristic  O(n²)
 *   Phase 2 – 2-opt local-search improvement          O(n² × iter)
 *
 * Reference: Applegate et al., "The Traveling Salesman Problem", 2006
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * haversineKm — great-circle distance between two GPS coordinates.
 *
 * Uses the Haversine formula which accounts for Earth's spherical
 * curvature. Accurate to ~0.3 % for distances under 500 km.
 *
 *   a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)
 *   d = 2R · atan2(√a, √(1−a))
 *
 * R = 6 371 km (mean Earth radius, IUGG standard)
 */
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const aVal =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

/**
 * buildDistanceMatrix — computes all pairwise Haversine distances.
 *
 * Returns a symmetric (n+1) × (n+1) matrix where index 0 = depot and
 * indices 1…n = farms.  Precomputing avoids redundant Haversine calls
 * inside the heuristic loops.
 */
function buildDistanceMatrix(
  farms: Farm[],
  depot: { lat: number; lng: number; name: string },
): number[][] {
  const nodes = [depot, ...farms];
  const n = nodes.length;
  const mat: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(nodes[i], nodes[j]);
      mat[i][j] = d;
      mat[j][i] = d;
    }
  }
  return mat;
}

/**
 * nearestNeighborTour — Phase 1 construction heuristic.
 *
 * Starting from the depot (index 0), greedily visits the closest
 * unvisited farm at each step.  This builds a feasible but not
 * necessarily optimal tour in O(n²) time.
 *
 * In a real VRP system this would also respect time-window constraints
 * and vehicle capacity limits per trip.
 */
function nearestNeighborTour(distMatrix: number[][]): number[] {
  const n = distMatrix.length;
  const visited = new Array(n).fill(false);
  const tour: number[] = [0]; // start at depot
  visited[0] = true;

  for (let step = 0; step < n - 1; step++) {
    const last = tour[tour.length - 1];
    let bestNext = -1;
    let bestDist = Infinity;
    for (let j = 1; j < n; j++) {
      if (!visited[j] && distMatrix[last][j] < bestDist) {
        bestDist = distMatrix[last][j];
        bestNext = j;
      }
    }
    if (bestNext !== -1) {
      tour.push(bestNext);
      visited[bestNext] = true;
    }
  }

  tour.push(0); // return to depot
  return tour;
}

/**
 * tourCost — total distance of a circular tour through the distance matrix.
 */
function tourCost(tour: number[], mat: number[][]): number {
  let total = 0;
  for (let i = 0; i < tour.length - 1; i++) {
    total += mat[tour[i]][tour[i + 1]];
  }
  return total;
}

/**
 * twoOptImprove — Phase 2 local-search improvement.
 *
 * Iteratively tries reversing every sub-segment [i+1 … j] of the tour.
 * If the reversal reduces total distance it is accepted (first-improvement
 * strategy).  Repeats until no improving swap exists (local optimum).
 *
 * Complexity: O(n² × iterations).  For n ≤ 10 this converges in
 * milliseconds.  In practice 2-opt reduces NN-tour cost by 5–20 %.
 *
 * Note: indices 0 and tour.length-1 are the depot and must stay fixed.
 */
function twoOptImprove(tour: number[], mat: number[][]): number[] {
  let best = [...tour];
  let improved = true;

  while (improved) {
    improved = false;
    // i runs from 1 (first farm) to n-2 (last farm before return)
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        // Cost of existing edges: (i-1→i) + (j→j+1)
        const currentCost =
          mat[best[i - 1]][best[i]] + mat[best[j]][best[j + 1]];
        // Cost after reversing segment i…j: (i-1→j) + (i→j+1)
        const newCost =
          mat[best[i - 1]][best[j]] + mat[best[i]][best[j + 1]];

        if (newCost < currentCost - 1e-10) {
          // Reverse the sub-segment between i and j
          const reversed = best.slice(i, j + 1).reverse();
          best = [...best.slice(0, i), ...reversed, ...best.slice(j + 1)];
          improved = true;
        }
      }
    }
  }

  return best;
}

/* ─── Route Result ───────────────────────────────────────────────── */
interface RouteLeg {
  fromLabel: string;
  toLabel: string;
  distanceKm: number;
  midLat: number;
  midLng: number;
}

interface RouteResult {
  orderedFarms: Farm[];   // farms in optimised visit order
  legs: RouteLeg[];       // per-segment distances
  totalDistanceKm: number;
  nnDistanceKm: number;   // nearest-neighbor cost before 2-opt
  estimatedTimeMin: number;
  fuelCostRs: number;
  improvement: number;    // % reduction achieved by 2-opt
}

/**
 * computeRoute — runs the full two-phase VRP and returns a RouteResult.
 *
 * Called after the user-visible loading animation completes, so the
 * "computation" appears to happen during the animated stages.
 */
function computeRoute(farms: Farm[], depot: { lat: number; lng: number; name: string }): RouteResult {
  const mat = buildDistanceMatrix(farms, depot);

  // Phase 1
  const nnTour = nearestNeighborTour(mat);
  const nnCost = tourCost(nnTour, mat);

  // Phase 2
  const optTour = twoOptImprove(nnTour, mat);
  const optCost = tourCost(optTour, mat);

  // Tour indices 1…n-1 are farm indices (0 = depot in matrix = index-1 in farms)
  const orderedFarms = optTour
    .slice(1, -1) // strip depot at both ends
    .map(i => farms[i - 1]);

  // Build leg descriptors
  const allNodes = [depot, ...farms];
  const legs: RouteLeg[] = [];
  for (let i = 0; i < optTour.length - 1; i++) {
    const from = allNodes[optTour[i]];
    const to   = allNodes[optTour[i + 1]];
    legs.push({
      fromLabel:   optTour[i] === 0 ? "Base" : (from as Farm).farmerName,
      toLabel:     optTour[i + 1] === 0 ? "Base" : (to as Farm).farmerName,
      distanceKm:  parseFloat(mat[optTour[i]][optTour[i + 1]].toFixed(1)),
      midLat:      (from.lat + to.lat) / 2,
      midLng:      (from.lng + to.lng) / 2,
    });
  }

  const improvement = nnCost > 0
    ? parseFloat((((nnCost - optCost) / nnCost) * 100).toFixed(1))
    : 0;

  // Assume avg 45 km/h on rural Punjab roads; diesel at ₹92/L, 8 km/L
  const estimatedTimeMin = Math.round((optCost / 45) * 60);
  const fuelCostRs = Math.round((optCost / 8) * 92);

  return {
    orderedFarms,
    legs,
    totalDistanceKm: parseFloat(optCost.toFixed(1)),
    nnDistanceKm:    parseFloat(nnCost.toFixed(1)),
    estimatedTimeMin,
    fuelCostRs,
    improvement,
  };
}

/* ─── VRP Simulation Stages ──────────────────────────────────────── */
const VRP_STAGES = [
  { id: "geocode",   label: "Collecting farm coordinates",  detail: "Geocoding selected farm GPS locations",           icon: "📍", durationMs: 700  },
  { id: "matrix",    label: "Computing distance matrix",    detail: "Haversine formula across all node pairs",         icon: "📐", durationMs: 900  },
  { id: "nn",        label: "Nearest-neighbor heuristic",   detail: "Greedy tour construction from depot (Phase 1)",   icon: "🔗", durationMs: 850  },
  { id: "twoopt",    label: "2-opt local search",           detail: "Improving tour with edge-swap iterations (Phase 2)", icon: "🔄", durationMs: 1000 },
  { id: "finalise",  label: "Finalising route plan",        detail: "Computing ETAs, fuel estimates, leg distances",   icon: "✅", durationMs: 500  },
];

/* ─── Helpers ────────────────────────────────────────────────────── */
function statusBadge(status: Farm["status"]) {
  const map = {
    available: { label: "Available", cls: "bg-green-100 text-green-800 border-green-200" },
    scheduled: { label: "Scheduled", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    collected: { label: "Collected", cls: "bg-muted text-muted-foreground border-border" },
    cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-800 border-red-200" },
  };
  const s = map[status];
  return <span className={cn("text-xs font-bold px-2.5 py-0.5 rounded-full border", s.cls)}>{s.label}</span>;
}

function QualityStars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(s => (
        <Star key={s} className={cn("w-3 h-3", s <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30")} />
      ))}
    </div>
  );
}

/* ─── Farm Card ──────────────────────────────────────────────────── */
function FarmCard({ farm, selected, onSelect, onSchedule, aggregatorLat, aggregatorLng, onShowDetails }: {
  farm: Farm; selected: boolean;
  aggregatorLat: number;
  aggregatorLng: number;
  onSelect: () => void; onSchedule: (farm: Farm) => void;
  onShowDetails: (farm: Farm) => void;
}) {
  const hasAi = !!(farm.gradeLabel || farm.aiNotes || farm.recommendation || farm.bestUse);
  const dist = haversineKm({ lat: aggregatorLat, lng: aggregatorLng }, farm);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${aggregatorLat},${aggregatorLng}&destination=${farm.lat},${farm.lng}&travelmode=driving`;
  const isReal = !!farm.requestId;  // true = real DB request, false = mock

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-2xl border-2 p-4 cursor-pointer transition-all duration-200 bg-card",
        selected ? "border-primary bg-primary/3 shadow-md shadow-primary/10" : "border-border hover:border-primary/40 hover:shadow-sm",
        farm.status === "collected" && "opacity-60"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0",
            selected ? "bg-primary/10" : "bg-muted")}>
            {farm.cropIcon}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-foreground leading-tight">{farm.farmerName}</p>
              {isReal && (
                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full border border-blue-200">
                  LIVE
                </span>
              )}
              {farm.gradeLabel && (
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                  farm.gradeLabel === "Premium" ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                  farm.gradeLabel === "Good"    ? "bg-green-100 text-green-800 border-green-200" :
                  farm.gradeLabel === "Average" ? "bg-amber-100 text-amber-800 border-amber-200" :
                                                  "bg-red-100 text-red-800 border-red-200")}>
                  {farm.gradeLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" /> {farm.location}
            </p>
            {isReal && farm.farmerPhone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" /> {farm.farmerPhone}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {statusBadge(farm.status)}
          {hasAi && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onShowDetails(farm); }}
              title="View AI analysis"
              aria-label="View AI analysis"
              className="text-[10px] font-bold flex items-center gap-1 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full px-2 py-0.5 transition">
              <Info className="w-3 h-3" /> AI Details
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "Crop",    value: farm.cropType.split(" ")[0] },
          { label: "Biomass", value: `${farm.biomass}t` },
          { label: "Dist.",   value: `${dist.toFixed(0)} km` },
        ].map(c => (
          <div key={c.label} className="bg-muted/50 rounded-xl p-2.5 text-center">
            <p className="text-xs text-muted-foreground font-medium mb-0.5">{c.label}</p>
            <p className="text-sm font-bold text-foreground truncate">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Date / commitment info */}
      {(farm.holdUntilDate || farm.committedPickupDate || farm.status === "cancelled") && (
        <div className="mb-3 space-y-1 text-xs">
          {farm.status === "available" && farm.holdUntilDate && (() => {
            const d = daysUntil(farm.holdUntilDate);
            const urgent = d <= 2;
            return (
              <div className={cn("flex items-center gap-1.5 font-semibold rounded-lg px-2 py-1",
                urgent ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-800 border border-amber-200")}>
                <Clock className="w-3 h-3" />
                Hold until {formatDate(farm.holdUntilDate)} · {d} day{d === 1 ? "" : "s"} left
              </div>
            );
          })()}
          {farm.status === "scheduled" && farm.committedPickupDate && (
            <div className="flex items-center gap-1.5 font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
              <Calendar className="w-3 h-3" />
              Committed: {formatDate(farm.committedPickupDate)}
            </div>
          )}
          {farm.status === "cancelled" && (
            <div className="flex items-start gap-1.5 font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>Cancelled{farm.cancelReason ? ` — ${farm.cancelReason}` : ""}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <QualityStars rating={farm.quality} />
          <span className="text-xs text-muted-foreground">{farm.requestedAt}</span>
        </div>
        {farm.status === "available" && (
          <div className="flex items-center gap-2">
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
              Maps <ExternalLink className="w-3 h-3" />
            </a>
            <button onClick={e => { e.stopPropagation(); onSchedule(farm); }}
              className="text-xs font-semibold text-indigo-700 hover:underline flex items-center gap-1">
              Schedule <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
        {farm.status === "scheduled" && (
          <span className="text-xs font-semibold text-amber-700 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Pickup set
          </span>
        )}
      </div>
    </motion.div>
  );
}

/* ─── AI Details Panel ──────────────────────────────────────────── */
function AiDetailsPanel({ farm, onClose, aggregatorLat, aggregatorLng }: {
  farm: Farm; onClose: () => void;
  aggregatorLat: number; aggregatorLng: number;
}) {
  const dist = haversineKm({ lat: aggregatorLat, lng: aggregatorLng }, farm);
  const totalValue = farm.pricePerTon ? Math.round(farm.biomass * farm.pricePerTon) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.2 }}
      className="sticky top-2 z-30 mb-4"
    >
      <div className="bg-card border-2 border-blue-300 rounded-3xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-2xl">
            {farm.cropIcon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-foreground leading-tight">{farm.farmerName}</h3>
              {farm.gradeLabel && (
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                  farm.gradeLabel === "Premium" ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                  farm.gradeLabel === "Good"    ? "bg-green-100 text-green-800 border-green-200" :
                  farm.gradeLabel === "Average" ? "bg-amber-100 text-amber-800 border-amber-200" :
                                                  "bg-red-100 text-red-800 border-red-200")}>
                  {farm.gradeLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" /> {farm.location} · {dist.toFixed(0)} km away
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-lg hover:bg-blue-100 flex items-center justify-center text-muted-foreground hover:text-foreground transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiCell label="Crop" value={farm.cropType} icon="🌾" />
            <KpiCell label="Biomass" value={`${farm.biomass} t`} icon="⚖️" />
            {farm.fieldArea != null && <KpiCell label="Field" value={`${farm.fieldArea} acre`} icon="📐" />}
            {farm.pricePerTon != null && <KpiCell label="Asking ₹/t" value={`₹${farm.pricePerTon}`} icon="💰" />}
          </div>

          {totalValue != null && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1">
                <IndianRupee className="w-3.5 h-3.5" /> Estimated lot value
              </span>
              <span className="text-base font-black text-emerald-900">
                ₹{totalValue.toLocaleString()}
              </span>
            </div>
          )}

          {/* AI quality block */}
          {(farm.qualityRating || farm.confidence != null || farm.residueColorNotes) && (
            <div className="bg-muted/30 border rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <FlaskConical className="w-3.5 h-3.5 text-blue-700" /> AI Quality Read
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {farm.qualityRating && (
                  <div className="flex items-center gap-1.5">
                    <QualityStars rating={farm.qualityRating} />
                    <span className="text-xs font-semibold text-foreground">{farm.qualityRating}/5</span>
                  </div>
                )}
                {farm.confidence != null && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    Confidence: <strong className="text-foreground">{farm.confidence}%</strong>
                  </span>
                )}
                {farm.residueFactor != null && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    Residue: <strong className="text-foreground">{farm.residueFactor} t/acre</strong>
                  </span>
                )}
              </div>
              {farm.residueColorNotes && (
                <p className="text-xs text-muted-foreground italic">"{farm.residueColorNotes}"</p>
              )}
            </div>
          )}

          {/* Best use / recommendation */}
          {(farm.bestUse || farm.recommendation) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
              {farm.bestUse && (
                <p className="text-xs font-bold text-amber-900">Best use: {farm.bestUse}</p>
              )}
              {farm.recommendation && (
                <p className="text-xs text-amber-800 leading-relaxed">{farm.recommendation}</p>
              )}
            </div>
          )}

          {/* AI notes */}
          {farm.aiNotes && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-xs font-bold text-blue-900 mb-1">Field notes</p>
              <p className="text-xs text-blue-800 leading-relaxed">{farm.aiNotes}</p>
            </div>
          )}

          {/* Issues */}
          {farm.aiIssues && farm.aiIssues.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs font-bold text-red-900 mb-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Flagged issues
              </p>
              <ul className="space-y-0.5">
                {farm.aiIssues.map((issue, i) => (
                  <li key={i} className="text-xs text-red-800 leading-relaxed">• {issue}</li>
                ))}
              </ul>
            </div>
          )}

          {!farm.aiNotes && !farm.recommendation && !farm.bestUse && !farm.gradeLabel && (
            <p className="text-xs text-muted-foreground italic text-center py-2">
              No AI analysis was attached to this request.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function KpiCell({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-muted/40 rounded-xl p-2 text-center">
      <p className="text-xs text-muted-foreground font-medium mb-0.5">{icon} {label}</p>
      <p className="text-sm font-bold text-foreground truncate">{value}</p>
    </div>
  );
}

/* ─── Map Component ──────────────────────────────────────────────── */
function AggregatorMap({ farms, factoryDemands, aggregatorLat, aggregatorLng, selectedIds, routeResult, onMapReady }: {
  farms: Farm[];
  factoryDemands: FactoryDemand[];
  aggregatorLat: number;
  aggregatorLng: number;
  selectedIds: number[];
  routeResult: RouteResult | null;
  onMapReady: () => void;
}) {
  const mapRef        = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerGroupRef = useRef<any>(null);
  const routeGroupRef = useRef<any>(null);

  // Initialise map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      if (!mapRef.current || mapInstanceRef.current) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false });
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors", maxZoom: 18,
      }).addTo(map);

      map.setView([aggregatorLat, aggregatorLng], 8);

      onMapReady();
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      if (!mapInstanceRef.current) return;

      if (markerGroupRef.current) {
        mapInstanceRef.current.removeLayer(markerGroupRef.current);
      }

      const group = L.layerGroup().addTo(mapInstanceRef.current);
      markerGroupRef.current = group;

      const depotIcon = L.divIcon({
        html: `<div style="background:#b45309;border:3px solid white;border-radius:50%;width:28px;height:28px;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:14px;">🚛</div>`,
        className: "", iconSize: [28, 28], iconAnchor: [14, 14],
      });
      L.marker([aggregatorLat, aggregatorLng], { icon: depotIcon })
        .addTo(group)
        .bindPopup(`<strong>Your Location (Depot)</strong>`);

      farms.forEach(farm => {
        const color = farm.status === "available" ? "#f59e0b" : farm.status === "scheduled" ? "#3b82f6" : "#9ca3af";
        const icon = L.divIcon({
          html: `<div style="background:${color};border:2px solid white;border-radius:50%;width:16px;height:16px;box-shadow:0 1px 4px rgba(0,0,0,.3);"></div>`,
          className: "", iconSize: [16, 16], iconAnchor: [8, 8],
        });
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${aggregatorLat},${aggregatorLng}&destination=${farm.lat},${farm.lng}&travelmode=driving`;
        L.marker([farm.lat, farm.lng], { icon })
          .addTo(group)
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:170px;">
              <strong>${farm.cropIcon} ${farm.farmerName}</strong><br/>
              <span style="color:#666;font-size:12px">${farm.location}</span><br/>
              <span style="font-size:12px">🌿 ${farm.cropType} · <strong>${farm.biomass}t</strong></span><br/>
              <a href="${mapsUrl}" target="_blank" style="font-size:11px;color:#2563eb;font-weight:600;">🗺️ Open in Google Maps</a>
            </div>
          `);
      });

      factoryDemands.forEach(d => {
        const fLat = d.factoryLat ?? geoFromLocation(d.factoryLocation).lat;
        const fLng = d.factoryLng ?? geoFromLocation(d.factoryLocation).lng;
        const factIcon = L.divIcon({
          html: `<div style="background:#6d28d9;border:2px solid white;border-radius:4px;width:18px;height:18px;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:11px;">🏭</div>`,
          className: "", iconSize: [18, 18], iconAnchor: [9, 9],
        });
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${aggregatorLat},${aggregatorLng}&destination=${fLat},${fLng}&travelmode=driving`;
        L.marker([fLat, fLng], { icon: factIcon })
          .addTo(group)
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:170px;">
              <strong>🏭 ${d.factoryName}</strong><br/>
              <span style="color:#666;font-size:12px">${d.factoryLocation}</span><br/>
              <span style="font-size:12px">Needs: <strong>${d.quantityTons}t ${d.cropType}</strong></span><br/>
              <span style="font-size:12px">Factory ask: <strong>₹${d.pricePerTon}/t</strong></span><br/>
              <a href="${mapsUrl}" target="_blank" style="font-size:11px;color:#2563eb;font-weight:600;">🗺️ Open in Google Maps</a>
            </div>
          `);
      });
    });
  }, [farms, factoryDemands, aggregatorLat, aggregatorLng]);

  // Draw / clear route whenever routeResult changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    import("leaflet").then((L) => {
      // Remove previous route layer group
      if (routeGroupRef.current) {
        mapInstanceRef.current.removeLayer(routeGroupRef.current);
        routeGroupRef.current = null;
      }

      if (!routeResult) return;

      const group = L.layerGroup().addTo(mapInstanceRef.current);
      routeGroupRef.current = group;

      const routeDepot = { lat: aggregatorLat, lng: aggregatorLng, name: "Your Location" };
      const allNodes = [routeDepot, ...routeResult.orderedFarms];
      const routeCoords: [number, number][] = [
        [aggregatorLat, aggregatorLng],
        ...routeResult.orderedFarms.map(f => [f.lat, f.lng] as [number, number]),
        [aggregatorLat, aggregatorLng],
      ];

      /*
       * Draw the optimised tour as a dashed green polyline.
       * In a production integration this would use an OSRM or Google
       * Directions API response to follow actual road geometry.
       * Here we connect GPS points directly (straight-line approximation).
       */
      L.polyline(routeCoords, {
        color: "#2d6a4f", weight: 3.5, dashArray: "10 6", opacity: 0.9,
      }).addTo(group);

      /*
       * Numbered waypoint markers — one per farm in optimised order.
       * The number tells the driver which stop to visit first, second, etc.
       */
      routeResult.orderedFarms.forEach((farm, idx) => {
        const numIcon = L.divIcon({
          html: `<div style="background:#2d6a4f;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,.35);">${idx + 1}</div>`,
          className: "", iconSize: [24, 24], iconAnchor: [12, 12],
        });
        L.marker([farm.lat, farm.lng], { icon: numIcon })
          .addTo(group)
          .bindPopup(`<strong>Stop ${idx + 1}: ${farm.farmerName}</strong><br/>${farm.cropType} · ${farm.biomass}t`);
      });

      /*
       * Per-leg distance labels — a small tooltip at each segment midpoint
       * showing the Haversine distance in km.  This gives the driver a quick
       * sense of how far the next stop is.
       */
      routeResult.legs.forEach(leg => {
        const label = L.divIcon({
          html: `<div style="background:white;border:1px solid #2d6a4f;border-radius:6px;padding:1px 5px;font-size:10px;font-weight:700;color:#2d6a4f;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2);">${leg.distanceKm} km</div>`,
          className: "", iconSize: [50, 18], iconAnchor: [25, 9],
        });
        L.marker([leg.midLat, leg.midLng], { icon: label, interactive: false }).addTo(group);
      });

      mapInstanceRef.current.fitBounds(routeCoords, { padding: [50, 50] });
    });
  }, [routeResult, aggregatorLat, aggregatorLng]);

  return (
    <div className="relative">
      <div ref={mapRef} className="w-full h-96 rounded-2xl overflow-hidden z-0" />
      <div className="absolute bottom-3 left-3 bg-card/95 backdrop-blur rounded-xl border px-3 py-2 text-xs space-y-1.5 shadow-sm">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> Available</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Scheduled</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-400 inline-block" /> Collected</div>
        <div className="flex items-center gap-2 text-primary font-semibold">
          <span className="inline-block w-5 border-t-2 border-dashed border-primary" /> Optimised Route
        </div>
      </div>
      {routeResult && (
        <div className="absolute top-3 right-3 bg-card/95 backdrop-blur rounded-xl border px-3 py-2 text-xs shadow-sm">
          <p className="font-bold text-foreground">{routeResult.totalDistanceKm} km</p>
          <p className="text-muted-foreground">total route</p>
        </div>
      )}
    </div>
  );
}

/* ─── VRP Loading Card ───────────────────────────────────────────── */
function VrpLoadingCard({ activeStage, farmCount }: { activeStage: number; farmCount: number }) {
  const { t } = useLang();
  return (
    <div className="bg-card rounded-3xl border shadow-sm">
      <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Route className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-foreground">{t("aggRouteOptTitle")}</h2>
          <p className="text-xs text-muted-foreground">VRP solver · {farmCount} farms</p>
        </div>
      </div>
      <div className="p-5 space-y-4">

        {/* Overall progress */}
        <div>
          <div className="flex justify-between text-xs font-semibold text-muted-foreground mb-2">
            <span>Vehicle routing algorithm</span>
            <span>{Math.round(((activeStage + 1) / VRP_STAGES.length) * 100)}%</span>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              animate={{ width: `${((activeStage + 1) / VRP_STAGES.length) * 100}%` }}
              transition={{ duration: 0.5 }}
              className="h-full bg-gradient-to-r from-primary to-amber-400 rounded-full"
            />
          </div>
        </div>

        {/* Stage list */}
        <div className="space-y-2.5">
          {VRP_STAGES.map((stage, i) => {
            const done    = i < activeStage;
            const active  = i === activeStage;
            const pending = i > activeStage;
            return (
              <motion.div key={stage.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: pending ? 0.35 : 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-2xl border-2 transition-all duration-300",
                  active  ? "border-primary bg-primary/4 shadow-sm" :
                  done    ? "border-green-200 bg-green-50" :
                  "border-border bg-muted/20"
                )}
              >
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-base",
                  active ? "bg-primary/15" : done ? "bg-green-100" : "bg-muted")}>
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : active ? (
                    <div className="w-4 h-4 rounded-full border-[3px] border-primary border-t-transparent animate-spin" />
                  ) : (
                    <span className="text-sm">{stage.icon}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-bold leading-tight",
                    done ? "text-green-800" : active ? "text-foreground" : "text-muted-foreground")}>
                    {stage.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{stage.detail}</p>
                </div>
                {done && <span className="text-xs font-semibold text-green-700 shrink-0">Done</span>}
                {active && <span className="text-xs font-semibold text-primary shrink-0 animate-pulse">Running</span>}
              </motion.div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Nearest-neighbor + 2-opt improvement — please wait
        </p>
      </div>
    </div>
  );
}

/* ─── Route Result Panel ─────────────────────────────────────────── */
function RouteResultPanel({
  result, aggregatorLat, aggregatorLng, onReset, weatherDryDays, weatherSummary,
  commitDate, onCommitDate, commitTime, onCommitTime,
  excludedStopIds, onToggleExclude,
  committing, commitResult, onConfirmCommit, minDate,
}: {
  result: RouteResult;
  aggregatorLat: number;
  aggregatorLng: number;
  onReset: () => void;
  weatherDryDays: number | null;
  weatherSummary: string | null;
  commitDate: string;
  onCommitDate: (d: string) => void;
  commitTime: string;
  onCommitTime: (t: string) => void;
  excludedStopIds: number[];
  onToggleExclude: (id: number) => void;
  committing: boolean;
  commitResult: { ok: number; failed: number; messages: string[] } | null;
  onConfirmCommit: () => void;
  minDate: string;
}) {
  const { t } = useLang();
  const googleRouteUrl = result.orderedFarms.length > 0
    ? `https://www.google.com/maps/dir/?api=1&origin=${aggregatorLat},${aggregatorLng}&destination=${aggregatorLat},${aggregatorLng}&waypoints=${result.orderedFarms.map(f => `${f.lat},${f.lng}`).join("|")}&travelmode=driving`
    : "";

  return (
    <div className="bg-card rounded-3xl border shadow-sm">
      <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-green-700" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-foreground">{t("routeOptimisedTitle")}</h2>
          <p className="text-xs text-muted-foreground">Nearest-neighbor + 2-opt · {result.orderedFarms.length} stops · app line is approximate</p>
        </div>
        {result.improvement > 0 && (
          <span className="text-xs font-bold bg-green-100 text-green-800 border border-green-200 px-2.5 py-1 rounded-full flex items-center gap-1">
            <TrendingDown className="w-3 h-3" /> {result.improvement}% better
          </span>
        )}
      </div>
      <div className="p-5 space-y-4">

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Approx Dist.",  value: `${result.totalDistanceKm} km`, icon: Route,  color: "bg-primary/10 text-primary"   },
            { label: "Est. Time", value: `${result.estimatedTimeMin} min`, icon: Timer, color: "bg-amber-100 text-amber-700" },
            { label: "Fuel Cost", value: `₹${result.fuelCostRs.toLocaleString()}`, icon: Fuel, color: "bg-blue-100 text-blue-700" },
          ].map(k => {
            const Icon = k.icon;
            return (
              <div key={k.label} className={cn("rounded-2xl p-3 text-center", k.color)}>
                <Icon className="w-4 h-4 mx-auto mb-1 opacity-70" />
                <p className="text-base font-black">{k.value}</p>
                <p className="text-xs font-semibold opacity-70 mt-0.5">{k.label}</p>
              </div>
            );
          })}
        </div>

        {weatherSummary && (
          <div className={cn(
            "flex items-start gap-2 p-3 rounded-xl text-xs border",
            weatherDryDays !== null && weatherDryDays <= 1
              ? "bg-red-50 border-red-200 text-red-800"
              : weatherDryDays !== null && weatherDryDays <= 3
              ? "bg-amber-50 border-amber-200 text-amber-900"
              : "bg-emerald-50 border-emerald-200 text-emerald-900",
          )}>
            {weatherDryDays !== null && weatherDryDays <= 3
              ? <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <div>
              <p className="font-bold">
                {weatherDryDays === null || weatherDryDays >= 99
                  ? "Clear weather window — flexible scheduling"
                  : weatherDryDays === 0
                  ? "Dispatch today — rain expected within hours"
                  : weatherDryDays === 1
                  ? "Dispatch today — rain expected tomorrow"
                  : `Dispatch within ${weatherDryDays - 1} day${weatherDryDays - 1 === 1 ? "" : "s"} to finish before rain`}
              </p>
              <p className="opacity-90 mt-0.5">{weatherSummary}</p>
            </div>
          </div>
        )}

        {googleRouteUrl && (
          <a
            href={googleRouteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white font-bold text-sm py-3 hover:bg-blue-700 transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open full route in Google Maps
          </a>
        )}

        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
          <Navigation className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-600" />
          <span>
            Website route lines connect GPS points for planning. Open Google Maps for road-by-road distance, then use that road distance for final diesel calculation.
          </span>
        </div>

        {/* 2-opt improvement callout */}
        {result.improvement > 0 && (
          <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800">
            <TrendingDown className="w-3.5 h-3.5 shrink-0 mt-0.5 text-green-600" />
            <span>
              2-opt improved the nearest-neighbor tour by <strong>{result.improvement}%</strong>,
              saving <strong>{(result.nnDistanceKm - result.totalDistanceKm).toFixed(1)} km</strong> vs. the greedy solution.
            </span>
          </div>
        )}

        {/* Stop-by-stop itinerary with leg distances */}
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">Pickup Itinerary</p>
          <div className="space-y-1.5">
            {/* Depot start */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-[10px] shrink-0">🚛</span>
              <span className="font-semibold text-foreground">Start: Your saved location</span>
            </div>

            {result.legs.slice(0, -1).map((leg, i) => {
              const farm = result.orderedFarms[i];
              const prevNode = i === 0
                ? { lat: aggregatorLat, lng: aggregatorLng }
                : { lat: result.orderedFarms[i - 1]!.lat, lng: result.orderedFarms[i - 1]!.lng };
              const mapsUrl = farm
                ? `https://www.google.com/maps/dir/?api=1&origin=${prevNode.lat},${prevNode.lng}&destination=${farm.lat},${farm.lng}&travelmode=driving`
                : "";
              const excluded = farm ? excludedStopIds.includes(farm.id) : false;
              const alreadyAccepted = farm?.status === "scheduled";
              return (
                <div key={i}>
                  <div className="flex items-center gap-1.5 ml-2 text-xs text-muted-foreground my-0.5">
                    <div className="w-px h-3 bg-border mx-0.5" />
                    <ArrowRight className="w-3 h-3" />
                    <span className="font-mono font-semibold">{leg.distanceKm} km</span>
                  </div>
                  <div className={cn(
                    "flex items-center gap-2 text-sm rounded-lg px-1 py-0.5 transition-colors",
                    excluded && "opacity-50 line-through",
                    alreadyAccepted && "bg-green-50",
                  )}>
                    <span className={cn(
                      "w-5 h-5 rounded-full text-white flex items-center justify-center font-black text-[10px] shrink-0",
                      alreadyAccepted ? "bg-green-600" : "bg-primary",
                    )}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-foreground">{farm?.farmerName}</span>
                      <span className="text-xs text-muted-foreground ml-2">{farm?.biomass}t</span>
                      {alreadyAccepted && (
                        <span className="ml-2 text-[10px] font-bold text-green-700">CONFIRMED</span>
                      )}
                    </div>
                    {farm && !alreadyAccepted && !committing && (
                      <button type="button"
                        onClick={() => onToggleExclude(farm.id)}
                        title={excluded ? "Add back to commitment" : "Skip this stop when confirming"}
                        className={cn(
                          "shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 border transition-colors",
                          excluded
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                            : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
                        )}>
                        {excluded ? "Add back" : "Skip"}
                      </button>
                    )}
                    {farm && (
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                        className="shrink-0 text-[10px] text-blue-600 font-semibold flex items-center gap-0.5 hover:underline">
                        <ExternalLink className="w-2.5 h-2.5" /> Maps
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Return leg */}
            <div className="flex items-center gap-1.5 ml-2 text-xs text-muted-foreground my-0.5">
              <div className="w-px h-3 bg-border mx-0.5" />
              <ArrowRight className="w-3 h-3" />
              <span className="font-mono font-semibold">{result.legs[result.legs.length - 1]?.distanceKm} km</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-[10px] shrink-0">🚛</span>
              <span className="font-semibold text-foreground">Return: Your Base</span>
            </div>
          </div>
        </div>

        {/* ─── Accept / Confirm zone ────────────────────────────────── */}
        {(() => {
          const pendingStops  = result.orderedFarms.filter(f => f.status !== "scheduled" && f.status !== "collected");
          const willCommit    = pendingStops.filter(f => !excludedStopIds.includes(f.id));
          const allAccepted   = pendingStops.length === 0;
          return (
            <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground leading-tight">
                    {allAccepted ? "All stops confirmed" : "Confirm & accept these pickups"}
                  </p>
                  <p className="text-xs text-muted-foreground leading-tight">
                    {allAccepted
                      ? "Every farmer in this route already sees the commitment in their app."
                      : "Pick a date and time, then accept all stops in one tap. Farmers get notified instantly."}
                  </p>
                </div>
              </div>

              {!allAccepted && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pickup date</label>
                      <input type="date" value={commitDate} min={minDate}
                        onChange={(e) => onCommitDate(e.target.value)}
                        disabled={committing}
                        className="mt-1 w-full h-10 px-3 rounded-xl border border-border bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Time</label>
                      <input type="time" value={commitTime}
                        onChange={(e) => onCommitTime(e.target.value)}
                        disabled={committing}
                        className="mt-1 w-full h-10 px-3 rounded-xl border border-border bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground bg-card rounded-xl border px-3 py-2">
                    <span>Stops to accept</span>
                    <span className="font-bold text-foreground">
                      {willCommit.length} of {pendingStops.length}
                      {excludedStopIds.length > 0 && (
                        <span className="ml-2 text-red-700">· {excludedStopIds.length} skipped</span>
                      )}
                    </span>
                  </div>

                  <Button className="w-full h-12 rounded-2xl text-base font-bold gap-2"
                    onClick={onConfirmCommit}
                    disabled={committing || willCommit.length === 0}>
                    {committing ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Confirming…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        Confirm pickup ({willCommit.length} stop{willCommit.length === 1 ? "" : "s"})
                      </>
                    )}
                  </Button>
                </>
              )}

              {commitResult && (
                <div className={cn(
                  "rounded-xl border px-3 py-2 text-xs space-y-1",
                  commitResult.failed === 0
                    ? "bg-green-50 border-green-200 text-green-900"
                    : "bg-amber-50 border-amber-200 text-amber-900",
                )}>
                  <p className="font-bold">
                    {commitResult.failed === 0
                      ? `✓ ${commitResult.ok} pickup${commitResult.ok === 1 ? "" : "s"} confirmed — farmers notified`
                      : `${commitResult.ok} confirmed · ${commitResult.failed} could not be saved`}
                  </p>
                  {commitResult.messages.slice(0, 3).map((m, i) => (
                    <p key={i} className="opacity-80">• {m}</p>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        <Button variant="outline" size="sm" className="w-full rounded-xl gap-2 mt-2"
          onClick={onReset}>
          <RotateCcw className="w-3.5 h-3.5" /> Reset & Reselect Farms
        </Button>
      </div>
    </div>
  );
}

/* ─── Schedule Modal ─────────────────────────────────────────────── */
function ScheduleModal({ farm, aggregatorLat, aggregatorLng, onClose, onConfirm }: {
  farm: Farm;
  aggregatorLat: number;
  aggregatorLng: number;
  onClose: () => void;
  onConfirm: (date: string, time: string) => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const today = toDateInputValue(new Date());
  const maxDate = farm.holdUntilDate ? toDateInputValue(new Date(farm.holdUntilDate)) : undefined;
  const farmerDeadlineDays = farm.holdUntilDate ? daysUntil(farm.holdUntilDate) : null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }}
        className="bg-card rounded-3xl border shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center">
            <Calendar className="w-6 h-6 text-indigo-700" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-foreground">Commit to Pickup Date</h3>
            <p className="text-sm text-muted-foreground">{farm.farmerName} · {farm.location}</p>
          </div>
        </div>

        <div className="bg-muted/40 rounded-2xl p-4 mb-4 flex gap-4 text-sm">
          <div><span className="text-muted-foreground">Crop:</span> <strong>{farm.cropType}</strong></div>
          <div><span className="text-muted-foreground">Amount:</span> <strong>{farm.biomass}t</strong></div>
          <div><span className="text-muted-foreground">Distance:</span> <strong>{haversineKm({ lat: aggregatorLat, lng: aggregatorLng }, farm).toFixed(0)} km</strong></div>
        </div>

        {farm.holdUntilDate && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-amber-900">
                Farmer can hold until {formatDate(farm.holdUntilDate)}
                {farmerDeadlineDays !== null && farmerDeadlineDays >= 0 && ` (${farmerDeadlineDays} day${farmerDeadlineDays === 1 ? "" : "s"} left)`}
              </p>
              <p className="text-amber-800/80 text-xs mt-0.5">
                If you miss your committed date, the order auto-cancels, you get a missed-pickup mark, and the farmer receives 50 apology credits.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">Committed Pickup Date</label>
            <input type="date" min={today} max={maxDate} value={date} onChange={e => setDate(e.target.value)}
              className="w-full rounded-xl border bg-background px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 transition" />
            {date && farm.holdUntilDate && new Date(date) > new Date(farm.holdUntilDate) && (
              <p className="text-xs text-red-700 mt-1.5 font-semibold">Date is past the farmer's hold-until deadline.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">Preferred Time</label>
            <div className="grid grid-cols-4 gap-2">
              {["08:00", "10:00", "14:00", "16:00"].map(t => (
                <button key={t} onClick={() => setTime(t)}
                  className={cn("py-2.5 rounded-xl border-2 text-sm font-semibold transition-all",
                    time === t ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-border text-foreground hover:border-indigo-300")}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 rounded-xl gap-2 bg-indigo-600 hover:bg-indigo-700" disabled={!date}
            onClick={() => { if (date) onConfirm(date, time); }}>
            <CheckCircle2 className="w-4 h-4" /> Confirm Commitment
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Start Negotiation Modal ────────────────────────────────────── */
function StartNegotiationModal({ demand, onClose, onStarted }: {
  demand: FactoryDemand;
  onClose: () => void;
  onStarted: (price: number, message?: string) => void;
}) {
  const [price, setPrice] = useState(String(demand.pricePerTon));
  const [msg, setMsg]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const p = parseInt(price, 10);
  const valid = Number.isFinite(p) && p > 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/55 z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.94, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 10 }}
        className="bg-card rounded-3xl border shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center">
            <Handshake className="w-6 h-6 text-indigo-700" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-foreground">Start Negotiation</h3>
            <p className="text-sm text-muted-foreground">{demand.factoryName} · {demand.cropIcon} {demand.cropType} · {demand.quantityTons}t</p>
          </div>
        </div>

        <div className="bg-muted/40 rounded-xl p-3 mb-4 text-sm flex justify-between">
          <span className="text-muted-foreground">Factory asking</span>
          <span className="font-bold">₹{demand.pricePerTon}/ton</span>
        </div>

        <label className="block text-sm font-semibold text-foreground mb-2">Your opening offer (₹/ton)</label>
        <div className="relative mb-4">
          <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="number" min="1" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full rounded-xl border-2 bg-background pl-9 pr-3 py-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 transition" />
        </div>

        <label className="block text-sm font-semibold text-foreground mb-2">Message (optional)</label>
        <textarea rows={2} value={msg} onChange={e => setMsg(e.target.value)}
          placeholder="Hi, I can collect within 5 days at this price…"
          className="w-full rounded-xl border-2 bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 transition mb-5" />

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 rounded-xl gap-2 bg-indigo-600 hover:bg-indigo-700" disabled={!valid || submitting}
            onClick={async () => {
              if (!valid) return;
              setSubmitting(true);
              onStarted(p, msg.trim() || undefined);
            }}>
            <Handshake className="w-4 h-4" /> Send Offer & Open Chat
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Factory Demand Card ────────────────────────────────────────── */
function DemandCard({ demand, aggregatorLat, aggregatorLng, negotiation, onStartNegotiate, onOpenChat }: {
  demand: FactoryDemand;
  aggregatorLat: number;
  aggregatorLng: number;
  negotiation?: Negotiation;
  onStartNegotiate: (demand: FactoryDemand) => void;
  onOpenChat: (negotiationId: number) => void;
}) {
  const { t } = useLang();
  const factLat = demand.factoryLat ?? geoFromLocation(demand.factoryLocation).lat;
  const factLng = demand.factoryLng ?? geoFromLocation(demand.factoryLocation).lng;
  const distKm = haversineKm({ lat: aggregatorLat, lng: aggregatorLng }, { lat: factLat, lng: factLng });
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${aggregatorLat},${aggregatorLng}&destination=${factLat},${factLng}&travelmode=driving`;
  const daysLeft = Math.ceil((new Date(demand.deadline).getTime() - Date.now()) / 86400000);

  const statusColor = demand.status === "open"
    ? "bg-green-100 text-green-800 border-green-200"
    : demand.status === "matched"
    ? "bg-blue-100 text-blue-800 border-blue-200"
    : "bg-muted text-muted-foreground border-border";

  return (
    <div className="bg-card rounded-2xl border-2 border-border p-4 hover:border-primary/30 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">
            {demand.cropIcon}
          </div>
          <div>
            <p className="font-bold text-foreground leading-tight">{demand.factoryName}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" /> {demand.factoryLocation}
            </p>
          </div>
        </div>
        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize shrink-0", statusColor)}>
          {demand.status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-muted/40 rounded-xl p-2 text-center">
          <p className="text-xs text-muted-foreground font-medium mb-0.5">{t("aggCropLabel")}</p>
          <p className="text-xs font-bold text-foreground truncate">{demand.cropType}</p>
        </div>
        <div className="bg-muted/40 rounded-xl p-2 text-center">
          <p className="text-xs text-muted-foreground font-medium mb-0.5">{t("aggQtyLabel")}</p>
          <p className="text-sm font-black text-foreground">{demand.quantityTons}t</p>
        </div>
        <div className="bg-muted/40 rounded-xl p-2 text-center">
          <p className="text-xs text-muted-foreground font-medium mb-0.5">{t("aggPriceLabel")}</p>
          <p className="text-xs font-black text-foreground">₹{demand.pricePerTon}/t</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1"><Navigation className="w-3 h-3" />{distKm.toFixed(0)} km</span>
          <span className={cn("font-semibold", daysLeft <= 3 ? "text-red-600" : "text-muted-foreground")}>
            {daysLeft > 0 ? `${daysLeft}${t("aggDaysLeft")}` : t("aggExpired")}
          </span>
        </div>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1 text-blue-600 font-semibold hover:text-blue-700 transition-colors">
          <ExternalLink className="w-3 h-3" /> {t("aggMapsLabel")}
        </a>
      </div>

      {demand.notes && (
        <p className="text-xs text-muted-foreground mt-2 bg-muted/30 rounded-lg px-2.5 py-1.5 line-clamp-2">{demand.notes}</p>
      )}

      {demand.status === "open" && !negotiation && (
        <button
          onClick={() => onStartNegotiate(demand)}
          className="mt-3 w-full rounded-xl border border-indigo-300 bg-indigo-50 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1.5"
        >
          <Handshake className="w-3.5 h-3.5" /> Negotiate Price
        </button>
      )}
      {negotiation && (
        <button
          onClick={() => onOpenChat(negotiation.id)}
          className={cn("mt-3 w-full rounded-xl py-2 text-xs font-bold transition-colors flex items-center justify-center gap-1.5",
            negotiation.status === "accepted" ? "border border-green-300 bg-green-50 text-green-800 hover:bg-green-100" :
            negotiation.status === "active"   ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" :
                                                "border border-border bg-muted text-muted-foreground hover:bg-muted/70")}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          {negotiation.status === "accepted" ? `Deal at ₹${negotiation.finalPrice}/t` :
           negotiation.status === "active"   ? "Open chat" :
           negotiation.status === "rejected" ? "View (rejected)" : "View (closed)"}
        </button>
      )}
    </div>
  );
}

/* ─── Main Dashboard ─────────────────────────────────────────────── */
export default function AggregatorDashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user, isLoading, isError } = useGetMe({ query: { retry: false } });
  const { t } = useLang();

  const [farms, setFarms]         = useState<Farm[]>([]);
  const [rawRequests, setRawRequests] = useState<PickupRequest[]>([]);
  const [factoryDemands, setFactoryDemands] = useState<FactoryDemand[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [truckCapacity, setTruckCapacity] = useState("10");
  const searchRadiusKm = 250;
  const [filter, setFilter]       = useState<"all" | "available" | "scheduled">("all");
  const [schedulingFarm, setSchedulingFarm] = useState<Farm | null>(null);
  const [detailFarm, setDetailFarm]         = useState<Farm | null>(null);
  const [scheduledDates, setScheduledDates] = useState<Record<number, string>>({});
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [localUser, setLocalUser] = useState<any>(null);

  const [vrpStage, setVrpStage]       = useState<number | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);

  /* Route → commit (accept) workflow.
     After a route is generated, the aggregator picks ONE pickup date+time
     for the whole run, optionally drops stops, then formally accepts each
     remaining stop in one click. This is the moment the farmer sees their
     pickup as "confirmed". */
  const tomorrowIso = (() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [routeCommitDate, setRouteCommitDate] = useState<string>(tomorrowIso);
  const [routeCommitTime, setRouteCommitTime] = useState<string>("08:00");
  const [excludedStopIds, setExcludedStopIds] = useState<number[]>([]);
  const [committingStops,  setCommittingStops] = useState(false);
  const [commitResult,     setCommitResult]    = useState<{ ok: number; failed: number; messages: string[] } | null>(null);

  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [chatNegId,    setChatNegId]    = useState<number | null>(null);
  const [startingNegFor, setStartingNegFor] = useState<FactoryDemand | null>(null);

  const logoutMutation = useLogout({
    mutation: { onSuccess: () => { queryClient.clear(); setLocation("/"); } },
  });

  useEffect(() => { if (isError && !isLoading) setLocation("/login"); }, [isError, isLoading]);
  useEffect(() => {
    if (user && user.role !== "aggregator") {
      setLocation(user.role === "farmer" ? "/dashboard/farmer" : "/dashboard/factory");
    }
    if (user) setLocalUser(user);
  }, [user]);

  // Use aggregator's own GPS if available, else fall back to Ludhiana depot
  const aggLat = localUser?.lat ?? DEPOT.lat;
  const aggLng = localUser?.lng ?? DEPOT.lng;
  const { data: aggWeather } = useWeatherForecast(localUser?.lat ?? null, localUser?.lng ?? null);

  const loadRealRequests = async () => {
    setLoadingRequests(true);
    try {
      const [requests, demands, negs] = await Promise.all([
        listPickupRequests(),
        listFactoryDemands(),
        listNegotiations(),
      ]);
      setNegotiations(negs);
      const realFarms: Farm[] = requests.map(req => {
        const coords = geoFromLocation(req.location);
        const dbStatus: Farm["status"] =
          req.status === "accepted"  ? "scheduled"  :
          req.status === "collected" ? "collected"  :
          req.status === "cancelled" ? "cancelled"  : "available";
        return {
          id:          req.id,
          requestId:   req.id,
          farmerName:  req.farmerName,
          farmerPhone: req.farmerPhone,
          location:    req.location,
          cropType:    req.cropType,
          cropIcon:    req.cropIcon,
          biomass:     req.biomass,
          quality:     Math.max(1, Math.min(5, Math.round(req.confidence / 20))),
          status:      dbStatus,
          requestedAt: formatTimeAgo(req.createdAt),
          lat:         req.lat ?? coords.lat,
          lng:         req.lng ?? coords.lng,
          holdUntilDate:       req.holdUntilDate,
          committedPickupDate: req.committedPickupDate,
          cancelReason:        req.cancelReason,
          fieldArea:           req.fieldArea,
          pricePerTon:         req.pricePerTon,
          confidence:          req.confidence,
          gradeLabel:          req.gradeLabel,
          qualityRating:       req.qualityRating,
          residueFactor:       req.residueFactor,
          residueColorNotes:   req.residueColorNotes,
          recommendation:      req.recommendation,
          bestUse:             req.bestUse,
          aiNotes:             req.aiNotes,
          aiIssues:            req.aiIssues ? req.aiIssues.split("\n").filter(Boolean) : [],
        };
      });
      setFarms(realFarms);
      setRawRequests(requests);
      setFactoryDemands(demands);
    } catch {
      /* keep existing state on error */
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadRealRequests();
    const interval = setInterval(loadRealRequests, 12000);
    return () => clearInterval(interval);
  }, [user]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setRouteResult(null);
    setVrpStage(null);
  };

  const handleGenerateRoute = () => {
    const selected = farms.filter(f => selectedIds.includes(f.id) && f.status !== "collected");
    if (selected.length === 0) return;
    setRouteResult(null);
    setVrpStage(0);
    setExcludedStopIds([]);
    setCommitResult(null);
    let elapsed = 0;
    VRP_STAGES.forEach((stage, i) => {
      elapsed += stage.durationMs;
      setTimeout(() => {
        if (i < VRP_STAGES.length - 1) {
          setVrpStage(i + 1);
        } else {
          const result = computeRoute(selected, { lat: aggLat, lng: aggLng, name: "Your Location" });
          setRouteResult(result);
          setVrpStage(null);
        }
      }, elapsed);
    });
  };

  const handleReset = () => {
    setRouteResult(null);
    setVrpStage(null);
    setSelectedIds([]);
    setExcludedStopIds([]);
    setCommitResult(null);
  };

  /* Bulk-accept every stop in the generated route (minus excluded ones).
     Each accept goes through the same PATCH /api/pickup-requests/:id endpoint
     that the per-farm Schedule modal uses, so the farmer instantly sees
     "Confirmed for <date>" + a push notification. */
  const handleConfirmRouteStops = async () => {
    if (!routeResult) return;
    const stops = routeResult.orderedFarms.filter(
      f => !excludedStopIds.includes(f.id) && f.status !== "collected" && f.status !== "scheduled",
    );
    if (stops.length === 0) return;
    if (!routeCommitDate || !routeCommitTime) {
      setCommitResult({ ok: 0, failed: 0, messages: ["Pick a date and time first."] });
      return;
    }

    const committed = new Date(`${routeCommitDate}T${routeCommitTime}:00`);
    if (Number.isNaN(committed.getTime())) {
      setCommitResult({ ok: 0, failed: 0, messages: ["Date/time is invalid."] });
      return;
    }
    const humanLabel = `${formatDate(committed)} · ${routeCommitTime}`;

    setCommittingStops(true);
    setCommitResult(null);

    let ok = 0;
    let failed = 0;
    const messages: string[] = [];

    for (const farm of stops) {
      if (!farm.requestId) {
        failed++;
        messages.push(`${farm.farmerName}: demo entry, no live request to accept.`);
        continue;
      }
      try {
        await updatePickupStatus(farm.requestId, "accepted", {
          committedPickupDate: committed.toISOString(),
          estimatedPickup:     humanLabel,
        });
        ok++;
        // Mirror the change locally so cards flip to "scheduled" immediately.
        setFarms(prev => prev.map(f =>
          f.id === farm.id
            ? { ...f, status: "scheduled", committedPickupDate: committed.toISOString() }
            : f,
        ));
        setScheduledDates(prev => ({ ...prev, [farm.id]: humanLabel }));
      } catch (err: any) {
        failed++;
        messages.push(`${farm.farmerName}: ${err?.message ?? "could not save"}`);
      }
    }

    setCommittingStops(false);
    setCommitResult({ ok, failed, messages });
    // Refresh server state so any auto-cancel sweeps / notifications show up.
    if (ok > 0) loadRealRequests();
  };

  const handleScheduleConfirm = async (farm: Farm, date: string, time: string) => {
    const committed = new Date(`${date}T${time}:00`);
    const humanLabel = `${formatDate(committed)} · ${time}`;
    setFarms(prev => prev.map(f => f.id === farm.id ? { ...f, status: "scheduled", committedPickupDate: committed.toISOString() } : f));
    setScheduledDates(prev => ({ ...prev, [farm.id]: humanLabel }));
    setSchedulingFarm(null);
    if (farm.requestId) {
      try {
        await updatePickupStatus(farm.requestId, "accepted", {
          committedPickupDate: committed.toISOString(),
          estimatedPickup:     humanLabel,
        });
      } catch (err: any) {
        alert(err.message ?? "Could not save commitment — please try again.");
        loadRealRequests();
      }
    }
  };

  /* One-tap GPS save — runs straight from the prompt banner */
  const [savingGps, setSavingGps] = useState(false);
  const [gpsErr, setGpsErr]       = useState<string | null>(null);
  const handleQuickSaveGps = () => {
    if (!navigator.geolocation) { setGpsErr(t("geoNotSupported")); return; }
    setSavingGps(true); setGpsErr(null);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const updated = await updateProfile({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocalUser((u: any) => ({ ...u, ...updated.user }));
        } catch (e: any) {
          setGpsErr(e?.message ?? t("locationError"));
        } finally {
          setSavingGps(false);
        }
      },
      err => {
        // Surface the real Geolocation error code so the user knows what to fix.
        const code = err?.code;
        if (code === 1) {
          setGpsErr("GPS permission denied. Please allow location access for this site in your browser settings.");
        } else if (code === 2) {
          setGpsErr("Could not get your GPS signal. Move outside or near a window and try again.");
        } else if (code === 3) {
          setGpsErr("GPS request timed out. Check your signal or pin your location on the map below.");
        } else if (err?.message) {
          setGpsErr(`Could not get your location: ${err.message}`);
        } else {
          setGpsErr(t("locationError"));
        }
        setSavingGps(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  /* Find an existing negotiation that this aggregator already has on a demand */
  const myNegotiationFor = (demandId: number) =>
    negotiations.find(n => n.demandId === demandId);

  const handleStartNegotiate = (demand: FactoryDemand) => {
    setStartingNegFor(demand);
  };

  const handleOpenChat = (id: number) => setChatNegId(id);

  // Filter by aggregator search radius:
  // available pickups must be within radius. Already-scheduled/collected/cancelled
  // pickups remain visible so the aggregator can complete them.
  const hasAggLocation = localUser?.lat != null && localUser?.lng != null;
  const visibleFarms = farms.filter(f => {
    if (f.status !== "available") return true;
    if (!hasAggLocation) return true;
    const d = haversineKm({ lat: localUser!.lat!, lng: localUser!.lng! }, { lat: f.lat, lng: f.lng });
    return d <= searchRadiusKm;
  });
  const farmsOutsideRadius = farms.filter(f =>
    f.status === "available" &&
    hasAggLocation &&
    haversineKm({ lat: localUser!.lat!, lng: localUser!.lng! }, { lat: f.lat, lng: f.lng }) > searchRadiusKm
  ).length;
  const filteredFarms = visibleFarms.filter(f => filter === "all" ? true : f.status === filter);
  const selectedFarms = visibleFarms.filter(f => selectedIds.includes(f.id));
  const selectedBiomass = selectedFarms.reduce((s, f) => s + f.biomass, 0);
  const capacity    = parseFloat(truckCapacity) || 10;
  const capacityPct = Math.min((selectedBiomass / capacity) * 100, 100);

  const availableCount = visibleFarms.filter(f => f.status === "available").length;
  const scheduledCount = visibleFarms.filter(f => f.status === "scheduled").length;
  const collectedCount = visibleFarms.filter(f => f.status === "collected").length;

  const displayUser = localUser ?? user;

  const hasAggregatorGps = !!(localUser?.lat && localUser?.lng);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
          <p className="text-muted-foreground font-medium">{t("aggLoadingDash")}</p>
        </div>
      </div>
    );
  }
  if (!displayUser) return null;

  const pendingPickupCount = visibleFarms.filter(f => f.status === "available" || f.status === "scheduled").length;

  return (
    <div className="min-h-screen bg-muted/20 pb-16">

      <WeatherAlertToast
        lat={localUser?.lat ?? null}
        lng={localUser?.lng ?? null}
        pendingCount={pendingPickupCount}
        audience="aggregator"
        storageKey={`agg-weather-alert:${displayUser.id}`}
      />

      {/* Sticky header */}
      <div className="bg-card border-b sticky top-0 z-40 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-16 gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowProfile(true)}
              className="w-10 h-10 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center hover:bg-indigo-200 transition-colors">
              <Truck className="w-5 h-5 text-indigo-700" />
            </button>
            <div>
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wider leading-none mb-0.5">{t("roleAggregator")}</p>
              <p className="font-bold text-foreground leading-none">{displayUser.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSelector compact className="hidden sm:flex" />
            <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" /> {displayUser.location}
            </div>
            <NotificationBell requests={rawRequests} userId={displayUser.id} role="aggregator" />
            <button onClick={() => setShowProfile(true)}
              className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
              <UserCircle className="w-5 h-5" />
            </button>
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-muted-foreground"
              onClick={() => logoutMutation.mutate({})} isLoading={logoutMutation.isPending}>
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{t("aggSignOut")}</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="sm:hidden px-4 pt-3">
        <LanguageSelector />
      </div>

      {/* Info strip */}
      <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 text-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold"><MapPin className="w-4 h-4 opacity-75" /> {displayUser.location}</span>
          <span className="flex items-center gap-1.5 opacity-80"><Phone className="w-4 h-4" /> {displayUser.phone}</span>
          {displayUser.lat && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${displayUser.lat},${displayUser.lng}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity underline"
            >
              <Navigation className="w-4 h-4" /> {t("aggMyLocation")}
            </a>
          )}
          <span className="ml-auto font-bold hidden sm:flex items-center gap-1.5"><Leaf className="w-4 h-4 opacity-75" /> {t("aggBiomassHub")}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">

        {/* GPS Location Prompt — one-tap save, no profile/edit/pin needed */}
        {!hasAggregatorGps && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-300 rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shrink-0">
                <Navigation className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-indigo-900 text-lg mb-1">{t("aggSetLocationTitle")}</h3>
                <p className="text-sm text-indigo-800/80 mb-3">{t("aggSetLocationDesc")}</p>
                <LocationPicker
                  lat={localUser?.lat ?? null}
                  lng={localUser?.lng ?? null}
                  accent="indigo"
                  onPick={async (lat, lng) => {
                    try {
                      const updated = await updateProfile({ lat, lng });
                      setLocalUser((u: any) => ({ ...u, ...updated.user }));
                    } catch {
                      setGpsErr(t("locationError"));
                    }
                  }}
                />
                {gpsErr && <p className="text-xs text-red-700 font-semibold mt-2">{gpsErr}</p>}
              </div>
            </div>
          </motion.div>
        )}

        {hasAggregatorGps && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-2.5 text-sm">
            <CheckCircle2 className="w-4 h-4 text-indigo-700 shrink-0" />
            <span className="font-semibold text-indigo-800 flex-1">
              {t("aggLocationSaved")}: {localUser.lat.toFixed(4)}, {localUser.lng.toFixed(4)}
            </span>
            <button onClick={() => setShowProfile(true)}
              className="text-xs font-semibold text-indigo-700 hover:underline">
              {t("aggUpdateLocation")}
            </button>
          </motion.div>
        )}

        {/* Reliability badge */}
        {(() => {
          const missed = localUser?.missedPickups ?? 0;
          const fulfilledFactories = factoryDemands.filter(
            d => d.matchedAggregatorId === displayUser.id && d.status === "fulfilled"
          ).length;
          const reliable = missed === 0;
          return (
            <div className={cn("flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm",
              reliable ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200")}>
              {reliable
                ? <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0" />
                : <AlertCircle  className="w-4 h-4 text-red-700 shrink-0" />}
              <span className={cn("font-semibold flex-1", reliable ? "text-green-800" : "text-red-800")}>
                {reliable ? t("aggReliabilityGood") : t("aggReliabilityWarn")}
              </span>
              {fulfilledFactories > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {fulfilledFactories} factory deliveries
                </span>
              )}
              <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full",
                reliable ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
                {t("aggMissedPickups")}: {missed}
              </span>
            </div>
          );
        })()}

        {/* Weather warning — schedule pickups before rain */}
        <WeatherWarning
          lat={localUser?.lat ?? null}
          lng={localUser?.lng ?? null}
          audience="aggregator"
        />

        {/* Stats row */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-4">
          {[
            { label: t("aggStatAvailable"), value: availableCount, icon: Wheat,       color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
            { label: t("aggStatScheduled"), value: scheduledCount, icon: Calendar,    color: "bg-blue-50 text-blue-700 border-blue-200" },
            { label: t("aggStatCollected"), value: collectedCount, icon: PackageCheck, color: "bg-green-50 text-green-700 border-green-200" },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className={cn("rounded-2xl border p-4 sm:p-5 text-center", s.color)}>
                <Icon className="w-5 h-5 mx-auto mb-1 opacity-70" />
                <p className="text-2xl sm:text-3xl font-display font-black">{s.value}</p>
                <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mt-0.5">{s.label}</p>
              </div>
            );
          })}
        </motion.div>

        {/* Map */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-card rounded-3xl border shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Navigation className="w-5 h-5 text-indigo-700" />
            </div>
            <h2 className="text-lg font-bold text-foreground flex-1">{t("aggMapTitle")}</h2>
            {routeResult && (
              <span className="text-xs font-semibold bg-green-100 text-green-800 border border-green-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {routeResult.totalDistanceKm} km · {routeResult.orderedFarms.length} stops
              </span>
            )}
          </div>
          <div className="p-4 sm:p-5">
            <AggregatorMap
              farms={visibleFarms}
              factoryDemands={factoryDemands}
              aggregatorLat={aggLat}
              aggregatorLng={aggLng}
              selectedIds={selectedIds}
              routeResult={routeResult}
              onMapReady={() => {}}
            />
          </div>
        </motion.div>

        {/* Smart weather-aware pickup planner */}
        <SmartCollectionPlanner
          farms={visibleFarms}
          aggregatorLat={localUser?.lat ?? null}
          aggregatorLng={localUser?.lng ?? null}
          truckCapacityTons={parseFloat(truckCapacity) || 10}
          selectedIds={selectedIds}
          onApplySuggestion={(ids) => setSelectedIds(ids)}
        />

        {/* Route Optimization + Truck Capacity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Route panel */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <AnimatePresence mode="wait">
              {vrpStage !== null ? (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <VrpLoadingCard activeStage={vrpStage} farmCount={selectedIds.length} />
                </motion.div>
              ) : routeResult ? (
                <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <RouteResultPanel
                    result={routeResult}
                    aggregatorLat={aggLat}
                    aggregatorLng={aggLng}
                    onReset={handleReset}
                    weatherDryDays={aggWeather?.nextRainDays ?? null}
                    weatherSummary={aggWeather?.summary ?? null}
                    commitDate={routeCommitDate}
                    onCommitDate={setRouteCommitDate}
                    commitTime={routeCommitTime}
                    onCommitTime={setRouteCommitTime}
                    excludedStopIds={excludedStopIds}
                    onToggleExclude={(id) => setExcludedStopIds(prev =>
                      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                    committing={committingStops}
                    commitResult={commitResult}
                    onConfirmCommit={handleConfirmRouteStops}
                    minDate={toDateInputValue(new Date())}
                  />
                </motion.div>
              ) : (
                <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="bg-card rounded-3xl border shadow-sm">
                    <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Route className="w-5 h-5 text-primary" />
                      </div>
                      <h2 className="text-lg font-bold text-foreground">{t("aggRouteOptTitle")}</h2>
                    </div>
                    <div className="p-5 space-y-4">
                      <p className="text-sm text-muted-foreground">
                        {t("aggRouteOptDesc")}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {VRP_STAGES.map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-xs text-muted-foreground/70 bg-muted/30 rounded-xl px-3 py-2">
                            <span>{s.icon}</span>
                            <span className="truncate">{s.label.split(" ").slice(0, 2).join(" ")}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-muted/40 rounded-2xl p-4 space-y-2">
                        {[
                          { label: t("aggSelectedFarms"), value: selectedIds.length },
                          { label: t("aggTotalBiomass"),  value: `${selectedBiomass.toFixed(1)} t` },
                        ].map(r => (
                          <div key={r.label} className="flex justify-between text-sm">
                            <span className="text-muted-foreground font-medium">{r.label}</span>
                            <span className="font-bold text-foreground">{r.value}</span>
                          </div>
                        ))}
                      </div>
                      <Button className="w-full h-12 rounded-2xl text-base font-bold gap-2"
                        disabled={selectedIds.length === 0} onClick={handleGenerateRoute}>
                        <Zap className="w-5 h-5" /> {t("aggGenerateRoute")}
                      </Button>
                      <Button variant="outline" size="sm" className="w-full rounded-xl gap-2"
                        onClick={handleReset}>
                        <RotateCcw className="w-3.5 h-3.5" /> {t("aggResetSelection")}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Truck Capacity */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-card rounded-3xl border shadow-sm">
            <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Weight className="w-5 h-5 text-blue-700" />
              </div>
              <h2 className="text-lg font-bold text-foreground">{t("aggTruckCapTitle")}</h2>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2.5">{t("aggLoadCapacity")}</label>
                <div className="relative">
                  <input type="number" min="1" max="50" value={truckCapacity}
                    onChange={e => setTruckCapacity(e.target.value)}
                    className="w-full rounded-xl border bg-background px-4 py-3.5 pr-16 text-foreground text-xl font-bold focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">tons</span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {["5", "10", "20", "30"].map(v => (
                  <button key={v} onClick={() => setTruckCapacity(v)}
                    className={cn("py-2.5 rounded-xl border-2 text-sm font-bold transition-all",
                      truckCapacity === v ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground hover:border-primary/40")}>
                    {v}t
                  </button>
                ))}
              </div>

              {/* Search radius — fixed at 250 km */}
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-foreground">Search radius</label>
                  <span className="text-sm font-bold text-primary">{searchRadiusKm} km</span>
                </div>
                {!hasAggLocation ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 font-medium">
                    Save your GPS location in your profile to filter pickups by distance.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      Pickups farther than {searchRadiusKm} km from your hub are hidden by default.
                    </p>
                    {farmsOutsideRadius > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {farmsOutsideRadius} pickup{farmsOutsideRadius === 1 ? "" : "s"} hidden (outside {searchRadiusKm} km).
                      </p>
                    )}
                  </>
                )}
              </div>
              <div>
                <div className="flex justify-between text-sm font-semibold mb-2">
                  <span className="text-muted-foreground">{t("aggSelectedLoad")}</span>
                  <span className={cn(capacityPct > 100 ? "text-destructive" : capacityPct > 80 ? "text-amber-600" : "text-green-600")}>
                    {selectedBiomass.toFixed(1)} / {capacity} t
                  </span>
                </div>
                <div className="h-4 bg-muted rounded-full overflow-hidden">
                  <motion.div animate={{ width: `${Math.min(capacityPct, 100)}%` }} transition={{ duration: 0.5 }}
                    className={cn("h-full rounded-full",
                      capacityPct > 100 ? "bg-destructive" : capacityPct > 80 ? "bg-amber-500" : "bg-green-500")} />
                </div>
                {capacityPct > 100 && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-destructive font-medium">
                    <AlertCircle className="w-3.5 h-3.5" /> {t("aggOverloaded")}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                <div className="text-center p-3 bg-muted/40 rounded-xl">
                  <p className="text-2xl font-black text-foreground">{Math.ceil(selectedBiomass / capacity) || 0}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("aggTripsNeeded")}</p>
                </div>
                <div className="text-center p-3 bg-muted/40 rounded-xl">
                  <p className="text-xl font-black text-foreground">₹{Math.round(selectedBiomass * 950).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("aggEstRevenue")}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Deliveries — demands matched to me */}
        {(() => {
          const myDeliveries = factoryDemands.filter(d => d.matchedAggregatorId === displayUser.id && d.status !== "closed");
          const fulfilledCount = factoryDemands.filter(d => d.matchedAggregatorId === displayUser.id && d.status === "fulfilled").length;
          if (myDeliveries.length === 0) return null;
          return (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
              className="bg-card rounded-3xl border-2 border-blue-200 shadow-sm">
              <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Route className="w-5 h-5 text-blue-700" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-foreground">My Deliveries to Factories</h2>
                  <p className="text-xs text-muted-foreground">Pickup the stubble before the deadline and deliver to the factory</p>
                </div>
                {fulfilledCount > 0 && (
                  <span className="text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> {fulfilledCount} fulfilled
                  </span>
                )}
                <span className="text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-full">
                  {myDeliveries.length} active
                </span>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {myDeliveries.map(d => {
                  const fLat = d.factoryLat ?? geoFromLocation(d.factoryLocation).lat;
                  const fLng = d.factoryLng ?? geoFromLocation(d.factoryLocation).lng;
                  const dist = haversineKm({ lat: aggLat, lng: aggLng }, { lat: fLat, lng: fLng });
                  const fuel = Math.round((dist / 4) * 95); // 4 km/L · ₹95/L
                  const eta  = Math.round((dist / 35) * 60); // 35 km/h
                  const url  = `https://www.google.com/maps/dir/?api=1&origin=${aggLat},${aggLng}&destination=${fLat},${fLng}&travelmode=driving`;
                  const days = Math.ceil((new Date(d.deadline).getTime() - Date.now()) / 86400000);
                  const isFulfilled = d.status === "fulfilled";
                  const urgencyClass = isFulfilled ? "border-emerald-300 bg-emerald-50/60"
                    : days <= 1 ? "border-red-300 bg-red-50/60"
                    : days <= 3 ? "border-amber-300 bg-amber-50/60"
                    : "border-blue-200 bg-blue-50/40";
                  return (
                    <div key={d.id} className={cn("rounded-2xl border-2 p-4", urgencyClass)}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-bold text-foreground">{d.factoryName}</p>
                          <p className="text-xs text-muted-foreground">{d.factoryLocation}</p>
                        </div>
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border",
                          isFulfilled ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                      : "bg-blue-100 text-blue-800 border-blue-200")}>
                          {d.cropIcon} {d.quantityTons}t
                        </span>
                      </div>

                      {!isFulfilled && (
                        <div className={cn("mb-2 rounded-xl px-3 py-2 text-xs font-bold flex items-center justify-between border",
                          days <= 0 ? "bg-red-100 text-red-900 border-red-300" :
                          days <= 1 ? "bg-red-50 text-red-800 border-red-200" :
                          days <= 3 ? "bg-amber-50 text-amber-900 border-amber-200" :
                                      "bg-card text-foreground border-border")}>
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {days <= 0 ? "Overdue!" : `Pickup before ${formatDate(d.deadline)}`}
                          </span>
                          <span>{days <= 0 ? "" : `${days}d left`}</span>
                        </div>
                      )}
                      {isFulfilled && (
                        <div className="mb-2 rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-1.5 bg-emerald-100 text-emerald-900 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Delivered to factory{d.fulfilledAt ? ` · ${formatDate(d.fulfilledAt)}` : ""}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-card rounded-xl p-2 text-center border">
                          <p className="text-[10px] text-muted-foreground">Distance</p>
                          <p className="text-sm font-black">{dist.toFixed(0)} km</p>
                        </div>
                        <div className="bg-card rounded-xl p-2 text-center border">
                          <p className="text-[10px] text-muted-foreground">ETA</p>
                          <p className="text-sm font-black">{eta} min</p>
                        </div>
                        <div className="bg-card rounded-xl p-2 text-center border">
                          <p className="text-[10px] text-muted-foreground">Fuel</p>
                          <p className="text-sm font-black">₹{fuel}</p>
                        </div>
                      </div>
                      {d.agreedPrice && (
                        <div className="mb-2 text-xs flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
                          <span className="text-green-800 font-semibold flex items-center gap-1">
                            <Handshake className="w-3 h-3" /> Agreed
                          </span>
                          <span className="font-black text-green-900">
                            ₹{d.agreedPrice}/t · ₹{(d.agreedPrice * d.quantityTons).toLocaleString()} total
                          </span>
                        </div>
                      )}
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-white font-bold text-xs py-2 hover:bg-blue-700 transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" /> Open route in Google Maps
                      </a>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })()}

        {/* Factory Demands Section */}
        {factoryDemands.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-card rounded-3xl border shadow-sm">
            <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                <Factory className="w-5 h-5 text-slate-700" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-foreground">{t("aggFactoryReqTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("aggFactoryReqDesc")}</p>
              </div>
              <span className="text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-full">
                {factoryDemands.filter(d => d.status === "open").length} {t("aggOpenLabel")}
              </span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {factoryDemands.filter(d => d.status === "open" || myNegotiationFor(d.id)).map(d => (
                  <DemandCard key={d.id} demand={d}
                    aggregatorLat={aggLat} aggregatorLng={aggLng}
                    negotiation={myNegotiationFor(d.id)}
                    onStartNegotiate={handleStartNegotiate}
                    onOpenChat={handleOpenChat} />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Farmer Pickup Requests */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-card rounded-3xl border shadow-sm">
          <div className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-4 border-b">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
              <Wheat className="w-5 h-5 text-green-700" />
            </div>
            <h2 className="text-lg font-bold text-foreground flex-1">{t("aggFarmReqTitle")}</h2>
            <button onClick={loadRealRequests} disabled={loadingRequests}
              className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1.5 hover:bg-green-100 transition disabled:opacity-60">
              <RefreshCw className={cn("w-3.5 h-3.5", loadingRequests && "animate-spin")} />
              <span>{t("aggLiveLabel")}</span>
            </button>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              {(["all", "available", "scheduled"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                    filter === f ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40")}>
                  {f === "all" ? t("aggFilterAll") : f === "available" ? t("aggFilterAvailable") : t("aggFilterScheduled")}
                </button>
              ))}
            </div>
            {selectedIds.length > 0 && (
              <span className="text-xs font-semibold bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                {selectedIds.length} {t("aggSelectedCount")}
              </span>
            )}
          </div>

          <div className="p-5">
            <AnimatePresence>
              {detailFarm && (
                <AiDetailsPanel
                  key={detailFarm.id}
                  farm={detailFarm}
                  aggregatorLat={aggLat}
                  aggregatorLng={aggLng}
                  onClose={() => setDetailFarm(null)}
                />
              )}
            </AnimatePresence>

            {farms.length === 0 && !loadingRequests && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🌾</div>
                <p className="text-base font-semibold text-foreground mb-1">{t("aggNoRequests")}</p>
                <p className="text-sm text-muted-foreground">{t("aggNoRequestsDesc")}</p>
              </div>
            )}

            {farms.length > 0 && selectedIds.length === 0 && (
              <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-xl mb-4 text-sm text-muted-foreground">
                <SlidersHorizontal className="w-4 h-4 shrink-0" />
                {t("aggTapToSelect")}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFarms.map(farm => (
                <FarmCard key={farm.id} farm={farm}
                  selected={selectedIds.includes(farm.id)}
                  aggregatorLat={aggLat}
                  aggregatorLng={aggLng}
                  onSelect={() => {
                    if (farm.status === "collected") return;
                    toggleSelect(farm.id);
                    // Tapping the card also opens the AI details panel so the
                    // aggregator immediately sees grade, biomass, quality, notes.
                    const hasAi = !!(farm.gradeLabel || farm.aiNotes || farm.recommendation || farm.bestUse);
                    if (hasAi) setDetailFarm(prev => prev?.id === farm.id ? null : farm);
                  }}
                  onSchedule={setSchedulingFarm}
                  onShowDetails={(f) => setDetailFarm(prev => prev?.id === f.id ? null : f)}
                />
              ))}
            </div>

            {Object.keys(scheduledDates).length > 0 && (
              <div className="mt-6 border-t pt-5">
                <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" /> {t("aggUpcomingPickups")}
                </h3>
                <div className="space-y-2">
                  {Object.entries(scheduledDates).map(([id, dateStr]) => {
                    const farm = farms.find(f => f.id === parseInt(id));
                    if (!farm) return null;
                    const distKm = haversineKm({ lat: aggLat, lng: aggLng }, farm);
                    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${aggLat},${aggLng}&destination=${farm.lat},${farm.lng}&travelmode=driving`;
                    return (
                      <div key={id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{farm.cropIcon}</span>
                          <div>
                            <p className="font-semibold text-foreground">{farm.farmerName}</p>
                            <p className="text-xs text-muted-foreground">{farm.location} · {distKm.toFixed(0)} {t("aggKmAway")}</p>
                          </div>
                        </div>
                        <div className="text-right space-y-0.5">
                          <p className="font-bold text-blue-800 text-xs">{dateStr}</p>
                          <p className="text-xs text-blue-600">{farm.biomass}t</p>
                          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5 justify-end">
                            <ExternalLink className="w-2.5 h-2.5" /> {t("aggOpenInMaps")}
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        <LoadOfferPanel
          aggregatorLat={localUser?.lat ?? null}
          aggregatorLng={localUser?.lng ?? null}
        />
      </div>

      <AnimatePresence>
        {startingNegFor && (
          <StartNegotiationModal
            demand={startingNegFor}
            onClose={() => setStartingNegFor(null)}
            onStarted={async (price, msg) => {
              const demand = startingNegFor;
              setStartingNegFor(null);
              try {
                const neg = await startNegotiation(demand.id, price, msg);
                await loadRealRequests();
                setChatNegId(neg.id);
              } catch (e: any) {
                alert(e.message ?? "Could not start negotiation");
              }
            }} />
        )}
        {chatNegId !== null && (
          <NegotiationChat
            negotiationId={chatNegId}
            myRole="aggregator"
            onClose={() => { setChatNegId(null); loadRealRequests(); }}
            onUpdated={() => loadRealRequests()}
          />
        )}
        {schedulingFarm && (
          <ScheduleModal farm={schedulingFarm}
            aggregatorLat={aggLat}
            aggregatorLng={aggLng}
            onClose={() => setSchedulingFarm(null)}
            onConfirm={(d, t) => handleScheduleConfirm(schedulingFarm, d, t)} />
        )}
        {showProfile && displayUser && (
          <ProfilePanel
            user={displayUser}
            onClose={() => setShowProfile(false)}
            onUpdate={updated => setLocalUser((prev: any) => ({ ...prev, ...updated }))}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
