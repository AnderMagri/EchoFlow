// EchoFlow Offscreen Document
// Handles canvas-based image stitching for full-page screenshots.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'STITCH_SCREENSHOTS') {
    stitchScreenshots(message.strips, message.totalWidth, message.totalHeight, message.devicePixelRatio || 1)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function stitchScreenshots(strips, cssWidth, cssHeight, dpr) {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  // Load the first strip to derive the *actual* device pixel ratio from the
  // captured image's own dimensions. window.devicePixelRatio (passed as dpr)
  // can diverge from the capture ratio when the browser zoom ≠ 100% or the
  // OS uses fractional scaling — using the real image ratio eliminates seams.
  const firstImg = await loadImage(strips[0].dataUrl);
  const imgDpr = firstImg.naturalWidth / cssWidth;  // actual px per CSS px

  // Output canvas size uses the real imgDpr so height is exact
  const pxWidth  = Math.round(cssWidth  * imgDpr);
  const pxHeight = Math.round(cssHeight * imgDpr);
  canvas.width  = pxWidth;
  canvas.height = pxHeight;

  async function drawStrip(img, strip) {
    // Source: crop from the captured image (device pixels via imgDpr)
    const srcY = Math.round(strip.srcY      * imgDpr);
    const srcH = Math.round(strip.srcHeight * imgDpr);
    // Destination: same coordinate system — no scaling distortion at seams
    const destY = Math.round(strip.destY    * imgDpr);
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, destY, pxWidth, srcH);
  }

  // First strip already loaded
  await drawStrip(firstImg, strips[0]);

  // Remaining strips — load and draw sequentially to keep memory bounded
  for (let i = 1; i < strips.length; i++) {
    const img = await loadImage(strips[i].dataUrl);
    await drawStrip(img, strips[i]);
  }

  return canvas.toDataURL('image/jpeg', 0.90);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image strip'));
    img.src = dataUrl;
  });
}
