/**
 * webPushClient.ts — Browser-side Web Push subscription helpers.
 *
 * Handles service worker registration, fetching the VAPID public key,
 * subscribing/unsubscribing via PushManager, and syncing the subscription
 * to the AgriCycle backend so it can send push messages while the app is
 * fully closed.
 */

const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

export type PushSupport = "unsupported" | "ok";

export function getPushCapability(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window)) return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return "ok";
}

export function getCurrentPermission(): NotificationPermission {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;
async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker.register(SW_URL, {
      scope: import.meta.env.BASE_URL,
    });
  }
  const reg = await swRegistrationPromise;
  await navigator.serviceWorker.ready;
  return reg;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidPublicKey(): Promise<string> {
  const r = await fetch("/api/push/vapid-public-key", { credentials: "include" });
  if (!r.ok) throw new Error("Could not fetch VAPID public key");
  const data = await r.json();
  return data.publicKey as string;
}

function subscriptionToJSON(sub: PushSubscription) {
  const j = sub.toJSON();
  return {
    endpoint: j.endpoint!,
    keys: {
      p256dh: j.keys?.p256dh ?? "",
      auth:   j.keys?.auth ?? "",
    },
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  };
}

/** Returns the existing subscription (if any) without prompting. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (getPushCapability() === "unsupported") return null;
  const reg = await getRegistration();
  return reg.pushManager.getSubscription();
}

/**
 * Requests permission (if needed), subscribes via PushManager, and POSTs
 * the subscription to the server. Returns the subscription on success.
 */
export async function enablePushNotifications(): Promise<PushSubscription> {
  if (getPushCapability() === "unsupported") {
    throw new Error("This browser does not support web push");
  }

  let perm = Notification.permission;
  if (perm === "default") {
    perm = await Notification.requestPermission();
  }
  if (perm !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const publicKey = await fetchVapidPublicKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscriptionToJSON(sub)),
  });
  if (!r.ok) {
    throw new Error("Could not register subscription with server");
  }

  return sub;
}

/** Unsubscribes from PushManager and tells the server to forget us. */
export async function disablePushNotifications(): Promise<void> {
  if (getPushCapability() === "unsupported") return;
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch {}
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {}
}
