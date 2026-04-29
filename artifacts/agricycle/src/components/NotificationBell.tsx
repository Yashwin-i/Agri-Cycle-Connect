/**
 * NotificationBell — pickup status change notification feed.
 *
 * Watches a list of PickupRequests for status transitions and stores a
 * persistent feed of human-readable events in localStorage (per user id).
 *
 * Behaviour:
 *  - First time seeing a user: snapshot statuses silently (no backfill spam).
 *  - On every requests update: diff against last-seen statuses, create a
 *    notification entry per changed request (max 30 stored).
 *  - Bell icon shows unread count badge.
 *  - Click bell → dropdown panel with feed; clicking opens marks it read,
 *    "Mark all read" button clears unread count.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, CheckCheck, X, Check, Truck, XCircle, Clock, PackageCheck, BellRing } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { PickupRequest } from "@/lib/pickupApi";
import {
  getPushCapability,
  getCurrentPermission,
  getExistingSubscription,
  enablePushNotifications,
  disablePushNotifications,
} from "@/lib/webPushClient";

/* ─── Web Push notifications ─────────────────────────────────────
 *
 * Uses a Service Worker + VAPID-signed Web Push so notifications fire
 * even when AgriCycle is fully closed. The server side stores per-user
 * subscriptions and triggers pushes on pickup status changes.
 */
type PermState = NotificationPermission | "unsupported";

type Role = "farmer" | "aggregator";
type Status = PickupRequest["status"];

interface Notification {
  id:        string;
  requestId: number;
  cropType:  string;
  fromStatus: Status | "new";
  toStatus:   Status;
  message:   string;
  ts:        number;
  read:      boolean;
}

const MAX_FEED = 30;

function statusLabel(s: Status): string {
  switch (s) {
    case "pending":   return "Pending";
    case "accepted":  return "Accepted";
    case "collected": return "Collected";
    case "cancelled": return "Cancelled";
  }
}

function buildMessage(req: PickupRequest, from: Status | "new", to: Status, role: Role): string {
  const crop = req.cropType || "Crop";
  if (role === "farmer") {
    if (from === "new" && to === "pending")     return `Pickup request for ${crop} created.`;
    if (to === "accepted")                       return `Aggregator accepted your ${crop} pickup. Get ready!`;
    if (to === "collected")                      return `${crop} pickup completed — payment processed.`;
    if (to === "cancelled")                      return `Your ${crop} pickup was cancelled.`;
  } else {
    if (from === "new" && to === "pending")     return `New ${crop} pickup request available nearby.`;
    if (to === "accepted")                       return `You accepted a ${crop} pickup.`;
    if (to === "collected")                      return `${crop} pickup marked as collected.`;
    if (to === "cancelled")                      return `A ${crop} pickup you accepted was cancelled.`;
  }
  return `${crop} pickup is now ${statusLabel(to)}.`;
}

function statusIcon(s: Status) {
  if (s === "accepted")  return <Check     className="w-4 h-4 text-blue-600" />;
  if (s === "collected") return <PackageCheck className="w-4 h-4 text-emerald-600" />;
  if (s === "cancelled") return <XCircle   className="w-4 h-4 text-red-600" />;
  return                     <Clock     className="w-4 h-4 text-amber-600" />;
}

function timeAgo(ts: number): string {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60)        return `${sec}s ago`;
  if (sec < 3600)      return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400)     return `${Math.floor(sec / 3600)}h ago`;
  return                      `${Math.floor(sec / 86400)}d ago`;
}

export function NotificationBell({ requests, userId, role }: {
  requests: PickupRequest[];
  userId:   number | string;
  role:     Role;
}) {
  const lastSeenKey = `agricycle_notifs_seen:${role}:${userId}`;
  const feedKey     = `agricycle_notifs_feed:${role}:${userId}`;

  const [feed, setFeed]   = useState<Notification[]>(() => {
    try { return JSON.parse(localStorage.getItem(feedKey) ?? "[]"); } catch { return []; }
  });
  const [open, setOpen]   = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Web push subscription state
  const [permission, setPermission] = useState<PermState>(
    () => getPushCapability() === "unsupported" ? "unsupported" : getCurrentPermission(),
  );
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [pushBusy, setPushBusy]       = useState<boolean>(false);
  const [pushError, setPushError]     = useState<string | null>(null);

  // On mount, check whether this browser has an active subscription
  useEffect(() => {
    if (getPushCapability() === "unsupported") return;
    getExistingSubscription()
      .then(sub => setPushEnabled(!!sub))
      .catch(() => {});
  }, [userId]);

  const togglePush = useCallback(async () => {
    if (permission === "unsupported") return;
    setPushError(null);
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
      } else {
        await enablePushNotifications();
        setPushEnabled(true);
        setPermission(getCurrentPermission());
      }
    } catch (e: any) {
      setPushError(e?.message ?? "Could not update notification settings");
      setPermission(getCurrentPermission());
    } finally {
      setPushBusy(false);
    }
  }, [permission, pushEnabled]);

  // Detect status transitions and append notifications
  useEffect(() => {
    if (!requests) return;
    let lastSeen: Record<string, Status>;
    let firstRun = false;
    try {
      const raw = localStorage.getItem(lastSeenKey);
      if (raw) {
        lastSeen = JSON.parse(raw);
      } else {
        lastSeen = {};
        firstRun = true;
      }
    } catch { lastSeen = {}; firstRun = true; }

    const next: Record<string, Status> = {};
    const newEntries: Notification[] = [];
    for (const req of requests) {
      const id = String(req.id);
      next[id] = req.status;
      if (firstRun) continue; // snapshot only, no backfill spam
      const prev = lastSeen[id];
      if (prev === req.status) continue;
      const fromStatus: Status | "new" = prev ?? "new";
      newEntries.push({
        id:         `${id}-${req.status}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        requestId:  req.id,
        cropType:   req.cropType,
        fromStatus,
        toStatus:   req.status,
        message:    buildMessage(req, fromStatus, req.status, role),
        ts:         Date.now(),
        read:       false,
      });
    }

    try { localStorage.setItem(lastSeenKey, JSON.stringify(next)); } catch {}

    if (newEntries.length) {
      setFeed(prev => {
        const merged = [...newEntries, ...prev].slice(0, MAX_FEED);
        try { localStorage.setItem(feedKey, JSON.stringify(merged)); } catch {}
        return merged;
      });
    }
  }, [requests, lastSeenKey, feedKey, role]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = useMemo(() => feed.filter(n => !n.read).length, [feed]);

  const markAllRead = () => {
    setFeed(prev => {
      const next = prev.map(n => ({ ...n, read: true }));
      try { localStorage.setItem(feedKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const markRead = (id: string) => {
    setFeed(prev => {
      const next = prev.map(n => n.id === id ? { ...n, read: true } : n);
      try { localStorage.setItem(feedKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const clearAll = () => {
    setFeed([]);
    try { localStorage.removeItem(feedKey); } catch {}
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(o => !o); }}
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className="relative p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-[340px] sm:w-[380px] max-h-[480px] bg-white rounded-2xl shadow-2xl border border-border z-50 overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />
                <p className="font-bold text-sm text-foreground">Notifications</p>
                {unread > 0 && (
                  <span className="text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">{unread} new</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {feed.length > 0 && unread > 0 && (
                  <button onClick={markAllRead}
                    className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:bg-primary/10 px-2 py-1 rounded-md">
                    <CheckCheck className="w-3 h-3" /> Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground" aria-label="Close">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Push notification toggle */}
            {permission !== "unsupported" && (
              <div className={`px-4 py-2.5 border-b flex items-center gap-3 ${
                pushEnabled ? "bg-emerald-50/60" : "bg-amber-50/40"
              }`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  pushEnabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}>
                  {pushEnabled ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground leading-tight">
                    {permission === "denied"
                      ? "Browser notifications blocked"
                      : pushEnabled
                        ? "Push alerts on"
                        : "Get push alerts on this device"}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {permission === "denied"
                      ? "Allow notifications for this site in your browser settings."
                      : pushEnabled
                        ? "You'll be notified about pickup updates even when AgriCycle is closed."
                        : "Get notified about pickup updates even when AgriCycle is closed."}
                  </p>
                  {pushError && <p className="text-[10px] text-red-600 leading-tight mt-1">{pushError}</p>}
                </div>
                {permission !== "denied" && (
                  <button
                    onClick={togglePush}
                    disabled={pushBusy}
                    className={`text-[11px] font-bold rounded-lg px-3 py-1.5 shrink-0 transition-colors disabled:opacity-50 ${
                      pushEnabled
                        ? "bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        : "bg-primary text-white hover:bg-primary/90"
                    }`}
                  >
                    {pushBusy ? "..." : pushEnabled ? "Turn off" : "Turn on"}
                  </button>
                )}
              </div>
            )}

            <div className="overflow-y-auto flex-1">
              {feed.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <Bell className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">You're all caught up</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {role === "farmer"
                      ? "We'll notify you when an aggregator responds to your pickup requests."
                      : "We'll notify you when farmers in your area request a pickup."}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {feed.map(n => (
                    <li key={n.id}>
                      <button
                        onClick={() => markRead(n.id)}
                        className={`w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors ${
                          n.read ? "" : "bg-primary/5"
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                          {n.toStatus === "accepted"  ? <Truck className="w-4 h-4 text-blue-600" />
                          : n.toStatus === "collected" ? <PackageCheck className="w-4 h-4 text-emerald-600" />
                          : n.toStatus === "cancelled" ? <XCircle className="w-4 h-4 text-red-600" />
                          : statusIcon(n.toStatus)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm leading-snug ${n.read ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                            {n.message}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Request #{n.requestId} · {timeAgo(n.ts)}
                          </p>
                        </div>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" aria-label="unread" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {feed.length > 0 && (
              <div className="border-t px-4 py-2 bg-muted/20 flex justify-end">
                <button onClick={clearAll}
                  className="text-[11px] font-semibold text-muted-foreground hover:text-red-600">
                  Clear all
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
