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

  // Work in device pixels for the output canvas
  const pxWidth = Math.round(cssWidth * dpr);
  const pxHeight = Math.round(cssHeight * dpr);

  canvas.width = pxWidth;
  canvas.height = pxHeight;

  for (const strip of strips) {
    const img = await loadImage(strip.dataUrl);

    // The captured image is in device pixels (e.g., 2x on Retina)
    // srcY and srcHeight are in CSS pixels — convert to device pixels
    const srcX = 0;
    const srcY = Math.round(strip.srcY * dpr);
    const srcW = img.naturalWidth;
    const srcH = Math.round(strip.srcHeight * dpr);

    // Destination on output canvas (also in device pixels)
    const destX = 0;
    const destY = Math.round(strip.destY * dpr);
    const destW = pxWidth;
    const destH = Math.round(strip.srcHeight * dpr);

    ctx.drawImage(img, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
  }

  return canvas.toDataURL('image/jpeg', 0.85);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image strip'));
    img.src = dataUrl;
  });
}
