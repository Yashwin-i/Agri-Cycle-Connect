import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigation, Loader2, Search, MapPin, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Place {
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void | Promise<void>;
  className?: string;
  defaultLat?: number;
  defaultLng?: number;
  accent?: "emerald" | "indigo";
}

export function LocationPicker({
  lat,
  lng,
  onPick,
  className,
  defaultLat = 30.901,
  defaultLng = 75.8573,
  accent = "emerald",
}: Props) {
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(lat == null || lng == null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const accentBtn =
    accent === "indigo"
      ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600"
      : "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600";
  const accentOutline =
    accent === "indigo"
      ? "border-indigo-300 text-indigo-700 hover:bg-indigo-50"
      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50";

  const detect = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError("Your browser blocked GPS. Use search or pin on map below.");
      setShowMap(true);
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await onPick(pos.coords.latitude, pos.coords.longitude);
        setDetecting(false);
      },
      () => {
        setError("GPS blocked or unavailable. Search your village or drop a pin on the map.");
        setShowMap(true);
        setDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q + ", India")}`;
      const r = await fetch(url, { headers: { "Accept-Language": "en" } });
      const json: Place[] = await r.json();
      setResults(json);
      if (json.length === 0) setError("No matches found. Try a nearby town or village name.");
    } catch {
      setError("Search failed. Check your internet.");
    } finally {
      setSearching(false);
    }
  };

  const pickPlace = async (p: Place) => {
    const la = parseFloat(p.lat);
    const lo = parseFloat(p.lon);
    setResults([]);
    setQuery(p.display_name);
    await onPick(la, lo);
    setShowMap(true);
  };

  const submitManual = async () => {
    const la = parseFloat(manualLat);
    const lo = parseFloat(manualLng);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      setError("Enter valid latitude (-90 to 90) and longitude (-180 to 180).");
      return;
    }
    setError(null);
    await onPick(la, lo);
  };

  // init map
  useEffect(() => {
    if (!showMap) return;
    if (!mapRef.current || mapInstanceRef.current) return;
    const startLat = lat ?? defaultLat;
    const startLng = lng ?? defaultLng;
    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false }).setView([startLat, startLng], 13);
    mapInstanceRef.current = map;
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles © Esri",
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([startLat, startLng], { draggable: true })
      .addTo(map)
      .bindPopup("Drag or tap the map to pin your location")
      .openPopup();
    markerRef.current = marker;

    marker.on("dragend", async () => {
      const p = marker.getLatLng();
      await onPick(p.lat, p.lng);
    });
    map.on("click", async (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      await onPick(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
  }, [showMap]);

  useEffect(() => {
    if (lat != null && lng != null && markerRef.current && mapInstanceRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      mapInstanceRef.current.setView([lat, lng], 14, { animate: true });
    }
  }, [lat, lng]);

  return (
    <div className={cn("space-y-3", className)}>
      {lat != null && lng != null && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm">
          <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-green-800">Location saved</p>
            <p className="text-xs text-green-700 truncate">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={detect}
          disabled={detecting}
          className={cn("flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border-2 transition-colors", accentBtn)}
        >
          {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
          {detecting ? "Detecting…" : "Use my GPS"}
        </button>
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className={cn("flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border-2 bg-white", accentOutline)}
        >
          <MapPin className="w-4 h-4" />
          {showMap ? "Hide map" : "Pin on map"}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(query); } }}
              placeholder="Search village, town or city (e.g. Ludhiana, Punjab)"
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            onClick={() => runSearch(query)}
            disabled={searching || !query.trim()}
            className={cn("px-4 py-2.5 rounded-xl text-sm font-semibold border-2", accentOutline)}
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
          </button>
        </div>
        {results.length > 0 && (
          <div className="rounded-xl border border-border bg-white divide-y max-h-56 overflow-y-auto">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickPlace(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 flex items-start gap-2"
              >
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <span className="flex-1">{r.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showMap && (
        <div className="space-y-2">
          <div ref={mapRef} className="h-56 w-full rounded-xl overflow-hidden border z-0" />
          <p className="text-[11px] text-muted-foreground text-center">
            Tap or drag the pin to mark your exact location.
          </p>
        </div>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Enter coordinates manually</summary>
        <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
          <input
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            placeholder="Latitude"
            className="px-2 py-1.5 rounded-lg border border-border bg-white text-foreground"
          />
          <input
            value={manualLng}
            onChange={(e) => setManualLng(e.target.value)}
            placeholder="Longitude"
            className="px-2 py-1.5 rounded-lg border border-border bg-white text-foreground"
          />
          <button
            type="button"
            onClick={submitManual}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border-2", accentOutline)}
          >
            Save
          </button>
        </div>
      </details>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}
