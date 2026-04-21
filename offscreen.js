// EchoFlow Offscreen Document
// Streaming stitch protocol: STITCH_BEGIN → STITCH_STRIP × N → STITCH_FINISH
// Each strip is sent individually (PNG, ~3-8 MB) to stay well under Chrome's
// 64 MB message limit. State is held across messages in module-level variables.

let sc     = null;   // stitching canvas
let scCtx  = null;
let scCssW = 0;      // viewport CSS width (used to derive actual DPR)
let scDpr  = null;   // derived from first strip's real pixel dimensions

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Streaming protocol ──────────────────────────────────────────────────

  if (message.action === 'STITCH_BEGIN') {
    // Initialise the shared canvas. Width/height are set from the hint DPR;
    // the width is corrected from the first strip's actual dimensions, and
    // the height is trimmed in STITCH_FINISH.
    sc     = document.getElementById('canvas');
    scCtx  = sc.getContext('2d');
    scCssW = message.cssWidth;
    scDpr  = null;
    const hint = message.hintDpr || 2;
    sc.width  = Math.round(message.cssWidth    * hint);
    sc.height = Math.round(message.totalHeight * hint);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'STITCH_STRIP') {
    loadImage(message.strip.dataUrl)
      .then(img => {
        // On the very first strip, derive the actual device-pixel ratio from
        // the captured image's own dimensions — more reliable than
        // window.devicePixelRatio when the browser zoom ≠ 100%.
        if (!scDpr) {
          scDpr = img.naturalWidth / scCssW;
          sc.width = Math.round(scCssW * scDpr);
          // Canvas height stays at the totalHeight estimate until STITCH_FINISH
        }
        const strip = message.strip;
        const srcY  = Math.round(strip.srcY      * scDpr);
        const srcH  = Math.round(strip.srcHeight * scDpr);
        const destY = Math.round(strip.destY     * scDpr);
        scCtx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, destY, sc.width, srcH);
        sendResponse({ success: true });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'STITCH_FINISH') {
    // Trim canvas to the actual covered height so there's no blank area at
    // the bottom (happens when the last scroll position hits maxScrollY early).
    const dpr    = scDpr || 1;
    const finalH = Math.round(message.coveredUpTo * dpr);

    const out  = document.createElement('canvas');
    out.width  = sc.width;
    out.height = finalH;
    out.getContext('2d').drawImage(sc, 0, 0, sc.width, finalH, 0, 0, sc.width, finalH);

    sendResponse({ success: true, dataUrl: out.toDataURL('image/jpeg', 0.92) });
    return true;
  }

  // ── Legacy one-shot protocol (kept for safety) ──────────────────────────

  if (message.action === 'STITCH_SCREENSHOTS') {
    stitchLegacy(message.strips, message.totalWidth, message.totalHeight, message.devicePixelRatio || 1)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ── Legacy helper ──────────────────────────────────────────────────────────

async function stitchLegacy(strips, cssWidth, cssHeight, dpr) {
  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  const firstImg = await loadImage(strips[0].dataUrl);
  const imgDpr   = firstImg.naturalWidth / cssWidth;
  canvas.width   = Math.round(cssWidth  * imgDpr);
  canvas.height  = Math.round(cssHeight * imgDpr);

  drawOne(ctx, firstImg, strips[0], imgDpr, canvas.width);
  for (let i = 1; i < strips.length; i++) {
    drawOne(ctx, await loadImage(strips[i].dataUrl), strips[i], imgDpr, canvas.width);
  }
  return canvas.toDataURL('image/jpeg', 0.90);
}

function drawOne(ctx, img, strip, imgDpr, canvasWidth) {
  const srcY  = Math.round(strip.srcY      * imgDpr);
  const srcH  = Math.round(strip.srcHeight * imgDpr);
  const destY = Math.round(strip.destY     * imgDpr);
  ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, destY, canvasWidth, srcH);
}

// ── Shared utility ─────────────────────────────────────────────────────────

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img   = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image strip'));
    img.src     = dataUrl;
  });
}
