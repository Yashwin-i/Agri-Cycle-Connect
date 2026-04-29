/**
 * IncomingLoadOffersPanel.tsx — Factory-side panel.
 *
 * Shows load offers sent BY aggregators TO this factory and lets the
 * factory accept (with optional counter price), reject, or mark fulfilled.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Inbox, Phone, MapPin, Calendar, Coins, CheckCircle2, X, Ban,
  PackageCheck, Clock, Loader2, AlertCircle, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  listLoadOffers, acceptLoadOffer, rejectLoadOffer, fulfillLoadOffer,
  type LoadOffer,
} from "@/lib/loadOfferApi";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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

/* ─── Accept-with-optional-counter modal ───────────────────── */
function AcceptModal({
  offer, onClose, onAccepted,
}: {
  offer: LoadOffer;
  onClose: () => void;
  onAccepted: (o: LoadOffer) => void;
}) {
  const [price, setPrice]   = useState(String(offer.askingPricePerTon));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const p = parseFloat(price);
    if (!p || p <= 0) return setErr("Enter a valid price per ton");
    setSubmitting(true);
    try {
      const updated = await acceptLoadOffer(
        offer.id,
        p === offer.askingPricePerTon ? undefined : Math.round(p),
      );
      onAccepted(updated);
    } catch (e: any) {
      setErr(e.message ?? "Could not accept offer");
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
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className="bg-card rounded-2xl border shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold">Accept this offer?</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-muted/40 p-3 text-sm">
            <p><span className="font-semibold">{offer.aggregatorName}</span> · {offer.quantityTons}t {offer.cropType}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Asking ₹{offer.askingPricePerTon.toLocaleString()}/ton
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Final price (₹/ton)</Label>
            <Input type="number" inputMode="numeric" min="1"
              value={price} onChange={e => setPrice(e.target.value)} className="rounded-xl" />
            <p className="text-[11px] text-muted-foreground">
              Leave as asking price to accept as-is, or enter a counter-offer.
            </p>
          </div>

          {err && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {err}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
            <Button onClick={submit} disabled={submitting}
              className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 gap-1.5">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Reject modal ──────────────────────────────────────────── */
function RejectModal({
  offer, onClose, onRejected,
}: {
  offer: LoadOffer;
  onClose: () => void;
  onRejected: (o: LoadOffer) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const updated = await rejectLoadOffer(offer.id, reason.trim() || undefined);
      onRejected(updated);
    } catch { /* fallthrough */ }
    finally { setSubmitting(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className="bg-card rounded-2xl border shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <Ban className="w-5 h-5 text-rose-600" />
            <h3 className="text-base font-bold">Reject this offer?</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Reason (optional)</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Price too high, quantity too small, no capacity right now…"
              className="rounded-xl resize-none" rows={3} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">Back</Button>
            <Button onClick={submit} disabled={submitting}
              className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 gap-1.5">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Reject
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Main panel ─────────────────────────────────────────────── */
export default function IncomingLoadOffersPanel() {
  const [offers, setOffers]       = useState<LoadOffer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [acceptOffer, setAcceptOffer] = useState<LoadOffer | null>(null);
  const [rejectOffer, setRejectOffer] = useState<LoadOffer | null>(null);

  const reload = async () => {
    try {
      const o = await listLoadOffers();
      setOffers(o);
    } catch { /* keep state */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    reload();
    const i = setInterval(reload, 12000);
    return () => clearInterval(i);
  }, []);

  const handleFulfill = async (id: number) => {
    try {
      const updated = await fulfillLoadOffer(id);
      setOffers(prev => prev.map(o => o.id === id ? updated : o));
    } catch (e: any) {
      alert(e.message ?? "Could not mark fulfilled");
    }
  };

  const sorted = [...offers].sort((a, b) => {
    const order: Record<LoadOffer["status"], number> = {
      pending: 0, accepted: 1, fulfilled: 2, rejected: 3, cancelled: 4,
    };
    return order[a.status] - order[b.status];
  });

  const pendingCount = offers.filter(o => o.status === "pending").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-2xl border shadow-sm overflow-hidden">
      <div className="p-5 border-b bg-gradient-to-br from-amber-50 to-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
                <Inbox className="w-5 h-5" />
              </div>
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center border-2 border-card">
                  {pendingCount}
                </span>
              )}
            </div>
            <div>
              <h2 className="text-base font-bold">Aggregator Load Offers</h2>
              <p className="text-xs text-muted-foreground">
                Direct requests from aggregators with biomass on hand.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5">
        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading offers…
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-sm font-semibold mb-1">No incoming offers yet</p>
            <p className="text-xs text-muted-foreground">
              When aggregators send a load your way, it'll show up here.
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
                          <Send className="w-3 h-3" />
                          From <span className="font-semibold">{o.aggregatorName}</span>
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
                    <div className="p-2 rounded-lg bg-amber-50 border border-amber-100">
                      <p className="text-[10px] text-amber-800 uppercase">Total</p>
                      <p className="font-bold text-sm text-amber-900">
                        ₹{total.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {o.aggregatorLocation}
                    </span>
                    <a href={`tel:${o.aggregatorPhone}`} className="flex items-center gap-1 hover:text-primary">
                      <Phone className="w-3 h-3" /> {o.aggregatorPhone}
                    </a>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> until {formatDate(o.availableUntil)}
                    </span>
                  </div>

                  {o.notes && (
                    <p className="text-xs bg-muted/40 rounded-lg p-2 text-muted-foreground italic">
                      "{o.notes}"
                    </p>
                  )}

                  {o.status === "pending" && (
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => setRejectOffer(o)}
                        className="flex-1 rounded-lg gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-50">
                        <Ban className="w-3.5 h-3.5" /> Reject
                      </Button>
                      <Button size="sm" onClick={() => setAcceptOffer(o)}
                        className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Accept
                      </Button>
                    </div>
                  )}

                  {o.status === "accepted" && (
                    <Button size="sm" onClick={() => handleFulfill(o.id)}
                      className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 gap-1.5">
                      <PackageCheck className="w-3.5 h-3.5" /> Mark as fulfilled
                    </Button>
                  )}

                  {o.status === "fulfilled" && (
                    <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-50 text-blue-800 text-xs font-semibold">
                      <PackageCheck className="w-3.5 h-3.5" /> Delivery complete
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {acceptOffer && (
          <AcceptModal offer={acceptOffer}
            onClose={() => setAcceptOffer(null)}
            onAccepted={(updated) => {
              setOffers(prev => prev.map(o => o.id === updated.id ? updated : o));
              setAcceptOffer(null);
            }} />
        )}
        {rejectOffer && (
          <RejectModal offer={rejectOffer}
            onClose={() => setRejectOffer(null)}
            onRejected={(updated) => {
              setOffers(prev => prev.map(o => o.id === updated.id ? updated : o));
              setRejectOffer(null);
            }} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
