/**
 * ProfilePanel.tsx — Slide-in profile drawer (view + edit) for all roles.
 *
 * Features:
 *  - Shows name, phone, role, location, GPS coordinates
 *  - Editable fields: name, location
 *  - GPS: auto-detect via browser geolocation + map pin via Leaflet
 *  - Save button calls PUT /api/users/profile
 *  - Multilingual (useLang)
 */

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, User, Phone, MapPin, Edit3, Save, Navigation, CheckCircle2,
  Loader2, Building2, Tractor, Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateProfile } from "@/lib/pickupApi";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLang } from "@/contexts/LanguageContext";
import L from "leaflet";

interface UserData {
  id: number;
  name: string;
  phone: string;
  role: "farmer" | "aggregator" | "factory";
  location: string;
  lat?: number | null;
  lng?: number | null;
}

interface ProfilePanelProps {
  user: UserData;
  onClose: () => void;
  onUpdate: (updated: Partial<UserData>) => void;
}

const ROLE_META = {
  farmer:     { icon: Tractor,  color: "text-green-700",   bg: "bg-green-100",   label: "Farmer"     },
  aggregator: { icon: Truck,    color: "text-amber-700",   bg: "bg-amber-100",   label: "Aggregator" },
  factory:    { icon: Building2, color: "text-slate-700",  bg: "bg-slate-100",   label: "Factory"    },
};

function LocationMap({
  lat, lng, onPick,
}: {
  lat: number; lng: number;
  onPick: (lat: number, lng: number) => void;
}) {
  const mapRef  = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInst.current) return;

    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView([lat, lng], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onPick(pos.lat, pos.lng);
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onPick(e.latlng.lat, e.latlng.lng);
    });

    mapInst.current = map;
    markerRef.current = marker;
  }, []);

  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      mapInst.current?.setView([lat, lng], 13, { animate: true });
    }
  }, [lat, lng]);

  return <div ref={mapRef} className="h-48 w-full rounded-xl overflow-hidden border z-0" />;
}

export function ProfilePanel({ user, onClose, onUpdate }: ProfilePanelProps) {
  const { t } = useLang();
  const [editing, setEditing]       = useState(false);
  const [name, setName]             = useState(user.name);
  const [location, setLocation]     = useState(user.location);
  const [lat, setLat]               = useState<number>(user.lat ?? 30.9010);
  const [lng, setLng]               = useState<number>(user.lng ?? 75.8573);
  const [hasGps, setHasGps]         = useState(!!(user.lat && user.lng));
  const [gpsLoading, setGpsLoading] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [showMap, setShowMap]       = useState(false);

  const roleMeta = ROLE_META[user.role];
  const RoleIcon = roleMeta.icon;
  const roleLabel =
    user.role === "farmer" ? t("roleFarmer") :
    user.role === "aggregator" ? t("roleAggregator") :
    t("roleFactory");

  const detectGps = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setHasGps(true);
        setGpsLoading(false);
        setShowMap(true);
      },
      () => {
        setGpsLoading(false);
        setShowMap(true); // let them pin manually
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateProfile({
        name,
        location,
        lat: hasGps ? lat : null,
        lng: hasGps ? lng : null,
      });
      onUpdate(updated);
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* ignore errors — user can retry */
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }} transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="bg-card rounded-t-3xl sm:rounded-3xl border shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0", roleMeta.bg)}>
              <RoleIcon className={cn("w-6 h-6", roleMeta.color)} />
            </div>
            <div>
              <p className={cn("text-xs font-bold uppercase tracking-wider", roleMeta.color)}>{roleLabel}</p>
              <p className="font-bold text-foreground text-lg leading-tight">{user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!editing && (
              <button onClick={() => setEditing(true)}
                className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                <Edit3 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose}
              className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <LanguageSelector />

          {/* Phone (never editable) */}
          <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-xl">
            <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground font-medium">Phone</p>
              <p className="text-sm font-semibold text-foreground">{user.phone}</p>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Full Name</label>
            {editing ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none bg-background text-foreground font-medium transition-colors"
              />
            ) : (
              <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-xl">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">{name}</span>
              </div>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Location</label>
            {editing ? (
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Amritsar, Punjab"
                className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none bg-background text-foreground font-medium transition-colors"
              />
            ) : (
              <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-xl">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">{location}</span>
              </div>
            )}
          </div>

          {/* GPS */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
              GPS Coordinates {hasGps && <span className="text-green-600 normal-case font-medium">✓ Saved</span>}
            </label>
            {editing ? (
              <div className="space-y-2">
                <button
                  onClick={detectGps}
                  disabled={gpsLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/40 text-primary font-semibold hover:bg-primary/5 transition-colors"
                >
                  {gpsLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Detecting…</>
                    : <><Navigation className="w-4 h-4" /> Use My Current Location</>}
                </button>
                <button
                  onClick={() => setShowMap(v => !v)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                >
                  {showMap ? "Hide map" : "Or pin on map"}
                </button>
                {showMap && (
                  <LocationMap
                    lat={lat} lng={lng}
                    onPick={(la, lo) => { setLat(la); setLng(lo); setHasGps(true); }}
                  />
                )}
                {hasGps && (
                  <p className="text-xs text-center text-muted-foreground">
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </p>
                )}
              </div>
            ) : hasGps ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                <Navigation className="w-4 h-4 text-green-600" />
                <span className="text-xs font-semibold text-green-800">
                  {(user.lat ?? lat).toFixed(4)}, {(user.lng ?? lng).toFixed(4)}
                </span>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium">
                No GPS saved — click Edit to add your location
              </div>
            )}
          </div>

          {/* Actions */}
          {editing && (
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button className="flex-1 rounded-xl gap-2" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : <><Save className="w-4 h-4" /> Save Profile</>}
              </Button>
            </div>
          )}

          {saved && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 justify-center text-green-700 font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" /> Profile updated!
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
