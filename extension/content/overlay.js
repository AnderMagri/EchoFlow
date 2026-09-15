/**
 * Live structure overlay.
 *
 * Injected into the page being audited. Draws the box skeleton ON the real
 * page rather than on a captured render, so you can scroll the client's site
 * with the structure lit up and see where the section boundaries actually fall.
 *
 * Self-contained by necessity — it is injected as a function, so it closes over
 * nothing.
 */

export function toggleOverlay(mode) {
  var ID = '__echoflow_overlay__';
  var existing = document.getElementById(ID);
  if (existing) { existing.remove(); if (!mode) return { active: false }; }
  if (!mode || mode === 'off') return { active: false };

  var layer = document.createElement('div');
  layer.id = ID;
  layer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483646';
  document.body.appendChild(layer);

  var pageW = document.documentElement.clientWidth;
  var scrollX = window.scrollX, scrollY = window.scrollY;
  var drawn = 0;

  function roleHue(el, cs) {
    var tag = el.tagName.toLowerCase();
    var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    if (tag === 'nav' || /nav|menu|header/.test(cls)) return 265;
    if (tag === 'footer') return 265;
    if (tag === 'form') return 330;
    if (/hero|banner|slideshow/.test(cls)) return 25;
    if (cs.display === 'grid' || /grid|collection|products/.test(cls)) return 200;
    if (/card|item|tile/.test(cls)) return 200;
    if (tag === 'img' || tag === 'picture' || /media|image|gallery/.test(cls)) return 160;
    return 210;
  }

  function walk(el, depth) {
    if (depth > 6 || drawn > 900) return;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) return;

    var parent = el.parentElement;
    var pw = parent ? parent.getBoundingClientRect().width : pageW;
    var isSection = depth <= 4 && r.width >= (pw || pageW) * 0.9 && r.height >= 80
      && (el.tagName === 'SECTION' || el.tagName === 'HEADER' || el.tagName === 'FOOTER'
        || /^shopify-section/.test(el.id || '') || el.hasAttribute('data-section-type'));

    // In 'sections' mode only the structural blocks are drawn — that is the
    // view you want when estimating a rebuild, without every div shouting.
    if (mode === 'all' || (mode === 'sections' && isSection)) {
      var hue = roleHue(el, cs);
      var box = document.createElement('div');
      box.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none;'
        + 'left:' + (r.left + scrollX) + 'px;top:' + (r.top + scrollY) + 'px;'
        + 'width:' + r.width + 'px;height:' + r.height + 'px;'
        + 'border:' + (isSection ? '2px solid hsl(' + hue + ' 70% 45% / .85)' : '1px solid hsl(' + hue + ' 60% 50% / .45)') + ';'
        + 'background:hsl(' + hue + ' 60% 50% / ' + (isSection ? '.06' : '.03') + ')';

      if (isSection || mode === 'all') {
        var label = document.createElement('span');
        var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
        label.textContent = el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls ? '.' + cls : '')
          + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
        label.style.cssText = 'position:absolute;top:0;left:0;font:9px ui-monospace,monospace;'
          + 'background:hsl(' + hue + ' 70% 30%);color:#fff;padding:1px 4px;white-space:nowrap;'
          + 'border-radius:0 0 3px 0;opacity:.9';
        box.appendChild(label);
      }
      layer.appendChild(box);
      drawn++;
    }
    for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1);
  }

  for (var i = 0; i < document.body.children.length; i++) walk(document.body.children[i], 1);

  if (mode === 'columns') {
    for (var c = 1; c < 12; c++) {
      var line = document.createElement('div');
      line.style.cssText = 'position:absolute;top:0;height:' + document.body.scrollHeight + 'px;'
        + 'left:' + (pageW / 12) * c + 'px;width:1px;background:rgba(31,79,143,.35)';
      layer.appendChild(line);
    }
  }

  return { active: true, boxes: drawn };
}
