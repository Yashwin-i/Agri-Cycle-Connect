/**
 * LoadOfferPanel.tsx — Aggregator-side panel.
 *
 * Lets an aggregator:
 *   • Send a new load offer to a chosen factory ("I have X tons of crop Y, will you buy?")
 *   • View status of all their previously sent offers
 *   • Cancel a pending offer
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Send, X, Calendar, MapPin, Wheat, Coins, AlertCircle,
  CheckCircle2, Clock, Ban, PackageCheck, Trash2, Loader2, Navigation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listFactories, listLoadOffers, createLoadOffer, cancelLoadOffer,
  type FactoryDirectoryEntry, type LoadOffer,
} from "@/lib/loadOfferApi";
import { useLang } from "@/contexts/LanguageContext";

const CROP_OPTIONS = [
  { key: "Rice Stubble",   icon: "🌾" },
  { key: "Wheat Straw",    icon: "🌾" },
  { key: "Maize Residue",  icon: "🌽" },
  { key: "Sugarcane Tops", icon: "🎋" },
  { key: "Cotton Stalks",  icon: "🌿" },
  { key: "Other Biomass",  icon: "🍂" },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/* great-circle distance in km */
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function StatusBadge({ status }: { status: LoadOffer["status"] }) {
  const cfg: Record<LoadOffer["status"], { label: string; cls: string; icon: any }> = {
    pending:   { label: "Pending",   cls: "bg-amber-100 text-amber-800 border-amber-200",         icon: Clock },
    accepted:  { label: "Accepted",  cls: "bg-emerald-100 text-emerald-800 border-emerald-200",   icon: CheckCircle2 },
    rejected:  { label: "Rejected",  cls: "bg-rose-100 text-rose-800 border-rose-200",            icon: Ban },
    fulfilled: { label: "Fulfilled", cls: "bg-blue-100 text-blue-800 border-blue-200",            icon: PackageCheck },
    cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-700 border-slate-200",         icon: X },
  };
  const c = cfg[status];
  const I = c.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${c.cls} font-semibold`}>
      <I className="w-3 h-3" /> {c.label}
    </Badge>
  );
}

/* ─── Send new offer modal ─────────────────────────────────────── */
function SendOfferModal({
  factories, aggregatorLat, aggregatorLng, onClose, onSent,
}: {
  factories: FactoryDirectoryEntry[];
  aggregatorLat: number | null;
  aggregatorLng: number | null;
  onClose: () => void;
  onSent: (o: LoadOffer) => void;
}) {
  const [factoryId, setFactoryId] = useState<string>("");
  const [crop, setCrop]           = useState(CROP_OPTIONS[0].key);
  const [quantity, setQuantity]   = useState("");
  const [price, setPrice]         = useState("");
  const tomorrow = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);
  const [until, setUntil]         = useState(tomorrow);
  const [notes, setNotes]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const minDate = new Date().toISOString().slice(0, 10);

  /** Factories enriched with distance from the aggregator (when GPS is known)
      and sorted nearest-first.                                              */
  const sortedFactories = useMemo(() => {
    const haveOrigin = aggregatorLat != null && aggregatorLng != null;
    const enriched = factories.map(f => {
      const haveTarget = f.lat != null && f.lng != null;
      const distanceKm = haveOrigin && haveTarget
        ? haversineKm(
            { lat: aggregatorLat as number, lng: aggregatorLng as number },
            { lat: f.lat as number,           lng: f.lng as number },
          )
        : null;
      return { ...f, distanceKm };
    });
    return enriched.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return a.name.localeCompare(b.name);
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }, [factories, aggregatorLat, aggregatorLng]);

  const submit = async () => {
    setErr(null);
    const fId = parseInt(factoryId, 10);
    const qty = parseFloat(quantity);
    const ppt = parseFloat(price);
    if (!fId)         return setErr("Pick a factory");
    if (!qty || qty <= 0) return setErr("Enter a valid quantity in tons");
    if (!ppt || ppt <= 0) return setErr("Enter a valid asking price per ton");
    if (!until)       return setErr("Pick an availability date");

    setSubmitting(true);
    try {
      const cropMeta = CROP_OPTIONS.find(c => c.key === crop) ?? CROP_OPTIONS[0];
      const offer = await createLoadOffer({
        factoryId:         fId,
        cropType:          crop,
        cropIcon:          cropMeta.icon,
        quantityTons:      qty,
        askingPricePerTon: Math.round(ppt),
        availableUntil:    until,
        notes:             notes.trim() || undefined,
      });
      onSent(offer);
    } catch (e: any) {
      setErr(e.message ?? "Could not send offer");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        className="bg-card rounded-2xl border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold">Send Load Offer</h3>
              <p className="text-xs text-muted-foreground">Tell a factory you have biomass to sell</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Target factory</Label>
            <Select value={factoryId} onValueChange={setFactoryId}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Pick a factory…" />
              </SelectTrigger>
              <SelectContent>
                {sortedFactories.length === 0 && (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    No registered factories yet.
                  </div>
                )}
                {sortedFactories.map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    <span className="flex items-center gap-2 w-full">
                      <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="font-medium">{f.name}</span>
                      {f.distanceKm != null && (
                        <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                          <Navigation className="w-3 h-3" />
                          {f.distanceKm < 10 ? f.distanceKm.toFixed(1) : Math.round(f.distanceKm)} km
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Crop / biomass type</Label>
            <Select value={crop} onValueChange={setCrop}>
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CROP_OPTIONS.map(c => (
                  <SelectItem key={c.key} value={c.key}>
                    <span className="flex items-center gap-2">
                      <span className="text-base">{c.icon}</span> {c.key}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <Wheat className="w-3 h-3" /> Quantity (tons)
              </Label>
              <Input type="number" inputMode="decimal" min="0.1" step="0.1"
                value={quantity} onChange={e => setQuantity(e.target.value)}
                placeholder="e.g. 12.5" className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <Coins className="w-3 h-3" /> Asking ₹ / ton
              </Label>
              <Input type="number" inputMode="numeric" min="1" step="1"
                value={price} onChange={e => setPrice(e.target.value)}
                placeholder="e.g. 2400" className="rounded-xl" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Available until
            </Label>
            <Input type="date" value={until} min={minDate}
              onChange={e => setUntil(e.target.value)} className="rounded-xl" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Pickup window, moisture %, photos sent over WhatsApp, etc."
              className="rounded-xl resize-none" rows={3} />
          </div>

          {err && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {err}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}
              className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 gap-1.5">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send offer
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Main panel ─────────────────────────────────────────────── */
export default function LoadOfferPanel({
  aggregatorLat = null, aggregatorLng = null,
}: {
  aggregatorLat?: number | null;
  aggregatorLng?: number | null;
} = {}) {
  const { t } = useLang();
  const [factories, setFactories] = useState<FactoryDirectoryEntry[]>([]);
  const [offers, setOffers]       = useState<LoadOffer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);

  const reload = async () => {
    try {
      const [f, o] = await Promise.all([listFactories(), listLoadOffers()]);
      setFactories(f);
      setOffers(o);
    } catch { /* keep state on error */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    reload();
    const i = setInterval(reload, 15000);
    return () => clearInterval(i);
  }, []);

  const handleCancel = async (id: number) => {
    setOffers(prev => prev.map(o => o.id === id ? { ...o, status: "cancelled" } : o));
    try { await cancelLoadOffer(id); } catch { reload(); }
  };

  const sorted = [...offers].sort((a, b) => {
    const order: Record<LoadOffer["status"], number> = {
      pending: 0, accepted: 1, fulfilled: 2, rejected: 3, cancelled: 4,
    };
    return order[a.status] - order[b.status];
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-2xl border shadow-sm overflow-hidden">
      <div className="p-5 border-b bg-gradient-to-br from-indigo-50 to-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">{t("loadOfferTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("loadOfferDesc")}
              </p>
            </div>
          </div>
          <Button onClick={() => setShowModal(true)} size="sm"
            className="rounded-xl gap-1.5 bg-indigo-600 hover:bg-indigo-700 shrink-0">
            <Send className="w-3.5 h-3.5" /> {t("loadOfferSendBtn")}
          </Button>
        </div>
      </div>

      <div className="p-5">
        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("loadOfferLoading")}
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📦</div>
            <p className="text-sm font-semibold mb-1">{t("loadOfferEmptyTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("loadOfferEmptyDesc")}
            </p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {sorted.map(o => {
              const total = o.quantityTons * (o.agreedPricePerTon ?? o.askingPricePerTon);
              return (
                <motion.div key={o.id}
                  layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-xl border bg-background p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl">{o.cropIcon}</span>
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{o.cropType}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          <span className="truncate">{o.factoryName}</span>
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded-lg bg-muted/50">
                      <p className="text-[10px] text-muted-foreground uppercase">Qty</p>
                      <p className="font-bold text-sm">{o.quantityTons}t</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/50">
                      <p className="text-[10px] text-muted-foreground uppercase">
                        {o.agreedPricePerTon ? "Agreed" : "Asking"} ₹/t
                      </p>
                      <p className="font-bold text-sm">
                        ₹{(o.agreedPricePerTon ?? o.askingPricePerTon).toLocaleString()}
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100">
                      <p className="text-[10px] text-indigo-700 uppercase">Total</p>
                      <p className="font-bold text-sm text-indigo-800">
                        ₹{total.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {o.factoryLocation}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> avail. {formatDate(o.availableUntil)}
                    </span>
                  </div>

                  {o.notes && (
                    <p className="text-xs bg-muted/40 rounded-lg p-2 text-muted-foreground italic">
                      "{o.notes}"
                    </p>
                  )}

                  {o.status === "rejected" && o.rejectionReason && (
                    <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg p-2 text-rose-800">
                      <span className="font-semibold">Reason:</span> {o.rejectionReason}
                    </div>
                  )}

                  {o.status === "pending" && (
                    <Button variant="outline" size="sm" onClick={() => handleCancel(o.id)}
                      className="w-full rounded-lg gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-50">
                      <Trash2 className="w-3.5 h-3.5" /> Cancel offer
                    </Button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showModal && (
          <SendOfferModal
            factories={factories}
            aggregatorLat={aggregatorLat}
            aggregatorLng={aggregatorLng}
            onClose={() => setShowModal(false)}
            onSent={(o) => {
              setOffers(prev => [o, ...prev]);
              setShowModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
