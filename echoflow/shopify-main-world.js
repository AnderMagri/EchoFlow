// Runs in the MAIN world (page context) to access window.Shopify
// Injected via chrome.scripting.executeScript({ world: "MAIN" })
(function () {
  const shopify = window.Shopify;
  const data = {
    theme_name: shopify?.theme?.name || null,
    theme_version: shopify?.theme?.id || null,
    page_type: shopify?.page_type || null,
    product: shopify?.product ? {
      id: shopify.product.id,
      title: shopify.product.title,
      handle: shopify.product.handle,
      type: shopify.product.type,
      vendor: shopify.product.vendor,
      variant_count: shopify.product.variants?.length || 0
    } : null,
    collection: shopify?.collection ? {
      id: shopify.collection.id,
      title: shopify.collection.title,
      handle: shopify.collection.handle
    } : null,
    currency: shopify?.currency?.active || null,
    locale: shopify?.locale || null,
    shop: shopify?.shop || null,
    country: shopify?.country || null
  };

  window.postMessage({ type: 'ECHOFLOW_SHOPIFY_DATA', payload: data }, '*');
})();
