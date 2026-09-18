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

/**
 * @param {string} mode  'sections' | 'all' | 'columns' | 'off'
 * @param {number} [columnCount]  how many columns the grid draws (default 12)
 */
export function toggleOverlay(mode, columnCount) {
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

  /**
   * Where the site's content actually lives.
   *
   * The grid used to be twelfths of the VIEWPORT, which aligns with nothing on
   * any site with a centred `max-width` container — that is to say, nearly all
   * of them. At 1920 with a 1200px container, four of the eleven lines fell
   * outside the content area entirely. It only ever looked correct at 1440,
   * where twelfths of the window coincide with a 1200px container by accident.
   *
   * So measure it. The content width is the one that REPEATS: section after
   * section shares the container's left edge and width, while full-bleed
   * wrappers match the viewport and are excluded. If nothing repeats, the site
   * is genuinely full-bleed and the grid says so rather than inventing one.
   *
   * Note this lands on the container's CONTENT box, not its border box — on
   * `main{max-width:1200px;padding:40px}` the repeated width is 1120, because
   * that is where content actually sits. It is also what a design tool means by
   * a 12-column grid: columns are drawn inside the margin, not across it.
   */
  function detectContainer() {
    var tally = {};
    var nodes = document.body.querySelectorAll('main, section, article, header, footer, div');
    for (var i = 0; i < nodes.length && i < 2000; i++) {
      var rc = nodes[i].getBoundingClientRect();
      if (rc.height < 40) continue;
      // Full-bleed matches the viewport; a sidebar is too narrow to be the grid.
      if (rc.width > pageW - 2 || rc.width < pageW * 0.4) continue;
      var key = Math.round(rc.left + scrollX) + '|' + Math.round(rc.width);
      tally[key] = (tally[key] || 0) + 1;
    }
    var bestKey = null, best = 0;
    for (var k in tally) { if (tally[k] > best) { best = tally[k]; bestKey = k; } }
    if (!bestKey) return { left: 0, width: pageW, measured: false, hits: 0 };
    var parts = bestKey.split('|');
    return { left: +parts[0], width: +parts[1], measured: true, hits: best };
  }

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
    // 'columns' draws them too: a grid with nothing under it cannot be checked
    // for alignment, which is the only thing a grid overlay is for.
    if (mode === 'all' || ((mode === 'sections' || mode === 'columns') && isSection)) {
      var hue = roleHue(el, cs);
      var box = document.createElement('div');
      box.setAttribute('data-ef', isSection ? 'section' : 'box');
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

  var container = null;
  var cols = Math.max(2, Math.min(24, columnCount || 12));

  if (mode === 'columns') {
    container = detectContainer();
    // body.scrollHeight alone under-measures whenever the document is taller
    // than the body box, and the grid then stops partway down the page.
    var pageH = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.documentElement.offsetHeight,
    );
    var colW = container.width / cols;

    // Bands, not hairlines. A line marks a boundary; a band shows the column
    // an element is supposed to sit in, which is what you are checking.
    for (var c = 0; c < cols; c++) {
      var band = document.createElement('div');
      band.setAttribute('data-ef', 'col');
      band.style.cssText = 'position:absolute;pointer-events:none;box-sizing:border-box;'
        + 'top:0;height:' + pageH + 'px;'
        + 'left:' + (container.left + colW * c) + 'px;width:' + colW + 'px;'
        + 'background:rgba(31,79,143,.07);'
        + 'border-left:1px solid rgba(31,79,143,.28);'
        + (c === cols - 1 ? 'border-right:1px solid rgba(31,79,143,.28);' : '');
      layer.appendChild(band);
    }

    // Say what was measured. A grid that silently falls back to the viewport is
    // how the old one went wrong unnoticed for so long.
    var tag = document.createElement('span');
    tag.setAttribute('data-ef', 'label');
    tag.textContent = container.measured
      ? Math.round(container.width) + 'px content · ' + cols + ' col · ' + Math.round(colW) + 'px each'
      : 'no repeating content container found — grid drawn on the full ' + pageW + 'px viewport';
    tag.style.cssText = 'position:absolute;top:' + scrollY + 'px;left:' + container.left + 'px;'
      + 'font:10px ui-monospace,monospace;background:rgba(31,79,143,.92);color:#fff;'
      + 'padding:2px 6px;white-space:nowrap;pointer-events:none';
    layer.appendChild(tag);
  }

  return { active: true, boxes: drawn, columns: mode === 'columns' ? cols : null, container: container };
}
