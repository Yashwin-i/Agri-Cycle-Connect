/**
 * aiAnalyze.ts — Crop residue image analysis using Gemini 2.5 Flash vision.
 *
 * POST /api/ai/analyze   (multipart/form-data)
 *   fields:
 *     - images:        one image file (JPG/PNG/WebP)
 *     - fieldArea:     number (acres)
 *     - cropTypeHint:  optional string
 *   returns: { cropType, cropKey, biomassEstimate, qualityRating, gradeLabel,
 *             confidence, recommendation, bestUse, pricePerTon, residueFactor,
 *             notes, issues, residueColorNotes, photosAnalyzed }
 */

import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files:    6,
    fileSize: 8 * 1024 * 1024, // 8 MB per file
  },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.mimetype)) {
      cb(new Error("Only JPG, PNG, WebP, or HEIC images are allowed"));
      return;
    }
    cb(null, true);
  },
});

const RESIDUE_DEFAULTS: Record<string, {
  cropType: string; residueFactor: number; pricePerTon: number; bestUse: string; icon: string;
}> = {
  wheat:     { cropType: "Wheat Straw",       residueFactor: 1.82, pricePerTon: 1150, bestUse: "Biogas / Paper Mill",   icon: "🌾" },
  rice:      { cropType: "Rice Straw",        residueFactor: 2.54, pricePerTon: 950,  bestUse: "Briquettes / Ethanol",  icon: "🌿" },
  maize:     { cropType: "Maize Residue",     residueFactor: 1.47, pricePerTon: 830,  bestUse: "Compost / Biochar",     icon: "🌽" },
  sugarcane: { cropType: "Sugarcane Bagasse", residueFactor: 3.50, pricePerTon: 780,  bestUse: "Co-generation Fuel",    icon: "🎋" },
  cotton:    { cropType: "Cotton Stalks",     residueFactor: 1.05, pricePerTon: 1050, bestUse: "Particle Board",        icon: "☁️" },
  other:     { cropType: "Mixed Residue",     residueFactor: 1.50, pricePerTon: 800,  bestUse: "Compost / Biogas",      icon: "🌱" },
};

const RECOMMENDATIONS: Record<string, string> = {
  wheat:     "High silica content makes this excellent for paper pulp, biogas digesters, and mushroom substrate.",
  rice:      "Premium quality stubble. Ideal for briquetting, ethanol production, and co-generation power plants.",
  maize:     "Moderate quality. Good for compost, biochar production, and cattle feed after treatment.",
  sugarcane: "Excellent calorific value. Preferred fuel source for co-generation and distillery boilers.",
  cotton:    "Dense woody structure. Suitable for particle board manufacturing and briquetting.",
  other:     "Mixed crop residue. Best routed to composting or biogas plants.",
};

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

router.post("/analyze",
  requireAuth,
  upload.array("images", 1),
  async (req: Request, res) => {
    const apiKey = process.env["GOOGLE_API_KEY"];
    if (!apiKey) {
      res.status(500).json({ error: "Server is missing GOOGLE_API_KEY" });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "Please upload at least one image" });
      return;
    }

    const fieldAreaRaw = req.body.fieldArea;
    const fieldArea = parseFloat(String(fieldAreaRaw));
    if (!Number.isFinite(fieldArea) || fieldArea <= 0) {
      res.status(400).json({ error: "fieldArea must be a positive number (acres)" });
      return;
    }
    const cropTypeHint = typeof req.body.cropTypeHint === "string" && req.body.cropTypeHint.trim()
      ? req.body.cropTypeHint.trim()
      : undefined;

    const parts: GeminiPart[] = files.map(f => ({
      inlineData: {
        mimeType: f.mimetype,
        data:     f.buffer.toString("base64"),
      },
    }));

    const hintLine = cropTypeHint
      ? `Farmer says the crop is likely "${cropTypeHint}". Verify against the photos and override if clearly wrong.`
      : "The farmer did not specify a crop. Identify it from the photos.";

    const prompt = `You are an agronomy expert analysing photos that should show crop residue (post-harvest stubble) from a field in Punjab, India.

You have been given ${files.length} photo${files.length > 1 ? "s" : ""}. Field area entered: ${fieldArea} acres.

${hintLine}

STEP 1 — Validate. First, decide whether the photos actually show post-harvest crop residue / stubble in a field. If the photos show something else (a person, animal, vehicle, food, indoor scene, screenshot, growing/standing crop with no harvest, blank/black image, etc.) OR are too blurry to tell, set "isCropResidue": false and explain briefly in "rejectionReason". In that case do NOT fill the analysis fields — return only:
   { "isCropResidue": false, "rejectionReason": "<short reason for the farmer>" }

STEP 2 — If and only if the photos do show crop residue, set "isCropResidue": true and also return:
1. cropKey: one of "rice", "wheat", "maize", "sugarcane", "cotton", "other" (lowercase). Punjab is mostly rice/wheat.
2. gradeLabel: "Premium" | "Good" | "Average" | "Poor" — based on dryness, uniformity, freshness, and lack of contamination/burning.
3. qualityRating: integer 1-5 (5 = Premium).
4. confidence: integer 60-99 representing how sure you are of the crop+grade combined.
5. densityMultiplier: number 0.7-1.3 — how dense the residue cover looks (1.0 = average).
6. residueColorNotes: short string (e.g. "Golden-brown, dry — ready for collection").
7. issues: short string array with concerns (e.g. ["Some scorch marks"]). Empty array if none.
8. notes: 1-2 sentence summary written for the farmer.

Return ONLY the JSON object. No markdown fences, no commentary.`;

    parts.push({ text: prompt });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    let geminiData: any;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        console.error("Gemini error:", r.status, text);
        res.status(502).json({ error: "Image analysis service failed", details: text.slice(0, 500) });
        return;
      }
      geminiData = await r.json();
    } catch (e: any) {
      console.error("Gemini network error:", e);
      res.status(502).json({ error: "Could not reach image analysis service", details: e?.message });
      return;
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    let analysis: any;
    try {
      analysis = JSON.parse(rawText);
    } catch {
      const start = rawText.indexOf("{");
      const end   = rawText.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try { analysis = JSON.parse(rawText.slice(start, end + 1)); } catch {}
      }
      if (!analysis) {
        res.status(502).json({ error: "Could not parse AI response", raw: rawText.slice(0, 500) });
        return;
      }
    }

    if (analysis.isCropResidue === false) {
      res.status(422).json({
        isCropResidue: false,
        error: "These photos don't appear to show crop residue.",
        rejectionReason: String(analysis.rejectionReason ?? "Please upload clear photos of the harvested field with stubble visible."),
        photosAnalyzed: files.length,
      });
      return;
    }

    const cropKey = (typeof analysis.cropKey === "string" ? analysis.cropKey.toLowerCase() : "other") as keyof typeof RESIDUE_DEFAULTS;
    const meta = RESIDUE_DEFAULTS[cropKey] ?? RESIDUE_DEFAULTS.other;

    const densityMultiplier = clamp(Number(analysis.densityMultiplier ?? 1.0), 0.7, 1.3);
    const qualityRating = clampInt(Number(analysis.qualityRating ?? 3), 1, 5);
    const confidence = clampInt(Number(analysis.confidence ?? 80), 60, 99);
    const gradeLabel = String(analysis.gradeLabel ?? gradeFromRating(qualityRating));
    const residueFactor = parseFloat((meta.residueFactor * densityMultiplier).toFixed(2));
    const biomassEstimate = parseFloat((fieldArea * residueFactor).toFixed(2));

    const priceMultiplier = qualityRating >= 5 ? 1.10 : qualityRating === 4 ? 1.05 : qualityRating === 3 ? 1.0 : qualityRating === 2 ? 0.90 : 0.80;
    const pricePerTon = Math.round(meta.pricePerTon * priceMultiplier);

    res.json({
      isCropResidue: true,
      cropKey,
      cropType:        meta.cropType,
      cropIcon:        meta.icon,
      residueFactor,
      densityMultiplier,
      biomassEstimate,
      qualityRating,
      gradeLabel,
      confidence,
      recommendation:  RECOMMENDATIONS[cropKey] ?? RECOMMENDATIONS.other,
      bestUse:         meta.bestUse,
      pricePerTon,
      notes:           String(analysis.notes ?? ""),
      issues:          Array.isArray(analysis.issues) ? analysis.issues.map(String).slice(0, 6) : [],
      residueColorNotes: String(analysis.residueColorNotes ?? ""),
      photosAnalyzed:  files.length,
    });
  },
);

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, n));
}
function clampInt(n: number, lo: number, hi: number): number {
  return Math.round(clamp(n, lo, hi));
}
function gradeFromRating(r: number): string {
  if (r >= 5) return "Premium";
  if (r >= 4) return "Good";
  if (r >= 3) return "Average";
  return "Poor";
}

export default router;
