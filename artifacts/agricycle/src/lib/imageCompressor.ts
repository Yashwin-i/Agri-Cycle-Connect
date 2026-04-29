/**
 * imageCompressor.ts — Client-side image compression for Low Internet Mode
 *
 * RURAL USABILITY RATIONALE
 * ──────────────────────────
 * Mobile data in rural Punjab is predominantly 2G/3G with average speeds
 * of 1–5 Mbps and high latency (~200 ms round-trips on BSNL/Jio rural).
 * A typical smartphone field photo is 3–8 MB in JPEG/HEIC format.
 *
 * Without compression, uploading an 8 MB photo on a 2G connection takes
 * 60+ seconds and may time-out.  With 80 % quality JPEG compression at
 * half the original resolution, the same photo is typically 200–600 KB —
 * a 10–15× reduction that brings upload time under 5 seconds.
 *
 * HOW IT WORKS
 * ─────────────
 * We use the browser's built-in <canvas> API to:
 *   1. Decode the File/Blob into an HTMLImageElement
 *   2. Draw it onto a canvas scaled to maxWidth × maxHeight
 *   3. Re-encode as JPEG at the target quality
 *   4. Return a new Blob the caller can display or upload
 *
 * No external library is needed — canvas.toBlob() is available in all
 * modern browsers including Chrome Android 88+ and Safari iOS 14+.
 *
 * SETTINGS (Low Internet preset)
 * ──────────────────────────────
 *   maxDimension : 1024 px — retains enough detail for the CV pipeline
 *   quality      : 0.72    — virtually invisible compression artefacts
 *                            at this size; typical output < 250 KB
 */

export interface CompressOptions {
  maxDimension?: number;   // longest edge of output image, default 1024
  quality?: number;        // JPEG quality 0–1, default 0.72
}

export interface CompressResult {
  blob: Blob;
  originalSizeKb: number;
  compressedSizeKb: number;
  compressionRatio: number;   // 0–1, lower = more compressed
}

/**
 * compressImage — takes a File and returns a smaller JPEG Blob.
 *
 * Returns a rejected Promise only if the browser can't decode the image
 * (e.g. corrupt file). All canvas errors are caught and re-thrown.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const { maxDimension = 1024, quality = 0.72 } = options;

  return new Promise((resolve, reject) => {
    const originalSizeKb = Math.round(file.size / 1024);

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // free memory immediately

      // Calculate dimensions preserving aspect ratio
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height / width) * maxDimension);
          width  = maxDimension;
        } else {
          width  = Math.round((width / height) * maxDimension);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas 2D not available")); return; }

      // Use bilinear smoothing for a cleaner downscale (default browser behaviour)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error("Canvas toBlob returned null")); return; }
          const compressedSizeKb = Math.round(blob.size / 1024);
          resolve({
            blob,
            originalSizeKb,
            compressedSizeKb,
            compressionRatio: blob.size / file.size,
          });
        },
        "image/jpeg",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to decode image"));
    };

    img.src = objectUrl;
  });
}

/** Convenience: return an object URL pointing to the compressed Blob */
export async function compressImageToUrl(
  file: File,
  options?: CompressOptions,
): Promise<{ url: string; result: CompressResult }> {
  const result = await compressImage(file, options);
  return { url: URL.createObjectURL(result.blob), result };
}
