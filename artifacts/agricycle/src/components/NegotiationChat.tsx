/**
 * NegotiationChat.tsx
 *
 * Chat-style price negotiation modal between an aggregator and a factory.
 * Both parties see the same interleaved message stream and can:
 *   - send a text message
 *   - send a counter-offer (price)
 *   - accept the latest offer from the other party (deal struck)
 *   - reject (close the negotiation)
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  X, Send, IndianRupee, CheckCircle2, XCircle, MessageSquare,
  Factory as FactoryIcon, Truck, Loader2, Handshake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getNegotiation,
  sendNegotiationMessage,
  type Negotiation,
  type NegotiationMessage,
} from "@/lib/negotiationApi";
import type { FactoryDemand } from "@/lib/pickupApi";

interface Props {
  negotiationId: number;
  myRole: "aggregator" | "factory";
  onClose: () => void;
  onUpdated?: (n: Negotiation) => void;
}

export function NegotiationChat({ negotiationId, myRole, onClose, onUpdated }: Props) {
  const [neg, setNeg]           = useState<Negotiation | null>(null);
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [text, setText]         = useState("");
  const [price, setPrice]       = useState("");
  const scrollRef               = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const data = await getNegotiation(negotiationId);
      setNeg(data);
      onUpdated?.(data);
    } catch (e: any) {
      setError(e.message ?? "Could not load chat");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [negotiationId]);
  useEffect(() => {
    if (!neg || neg.status !== "active") return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [neg?.status, neg?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [neg?.messages?.length]);

  const send = async (payload: { type: "text" | "offer" | "accept" | "reject"; price?: number; text?: string }) => {
    setSending(true);
    setError(null);
    try {
      const updated = await sendNegotiationMessage(negotiationId, payload);
      setNeg(updated);
      onUpdated?.(updated);
      setText("");
      setPrice("");
    } catch (e: any) {
      setError(e.message ?? "Could not send");
    } finally {
      setSending(false);
    }
  };

  const latestOtherOffer = (() => {
    if (!neg?.messages) return null;
    const offers = neg.messages.filter(m => m.type === "offer");
    const last = offers[offers.length - 1];
    if (!last) return null;
    if (last.senderRole === myRole) return null;
    return last;
  })();

  const demand: FactoryDemand | null | undefined = neg?.demand;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/55 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="bg-card rounded-t-3xl sm:rounded-3xl border shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b">
          <div className="w-11 h-11 rounded-2xl bg-indigo-100 flex items-center justify-center">
            <Handshake className="w-5 h-5 text-indigo-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-foreground truncate">Price Negotiation</h3>
            {demand && (
              <p className="text-xs text-muted-foreground truncate">
                {demand.cropIcon} {demand.cropType} · {demand.quantityTons}t · {myRole === "aggregator" ? `Factory: ${demand.factoryName}` : `Aggregator: ${neg?.aggregatorName}`}
              </p>
            )}
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status banner */}
        {neg && neg.status !== "active" && (
          <div className={cn("px-5 py-2.5 text-sm font-semibold border-b flex items-center gap-2",
            neg.status === "accepted" ? "bg-green-50 text-green-800 border-green-200"
            : neg.status === "rejected" ? "bg-red-50 text-red-800 border-red-200"
            : "bg-muted text-muted-foreground")}>
            {neg.status === "accepted" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {neg.status === "accepted" && `Deal closed at ₹${neg.finalPrice}/ton`}
            {neg.status === "rejected" && "This negotiation was rejected"}
            {neg.status === "cancelled" && "This negotiation was closed (another offer was accepted)"}
          </div>
        )}

        {/* Demand summary */}
        {demand && (
          <div className="px-5 py-2.5 bg-muted/30 border-b text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>Factory ask: <strong className="text-foreground">₹{demand.pricePerTon}/t</strong></span>
            <span>Quantity: <strong className="text-foreground">{demand.quantityTons}t</strong></span>
            <span>Deadline: <strong className="text-foreground">{demand.deadline}</strong></span>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-muted/10 min-h-[260px]">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && neg?.messages?.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">No messages yet.</p>
          )}
          {neg?.messages?.map(m => (
            <MessageBubble key={m.id} m={m} mine={m.senderRole === myRole} />
          ))}
        </div>

        {/* Composer */}
        {neg?.status === "active" && (
          <div className="border-t bg-card p-4 space-y-3">
            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}

            {/* Accept latest offer */}
            {latestOtherOffer && (
              <button
                onClick={() => send({ type: "accept" })}
                disabled={sending}
                className="w-full rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 text-sm flex items-center justify-center gap-2 transition disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                Accept ₹{latestOtherOffer.price}/ton — close the deal
              </button>
            )}

            {/* Counter-offer */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="number" min="1" placeholder="Counter price ₹/ton"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  className="w-full rounded-xl border bg-background pl-8 pr-3 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                />
              </div>
              <Button
                onClick={() => {
                  const p = parseInt(price, 10);
                  if (!Number.isFinite(p) || p <= 0) return;
                  send({ type: "offer", price: p });
                }}
                disabled={sending || !price || parseInt(price, 10) <= 0}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 px-4"
              >
                <IndianRupee className="w-4 h-4" /> Offer
              </Button>
            </div>

            {/* Text message */}
            <div className="flex gap-2">
              <input
                type="text" placeholder="Type a message…"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && text.trim()) send({ type: "text", text: text.trim() });
                }}
                className="flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
              />
              <Button
                onClick={() => text.trim() && send({ type: "text", text: text.trim() })}
                disabled={sending || !text.trim()}
                variant="outline" className="rounded-xl gap-1.5 px-3"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>

            <button
              onClick={() => {
                if (confirm("Reject and close this negotiation?")) send({ type: "reject" });
              }}
              disabled={sending}
              className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline disabled:opacity-60"
            >
              Reject negotiation
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function MessageBubble({ m, mine }: { m: NegotiationMessage; mine: boolean }) {
  const RoleIcon = m.senderRole === "factory" ? FactoryIcon : Truck;
  const roleLabel = m.senderRole === "factory" ? "Factory" : "Aggregator";

  if (m.type === "accept") {
    return (
      <div className="flex justify-center">
        <div className="bg-green-100 border border-green-200 text-green-800 rounded-full px-3 py-1 text-xs font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {roleLabel} accepted ₹{m.price}/ton
        </div>
      </div>
    );
  }
  if (m.type === "reject") {
    return (
      <div className="flex justify-center">
        <div className="bg-red-100 border border-red-200 text-red-800 rounded-full px-3 py-1 text-xs font-bold flex items-center gap-1.5">
          <XCircle className="w-3.5 h-3.5" /> {roleLabel} rejected
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
          <RoleIcon className="w-3.5 h-3.5 text-slate-700" />
        </div>
      )}
      <div className={cn(
        "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm",
        mine ? "bg-indigo-600 text-white rounded-br-md" : "bg-white border rounded-bl-md text-foreground",
      )}>
        {m.type === "offer" ? (
          <div>
            <div className={cn("flex items-center gap-1.5 font-bold mb-0.5",
              mine ? "text-white" : "text-indigo-700")}>
              <IndianRupee className="w-3.5 h-3.5" />
              <span>Offer: ₹{m.price}/ton</span>
            </div>
            {m.text && (
              <p className={cn("text-xs mt-1", mine ? "text-indigo-50" : "text-muted-foreground")}>{m.text}</p>
            )}
          </div>
        ) : (
          <p>{m.text}</p>
        )}
        <p className={cn("text-[10px] mt-1", mine ? "text-indigo-100" : "text-muted-foreground")}>
          {new Date(m.createdAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
        </p>
      </div>
    </div>
  );
}
