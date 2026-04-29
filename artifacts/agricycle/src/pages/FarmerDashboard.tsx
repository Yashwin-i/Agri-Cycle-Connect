/**
 * FarmerDashboard.tsx
 *
 * RURAL USABILITY DESIGN PRINCIPLES
 * ───────────────────────────────────
 *  1. Low literacy / non-English speakers
 *     → All UI text comes from the i18n translation table (useLang/t()).
 *     → SpeakButton reads instructions and results aloud via TTS.
 *
 *  2. Outdoor screens in bright sunlight
 *     → Minimum font size text-base (16 px) throughout.
 *     → Accessibility Mode further enlarges fonts/buttons for impaired vision.
 *
 *  3. Slow 2G/3G mobile internet
 *     → Low Internet Mode compresses uploaded images (~10–15× smaller).
 *     → React.lazy() in App.tsx means this chunk only downloads on demand.
 *
 *  4. Low-cost Android phones with imprecise touch
 *     → All interactive targets are min-h-[48px] or larger (WCAG 2.5.5).
 *     → Accessibility Mode raises all targets to min-h-[56px]/h-16.
 *
 * SMART IMAGE ANALYSIS (simulated computer vision)
 * ─────────────────────────────────────────────────
 *  The AI pipeline is simulated using deterministic heuristics:
 *   1. Validate file type + minimum size (reject blank/corrupted files)
 *   2. Detect crop from image filename keywords (rice, wheat, maize …)
 *   3. Apply PAU residue factor with ±10 % random variation for realism
 *   4. Generate confidence score (base confidence ± small random noise)
 *  Comment: "This simulates a computer vision model using heuristics"
 *
 * FARMER ↔ AGGREGATOR CONNECTION
 * ────────────────────────────────
 *  When the farmer clicks "Request Pickup" the app posts the current AI
 *  result to POST /api/pickup-requests (pickupApi.ts).  It then polls
 *  GET /api/pickup-requests every 10 seconds so the farmer sees real-time
 *  status updates ("Pending" → "Scheduled by aggregator").
 */

import "leaflet/dist/leaflet.css";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Tractor, MapPin, Phone, LogOut, Leaf, Star,
  Camera, FlaskConical, Truck, Gift,
  CheckCircle2, Sprout, Flame,
  ChevronRight, Award, Coins, ImagePlus, X,
  Wifi, WifiOff, Accessibility, AlertTriangle,
  ClipboardList, Clock, UserCircle, Navigation, Loader2, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/contexts/LanguageContext";
import { SpeakButton } from "@/components/SpeakButton";
import { LanguageSelector } from "@/components/LanguageSelector";
import { compressImage } from "@/lib/imageCompressor";
import {
  createPickupRequest,
  listPickupRequests,
  extendPickupDeadline,
  updateProfile,
  geoFromLocation,
  formatTimeAgo,
  formatDate,
  daysUntil,
  type PickupRequest,
} from "@/lib/pickupApi";
import { ProfilePanel } from "@/components/ProfilePanel";
import { WeatherWarning } from "@/components/WeatherWarning";
import { LocationPicker } from "@/components/LocationPicker";
import { WeatherAlertToast } from "@/components/WeatherAlertToast";
import { DisposalMethods } from "@/components/DisposalMethods";
import { NotificationBell } from "@/components/NotificationBell";
import L from "leaflet";

/* ─── Types ───────────────────────────────────────────────────── */
interface AiResult {
  cropType: string;
  cropKey: string;
  cropIcon?: string;
  residueFactor: number;
  biomassEstimate: number;
  qualityRating: number;
  gradeLabel?: string;
  confidence: number;
  recommendation: string;
  bestUse: string;
  pricePerTon: number;
  detectedFromFilename: boolean;
  notes?: string;
  issues?: string[];
  residueColorNotes?: string;
  photosAnalyzed?: number;
}

/* ─── Crop Residue Data (PAU coefficients) ────────────────────── */
const RESIDUE_FACTORS: Record<string, {
  cropType: string; residueFactor: number; qualityRating: number;
  confidence: number; recommendation: string; bestUse: string;
  pricePerTon: number; icon: string;
  /** keywords that trigger automatic detection from image filename */
  filenameKeywords: string[];
}> = {
  wheat: {
    cropType: "Wheat Straw", residueFactor: 1.82, qualityRating: 4, confidence: 94,
    recommendation: "High silica content makes this excellent for paper pulp, biogas digesters, and mushroom substrate.",
    bestUse: "Biogas / Paper Mill", pricePerTon: 1150, icon: "🌾",
    filenameKeywords: ["wheat", "gehun", "gehu"],
  },
  rice: {
    cropType: "Rice Straw", residueFactor: 2.54, qualityRating: 5, confidence: 97,
    recommendation: "Premium quality stubble. Ideal for briquetting, ethanol production, and co-generation power plants.",
    bestUse: "Briquettes / Ethanol", pricePerTon: 950, icon: "🌿",
    filenameKeywords: ["rice", "paddy", "dhan", "chawal"],
  },
  maize: {
    cropType: "Maize Residue", residueFactor: 1.47, qualityRating: 3, confidence: 89,
    recommendation: "Moderate quality. Good for compost, biochar production, and cattle feed after treatment.",
    bestUse: "Compost / Biochar", pricePerTon: 830, icon: "🌽",
    filenameKeywords: ["maize", "corn", "makka", "maka"],
  },
  sugarcane: {
    cropType: "Sugarcane Bagasse", residueFactor: 3.50, qualityRating: 5, confidence: 96,
    recommendation: "Excellent calorific value. Preferred fuel source for co-generation and distillery boilers.",
    bestUse: "Co-generation Fuel", pricePerTon: 780, icon: "🎋",
    filenameKeywords: ["sugarcane", "ganna", "sugar"],
  },
  cotton: {
    cropType: "Cotton Stalks", residueFactor: 1.05, qualityRating: 3, confidence: 88,
    recommendation: "Dense woody structure. Suitable for particle board manufacturing and briquetting.",
    bestUse: "Particle Board", pricePerTon: 1050, icon: "☁️",
    filenameKeywords: ["cotton", "narma", "kapas"],
  },
};

/**
 * SMART HEURISTIC CROP DETECTION
 * ─────────────────────────────────
 * This simulates a computer vision model using heuristics.
 *
 * Priority order:
 *   1. Explicit user selection (cropTypeOverride) — highest confidence
 *   2. Filename keyword match — second priority
 *   3. Weighted random fallback biased toward rice (most common in Punjab)
 *
 * The ±10 % variation on residueFactor and ±3 % on confidence simulates
 * the natural variance of a real regression model across field conditions
 * (moisture content, straw density, plot heterogeneity).
 */
function detectCropFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase().replace(/[^a-z]/g, " ");
  for (const [key, meta] of Object.entries(RESIDUE_FACTORS)) {
    if (meta.filenameKeywords.some(kw => lower.includes(kw))) {
      return key;
    }
  }
  return null;
}

function weightedRandomCrop(): string {
  // Punjab stubble is predominantly rice (70 %) and wheat (20 %)
  const rand = Math.random();
  if (rand < 0.70) return "rice";
  if (rand < 0.90) return "wheat";
  if (rand < 0.95) return "maize";
  if (rand < 0.98) return "sugarcane";
  return "cotton";
}

function buildAiResult(
  cropKey: string,
  areaNum: number,
  detectedFromFilename: boolean,
): AiResult {
  // This simulates a computer vision model using heuristics
  const meta = RESIDUE_FACTORS[cropKey] ?? RESIDUE_FACTORS.wheat;

  // ±10 % variation on residue factor — models real field heterogeneity
  const variation = 1 + (Math.random() * 0.2 - 0.1);
  const adjustedFactor = parseFloat((meta.residueFactor * variation).toFixed(2));
  const biomass = parseFloat((areaNum * adjustedFactor).toFixed(2));

  // ±3 % confidence variation — mirrors classifier softmax uncertainty
  const confNoise = Math.floor(Math.random() * 6 - 3);
  const confidence = Math.min(99, Math.max(75, meta.confidence + confNoise));

  return {
    cropKey,
    cropType:        meta.cropType,
    residueFactor:   adjustedFactor,
    biomassEstimate: biomass,
    qualityRating:   meta.qualityRating,
    confidence,
    recommendation:  meta.recommendation,
    bestUse:         meta.bestUse,
    pricePerTon:     meta.pricePerTon,
    detectedFromFilename,
  };
}

/**
 * SIMULATED COMPUTER VISION PIPELINE STAGES
 * Each stage maps to a real inference step that would run server-side:
 *   1. Preprocess → resize, normalise, EXIF-strip
 *   2. Segment    → DeepLabV3+ residue mask
 *   3. Classify   → EfficientNet-B4 5-class classifier
 *   4. Estimate   → Biomass regression (area × NDVI density)
 */
const CV_PIPELINE_STAGES = [
  { id: "validate",   label: "Validating image",         detail: "Checking file format, size & quality",          icon: "🔍", durationMs: 600  },
  { id: "preprocess", label: "Preprocessing image",      detail: "Normalising colour channels & EXIF data",       icon: "🔬", durationMs: 900  },
  { id: "segment",    label: "Semantic segmentation",    detail: "Identifying crop residue regions in frame",     icon: "🗺️",  durationMs: 1100 },
  { id: "classify",   label: "Crop type classification", detail: "Running EfficientNet-B4 classifier (heuristic)",icon: "🌾", durationMs: 900  },
  { id: "estimate",   label: "Biomass estimation",       detail: "Applying residue factor × field area formula",  icon: "📊", durationMs: 700  },
];

const CROP_OPTIONS = [
  { value: "wheat",     label: "🌾 Wheat Straw" },
  { value: "rice",      label: "🌿 Rice Straw" },
  { value: "maize",     label: "🌽 Maize Residue" },
  { value: "sugarcane", label: "🎋 Sugarcane" },
  { value: "cotton",    label: "☁️ Cotton Stalks" },
];

/* ─── Sub-components ──────────────────────────────────────────── */
function SectionCard({
  children, delay = 0, a11y = false,
}: {
  children: React.ReactNode; delay?: number; a11y?: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}
      className={`bg-card rounded-3xl border shadow-sm overflow-hidden ${a11y ? "border-2" : ""}`}>
      {children}
    </motion.div>
  );
}

function SectionHeader({ icon, title, badge, children }: {
  icon: React.ReactNode; title: string; badge?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b">
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
        {icon}
      </div>
      <h2 className="text-lg font-bold text-foreground flex-1">{title}</h2>
      {children}
      {badge && (
        <span className="text-xs font-semibold bg-primary/10 text-primary px-2.5 py-1 rounded-full">{badge}</span>
      )}
    </div>
  );
}

/* ─── 1. Upload Section ───────────────────────────────────────── */
const MAX_IMAGES = 1;

interface FieldPhoto { url: string; filename: string; file: File; }

function UploadSection({
  onAnalyze, lowInternet, a11y, analyzing, analyzeError,
}: {
  onAnalyze: (crop: string, area: string, photos: FieldPhoto[]) => void;
  lowInternet: boolean;
  a11y: boolean;
  analyzing: boolean;
  analyzeError: string | null;
}) {
  const { t } = useLang();
  const [photos, setPhotos]             = useState<FieldPhoto[]>([]);
  const [cropType, setCropType]         = useState("");
  const [fieldArea, setFieldArea]       = useState("");
  const [dragging, setDragging]         = useState(false);
  const [compressInfo, setCompressInfo] = useState<string | null>(null);
  const [compressing, setCompressing]   = useState(false);
  const [fileError, setFileError]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * handleFile — validates and processes the selected image.
   *
   * VALIDATION (simulates server-side checks):
   *   • Must be an image/* MIME type
   *   • Must be at least 5 KB (rejects blank screenshots or placeholder files)
   *
   * LOW INTERNET MODE: compresses via Canvas API before storing in state.
   * This simulates reducing the upload payload before sending to the server.
   */
  const handleFiles = useCallback(async (files: File[]) => {
    setFileError(null);
    setCompressInfo(null);

    const remainingSlots = MAX_IMAGES - photos.length;
    if (remainingSlots <= 0) {
      setFileError(`Only ${MAX_IMAGES} photo allowed. Remove the current one to add another.`);
      return;
    }

    const accepted = files.slice(0, remainingSlots);
    const newPhotos: FieldPhoto[] = [];
    setCompressing(true);
    try {
      for (const file of accepted) {
        if (!file.type.startsWith("image/")) {
          setFileError("Please upload image files only (JPG, PNG, HEIC).");
          continue;
        }
        if (file.size < 5 * 1024) {
          setFileError("One of the images appears blank or too small.");
          continue;
        }
        try {
          // Compress to a smaller JPEG so uploads stay fast on slow connections
          const maxDim = lowInternet ? 800 : 1280;
          const quality = lowInternet ? 0.65 : 0.78;
          const result = await compressImage(file, { maxDimension: maxDim, quality });
          const jpegName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          const compressedFile = new File([result.blob], jpegName, { type: "image/jpeg" });
          const previewUrl = URL.createObjectURL(result.blob);
          newPhotos.push({ url: previewUrl, filename: jpegName, file: compressedFile });
          if (lowInternet) setCompressInfo(`Compressed: ${result.originalSizeKb} KB → ${result.compressedSizeKb} KB`);
        } catch {
          // Fall back to the original file if canvas decoding fails
          newPhotos.push({ url: URL.createObjectURL(file), filename: file.name, file });
        }
      }
      setPhotos(prev => [...prev, ...newPhotos]);
    } finally {
      setCompressing(false);
    }
  }, [lowInternet, photos.length]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  }, [handleFiles]);

  const removePhoto = (idx: number) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  const canSubmit = photos.length > 0 && fieldArea && !compressing && !analyzing;

  const btnH = a11y ? "h-16 text-xl" : "h-14 text-lg";

  return (
    <SectionCard delay={0.1} a11y={a11y}>
      <SectionHeader icon={<Camera className="w-5 h-5" />} title={t("uploadInstruction")} badge={t("step1Badge")}>
        <SpeakButton text={`${t("uploadInstruction")}. ${t("uploadHint")}`} iconOnly />
      </SectionHeader>
      <div className="p-6 space-y-5">

        {/* Instruction hint */}
        <div className={`flex items-start gap-3 p-3 bg-primary/5 rounded-2xl border border-primary/15 ${a11y ? "p-4" : ""}`}>
          <Camera className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <p className={`font-medium text-foreground leading-relaxed flex-1 ${a11y ? "text-lg" : "text-sm"}`}>
            {t("uploadHint")}
          </p>
        </div>

        {/* Photo gallery / drop zone */}
        <div className="space-y-3">
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p, idx) => (
                <div key={idx} className="relative rounded-xl overflow-hidden border-2 border-emerald-200 bg-muted/30 aspect-square">
                  <img src={p.url} alt={`Field ${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80"
                    aria-label="Remove photo"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-[10px] text-white font-bold p-1.5 truncate">
                    Photo {idx + 1}
                  </div>
                </div>
              ))}
              {photos.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => !compressing && fileRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-primary/40 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center text-primary transition-colors"
                >
                  <ImagePlus className="w-7 h-7 mb-1" />
                  <span className="text-xs font-bold">Add photo</span>
                  <span className="text-[10px] text-muted-foreground">{photos.length}/{MAX_IMAGES}</span>
                  <span className="sr-only">Replace your photo by removing the current one first.</span>
                </button>
              )}
            </div>
          )}

          {photos.length === 0 && (
            <div
              onClick={() => !compressing && fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`relative rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 flex flex-col items-center justify-center text-center min-h-[200px] overflow-hidden
                ${dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-muted/40"}
              `}
            >
              {compressing ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm font-medium text-muted-foreground">{t("compressingImg")}</p>
                </div>
              ) : (
                <div className="py-10 px-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <ImagePlus className="w-8 h-8 text-primary" />
                  </div>
                  <p className={`font-bold text-foreground mb-1 ${a11y ? "text-xl" : "text-lg"}`}>{t("uploadButton")}</p>
                  <p className={`text-muted-foreground ${a11y ? "text-base" : "text-sm"}`}>Add 1 clear photo of the residue for AI analysis</p>
                </div>
              )}
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) handleFiles(files);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
        </div>

        {/* Validation error */}
        {fileError && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {fileError}
          </div>
        )}

        {/* Compression info */}
        {compressInfo && (
          <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            {compressInfo}
          </div>
        )}

        {/* Crop selector */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className={`block font-bold text-foreground ${a11y ? "text-lg" : "text-base"}`}>{t("cropTypeLabel")}</label>
            {cropType && (
              <button type="button" onClick={() => setCropType("")}
                className="text-xs font-semibold text-muted-foreground hover:text-primary underline-offset-2 hover:underline">
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {CROP_OPTIONS.map((opt) => {
              const selected = cropType === opt.value;
              return (
                <button key={opt.value} type="button"
                  onClick={() => setCropType(selected ? "" : opt.value)}
                  aria-pressed={selected}
                  className={`rounded-xl border-2 font-bold transition-all text-left min-h-[48px]
                    ${a11y ? "py-4 px-4 text-base" : "py-3 px-4 text-sm"}
                    ${selected ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground hover:border-primary/40"}`}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Field area */}
        <div>
          <label className={`block font-bold text-foreground mb-2 ${a11y ? "text-lg" : "text-base"}`}>{t("fieldAreaLabel")}</label>
          <div className="relative">
            <input type="number" min="0.1" step="0.1" placeholder="e.g. 2.5" value={fieldArea}
              onChange={(e) => setFieldArea(e.target.value)}
              className={`w-full rounded-xl border bg-background px-4 pr-20 text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition
                ${a11y ? "py-4 text-xl h-16" : "py-3.5 text-lg h-14"}`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">{t("acresSuffix")}</span>
          </div>
        </div>

        <Button disabled={!canSubmit} onClick={() => canSubmit && onAnalyze(cropType, fieldArea, photos)}
          className={`w-full rounded-2xl font-bold gap-2 disabled:opacity-50 ${btnH}`}>
          <FlaskConical className="w-5 h-5" />
          {analyzing ? "Analysing photos…" : `${t("analyseButton")}${photos.length > 1 ? ` (${photos.length} photos)` : ""}`}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          Crop type is optional — we'll identify it from your photos.
        </p>
      </div>
    </SectionCard>
  );
}

/* ─── 2a. AI Loading Card ──────────────────────────────────────── */
function AiLoadingCard({ activeStage, a11y }: { activeStage: number; a11y: boolean }) {
  const { t } = useLang();
  return (
    <SectionCard delay={0} a11y={a11y}>
      <SectionHeader icon={<FlaskConical className="w-5 h-5" />} title={t("aiProcessingTitle")} badge={t("aiRunningBadge")} />
      <div className="p-6 space-y-4">
        <div>
          <div className="flex justify-between text-xs font-semibold text-muted-foreground mb-2">
            <span>{t("cvPipelineLabel")}</span>
            <span>{Math.round(((activeStage + 1) / CV_PIPELINE_STAGES.length) * 100)}%</span>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <motion.div animate={{ width: `${((activeStage + 1) / CV_PIPELINE_STAGES.length) * 100}%` }}
              transition={{ duration: 0.5 }}
              className="h-full bg-gradient-to-r from-primary to-green-400 rounded-full" />
          </div>
        </div>
        <div className="space-y-3">
          {CV_PIPELINE_STAGES.map((stage, i) => {
            const done = i < activeStage, active = i === activeStage, pending = i > activeStage;
            return (
              <motion.div key={stage.id} initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: pending ? 0.4 : 1, x: 0 }} transition={{ delay: i * 0.08 }}
                className={`flex items-center gap-4 p-3.5 rounded-2xl border-2 transition-all duration-300 ${
                  active ? "border-primary bg-primary/4 shadow-sm" :
                  done   ? "border-green-200 bg-green-50" : "border-border bg-muted/20"
                }`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg ${active ? "bg-primary/15" : done ? "bg-green-100" : "bg-muted"}`}>
                  {done ? <CheckCircle2 className="w-5 h-5 text-green-600" /> :
                   active ? <div className="w-5 h-5 rounded-full border-[3px] border-primary border-t-transparent animate-spin" /> :
                   <span>{stage.icon}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-bold leading-tight ${done ? "text-green-800" : active ? "text-foreground" : "text-muted-foreground"} ${a11y ? "text-base" : "text-sm"}`}>{stage.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{stage.detail}</p>
                </div>
                {done   && <span className="text-xs font-semibold text-green-700 shrink-0">Done</span>}
                {active && <span className="text-xs font-semibold text-primary shrink-0 animate-pulse">Active</span>}
              </motion.div>
            );
          })}
        </div>
        <p className={`text-center text-muted-foreground pt-1 ${a11y ? "text-base" : "text-sm"}`}>{t("analysisRunning")}</p>
      </div>
    </SectionCard>
  );
}

/* ─── 2b. AI Result Card ────────────────────────────────────────── */
function AiResultCard({ result, fieldArea, a11y }: { result: AiResult; fieldArea: number; a11y: boolean }) {
  const { t } = useLang();
  const earnings = Math.round(result.biomassEstimate * result.pricePerTon);
  const ttsSummary = t(
    "ttsResultSummary",
    result.cropType,
    result.biomassEstimate,
    earnings,
    result.qualityRating,
    result.pricePerTon,
  );

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <SectionCard delay={0} a11y={a11y}>
        <SectionHeader icon={<FlaskConical className="w-5 h-5" />} title={t("resultTitle")} badge="✅ Complete">
          <SpeakButton text={ttsSummary} />
        </SectionHeader>
        <div className="p-6 space-y-5">

          {/* AI source badge */}
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
            <FlaskConical className="w-3.5 h-3.5 shrink-0" />
            <span>
              Analysed from <strong>{result.photosAnalyzed ?? 1} photo{(result.photosAnalyzed ?? 1) > 1 ? "s" : ""}</strong>
              {result.gradeLabel && <> · Grade: <strong>{result.gradeLabel}</strong></>}
            </span>
          </div>

          {/* AI notes */}
          {result.notes && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-1.5">Summary</p>
              <p className={`text-emerald-900 leading-relaxed ${a11y ? "text-base" : "text-sm"}`}>{result.notes}</p>
              {result.residueColorNotes && (
                <p className="text-xs text-emerald-700 mt-2 italic">{result.residueColorNotes}</p>
              )}
            </div>
          )}

          {/* Issues flagged by AI */}
          {result.issues && result.issues.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Issues flagged
              </p>
              <ul className="text-xs text-amber-900 space-y-1 list-disc list-inside">
                {result.issues.map((iss, i) => <li key={i}>{iss}</li>)}
              </ul>
            </div>
          )}

          {/* Confidence */}
          <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/15 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Sprout className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground font-medium mb-1">{t("confidenceLabel")}</p>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${result.confidence}%` }}
                  transition={{ duration: 0.8, delay: 0.2 }} className="h-full bg-primary rounded-full" />
              </div>
            </div>
            <span className={`font-display font-black text-primary shrink-0 ${a11y ? "text-2xl" : "text-lg"}`}>{result.confidence}%</span>
          </div>

          {/* Crop + best use */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 border border-green-100 rounded-2xl p-4">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-1.5">{t("cropDetected")}</p>
              <p className={`font-bold text-green-900 leading-tight ${a11y ? "text-lg" : "text-base"}`}>{result.cropType}</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1.5">{t("bestUseLabel")}</p>
              <p className={`font-bold text-blue-900 leading-tight ${a11y ? "text-lg" : "text-base"}`}>{result.bestUse}</p>
            </div>
          </div>

          {/* Biomass formula */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">{t("biomassLabel")}</p>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <div className="bg-white border border-amber-200 rounded-lg px-3 py-2 text-center min-w-[70px]">
                <p className="text-xs text-amber-700 font-semibold mb-0.5">{t("fieldAreaLabel")}</p>
                <p className="font-black text-foreground">{fieldArea} ac</p>
              </div>
              <span className="text-amber-600 font-bold text-lg">×</span>
              <div className="bg-white border border-amber-200 rounded-lg px-3 py-2 text-center min-w-[80px]">
                <p className="text-xs text-amber-700 font-semibold mb-0.5">Factor</p>
                <p className="font-black text-foreground">{result.residueFactor} t/ac</p>
              </div>
              <span className="text-amber-600 font-bold text-lg">=</span>
              <div className="bg-amber-600 text-white rounded-xl px-4 py-2 text-center">
                <p className="text-xs font-semibold opacity-80 mb-0.5">{t("biomassLabel")}</p>
                <p className={`font-black ${a11y ? "text-xl" : "text-lg"}`}>{result.biomassEstimate.toFixed(2)} t</p>
              </div>
            </div>
            <p className="text-xs text-amber-700">
              Residue factor: <strong>{result.residueFactor} t/acre</strong> — PAU baseline for {result.cropType.toLowerCase()}, adjusted by density assessment of your photos
            </p>
          </div>

          {/* Quality stars */}
          <div className="bg-muted/40 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className={`font-semibold text-foreground ${a11y ? "text-base" : "text-sm"}`}>{t("residueQuality")}</p>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} className={`${a11y ? "w-6 h-6" : "w-5 h-5"} ${s <= result.qualityRating ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30"}`} />
                ))}
              </div>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${(result.qualityRating / 5) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="h-full bg-gradient-to-r from-yellow-400 to-green-500 rounded-full" />
            </div>
          </div>

          {/* Recommendation */}
          <div className="flex gap-3 p-4 bg-primary/5 border border-primary/15 rounded-2xl">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className={`text-foreground leading-relaxed ${a11y ? "text-base" : "text-sm"}`}>{result.recommendation}</p>
          </div>

          {/* Earnings */}
          <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
            <div>
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-0.5">{t("earningsLabel")}</p>
              <p className={`font-display font-bold text-emerald-800 ${a11y ? "text-4xl" : "text-3xl"}`}>₹{earnings.toLocaleString()}</p>
              <p className="text-xs text-emerald-600 mt-0.5">{result.biomassEstimate.toFixed(2)}t × ₹{result.pricePerTon.toLocaleString()}/t</p>
            </div>
            <div className={`rounded-full bg-emerald-100 flex items-center justify-center ${a11y ? "w-16 h-16" : "w-14 h-14"}`}>
              <Coins className={`text-emerald-600 ${a11y ? "w-8 h-8" : "w-7 h-7"}`} />
            </div>
          </div>
        </div>
      </SectionCard>
    </motion.div>
  );
}

/* ─── 3. Pickup Request ───────────────────────────────────────── */
function PickupRequest({
  location, aiResult, userId, a11y, gpsLat, gpsLng, fieldArea,
  onRequestSent,
}: {
  location: string;
  aiResult: AiResult | null;
  userId: number;
  a11y: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  fieldArea: number;
  onRequestSent: (req: PickupRequest) => void;
}) {
  const { t } = useLang();
  const [status, setStatus]    = useState<"idle" | "loading" | "confirmed">("idle");
  const [refId, setRefId]      = useState("");
  const [error, setError]      = useState<string | null>(null);
  const [holdDays, setHoldDays] = useState<3 | 7 | 14>(7);

  const btnH = a11y ? "h-16 text-xl" : "h-14 text-base";

  const handleRequest = async () => {
    if (!aiResult) return;
    if (gpsLat == null || gpsLng == null) {
      setError(t("gpsRequiredNote"));
      return;
    }
    setStatus("loading");
    setError(null);

    try {
      const req = await createPickupRequest({
        cropType:    aiResult.cropType,
        cropKey:     aiResult.cropKey,
        cropIcon:    RESIDUE_FACTORS[aiResult.cropKey]?.icon ?? "🌾",
        biomass:     aiResult.biomassEstimate,
        fieldArea,
        pricePerTon: aiResult.pricePerTon,
        confidence:  aiResult.confidence,
        lat:         gpsLat,
        lng:         gpsLng,
        holdUntilDays: holdDays,
        gradeLabel:        aiResult.gradeLabel,
        qualityRating:     aiResult.qualityRating,
        residueFactor:     aiResult.residueFactor,
        residueColorNotes: aiResult.residueColorNotes,
        recommendation:    aiResult.recommendation,
        bestUse:           aiResult.bestUse,
        aiNotes:           aiResult.notes,
        aiIssues:          aiResult.issues,
      });
      setRefId(`AGR-${req.id.toString().padStart(5, "0")}`);
      setStatus("confirmed");
      onRequestSent(req);
    } catch (err: any) {
      setError(err.message ?? "Failed to send request. Please try again.");
      setStatus("idle");
    }
  };

  return (
    <SectionCard delay={0.2} a11y={a11y}>
      <SectionHeader icon={<Truck className="w-5 h-5" />} title={t("requestPickupTitle")} />
      <div className="p-6">
        <AnimatePresence mode="wait">
          {status === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-muted/40 rounded-2xl">
                <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground font-medium">{t("pickupLocationLabel")}</p>
                  <p className={`font-bold text-foreground ${a11y ? "text-lg" : "text-base"}`}>{location || "Your registered location"}</p>
                  {gpsLat != null && gpsLng != null ? (
                    <p className="text-xs text-green-700 font-semibold mt-1">
                      {t("gpsSharedNote")} {gpsLat.toFixed(5)}, {gpsLng.toFixed(5)}
                    </p>
                  ) : (
                    <p className="text-xs text-red-700 font-semibold mt-1">
                      {t("gpsRequiredNote")}
                    </p>
                  )}
                </div>
              </div>

              {/* Show crop info if AI result is ready */}
              {aiResult ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-muted/40 rounded-xl p-3">
                    <p className="text-muted-foreground text-xs font-medium mb-0.5">{t("cropDetected")}</p>
                    <p className="font-bold">{aiResult.cropType}</p>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-3">
                    <p className="text-muted-foreground text-xs font-medium mb-0.5">{t("biomassLabel")}</p>
                    <p className="font-bold">{aiResult.biomassEstimate.toFixed(2)} t</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {t("aiFirstHint")}
                </p>
              )}

              <p className={`text-muted-foreground ${a11y ? "text-base" : "text-sm"}`}>
                {t("pickupTimeNote")}
              </p>

              {/* Hold-until selector */}
              <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4">
                <p className={`font-bold text-amber-900 mb-1 ${a11y ? "text-base" : "text-sm"}`}>
                  {t("farmerHoldDaysLabel")}
                </p>
                <p className="text-xs text-amber-800/80 mb-3">{t("farmerHoldDaysHelp")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { d: 3,  label: t("farmerHoldDays3")  },
                    { d: 7,  label: t("farmerHoldDays7")  },
                    { d: 14, label: t("farmerHoldDays14") },
                  ] as const).map(opt => (
                    <button key={opt.d} type="button" onClick={() => setHoldDays(opt.d as 3 | 7 | 14)}
                      className={`rounded-xl border-2 px-3 ${a11y ? "py-3 text-base" : "py-2.5 text-sm"} font-bold transition-all ${
                        holdDays === opt.d
                          ? "border-amber-600 bg-amber-100 text-amber-900"
                          : "border-amber-200 bg-white text-amber-800 hover:border-amber-400"
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}

              <Button onClick={handleRequest} disabled={!aiResult || gpsLat == null || gpsLng == null}
                className={`w-full rounded-2xl font-bold gap-3 disabled:opacity-50 ${btnH}`}>
                <Truck className="w-5 h-5" /> {t("requestPickupBtn")}
              </Button>
              {!aiResult && (
                <p className="text-center text-xs text-muted-foreground">{t("completeAiFirst")}</p>
              )}
              {aiResult && (gpsLat == null || gpsLng == null) && (
                <p className="text-center text-xs text-red-700 font-semibold">{t("saveGpsFirst")}</p>
              )}
            </motion.div>
          )}

          {status === "loading" && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center py-8 gap-4">
              <div className="w-14 h-14 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <p className="font-semibold text-foreground">Submitting your request…</p>
            </motion.div>
          )}

          {status === "confirmed" && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center text-center py-6 gap-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-9 h-9 text-green-600" />
              </div>
              <div>
                <p className={`font-bold text-foreground mb-1 ${a11y ? "text-xl" : "text-lg"}`}>{t("pickupConfirmed")}</p>
                <p className={`text-muted-foreground ${a11y ? "text-base" : "text-sm"}`}>{t("pickupConfirmedDesc")}</p>
              </div>
              <div className="w-full p-3 bg-green-50 border border-green-200 rounded-xl text-sm font-semibold text-green-800">
                Reference ID: {refId}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SectionCard>
  );
}

/* ─── 3b. Live Request Status Panel ──────────────────────────── */
function MyRequestsPanel({ requests, a11y, onChanged }: { requests: PickupRequest[]; a11y: boolean; onChanged: () => void }) {
  const { t } = useLang();
  const [extending, setExtending] = useState<number | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);
  if (requests.length === 0) return null;

  const handleExtend = async (id: number, days: number) => {
    setExtending(id);
    setExtendError(null);
    try {
      await extendPickupDeadline(id, days);
      onChanged();
    } catch (e: any) {
      setExtendError(e?.message ?? "Could not extend deadline");
    } finally {
      setExtending(null);
    }
  };

  const statusColor = (s: string) => ({
    pending:   "bg-amber-50 border-amber-200 text-amber-800",
    accepted:  "bg-green-50 border-green-200 text-green-800",
    collected: "bg-blue-50 border-blue-200 text-blue-800",
    cancelled: "bg-red-50 border-red-200 text-red-800",
  })[s] ?? "bg-muted border-border text-foreground";

  const statusLabel = (s: string) => ({
    pending:   `⏳ ${t("statusPending")}`,
    accepted:  `✅ ${t("statusAccepted")}`,
    collected: `📦 ${t("statusCollected")}`,
    cancelled: `⚠️ ${t("aggCancelledLabel")}`,
  })[s] ?? s;

  return (
    <SectionCard delay={0.05} a11y={a11y}>
      <SectionHeader icon={<ClipboardList className="w-5 h-5" />} title={t("myRequestsTitle")} badge={`${requests.length}`} />
      <div className="p-6 space-y-3">
        {requests.map((req) => {
          const holdLeft = req.holdUntilDate ? daysUntil(req.holdUntilDate) : null;
          return (
            <div key={req.id} className={`rounded-2xl border p-4 ${statusColor(req.status)}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className={`font-bold leading-tight ${a11y ? "text-base" : "text-sm"}`}>{req.cropType}</p>
                <span className={`text-xs font-bold px-2 py-1 rounded-full border ${statusColor(req.status)}`}>
                  {statusLabel(req.status)}
                </span>
              </div>
              <div className="flex gap-4 text-xs text-current opacity-80">
                <span>{req.biomass.toFixed(1)} t biomass</span>
                <span>₹{(req.biomass * req.pricePerTon).toLocaleString()} est.</span>
              </div>

              {/* Pending: show hold-until countdown + extend button */}
              {req.status === "pending" && req.holdUntilDate && (
                <>
                  <div className="flex items-center gap-1.5 mt-2 text-xs font-bold">
                    <Clock className="w-3.5 h-3.5" />
                    {t("farmerHoldUntilTag")}: {formatDate(req.holdUntilDate)}
                    {holdLeft !== null && holdLeft >= 0 && ` · ${holdLeft} ${holdLeft === 1 ? t("aggDayWord") : t("aggDaysWord")}`}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                    <span className="text-[11px] font-bold text-amber-900">Extend deadline:</span>
                    {[3, 7, 14].map(days => (
                      <button
                        key={days}
                        onClick={() => handleExtend(req.id, days)}
                        disabled={extending === req.id}
                        className="text-[11px] font-bold px-2 py-1 rounded-full bg-amber-200 hover:bg-amber-300 text-amber-900 border border-amber-400 transition-colors disabled:opacity-50"
                      >
                        {extending === req.id ? "…" : `+${days}d`}
                      </button>
                    ))}
                  </div>
                  {extendError && extending === null && (
                    <p className="text-[11px] text-red-700 font-semibold mt-1">{extendError}</p>
                  )}
                </>
              )}

              {/* Accepted: show aggregator's committed date */}
              {req.status === "accepted" && req.committedPickupDate && (
                <div className="flex items-center gap-1.5 mt-2 text-xs font-bold">
                  <Calendar className="w-3.5 h-3.5" />
                  {t("farmerCommittedTag")}: {formatDate(req.committedPickupDate)}
                </div>
              )}
              {req.status === "accepted" && !req.committedPickupDate && req.estimatedPickup && (
                <div className="flex items-center gap-1.5 mt-2 text-xs font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  Pickup: {req.estimatedPickup}
                </div>
              )}

              {/* Cancelled: apology + compensation */}
              {req.status === "cancelled" && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> {t("farmerCancelledMsg")}
                  </p>
                  {req.cancelReason && (
                    <p className="text-xs opacity-80">{t("aggCancelReason")}: {req.cancelReason}</p>
                  )}
                  {(req.compensationCredits ?? 0) > 0 && (
                    <p className="text-xs font-bold inline-flex items-center gap-1 bg-white/60 rounded-full px-2 py-0.5 mt-1">
                      🎁 {t("farmerCompensation")}
                    </p>
                  )}
                  <DisposalMethods biomassTons={req.biomass} />
                </div>
              )}

              <p className="text-xs opacity-60 mt-2">{formatTimeAgo(req.createdAt)} · ID: AGR-{req.id.toString().padStart(5, "0")}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* ─── Impact / persuasion panel — "save environment + earn" ──── */
function ImpactPanel({ pendingBiomass, pricePerTon, a11y }: {
  pendingBiomass: number;
  pricePerTon: number;
  a11y: boolean;
}) {
  const { t } = useLang();
  /* Use realistic factors: 1 t residue burned ≈ 1.46 t CO₂e; 1 mature tree ≈ 22 kg CO₂/yr */
  const biomass    = Math.max(pendingBiomass, 1);
  const earnings   = Math.round(biomass * pricePerTon);
  const co2Saved   = (biomass * 1.46).toFixed(1);
  const treesEquiv = Math.round((biomass * 1460) / 22);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-amber-50 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 text-white px-5 py-4">
        <h3 className={`font-display font-black ${a11y ? "text-2xl" : "text-xl"} leading-tight`}>
          🌍 {t("farmerImpactTitle")}
        </h3>
        <p className={`opacity-90 mt-1 ${a11y ? "text-base" : "text-sm"}`}>{t("farmerImpactSub")}</p>
      </div>

      <div className="p-5 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-amber-100 border border-amber-300 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-1">{t("farmerImpactEarn")}</p>
          <p className={`font-display font-black text-amber-900 ${a11y ? "text-2xl" : "text-xl"}`}>₹{earnings.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl bg-emerald-100 border border-emerald-300 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 mb-1">{t("farmerImpactCo2")}</p>
          <p className={`font-display font-black text-emerald-900 ${a11y ? "text-2xl" : "text-xl"}`}>{co2Saved}t</p>
        </div>
        <div className="rounded-2xl bg-green-100 border border-green-300 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-green-800 mb-1">{t("farmerImpactTrees")}</p>
          <p className={`font-display font-black text-green-900 ${a11y ? "text-2xl" : "text-xl"}`}>{treesEquiv}</p>
        </div>
      </div>

      <div className="px-5 pb-5">
        <p className={`text-emerald-900/80 ${a11y ? "text-sm" : "text-xs"} mb-3`}>
          💚 {t("farmerImpactHealth")}
        </p>
        <div className="rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-center font-bold text-sm">
          ↓ {t("farmerImpactCta")} ↓
        </div>
      </div>
    </motion.div>
  );
}

/* ─── 4. Farmer Rewards ──────────────────────────────────────── */
function FarmerRewards({ credits, a11y }: { credits: number; a11y: boolean }) {
  const { t } = useLang();
  const tiers = [
    { name: t("tierGreenStarter"),   min: 0,    max: 100,  icon: "🌱", color: "bg-green-100 text-green-800 border-green-200" },
    { name: t("tierEcoWarrior"),     min: 100,  max: 500,  icon: "🏆", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    { name: t("tierCarbonHero"),     min: 500,  max: 1000, icon: "🌍", color: "bg-blue-100 text-blue-800 border-blue-200" },
    { name: t("tierChampion"),       min: 1000, max: 9999, icon: "⭐", color: "bg-purple-100 text-purple-800 border-purple-200" },
  ];
  const tier     = tiers.find(t => credits >= t.min && credits < t.max) ?? tiers[0];
  const progress = ((credits - tier.min) / (tier.max - tier.min)) * 100;

  const earningRules = [
    { icon: "🌾", label: t("earn10PerTon") },
    { icon: "🚛", label: t("earn5PerPickup") },
    { icon: "🚫🔥", label: t("earn50NoBurn") },
  ];
  const benefits = [
    { icon: "💰", label: t("benefit1") },
    { icon: "📜", label: t("benefit2") },
    { icon: "🚜", label: t("benefit3") },
    { icon: "🌿", label: t("benefit4") },
  ];

  return (
    <SectionCard delay={0.25} a11y={a11y}>
      <SectionHeader icon={<Gift className="w-5 h-5" />} title={t("ecoRewardsTitle")} badge={`${credits} ${t("creditsLabel")}`} />
      <div className="p-6 space-y-5">
        <div className={`flex items-center gap-4 p-4 rounded-2xl border ${tier.color}`}>
          <span className="text-4xl">{tier.icon}</span>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-0.5">{t("currentTierLabel")}</p>
            <p className={`font-bold ${a11y ? "text-2xl" : "text-xl"}`}>{tier.name}</p>
          </div>
          <Award className="w-6 h-6 opacity-60" />
        </div>
        <div>
          <div className="flex justify-between text-xs font-semibold text-muted-foreground mb-2">
            <span>{credits} {t("creditsLabel")}</span>
            <span>{tier.max} {t("neededNextTier")}</span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(progress, 100)}%` }}
              transition={{ duration: 1, delay: 0.5 }}
              className="h-full bg-gradient-to-r from-primary to-green-400 rounded-full" />
          </div>
        </div>
        <div className="text-center py-4">
          <p className={`font-display font-black text-primary ${a11y ? "text-7xl" : "text-6xl"}`}>{credits}</p>
          <p className={`text-muted-foreground font-semibold mt-1 ${a11y ? "text-lg" : ""}`}>{t("ecoCreditsEarned")}</p>
          {credits === 0 ? (
            <p className={`text-primary font-medium mt-1 ${a11y ? "text-base" : "text-sm"}`}>{t("startEarningHint")}</p>
          ) : (
            <p className={`text-muted-foreground mt-1 ${a11y ? "text-base" : "text-sm"}`}>≈ ₹{credits * 0.5} {t("cashbackValue")}</p>
          )}
        </div>

        {/* How to earn credits */}
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-3">
          <p className={`font-bold text-primary ${a11y ? "text-base" : "text-sm"}`}>{t("howToEarnTitle")}</p>
          <div className="space-y-2">
            {earningRules.map((r, i) => (
              <div key={i} className={`flex items-center gap-3 bg-white/60 rounded-xl ${a11y ? "p-3" : "p-2.5"}`}>
                <span className="text-xl">{r.icon}</span>
                <p className={`font-medium text-foreground ${a11y ? "text-base" : "text-sm"}`}>{r.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className={`font-bold text-foreground mb-3 ${a11y ? "text-base" : "text-sm"}`}>{t("yourBenefits")}</p>
          <div className="space-y-2">
            {benefits.map((b, i) => (
              <div key={i} className={`flex items-center gap-3 bg-muted/30 rounded-xl ${a11y ? "p-4" : "p-3"}`}>
                <span className="text-xl">{b.icon}</span>
                <p className={`font-medium text-foreground ${a11y ? "text-base" : "text-sm"}`}>{b.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 items-center p-4 bg-red-50 border border-red-200 rounded-2xl">
          <Flame className="w-5 h-5 text-red-500 shrink-0" />
          <p className={`text-red-800 font-medium ${a11y ? "text-base" : "text-sm"}`}>
            <strong>Did you know?</strong> Burning stubble = losing up to <strong>500 credits</strong> + government fines.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

/* ─── GPS Collector ──────────────────────────────────────────── */
function GpsCollector({ lat, lng, onGps }: {
  lat: number | null; lng: number | null;
  onGps: (lat: number, lng: number) => void;
}) {
  const { t } = useLang();
  const [detecting, setDetecting] = useState(false);
  const [error, setError]         = useState("");
  const [showPinMap, setShowPinMap] = useState(false);

  const detect = () => {
    if (!navigator.geolocation) { setError(t("geoNotSupported")); return; }
    setDetecting(true);
    setError("");

    /* Helper that turns a PositionError into a human-friendly message
       in the user's current language (denied / unavailable / timeout). */
    const messageFor = (err: GeolocationPositionError): string => {
      if (err.code === 1) return t("gpsErrDenied");
      if (err.code === 2) return t("gpsErrUnavailable");
      if (err.code === 3) return t("gpsErrTimeout");
      return err.message || t("locationError");
    };

    /* Two-stage strategy for rural / weak-signal devices:
       1. First try high-accuracy with a 15s budget and accept a 60s
          cached fix to avoid repeatedly hitting cold-start delays.
       2. If high-accuracy times out (code 3), automatically retry once
          with low accuracy (cell-tower / wifi) which almost always
          succeeds. This is exactly the kind of recovery rural users
          need — they should never see a hard failure on first try. */
    navigator.geolocation.getCurrentPosition(
      pos => {
        onGps(pos.coords.latitude, pos.coords.longitude);
        setDetecting(false);
      },
      err => {
        if (err.code === 3) {
          // High-accuracy timed out — fall back to coarse location.
          navigator.geolocation.getCurrentPosition(
            pos2 => {
              onGps(pos2.coords.latitude, pos2.coords.longitude);
              setDetecting(false);
              setError("");
            },
            err2 => {
              setError(messageFor(err2));
              setDetecting(false);
            },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
          );
          return;
        }
        setError(messageFor(err));
        setDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  return (
    <div className="space-y-2">
      {lat != null && lng != null && (
        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl text-sm">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-green-600" />
            <div>
              <p className="text-xs font-bold text-green-800">{t("gpsSaved")}</p>
              <p className="text-xs text-green-700">{lat.toFixed(4)}, {lng.toFixed(4)}</p>
            </div>
          </div>
          <button onClick={detect} disabled={detecting}
            className="text-xs font-semibold text-green-700 hover:underline">
            {t("updateGps")}
          </button>
        </div>
      )}
      <button onClick={detect} disabled={detecting}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/40 text-primary font-semibold hover:bg-primary/5 transition-colors text-sm">
        {detecting
          ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("gettingLocation")}</>
          : <><Navigation className="w-4 h-4" /> {lat != null && lng != null ? t("useGpsAgain") : t("saveGpsLocation")}</>}
      </button>
      <button
        onClick={() => setShowPinMap(v => !v)}
        className="w-full rounded-xl border border-border py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      >
        {showPinMap ? t("hideMapPin") : t("pinFieldOnMap")}
      </button>
      {showPinMap && (
        <FieldPinMap
          lat={lat ?? 30.9010}
          lng={lng ?? 75.8573}
          onPick={onGps}
        />
      )}
      {error && <p className="text-xs text-red-600 text-center">{error}</p>}
    </div>
  );
}

function FieldPinMap({ lat, lng, onPick }: {
  lat: number;
  lng: number;
  onPick: (lat: number, lng: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false }).setView([lat, lng], 14);
    mapInstanceRef.current = map;

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles © Esri",
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map)
      .bindPopup("Drag or tap to mark your approximate field pickup point")
      .openPopup();
    markerRef.current = marker;

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onPick(pos.lat, pos.lng);
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onPick(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerRef.current?.setLatLng([lat, lng]);
    mapInstanceRef.current?.setView([lat, lng], 14, { animate: true });
  }, [lat, lng]);

  return (
    <div className="space-y-2">
      <div ref={mapRef} className="h-56 w-full rounded-xl overflow-hidden border z-0" />
      <p className="text-xs text-muted-foreground text-center">
        Tap near your field entrance/edge if you cannot stand at the centre of the farm.
      </p>
    </div>
  );
}

function fieldBoundaryCoords(centerLat: number, centerLng: number, acres: number): [number, number][] {
  const safeAcres = Math.max(acres || 1, 0.1);
  const sideMeters = Math.sqrt(safeAcres * 4046.86);
  const halfSide = sideMeters / 2;
  const latOffset = halfSide / 111320;
  const lngOffset = halfSide / (111320 * Math.max(Math.cos(centerLat * Math.PI / 180), 0.2));
  return [
    [centerLat + latOffset, centerLng - lngOffset],
    [centerLat + latOffset, centerLng + lngOffset],
    [centerLat - latOffset, centerLng + lngOffset],
    [centerLat - latOffset, centerLng - lngOffset],
  ];
}

/* ─── 5. Field Map ───────────────────────────────────────────── */
function FieldMap({ location, lat, lng, fieldArea }: { location: string; lat?: number | null; lng?: number | null; fieldArea: number }) {
  const { t } = useLang();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // GPS takes priority; fall back to location-derived coords only if no GPS
  const hasGps = lat != null && lng != null;
  const coordsFromLocation = geoFromLocation(location);
  const centerLat = hasGps ? lat! : coordsFromLocation.lat;
  const centerLng = hasGps ? lng! : coordsFromLocation.lng;

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    });

    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false });
    mapInstanceRef.current = map;

    const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 18,
    });
    const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles © Esri", maxZoom: 19,
    });

    satelliteLayer.addTo(map);
    L.control.layers({ "Satellite": satelliteLayer, "Street map": streetLayer }, undefined, { position: "topright" }).addTo(map);

    // Zoom level 16 for GPS accuracy, 13 for estimated
    const zoom = hasGps ? 16 : 13;
    map.setView([centerLat, centerLng], zoom);

    const marker = L.marker([centerLat, centerLng]).addTo(map)
      .bindPopup(`<div style="font-family:sans-serif;padding:4px 2px"><strong>📍 ${hasGps ? "GPS Location" : "Approximate Area"}</strong><br/><span style="color:#666;font-size:12px">${hasGps ? `${centerLat.toFixed(5)}, ${centerLng.toFixed(5)}` : (location || "Punjab, India")}</span></div>`)
      .openPopup();
    markerRef.current = marker;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Pan and update marker when GPS becomes available or changes
  useEffect(() => {
    if (!mapInstanceRef.current || lat == null || lng == null) return;
    mapInstanceRef.current.setView([lat, lng], 16, { animate: true });
    markerRef.current?.setLatLng([lat, lng]);
    markerRef.current?.bindPopup(
      `<div style="font-family:sans-serif;padding:4px 2px"><strong>📍 GPS Location</strong><br/><span style="color:#666;font-size:12px">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>`
    ).openPopup();
  }, [lat, lng]);

  return (
    <SectionCard delay={0.3}>
      <SectionHeader icon={<MapPin className="w-5 h-5" />} title={t("fieldLocationTitle")} badge={hasGps ? t("gpsPinnedBadge") : t("satelliteMapBadge")} />
      <div className="px-6 pb-4 pt-2">
        {hasGps ? (
          <p className="text-sm text-green-700 flex items-center gap-2 mb-3 font-semibold">
            <Navigation className="w-4 h-4" /> GPS: {lat!.toFixed(5)}, {lng!.toFixed(5)} · {fieldArea.toFixed(1)} {t("acresLabel")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-primary" /> {location || t("savedFieldLocation")} · {fieldArea.toFixed(1)} {t("acresLabel")}
          </p>
        )}
      </div>
      <div ref={mapRef} className="w-full h-72 z-0" />
      <div className="px-6 py-4 border-t">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-primary inline-block" /> {t("yourLocationLabel")}
          </span>
          {hasGps && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
              target="_blank" rel="noopener noreferrer"
              className="ml-auto text-blue-500 hover:underline flex items-center gap-1">
              {t("openInMaps")}
            </a>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function FarmerDashboard() {
  const [, setLocation] = useLocation();
  const queryClient     = useQueryClient();
  const { data: user, isLoading, isError } = useGetMe({ query: { retry: false } });
  const { t }           = useLang();

  const [aiResult, setAiResult]           = useState<AiResult | null>(null);
  const [fieldAreaNum, setFieldAreaNum]   = useState(1);
  const [ecoCredits]                      = useState(0);
  const [pipelineStage, setPipelineStage] = useState<number | null>(null);
  const [myRequests, setMyRequests]       = useState<PickupRequest[]>([]);
  const [showProfile, setShowProfile]     = useState(false);
  const [localUser, setLocalUser]         = useState<any>(null);
  const [gpsLat, setGpsLat]              = useState<number | null>(null);
  const [gpsLng, setGpsLng]              = useState<number | null>(null);

  /* ── Persisted UI preferences ── */
  const [lowInternet, setLowInternet] = useState(() => {
    try { return localStorage.getItem("agricycle_low_internet") === "1"; } catch { return false; }
  });

  /**
   * ACCESSIBILITY MODE
   * ─────────────────────
   * Enlarges fonts, buttons, and spacing across the entire dashboard.
   * Intended for elderly farmers or users with visual impairments.
   * Persisted across sessions via localStorage.
   */
  const [a11y, setA11y] = useState(() => {
    try { return localStorage.getItem("agricycle_a11y") === "1"; } catch { return false; }
  });

  const toggleLowInternet = () => setLowInternet(prev => {
    const next = !prev;
    try { localStorage.setItem("agricycle_low_internet", next ? "1" : "0"); } catch {}
    return next;
  });

  const toggleA11y = () => setA11y(prev => {
    const next = !prev;
    try { localStorage.setItem("agricycle_a11y", next ? "1" : "0"); } catch {}
    return next;
  });

  const logoutMutation = useLogout({
    mutation: { onSuccess: () => { queryClient.clear(); setLocation("/"); } },
  });

  useEffect(() => { if (isError && !isLoading) setLocation("/login"); }, [isError, isLoading]);
  useEffect(() => {
    if (user && user.role !== "farmer") {
      setLocation(user.role === "aggregator" ? "/dashboard/aggregator" : "/dashboard/factory");
    }
    if (user) {
      setLocalUser(user);
      if (user.lat != null) setGpsLat(user.lat);
      if (user.lng != null) setGpsLng(user.lng);
    }
  }, [user]);

  const displayUser = localUser ?? user;

  /* Poll for request status updates every 12 seconds */
  useEffect(() => {
    if (!user) return;
    const load = () => listPickupRequests().then(setMyRequests).catch(() => {});
    load();
    const interval = setInterval(load, 12000);
    return () => clearInterval(interval);
  }, [user]);

  /**
   * handleAnalyze — runs the simulated CV pipeline with smart heuristics.
   *
   * This simulates a computer vision model using heuristics:
   *   1. If crop selected by user → use that (highest confidence)
   *   2. Detect crop from image filename keywords
   *   3. Weighted random fallback (biased toward rice — most common in Punjab)
   *   4. Apply ±10 % factor variation + ±3 % confidence noise for realism
   */
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async (crop: string, area: string, photos: FieldPhoto[]) => {
    const areaNum = parseFloat(area) || 1;
    setFieldAreaNum(areaNum);
    setAiResult(null);
    setAnalyzeError(null);
    setAnalyzing(true);
    setPipelineStage(0);

    // Cycle through pipeline stages while waiting for the API
    let stageIdx = 0;
    const stageTimer = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, CV_PIPELINE_STAGES.length - 1);
      setPipelineStage(stageIdx);
    }, 800);

    try {
      const formData = new FormData();
      formData.append("fieldArea", String(areaNum));
      if (crop) formData.append("cropTypeHint", crop);
      photos.forEach(p => formData.append("images", p.file, p.filename));

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 422 && err?.isCropResidue === false) {
          setAnalyzeError(
            `${err.error ?? "These photos don't appear to show crop residue."} ${err.rejectionReason ?? ""}`.trim()
          );
          return;
        }
        throw new Error(err?.error ?? `Analysis failed (${res.status})`);
      }
      const data = await res.json();
      setAiResult({
        cropType:        data.cropType,
        cropKey:         data.cropKey,
        cropIcon:        data.cropIcon,
        residueFactor:   data.residueFactor,
        biomassEstimate: data.biomassEstimate,
        qualityRating:   data.qualityRating,
        gradeLabel:      data.gradeLabel,
        confidence:      data.confidence,
        recommendation:  data.recommendation,
        bestUse:         data.bestUse,
        pricePerTon:     data.pricePerTon,
        detectedFromFilename: !crop,
        notes:           data.notes,
        issues:          data.issues,
        residueColorNotes: data.residueColorNotes,
        photosAnalyzed:  data.photosAnalyzed,
      });
    } catch (e: any) {
      setAnalyzeError(e?.message ?? "Could not analyse photos. Please try again.");
    } finally {
      clearInterval(stageTimer);
      setAnalyzing(false);
      setPipelineStage(null);
    }
  };

  const handleRequestSent = (req: PickupRequest) => {
    setMyRequests(prev => [req, ...prev]);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          <p className="text-muted-foreground font-medium text-base">Loading your dashboard…</p>
        </div>
      </div>
    );
  }
  if (!displayUser) return null;

  const farmerPendingCount = myRequests.filter(r => r.status === "pending" || r.status === "accepted").length;

  return (
    <div className={`min-h-screen bg-muted/20 pb-16 ${a11y ? "text-[1.05rem]" : ""}`}>

      <WeatherAlertToast
        lat={gpsLat}
        lng={gpsLng}
        pendingCount={farmerPendingCount}
        audience="farmer"
        storageKey={`farmer-weather-alert:${displayUser.id}`}
      />

      {/* Sticky header */}
      <div className="bg-card border-b sticky top-0 z-40 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between h-16 gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowProfile(true)}
              className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center hover:bg-primary/20 transition-colors">
              <Tractor className="w-5 h-5 text-primary" />
            </button>
            <div>
              <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider leading-none mb-0.5">{t("roleFarmer")}</p>
              <p className="font-bold text-foreground leading-none">{displayUser.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSelector compact className="hidden sm:flex" />
            <NotificationBell requests={myRequests} userId={displayUser.id} role="farmer" />
            <button onClick={() => setShowProfile(true)}
              className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
              <UserCircle className="w-5 h-5" />
            </button>

            {/* Low Internet Mode toggle */}
            <button onClick={toggleLowInternet} title={t("lowInternetMode")} aria-label={t("lowInternetMode")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold border-2 shadow-sm transition-all min-h-[36px] ${
                lowInternet
                  ? "bg-amber-500 text-white border-amber-600 shadow-amber-200"
                  : "bg-white text-amber-700 border-amber-400 hover:bg-amber-50"
              }`}>
              {lowInternet ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{lowInternet ? t("lowDataOn") : t("dataSaver")}</span>
            </button>

            {/* Accessibility Mode toggle */}
            <button onClick={toggleA11y} title={t("a11yMode")} aria-label={t("a11yMode")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold border-2 shadow-sm transition-all min-h-[36px] ${
                a11y
                  ? "bg-blue-600 text-white border-blue-700 shadow-blue-200"
                  : "bg-white text-blue-700 border-blue-400 hover:bg-blue-50"
              }`}>
              <Accessibility className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{a11y ? t("a11yOn") : t("a11yMode")}</span>
            </button>

            <div className="hidden sm:flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-bold">
              <Leaf className="w-4 h-4" /> {ecoCredits}
            </div>
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-muted-foreground min-h-[36px]"
              onClick={() => logoutMutation.mutate({})} isLoading={logoutMutation.isPending}>
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Low Internet banner */}
      <AnimatePresence>
        {lowInternet && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-amber-500 text-white px-4 py-2">
            <div className="max-w-5xl mx-auto flex items-center gap-2 text-sm font-semibold">
              <WifiOff className="w-4 h-4 shrink-0" />
              {t("lowInternetOn")} — images compressed to save mobile data
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Accessibility banner */}
      <AnimatePresence>
        {a11y && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-blue-600 text-white px-4 py-2">
            <div className="max-w-5xl mx-auto flex items-center gap-2 text-sm font-semibold">
              <Accessibility className="w-4 h-4 shrink-0" />
              Accessibility Mode is ON — larger text, bigger buttons, more spacing
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* User info strip */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-primary text-white px-4 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5 font-semibold">
            <MapPin className="w-4 h-4 opacity-75" /> {displayUser.location}
          </span>
          <span className="flex items-center gap-1.5 opacity-80">
            <Phone className="w-4 h-4" /> {displayUser.phone}
          </span>
          {gpsLat && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${gpsLat},${gpsLng}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 opacity-80 hover:opacity-100 underline">
              <Navigation className="w-4 h-4" /> My Location
            </a>
          )}
          <span className="ml-auto flex items-center gap-1.5 font-semibold">
            <Sprout className="w-4 h-4 opacity-75" /> Stubble-free Farmer
          </span>
        </div>
      </motion.div>

      {/* Mobile language selector */}
      <div className="sm:hidden px-4 pt-3">
        <LanguageSelector />
      </div>

      {/* Main content */}
      <div className={`max-w-5xl mx-auto px-4 sm:px-6 pt-6 space-y-6 ${a11y ? "space-y-8" : ""}`}>

        {/* My requests panel — only shown if there are requests */}
        {myRequests.length > 0 && (
          <MyRequestsPanel
            requests={myRequests}
            a11y={a11y}
            onChanged={() => listPickupRequests().then(setMyRequests).catch(() => {})}
          />
        )}

        {/* Upload + AI panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UploadSection onAnalyze={handleAnalyze} lowInternet={lowInternet} a11y={a11y} analyzing={analyzing} analyzeError={analyzeError} />

          <AnimatePresence mode="wait">
            {pipelineStage !== null ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AiLoadingCard activeStage={pipelineStage} a11y={a11y} />
              </motion.div>
            ) : aiResult ? (
              <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AiResultCard result={aiResult} fieldArea={fieldAreaNum} a11y={a11y} />
              </motion.div>
            ) : analyzeError ? (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SectionCard delay={0} a11y={a11y}>
                  <SectionHeader icon={<AlertTriangle className="w-5 h-5" />} title="Analysis Result" badge="Could not recognise" />
                  <div className="p-6 space-y-4">
                    <div className="flex items-start gap-3 bg-red-50 border-2 border-red-200 rounded-2xl p-4">
                      <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 text-red-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-red-900 mb-1 ${a11y ? "text-base" : "text-sm"}`}>
                          We couldn't recognise a crop in these photos
                        </p>
                        <p className={`text-red-800 leading-relaxed ${a11y ? "text-sm" : "text-xs"}`}>
                          {analyzeError}
                        </p>
                      </div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                      <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2">Try again with</p>
                      <ul className={`space-y-1.5 text-amber-900 list-disc list-inside ${a11y ? "text-sm" : "text-xs"}`}>
                        <li>Photos taken in good daylight</li>
                        <li>Close-up shots of the residue on the field</li>
                        <li>2 to 4 photos covering different parts of the field</li>
                        <li>Picking the crop type manually if known</li>
                      </ul>
                    </div>
                  </div>
                </SectionCard>
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SectionCard delay={0.15} a11y={a11y}>
                  <SectionHeader icon={<FlaskConical className="w-5 h-5" />} title="Analysis Result" />
                  <div className="p-6 flex flex-col items-center justify-center text-center py-16 text-muted-foreground min-h-[300px]">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <FlaskConical className="w-9 h-9 text-primary/30" />
                    </div>
                    <p className={`font-bold text-foreground mb-2 ${a11y ? "text-xl" : "text-lg"}`}>{t("noPhotoYet")}</p>
                    <p className={`max-w-xs ${a11y ? "text-base" : "text-sm"}`}>{t("uploadHint")}</p>
                    <div className="mt-5 grid grid-cols-2 gap-2 w-full max-w-xs text-left">
                      {CV_PIPELINE_STAGES.map(s => (
                        <div key={s.id} className="flex items-center gap-2 text-xs text-muted-foreground/70 bg-muted/30 rounded-lg px-2.5 py-2">
                          <span>{s.icon}</span> {s.label.split(" ").slice(0,2).join(" ")}
                        </div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Weather warning — push farmer to negotiate before rain */}
        <WeatherWarning lat={gpsLat} lng={gpsLng} audience="farmer" />

        {/* Impact / persuasion panel — earn + save environment */}
        <ImpactPanel
          pendingBiomass={aiResult?.biomassEstimate ?? myRequests
            .filter(r => r.status === "pending" || r.status === "accepted")
            .reduce((s, r) => s + r.biomass, 0)}
          pricePerTon={aiResult?.pricePerTon ?? 2500}
          a11y={a11y}
        />

        {/* GPS + Pickup + Rewards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            {/* GPS collection card */}
            <SectionCard delay={0.18} a11y={a11y}>
              <SectionHeader icon={<Navigation className="w-5 h-5" />} title={t("farmerGpsCardTitle")}
                badge={gpsLat ? t("farmerGpsCardSaved") : t("farmerGpsCardRequired")} />
              <div className="p-6">
                <p className="text-sm text-muted-foreground mb-3">
                  {t("farmerGpsCardDesc")}
                </p>
                <LocationPicker
                  lat={gpsLat} lng={gpsLng}
                  accent="emerald"
                  onPick={async (lat, lng) => {
                    setGpsLat(lat);
                    setGpsLng(lng);
                    setLocalUser((prev: any) => ({ ...prev, lat, lng }));
                    try { await updateProfile({ lat, lng }); } catch {}
                  }}
                />
              </div>
            </SectionCard>

            <PickupRequest
              location={displayUser.location}
              aiResult={aiResult}
              userId={displayUser.id}
              a11y={a11y}
              onRequestSent={handleRequestSent}
              gpsLat={gpsLat}
              gpsLng={gpsLng}
              fieldArea={fieldAreaNum}
            />
          </div>
          <FarmerRewards credits={ecoCredits} a11y={a11y} />
        </div>

        {/* Field map */}
        <FieldMap location={displayUser.location} lat={gpsLat} lng={gpsLng} fieldArea={fieldAreaNum} />
      </div>

      <AnimatePresence>
        {showProfile && displayUser && (
          <ProfilePanel
            user={displayUser}
            onClose={() => setShowProfile(false)}
            onUpdate={updated => {
              setLocalUser((prev: any) => ({ ...prev, ...updated }));
              if (updated.lat != null) setGpsLat(updated.lat);
              if (updated.lng != null) setGpsLng(updated.lng);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
