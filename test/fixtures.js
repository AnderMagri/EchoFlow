/** Synthetic sites for verifying the instrument separates clean from messy. */
const t = (pairs) => pairs.map(([value, count]) => ({ value, count }));

function page(url, surface, overrides = {}) {
  return {
    url, surface, viewport: { width: 1440, height: 900, label: 'desktop' },
    styles: {}, roles: {}, anatomy: {}, copy: {}, engine: {}, a11y: {}, ...overrides,
  };
}

/** A site with a real design system: few tokens, no forks, components agree. */
export function cleanSite() {
  const styles = {
    colorText: t([['#1a1a1a', 800], ['#6b7280', 200]]),
    colorBackground: t([['#ffffff', 900], ['#f9fafb', 150]]),
    colorBorder: t([['#e5e7eb', 120], ['#2563eb', 40]]),
    fontFamily: t([['Inter, sans-serif', 900], ['Fraunces, serif', 120]]),
    fontSize: t([['14px', 200], ['16px', 800], ['20px', 120], ['24px', 60], ['32px', 30], ['48px', 10]]),
    fontWeight: t([['400', 800], ['500', 200], ['700', 100]]),
    borderRadius: t([['4px', 200], ['8px', 150], ['999px', 40]]),
    shadow: t([['0 1px 2px rgba(0,0,0,.06)', 90], ['0 4px 12px rgba(0,0,0,.08)', 30]]),
    spacing: t([['8px', 400], ['16px', 380], ['24px', 200], ['32px', 120], ['48px', 60], ['64px', 30]]),
  };
  const btn = { label: 'Add to cart', background: '#2563eb', color: '#ffffff', fontSize: 16, fontWeight: 500, borderRadius: 8, height: 48 };
  const header = { items: ['Shop', 'About', 'Journal', 'Contact'], height: 72 };
  const mk = (url, surface, anatomy) => page(url, surface, {
    styles, roles: { primaryButton: btn, header },
    anatomy,
    copy: { priceFormats: ['$0.00'] },
    engine: { isShopify: true, apps: ['klaviyo', 'judgeme'], sections: ['header', 'footer', 'image-banner', 'featured-collection', 'main-product'], vitals: { lcp: 1800 } },
  });
  const pdpAnatomy = { gallery: true, title: true, price: true, variantSelector: true, addToCart: true, description: true, reviews: true, breadcrumbs: true, recommendations: true, shippingInfo: true, stockStatus: true };
  return [
    mk('https://clean.com/', 'home', { hero: true, featuredProducts: true, valueProps: true, newsletter: true, socialProof: true }),
    mk('https://clean.com/products/a', 'pdp', pdpAnatomy),
    mk('https://clean.com/products/b', 'pdp', pdpAnatomy),
    mk('https://clean.com/products/c', 'pdp', pdpAnatomy),
    mk('https://clean.com/collections/all', 'plp', { title: true, productGrid: true, filters: true, sort: true, pagination: true, breadcrumbs: true, resultCount: true }),
  ];
}

/** A site assembled page by page: token sprawl, forks, drifting components. */
export function messySite() {
  const base = {
    colorText: t([['#333333', 400], ['#343434', 30], ['#353535', 12], ['#2b2b2b', 40], ['#555555', 90], ['#5a5a5a', 20]]),
    colorBackground: t([['#ffffff', 700], ['#fefefe', 20], ['#f8f9fa', 90], ['#f7f8f9', 30], ['#fafbfc', 25]]),
    colorBorder: t([['#e63946', 60], ['#e5393f', 18], ['#dd3844', 9], ['#457b9d', 30], ['#4a7fa0', 11],
      ['#2a9d8f', 20], ['#e9c46a', 15], ['#f4a261', 12], ['#e76f51', 10], ['#264653', 14], ['#a8dadc', 9], ['#1d3557', 8]]),
    fontFamily: t([['Roboto, sans-serif', 500], ['Open Sans, sans-serif', 300], ['Montserrat, sans-serif', 200], ['Lato, sans-serif', 90], ['Georgia, serif', 40]]),
    fontSize: t([['11px', 40], ['12px', 120], ['13px', 90], ['14px', 300], ['15px', 110], ['16px', 400],
      ['17px', 30], ['18px', 150], ['19px', 20], ['20px', 90], ['22px', 40], ['24px', 70], ['26px', 25],
      ['28px', 40], ['30px', 15], ['32px', 35], ['36px', 20], ['42px', 10], ['48px', 12]]),
    fontWeight: t([['300', 60], ['400', 500], ['500', 200], ['600', 180], ['700', 150], ['800', 40], ['900', 10]]),
    borderRadius: t([['2px', 60], ['3px', 40], ['4px', 120], ['5px', 30], ['6px', 90], ['8px', 110], ['10px', 25], ['12px', 40], ['20px', 15]]),
    shadow: t([['0 1px 2px rgba(0,0,0,.05)', 40], ['0 1px 3px rgba(0,0,0,.05)', 30], ['0 2px 4px rgba(0,0,0,.1)', 50],
      ['0 2px 5px rgba(0,0,0,.1)', 20], ['0 4px 6px rgba(0,0,0,.1)', 35], ['0 4px 8px rgba(0,0,0,.12)', 25],
      ['0 6px 12px rgba(0,0,0,.15)', 15], ['0 10px 20px rgba(0,0,0,.2)', 10]]),
    spacing: t([['5px', 80], ['8px', 200], ['10px', 150], ['12px', 180], ['13px', 25], ['15px', 90],
      ['16px', 210], ['18px', 40], ['20px', 160], ['22px', 20], ['24px', 130], ['25px', 70],
      ['30px', 95], ['32px', 60], ['35px', 30], ['40px', 80], ['45px', 20], ['50px', 60]]),
  };
  const mk = (url, surface, btn, header, anatomy, apps, lcp, priceFormats) => page(url, surface, {
    styles: base, roles: { primaryButton: btn, header }, anatomy,
    copy: { priceFormats },
    engine: { isShopify: true, apps, sections: ['header', 'footer', 'hero-a', 'hero-b', 'banner', 'banner-alt', 'grid', 'grid-2', 'product-main', 'product-alt', 'slider', 'carousel'], vitals: { lcp } },
  });
  const nav1 = ['Shop', 'About', 'Blog', 'Contact'];
  const nav2 = ['Shop', 'Our Story', 'Blog', 'Contact', 'Sale'];
  return [
    mk('https://messy.com/', 'home', { label: 'Shop Now', background: '#e63946', color: '#fff', fontSize: 16, fontWeight: 700, borderRadius: 4, height: 48 }, { items: nav1 },
      { hero: true, featuredProducts: true, valueProps: false, newsletter: true, socialProof: false }, ['klaviyo', 'judgeme', 'gorgias', 'hotjar'], 2400, ['$0.00']),
    mk('https://messy.com/products/a', 'pdp', { label: 'Add to cart', background: '#e63946', color: '#fff', fontSize: 16, fontWeight: 700, borderRadius: 4, height: 48 }, { items: nav1 },
      { gallery: true, title: true, price: true, variantSelector: true, addToCart: true, description: true, reviews: true, breadcrumbs: true, recommendations: true, shippingInfo: true, stockStatus: true }, ['klaviyo', 'judgeme', 'gorgias', 'hotjar'], 2600, ['$0.00']),
    mk('https://messy.com/products/b', 'pdp', { label: 'ADD TO BAG', background: '#e5393f', color: '#fff', fontSize: 15, fontWeight: 600, borderRadius: 6, height: 42 }, { items: nav2 },
      { gallery: true, title: true, price: true, variantSelector: true, addToCart: true, description: true, reviews: false, breadcrumbs: false, recommendations: false, shippingInfo: true, stockStatus: false }, ['klaviyo', 'judgeme', 'gorgias', 'hotjar', 'yotpo', 'pushowl'], 4800, ['USD 0.00']),
    mk('https://messy.com/products/c', 'pdp', { label: 'Buy now', background: '#dd3844', color: '#fff', fontSize: 18, fontWeight: 800, borderRadius: 8, height: 56 }, { items: nav2 },
      { gallery: true, title: true, price: true, variantSelector: false, addToCart: true, description: true, reviews: false, breadcrumbs: false, recommendations: true, shippingInfo: false, stockStatus: false }, ['klaviyo', 'judgeme'], 5200, ['0,00 $']),
    mk('https://messy.com/collections/all', 'plp', { label: 'Shop Now', background: '#e63946', color: '#fff', fontSize: 16, fontWeight: 700, borderRadius: 4, height: 48 }, { items: nav1 },
      { title: true, productGrid: true, filters: false, sort: true, pagination: true, breadcrumbs: true, resultCount: false }, ['klaviyo', 'judgeme', 'gorgias'], 3100, ['$0.00']),
  ];
}
