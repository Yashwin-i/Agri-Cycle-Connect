/**
 * FactoryDashboard.tsx
 *
 * Factory dashboard:
 *   • Post biomass demands (free-text crop accepted)
 *   • Manage own posted demands
 *   • Chat-based price negotiations with aggregators
 *   • Map of factory location only (no farmer pickup feed)
 */
import "leaflet/dist/leaflet.css";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Factory, MapPin, Phone, LogOut, Leaf, PackagePlus, CheckCircle2,
  Trash2, X, AlertCircle, Navigation, RefreshCw,
  UserCircle, Loader2, Building2, MessageSquare, Handshake, Plus, IndianRupee, PackageCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  listFactoryDemands,
  createFactoryDemand,
  deleteFactoryDemand,
  closeFactoryDemand,
  markDemandFulfilled,
  geoFromLocation,
  formatTimeAgo,
  updateProfile,
  type FactoryDemand,
  type CreateDemandPayload,
} from "@/lib/pickupApi";
import {
  listNegotiations,
  type Negotiation,
} from "@/lib/negotiationApi";
import { NegotiationChat } from "@/components/NegotiationChat";
import IncomingLoadOffersPanel from "@/components/IncomingLoadOffersPanel";
import { ProfilePanel } from "@/components/ProfilePanel";
import { LocationPicker } from "@/components/LocationPicker";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLang } from "@/contexts/LanguageContext";
import L from "leaflet";

/* ─── GPS error helper ───────────────────────────────────────
 * Translates a GeolocationPositionError code into a clear,
 * user-facing message. The default Geolocation error callback
 * gives almost no useful info, so we surface what actually went
 * wrong (permission denied, signal unavailable, timeout, etc.).
 */
function gpsErrorMessage(err: GeolocationPositionError | unknown): string {
  const e = err as GeolocationPositionError | undefined;
  const code = e?.code;
  if (code === 1) return "GPS permission denied. Please allow location access for this site in your browser settings.";
  if (code === 2) return "Could not get your GPS signal. Move outside or near a window and try again.";
  if (code === 3) return "GPS request timed out. Check your signal or pin your location on the map below.";
  if (e?.message) return `Could not get your location: ${e.message}`;
  return "Could not access your location. Pin your location on the map below.";
}

/* ─── Crop preset list (factories may add custom crops too) ────── */
const CROP_PRESETS = [
  { label: "Wheat Straw",        icon: "🌾" },
  { label: "Paddy Stubble",      icon: "🌿" },
  { label: "Maize Stalks",       icon: "🌽" },
  { label: "Sugarcane Bagasse",  icon: "🎋" },
  { label: "Cotton Stalks",      icon: "🌸" },
  { label: "Mustard Stalks",     icon: "🌼" },
  { label: "Soybean Residue",    icon: "🫘" },
  { label: "Bajra Stalks",       icon: "🌾" },
  { label: "Jowar Stalks",       icon: "🌾" },
  { label: "Groundnut Shells",   icon: "🥜" },
];

/* ─── Factory Map (factory location only) ────────────────────────── */
function FactoryMap({ factoryLat, factoryLng, factoryName }: {
  factoryLat: number;
  factoryLng: number;
  factoryName: string;
}) {
  const mapRef     = useRef<HTMLDivElement>(null);
  const mapInstRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstRef.current) return;
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    });
    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false });
    mapInstRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 18,
    }).addTo(map);
    map.setView([factoryLat, factoryLng], 11);

    const factIcon = L.divIcon({
      html: `<div style="background:#1e3a5f;border:3px solid white;border-radius:6px;width:32px;height:32px;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:18px;">🏭</div>`,
      className: "", iconSize: [32, 32], iconAnchor: [16, 16],
    });
    L.marker([factoryLat, factoryLng], { icon: factIcon })
      .addTo(map)
      .bindPopup(`<strong>${factoryName}</strong>`)
      .openPopup();

    return () => { map.remove(); mapInstRef.current = null; };
  }, [factoryLat, factoryLng]);

  return <div ref={mapRef} className="w-full h-72 rounded-2xl overflow-hidden z-0" />;
}

/* ─── Post Demand Modal (with custom-crop support) ────────────────── */
function PostDemandModal({ onClose, onSuccess }: {
  onClose: () => void;
  onSuccess: (d: FactoryDemand) => void;
}) {
  const { t } = useLang();
  const [presetIdx, setPresetIdx]     = useState<number | null>(0);
  const [customCrop, setCustomCrop]   = useState("");
  const [customIcon, setCustomIcon]   = useState("🌾");
  const [qty, setQty]                 = useState("100");
  const [price, setPrice]             = useState("1000");
  const [deadline, setDeadline]       = useState("");
  const [notes, setNotes]             = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");
  const today = new Date().toISOString().split("T")[0];

  const usingCustom = presetIdx === null;
  const cropLabel = usingCustom ? customCrop.trim() : CROP_PRESETS[presetIdx!].label;
  const cropIcon  = usingCustom ? (customIcon || "🌾") : CROP_PRESETS[presetIdx!].icon;

  const handlePost = async () => {
    setError("");
    if (!cropLabel || cropLabel.length < 2) { setError(t("facModalErrCrop")); return; }
    if (!deadline) { setError(t("facModalErrDeadline")); return; }
    if (!qty || parseFloat(qty) <= 0) { setError(t("facModalErrQty")); return; }
    setSaving(true);
    try {
      const payload: CreateDemandPayload = {
        cropType:     cropLabel,
        cropIcon,
        quantityTons: parseFloat(qty),
        pricePerTon:  parseFloat(price),
        deadline,
        notes:        notes || undefined,
      };
      const demand = await createFactoryDemand(payload);
      onSuccess(demand);
    } catch (err: any) {
      setError(err.message ?? t("facModalErrFail"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <motion.div initial={{ y: "100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }} transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="bg-card rounded-t-3xl sm:rounded-3xl border shadow-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
            <PackagePlus className="w-6 h-6 text-slate-700" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-foreground">{t("facModalTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("facModalSubtitle")}</p>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 pt-4 space-y-5">
          {/* Crop selector */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">{t("facModalCropType")}</label>
            <div className="grid grid-cols-2 gap-2">
              {CROP_PRESETS.map((c, i) => (
                <button key={c.label} onClick={() => setPresetIdx(i)}
                  className={cn("flex items-center gap-2.5 p-3 rounded-xl border-2 text-left transition-all",
                    presetIdx === i ? "border-primary bg-primary/5" : "border-border hover:border-primary/30")}>
                  <span className="text-xl shrink-0">{c.icon}</span>
                  <span className="text-sm font-semibold text-foreground leading-tight">{c.label}</span>
                </button>
              ))}
              <button onClick={() => setPresetIdx(null)}
                className={cn("flex items-center gap-2.5 p-3 rounded-xl border-2 border-dashed text-left transition-all",
                  usingCustom ? "border-primary bg-primary/5" : "border-border hover:border-primary/30")}>
                <Plus className="w-4 h-4 shrink-0 text-primary" />
                <span className="text-sm font-semibold text-foreground leading-tight">{t("facModalAddCustom")}</span>
              </button>
            </div>
            {usingCustom && (
              <div className="mt-3 grid grid-cols-[1fr_80px] gap-2">
                <input type="text" placeholder={t("facModalCustomPh")}
                  value={customCrop} onChange={e => setCustomCrop(e.target.value)}
                  className="rounded-xl border-2 border-border focus:border-primary outline-none px-3 py-2.5 text-sm font-semibold bg-background" />
                <input type="text" placeholder="🌾" maxLength={2}
                  value={customIcon} onChange={e => setCustomIcon(e.target.value)}
                  className="rounded-xl border-2 border-border focus:border-primary outline-none px-3 py-2.5 text-center text-lg bg-background" />
              </div>
            )}
          </div>

          {/* Quantity + Price */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">{t("facModalQty")}</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                className="w-full px-3 py-3 rounded-xl border-2 border-border focus:border-primary outline-none bg-background text-foreground font-bold text-lg transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">{t("facModalAskPrice")}</label>
              <input type="number" min="100" value={price} onChange={e => setPrice(e.target.value)}
                className="w-full px-3 py-3 rounded-xl border-2 border-border focus:border-primary outline-none bg-background text-foreground font-bold text-lg transition-colors" />
            </div>
          </div>

          {/* Deadline */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">{t("facModalDeadline")}</label>
            <input type="date" min={today} value={deadline} onChange={e => setDeadline(e.target.value)}
              className="w-full px-3 py-3 rounded-xl border-2 border-border focus:border-primary outline-none bg-background text-foreground font-semibold transition-colors" />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">{t("facModalNotes")}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder={t("facModalNotesPh")}
              className="w-full px-3 py-3 rounded-xl border-2 border-border focus:border-primary outline-none bg-background text-foreground text-sm resize-none transition-colors" />
          </div>

          {/* Preview */}
          <div className="bg-muted/40 rounded-2xl p-4 text-sm">
            <p className="font-semibold text-foreground mb-2">{t("facModalSummary")}</p>
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
              <span className="text-muted-foreground">{t("facModalCrop")}</span>
              <span className="font-semibold">{cropIcon} {cropLabel || "—"}</span>
              <span className="text-muted-foreground">{t("facModalQuantity")}</span>
              <span className="font-semibold">{qty || "—"} t</span>
              <span className="text-muted-foreground">{t("facModalAskingPrice")}</span>
              <span className="font-semibold">₹{price || "—"}/t</span>
              <span className="text-muted-foreground">{t("facModalTotalValue")}</span>
              <span className="font-bold text-primary">₹{(parseFloat(qty || "0") * parseFloat(price || "0")).toLocaleString()}</span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>{t("facModalCancel")}</Button>
            <Button className="flex-1 rounded-xl gap-2" onClick={handlePost} disabled={saving}>
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("facModalPosting")}</>
                : <><PackagePlus className="w-4 h-4" /> {t("facModalPostBtn")}</>}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Demand Card with negotiation count ──────────────────────── */
function MyDemandCard({ demand, negotiations, onDelete, onClose, onFulfill, onOpenChat }: {
  demand: FactoryDemand;
  negotiations: Negotiation[];
  onDelete: (id: number) => void;
  onClose: (id: number) => void;
  onFulfill: (id: number) => void;
  onOpenChat: (n: Negotiation) => void;
}) {
  const { t } = useLang();
  const daysLeft = Math.ceil((new Date(demand.deadline).getTime() - Date.now()) / 86400000);
  const [deleting, setDeleting]   = useState(false);
  const [closing, setClosing]     = useState(false);
  const [fulfilling, setFulfilling] = useState(false);
  const [expanded, setExpanded]   = useState(false);

  const negs = negotiations.filter(n => n.demandId === demand.id);
  const activeNegs = negs.filter(n => n.status === "active");
  const acceptedNeg = negs.find(n => n.status === "accepted");

  const statusColor =
    demand.status === "open"      ? "bg-green-100 text-green-800 border-green-200" :
    demand.status === "matched"   ? "bg-blue-100 text-blue-800 border-blue-200"   :
    demand.status === "fulfilled" ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                                    "bg-muted text-muted-foreground border-border";

  const statusLabel =
    demand.status === "open"      ? t("facStatusOpen") :
    demand.status === "matched"   ? t("facStatusMatched") :
    demand.status === "fulfilled" ? t("facStatusFulfilled") :
                                    t("facStatusClosed");

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2 }}
      className="bg-card rounded-2xl border-2 border-border p-4 hover:border-primary/20 transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">
            {demand.cropIcon}
          </div>
          <div>
            <p className="font-bold text-foreground leading-tight">{demand.cropType}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatTimeAgo(demand.createdAt)}</p>
          </div>
        </div>
        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0", statusColor)}>
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-muted/40 rounded-xl p-2 text-center">
          <p className="text-xs text-muted-foreground mb-0.5">{t("facCardNeeded")}</p>
          <p className="text-sm font-black text-foreground">{demand.quantityTons}t</p>
        </div>
        <div className="bg-muted/40 rounded-xl p-2 text-center">
          <p className="text-xs text-muted-foreground mb-0.5">{t("facCardAskAgreed")}</p>
          <p className="text-xs font-black text-foreground">
            ₹{demand.agreedPrice ?? demand.pricePerTon}/t
          </p>
        </div>
        <div className={cn("rounded-xl p-2 text-center",
          daysLeft <= 3 ? "bg-red-50" : "bg-muted/40")}>
          <p className="text-xs text-muted-foreground mb-0.5">{t("facCardLeft")}</p>
          <p className={cn("text-xs font-black", daysLeft <= 3 ? "text-red-700" : "text-foreground")}>
            {daysLeft > 0 ? `${daysLeft}d` : t("facCardExpired")}
          </p>
        </div>
      </div>

      {acceptedNeg && (
        <div className={cn("mb-3 border-2 rounded-xl p-3 text-xs",
          demand.status === "fulfilled"
            ? "bg-emerald-50 border-emerald-300"
            : "bg-blue-50 border-blue-300")}>
          <p className={cn("font-bold flex items-center gap-1.5 mb-1",
            demand.status === "fulfilled" ? "text-emerald-900" : "text-blue-900")}>
            {demand.status === "fulfilled"
              ? <CheckCircle2 className="w-4 h-4" />
              : <Handshake className="w-4 h-4" />}
            <span className="text-[13px]">
              {demand.status === "fulfilled"
                ? `${t("facCardDeliveredBy")} ${acceptedNeg.aggregatorName}`
                : `${t("facCardMatchedWith")} ${acceptedNeg.aggregatorName}`}
            </span>
          </p>
          <div className={cn("flex items-center justify-between gap-2 bg-white/60 rounded-lg px-2 py-1.5",
            demand.status === "fulfilled" ? "text-emerald-900" : "text-blue-900")}>
            <span className="font-semibold">{t("facCardFinalPrice")}</span>
            <span className="font-black">₹{acceptedNeg.finalPrice}/t</span>
          </div>
          <div className={cn("flex items-center justify-between gap-2 bg-white/60 rounded-lg px-2 py-1.5 mt-1",
            demand.status === "fulfilled" ? "text-emerald-900" : "text-blue-900")}>
            <span className="font-semibold">{t("facCardTotal")}</span>
            <span className="font-black">₹{((acceptedNeg.finalPrice ?? 0) * demand.quantityTons).toLocaleString()}</span>
          </div>
          {demand.status === "matched" && (
            <p className="text-blue-800 text-[11px] mt-2 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> {t("facCardAwaitingDelivery")}
            </p>
          )}
          {demand.status === "fulfilled" && demand.fulfilledAt && (
            <p className="text-emerald-700 text-[11px] mt-2 font-semibold">
              ✓ {t("facCardReceivedAgo")} {formatTimeAgo(demand.fulfilledAt)}
            </p>
          )}
        </div>
      )}

      {demand.notes && (
        <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-2.5 py-1.5 mb-3 line-clamp-2">
          {demand.notes}
        </p>
      )}

      {/* Negotiations toggle */}
      {negs.length > 0 && (
        <button onClick={() => setExpanded(v => !v)}
          className="w-full mb-2 flex items-center justify-between gap-2 text-xs font-semibold bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl px-3 py-2 hover:bg-indigo-100 transition-colors">
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            {activeNegs.length} {t("facCardNegsActive")} · {negs.length} {negs.length === 1 ? t("facCardNegsCount") : t("facCardNegsCount_pl")}
          </span>
          <span>{expanded ? t("facCardHide") : t("facCardView")}</span>
        </button>
      )}

      {expanded && negs.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {negs.map(n => {
            const lastOffer = [...(n.messages ?? [])].reverse().find(m => m.type === "offer");
            return (
              <button key={n.id} onClick={() => onOpenChat(n)}
                className="w-full flex items-center gap-2 text-xs bg-background border rounded-lg px-2.5 py-2 hover:border-indigo-300 transition-colors text-left">
                <span className={cn("w-2 h-2 rounded-full shrink-0",
                  n.status === "active" ? "bg-amber-500" :
                  n.status === "accepted" ? "bg-green-500" :
                  "bg-muted-foreground")} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{n.aggregatorName}</p>
                  {lastOffer && (
                    <p className="text-muted-foreground">
                      {t("facCardLatest")}: ₹{lastOffer.price}/t ({lastOffer.senderRole})
                    </p>
                  )}
                </div>
                <MessageSquare className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {demand.status === "open" && (
        <div className="flex gap-2">
          <button onClick={async () => { setClosing(true); try { onClose(demand.id); } finally { setClosing(false); } }}
            disabled={closing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors disabled:opacity-60">
            {closing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {t("facCardCloseRequest")}
          </button>
          <button onClick={async () => { setDeleting(true); try { onDelete(demand.id); } finally { setDeleting(false); } }}
            disabled={deleting}
            className="p-2 rounded-xl border border-border hover:bg-red-50 hover:border-red-200 text-muted-foreground hover:text-red-700 transition-colors disabled:opacity-60">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {demand.status === "matched" && (
        <button onClick={async () => { setFulfilling(true); try { onFulfill(demand.id); } finally { setFulfilling(false); } }}
          disabled={fulfilling}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-emerald-400 bg-emerald-50 text-emerald-800 text-xs font-bold hover:bg-emerald-100 transition-colors disabled:opacity-60">
          {fulfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
          {t("facCardMarkReceived")}
        </button>
      )}

      {demand.status === "fulfilled" && (
        <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5" /> {t("facCardComplete")}
        </div>
      )}
    </motion.div>
  );
}

/* ─── Main Dashboard ─────────────────────────────────────────────── */
export default function FactoryDashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user, isLoading, isError } = useGetMe({ query: { retry: false } });
  const { t } = useLang();

  const [demands, setDemands]               = useState<FactoryDemand[]>([]);
  const [negotiations, setNegotiations]     = useState<Negotiation[]>([]);
  const [showPostModal, setShowPostModal]   = useState(false);
  const [showProfile, setShowProfile]       = useState(false);
  const [showMapPicker, setShowMapPicker]   = useState(false);
  const [chatNegId, setChatNegId]           = useState<number | null>(null);
  const [loading, setLoading]               = useState(false);
  const [localUser, setLocalUser]           = useState<any>(null);
  const [statusFilter, setStatusFilter]     = useState<"all" | "open" | "matched" | "closed">("all");

  // GPS one-tap save
  const [savingGps, setSavingGps] = useState(false);
  const [gpsErr, setGpsErr]       = useState<string | null>(null);

  const logoutMutation = useLogout({
    mutation: { onSuccess: () => { queryClient.clear(); setLocation("/"); } },
  });

  useEffect(() => { if (isError && !isLoading) setLocation("/login"); }, [isError, isLoading]);
  useEffect(() => {
    if (user && user.role !== "factory") {
      setLocation(user.role === "farmer" ? "/dashboard/farmer" : "/dashboard/aggregator");
    }
    if (user) setLocalUser(user);
  }, [user]);

  const displayUser = localUser ?? user;
  const factLat = displayUser?.lat ?? geoFromLocation(displayUser?.location ?? "Ludhiana").lat;
  const factLng = displayUser?.lng ?? geoFromLocation(displayUser?.location ?? "Ludhiana").lng;
  const hasFactoryGps = !!(localUser?.lat && localUser?.lng);

  const loadData = async () => {
    setLoading(true);
    try {
      const [demandsData, negs] = await Promise.all([
        listFactoryDemands(),
        listNegotiations(),
      ]);
      setDemands(demandsData);
      setNegotiations(negs);
    } catch { /* keep state */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!user) return;
    loadData();
    const interval = setInterval(loadData, 12000);
    return () => clearInterval(interval);
  }, [user]);

  const handleQuickSaveGps = () => {
    if (!navigator.geolocation) {
      setGpsErr("This browser does not support GPS. Use 'Pick on map' instead.");
      return;
    }
    setSavingGps(true); setGpsErr(null);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const updated = await updateProfile({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocalUser((u: any) => ({ ...u, ...updated.user }));
        } catch (e: any) {
          setGpsErr(e?.message ?? "Could not save your location to the server.");
        }
        finally { setSavingGps(false); }
      },
      err => {
        setGpsErr(gpsErrorMessage(err));
        setSavingGps(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const handleMapPick = async (lat: number, lng: number) => {
    try {
      const updated = await updateProfile({ lat, lng });
      setLocalUser((u: any) => ({ ...u, ...updated.user }));
      setGpsErr(null);
    } catch (e: any) {
      setGpsErr(e?.message ?? "Could not save your location to the server.");
    }
  };

  const handleDemandPosted = (demand: FactoryDemand) => {
    setDemands(prev => [demand, ...prev]);
    setShowPostModal(false);
  };

  const handleDeleteDemand = async (id: number) => {
    setDemands(prev => prev.filter(d => d.id !== id));
    try { await deleteFactoryDemand(id); } catch { loadData(); }
  };

  const handleFulfillDemand = async (id: number) => {
    try {
      const updated = await markDemandFulfilled(id);
      setDemands(prev => prev.map(d => d.id === id ? updated : d));
    } catch (e: any) {
      alert(e.message ?? "Could not mark fulfilled");
      loadData();
    }
  };

  const handleCloseDemand = async (id: number) => {
    setDemands(prev => prev.map(d => d.id === id ? { ...d, status: "closed" as const } : d));
    try { await closeFactoryDemand(id); } catch { loadData(); }
  };

  const filteredDemands = statusFilter === "all" ? demands : demands.filter(d => d.status === statusFilter);

  const openDemands     = demands.filter(d => d.status === "open");
  const matchedDemands  = demands.filter(d => d.status === "matched");
  const closedDemands   = demands.filter(d => d.status === "closed");
  const activeNegCount  = negotiations.filter(n => n.status === "active").length;

  const totalValuePosted = openDemands.reduce((s, d) => s + d.quantityTons * d.pricePerTon, 0);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600" />
          <p className="text-muted-foreground font-medium">{t("facLoadingDash")}</p>
        </div>
      </div>
    );
  }
  if (!displayUser) return null;

  return (
    <div className="min-h-screen bg-muted/20 pb-16">

      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-40 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-16 gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowProfile(true)}
              className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center hover:bg-slate-200 transition-colors">
              <Building2 className="w-5 h-5 text-slate-700" />
            </button>
            <div>
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider leading-none mb-0.5">{t("roleFactory")}</p>
              <p className="font-bold text-foreground leading-none">{displayUser.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSelector compact className="hidden sm:flex" />
            <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" /> {displayUser.location}
            </div>
            <button onClick={() => setShowProfile(true)}
              className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
              <UserCircle className="w-5 h-5" />
            </button>
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-muted-foreground"
              onClick={() => logoutMutation.mutate({})} isLoading={logoutMutation.isPending}>
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{t("facSignOut")}</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="sm:hidden px-4 pt-3"><LanguageSelector /></div>

      {/* Banner */}
      <div className="bg-slate-800 text-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold"><MapPin className="w-4 h-4 opacity-75" /> {displayUser.location}</span>
          <span className="flex items-center gap-1.5 opacity-80"><Phone className="w-4 h-4" /> {displayUser.phone}</span>
          {displayUser.lat && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${displayUser.lat},${displayUser.lng}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 opacity-80 hover:opacity-100 underline">
              <Navigation className="w-4 h-4" /> {t("facMyLocation")}
            </a>
          )}
          <span className="ml-auto font-bold hidden sm:flex items-center gap-1.5">
            <Leaf className="w-4 h-4 opacity-75" /> {t("facHubBadge")}
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">

        {/* GPS one-tap prompt */}
        {!hasFactoryGps && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-slate-50 to-blue-50 border-2 border-slate-300 rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-700 flex items-center justify-center shrink-0">
                <Navigation className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-900 text-lg mb-1">{t("facPinTitle")}</h3>
                <p className="text-sm text-slate-700/80 mb-3">
                  {t("facPinDesc")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleQuickSaveGps} isLoading={savingGps}
                    className="bg-slate-700 hover:bg-slate-800 text-white rounded-xl gap-2 font-bold">
                    <Navigation className="w-4 h-4" /> {t("facUseMyGps")}
                  </Button>
                  <Button variant="outline" onClick={() => setShowMapPicker(true)}
                    className="rounded-xl gap-2 font-semibold border-slate-300 text-slate-700 hover:bg-slate-50">
                    <MapPin className="w-4 h-4" /> {t("facPickOnMap")}
                  </Button>
                </div>
                {gpsErr && <p className="text-xs text-red-700 font-semibold mt-2">{gpsErr}</p>}
              </div>
            </div>
          </motion.div>
        )}

        {hasFactoryGps && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm">
            <CheckCircle2 className="w-4 h-4 text-slate-700 shrink-0" />
            <span className="font-semibold text-slate-800 flex-1">
              {t("facLocSavedPrefix")} {localUser.lat.toFixed(4)}, {localUser.lng.toFixed(4)}
            </span>
            <button onClick={() => setShowProfile(true)} className="text-xs font-semibold text-slate-700 hover:underline">
              {t("facUpdate")}
            </button>
          </motion.div>
        )}

        {/* Stats row */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t("facStatOpen"),    value: openDemands.length,    color: "bg-green-50 text-green-700 border-green-200" },
            { label: t("facStatMatched"), value: matchedDemands.length, color: "bg-blue-50 text-blue-700 border-blue-200" },
            { label: t("facStatChats"),   value: activeNegCount,        color: "bg-amber-50 text-amber-700 border-amber-200" },
            { label: t("facStatValue"),   value: `₹${Math.round(totalValuePosted / 1000)}k`,
              color: "bg-purple-50 text-purple-700 border-purple-200" },
          ].map((s, i) => (
            <div key={i} className={cn("rounded-2xl border p-4 text-center", s.color)}>
              <p className="text-2xl sm:text-3xl font-black">{s.value}</p>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mt-0.5">{s.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Map + CTA */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="lg:col-span-2 bg-card rounded-3xl border shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                <Navigation className="w-5 h-5 text-slate-700" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-foreground">{t("facMapTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("facMapSubtitle")}</p>
              </div>
              <button onClick={loadData} disabled={loading}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1.5 hover:bg-slate-100 transition disabled:opacity-60">
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              </button>
            </div>
            <div className="p-4">
              <FactoryMap factoryLat={factLat} factoryLng={factLng} factoryName={displayUser.name} />
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="bg-card rounded-3xl border shadow-sm">
            <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <PackagePlus className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-foreground">{t("facQuickActions")}</h2>
            </div>
            <div className="p-5 space-y-3">
              <Button className="w-full h-12 rounded-2xl gap-2 text-base font-bold"
                onClick={() => setShowPostModal(true)}>
                <PackagePlus className="w-5 h-5" /> {t("facPostDemandBtn")}
              </Button>

              <div className="bg-muted/40 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("facSummaryTitle")}</p>
                {[
                  { label: t("facSummaryOpen"),    value: openDemands.length,    color: "text-green-700" },
                  { label: t("facSummaryMatched"), value: matchedDemands.length, color: "text-blue-700"  },
                  { label: t("facSummaryClosed"),  value: closedDemands.length,  color: "text-muted-foreground" },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className={cn("font-black", r.color)}>{r.value}</span>
                  </div>
                ))}
                <div className="border-t pt-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("facSummaryTotalSought")}</span>
                    <span className="font-black">{openDemands.reduce((s, d) => s + d.quantityTons, 0)}t</span>
                  </div>
                </div>
              </div>

              {activeNegCount > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
                  <p className="text-xs font-bold text-indigo-800 mb-1 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" /> {activeNegCount} {activeNegCount === 1 ? t("facActiveNegBanner") : t("facActiveNegBanner_pl")}
                  </p>
                  <p className="text-xs text-indigo-700">
                    {t("facActiveNegHelp")}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Active Negotiations */}
        {negotiations.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-card rounded-3xl border shadow-sm">
            <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <Handshake className="w-5 h-5 text-indigo-700" />
              </div>
              <h2 className="text-lg font-bold text-foreground flex-1">{t("facNegSectionTitle")}</h2>
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1">
                {activeNegCount} {t("facActiveBadge")}
              </span>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {negotiations.map(n => {
                const lastOffer = [...(n.messages ?? [])].reverse().find(m => m.type === "offer");
                const demand   = demands.find(d => d.id === n.demandId);
                return (
                  <button key={n.id} onClick={() => setChatNegId(n.id)}
                    className="text-left rounded-2xl border-2 hover:border-indigo-300 transition-colors p-4 bg-background">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="font-bold text-foreground truncate">{n.aggregatorName}</p>
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize shrink-0",
                        n.status === "active" ? "bg-amber-100 text-amber-800 border-amber-200" :
                        n.status === "accepted" ? "bg-green-100 text-green-800 border-green-200" :
                        "bg-muted text-muted-foreground border-border")}>{n.status}</span>
                    </div>
                    {demand && (
                      <p className="text-xs text-muted-foreground truncate">
                        {demand.cropIcon} {demand.cropType} · {demand.quantityTons}t
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="text-muted-foreground">
                        {lastOffer ? `${t("facLatestOffer")} ₹${lastOffer.price}/t (${lastOffer.senderRole})` : t("facNoOffersYet")}
                      </span>
                      <span className="text-indigo-700 font-bold flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" /> {t("facOpenChat")}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* My Demands */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-card rounded-3xl border shadow-sm">
          <div className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-4 border-b">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Factory className="w-5 h-5 text-slate-700" />
            </div>
            <h2 className="text-lg font-bold text-foreground flex-1">{t("facMyDemandsTitle")}</h2>
            <div className="flex items-center gap-2">
              {(["all", "open", "matched", "closed"] as const).map(f => {
                const labelKey =
                  f === "all" ? "facFilterAll" :
                  f === "open" ? "facFilterOpen" :
                  f === "matched" ? "facFilterMatched" : "facFilterClosed";
                return (
                  <button key={f} onClick={() => setStatusFilter(f)}
                    className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                      statusFilter === f ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40")}>
                    {t(labelKey as any)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="p-5">
            {filteredDemands.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🏭</div>
                <p className="text-base font-semibold text-foreground mb-1">{t("facEmptyTitle")}</p>
                <p className="text-sm text-muted-foreground mb-4">{t("facEmptyDesc")}</p>
                <Button onClick={() => setShowPostModal(true)} className="rounded-xl gap-2">
                  <PackagePlus className="w-4 h-4" /> {t("facEmptyCta")}
                </Button>
              </div>
            )}
            <AnimatePresence mode="popLayout">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredDemands.map(d => (
                  <MyDemandCard key={d.id} demand={d}
                    negotiations={negotiations}
                    onDelete={handleDeleteDemand}
                    onClose={handleCloseDemand}
                    onFulfill={handleFulfillDemand}
                    onOpenChat={n => setChatNegId(n.id)} />
                ))}
              </div>
            </AnimatePresence>
          </div>
        </motion.div>

        <IncomingLoadOffersPanel />
      </div>

      <AnimatePresence>
        {showPostModal && (
          <PostDemandModal
            onClose={() => setShowPostModal(false)}
            onSuccess={handleDemandPosted}
          />
        )}
        {showProfile && displayUser && (
          <ProfilePanel
            user={displayUser}
            onClose={() => setShowProfile(false)}
            onUpdate={updated => setLocalUser((prev: any) => ({ ...prev, ...updated }))}
          />
        )}
        {showMapPicker && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowMapPicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-700 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{t("facPickOnMap")}</p>
                    <p className="text-xs text-muted-foreground">Tap the map, search a place, or use GPS to mark your factory.</p>
                  </div>
                </div>
                <button onClick={() => setShowMapPicker(false)}
                  className="p-2 rounded-xl hover:bg-slate-200 text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 overflow-y-auto flex-1">
                <LocationPicker
                  lat={localUser?.lat ?? null}
                  lng={localUser?.lng ?? null}
                  accent="indigo"
                  onPick={handleMapPick}
                />
              </div>
              <div className="border-t bg-slate-50 px-5 py-3 flex justify-end">
                <Button onClick={() => setShowMapPicker(false)} className="bg-slate-700 hover:bg-slate-800 text-white rounded-xl">
                  Done
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {chatNegId !== null && (
          <NegotiationChat
            negotiationId={chatNegId}
            myRole="factory"
            onClose={() => { setChatNegId(null); loadData(); }}
            onUpdated={() => loadData()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
