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
    var bestKey = null, best = 0, bestWidth = Infinity;
    for (var k in tally) {
      var w = +k.split('|')[1];
      // More repeats wins. On a tie the NARROWER box wins: a wrapper with
      // 32px of padding repeats exactly as often as the content column inside
      // it, and drawing the grid across the padding puts every line in the
      // wrong place by the padding width.
      if (tally[k] > best || (tally[k] === best && w < bestWidth)) {
        best = tally[k]; bestKey = k; bestWidth = w;
      }
    }
    if (!bestKey) return { left: 0, width: pageW, measured: false, hits: 0 };
    var parts = bestKey.split('|');
    return { left: +parts[0], width: +parts[1], measured: true, hits: best };
  }

  /**
   * How many columns is this page actually laid out on?
   *
   * Offering 12 in a menu is not detection — it is a guess the reader has to
   * confirm by eye, which is the work the overlay was supposed to do. Two
   * sources, in order of authority:
   *
   * 1. An explicit CSS grid. `grid-template-columns` resolves to a list of
   *    real track sizes in the computed style, so the count is a FACT, not an
   *    inference. A four-up product grid says four and there is nothing to
   *    argue about.
   *
   * 2. The layout grid, inferred from where element edges fall. Most
   *    storefronts have no `display:grid` on the page skeleton at all — the
   *    12-column system lives in the designer's head and in a set of widths.
   *    So search for the (columns, gutter) pair whose boundaries the most
   *    element edges land on.
   *
   * The search has to include the gutter. A 12-column grid with a 24px gutter
   * puts its edges at multiples of (col + gutter), NOT at twelfths of the
   * container, so a gutter-less model scores a real 12-col layout near zero
   * and picks something meaningless instead.
   */
  function detectGrid(box) {
    var explicit = countExplicitGrids(box);
    var inferred = inferLayoutGrid(box);
    // The one the page is actually laid out on: the widest CSS grid that
    // fills the content column. Below that it is a component, not the page.
    var pageGrid = null;
    for (var i = 0; i < explicit.length; i++) {
      if (explicit[i].span >= 0.9) { pageGrid = explicit[i]; break; }
    }
    return { explicit: explicit, inferred: inferred, pageGrid: pageGrid };
  }

  /**
   * Real CSS grids on the page, by their resolved track lists.
   *
   * Ranked by WIDTH, not by how many there are. A collection page has a dozen
   * two-up grids inside cards and one four-up product grid — counting
   * occurrences picks the cards, which is the component, not the page. The
   * grid that spans the content column is the page's grid; everything
   * narrower is something laid out inside it.
   */
  function countExplicitGrids(box) {
    var byCols = {};
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length && i < 4000; i++) {
      var cs = getComputedStyle(all[i]);
      if (cs.display !== 'grid' && cs.display !== 'inline-grid') continue;
      var tpl = cs.gridTemplateColumns;
      if (!tpl || tpl === 'none') continue;
      var r = all[i].getBoundingClientRect();
      // Short grids still count. A filter row 32px tall is a real 3-up grid,
      // and the old 40px floor dropped it silently.
      if (r.width < 120 || r.height < 8) continue;
      // The computed value is a resolved px list, so the token count IS the
      // column count. `repeat(4, 1fr)` arrives as "260px 260px 260px 260px".
      var n = tpl.trim().split(/\s+/).length;
      if (n < 2 || n > 24) continue;
      var span = box && box.width ? r.width / box.width : 0;
      if (!byCols[n]) byCols[n] = { columns: n, uses: 0, width: 0, span: 0 };
      byCols[n].uses++;
      if (r.width > byCols[n].width) {
        byCols[n].width = r.width;
        byCols[n].span = span;
      }
    }
    return Object.keys(byCols)
      .map(function (n) { return byCols[n]; })
      .sort(function (a, b) { return b.width - a.width; });
  }

  /**
   * Search (columns × gutter) for the grid the most element edges sit on.
   *
   * Scoring has to punish large counts. A 16-column grid has more boundaries
   * than a 4-column one, so it catches more edges by accident and always wins
   * a naive "how many edges aligned" contest. So the score is coverage TIMES
   * the share of boundaries that are actually used: a grid whose lines are
   * mostly empty is not the grid this page was drawn on.
   */
  function inferLayoutGrid(box) {
    var edges = dedupe(collectEdges(box));
    if (edges.length < 6) return null;

    var GUTTERS = [0, 8, 10, 12, 16, 20, 24, 30, 32, 40, 48];
    var candidates = [];

    for (var n = 2; n <= 16; n++) {
      for (var g = 0; g < GUTTERS.length; g++) {
        var gut = GUTTERS[g];
        var col = (box.width - (n - 1) * gut) / n;
        // A gutter wider than a column is not a grid, it is a coincidence with
        // a plausible arithmetic.
        if (col < 24 || gut > col) continue;

        // Tight. The first pass allowed 4% of a column, which let a 4-col
        // model swallow a 12-col page: 306 and 304 are two different grids and
        // six pixels of slack cannot tell them apart. Real edges land within
        // a pixel or two of their line; anything looser is not measuring.
        var tol = Math.min(3, Math.max(1.5, col * 0.015));

        // Every line an element could legitimately sit on: the start of each
        // column and the end of each column.
        var lines = [];
        for (var i = 0; i < n; i++) {
          lines.push(box.left + i * (col + gut));
          lines.push(box.left + i * (col + gut) + col);
        }

        var hitLines = {};
        var hits = 0;
        var residual = 0;
        for (var e = 0; e < edges.length; e++) {
          var nearest = Infinity, nearestLine = -1;
          for (var l = 0; l < lines.length; l++) {
            var d = Math.abs(edges[e] - lines[l]);
            if (d < nearest) { nearest = d; nearestLine = l; }
          }
          if (nearest <= tol) { hits++; residual += nearest; hitLines[nearestLine] = 1; }
        }
        var distinct = Object.keys(hitLines).length;
        // A grid has to be evidenced across its own width. Eight product tiles
        // repeat the same handful of x positions, and before the edges were
        // deduplicated that let a 14-column model "explain" 69% of them while
        // touching five of its twenty-eight lines. A claim of n columns needs
        // at least n lines with something on them.
        if (distinct < Math.max(3, n)) continue;
        candidates.push({
          columns: n, gutter: gut,
          coverage: hits / edges.length,
          // How CLOSELY it fits, not just whether it fits. The grid a page was
          // drawn on sits on its edges to within a pixel; a coarser grid that
          // happens to land nearby averages two or three.
          residual: hits ? residual / hits : Infinity,
          lines: distinct,
        });
      }
    }
    if (!candidates.length) return null;

    // Rank by how much of the page the grid explains, then by how tightly.
    //
    // Two earlier attempts got this wrong. Multiplying coverage by the share
    // of gridlines used punished exactly the grids it was meant to find — a
    // real 12-column layout leaves most of its 24 lines empty, because you do
    // not place something against every one. Falling back to "fewer columns
    // wins" was just as bad: an 8-column page also fits a 4-column reading,
    // since a coarse grid is a SUBSET of a fine one, and simplicity picked the
    // wrong one every time.
    //
    // Residual settles it. Both models may cover every edge, but only the real
    // grid sits ON them — 8 columns at 20px fits the 8-column page to within a
    // fraction of a pixel, while 4 columns at 16px is out by two or three and
    // only passes because the tolerance is generous.
    candidates.sort(function (a, b) {
      if (Math.abs(a.coverage - b.coverage) > 0.02) return b.coverage - a.coverage;
      if (Math.abs(a.residual - b.residual) > 0.35) return a.residual - b.residual;
      if (a.columns !== b.columns) return a.columns - b.columns;
      return a.gutter - b.gutter;
    });

    var best = candidates[0];
    return best.coverage < 0.5 ? null : best;
  }

  /**
   * Distinct positions only.
   *
   * A row of identical tiles contributes the same x values over and over, and
   * counting them repeatedly lets a wrong model score well by explaining one
   * popular edge many times. What matters is how many DIFFERENT places on the
   * page the grid accounts for.
   */
  function dedupe(values) {
    var seen = {};
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var k = Math.round(values[i]);
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(values[i]);
    }
    return out;
  }

  /** Left and right edges of everything substantial inside the container. */
  function collectEdges(box) {
    var out = [];
    var all = document.body.querySelectorAll('div, section, article, main, aside, header, footer, ul, ol, figure, img, h1, h2, h3, p, a, form');
    for (var i = 0; i < all.length && i < 3000; i++) {
      var cs = getComputedStyle(all[i]);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = all[i].getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      var left = r.left + scrollX, right = r.right + scrollX;
      // Only what is inside the content column; a full-bleed band tells you
      // nothing about the grid its contents sit on.
      if (right < box.left - 2 || left > box.left + box.width + 2) continue;
      out.push(left, right);
    }
    return out;
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
  var grid = null;
  var cols = null;
  var gutter = 0;

  if (mode === 'columns') {
    container = detectContainer();
    grid = detectGrid(container);

    // Measured first, asked-for second. `columnCount` is an override for when
    // the reader knows the intended grid and wants to check the page against
    // it — not the default, because a default of 12 is a guess wearing the
    // costume of a measurement.
    if (columnCount) {
      cols = Math.max(2, Math.min(24, columnCount));
      gutter = grid.inferred && grid.inferred.columns === cols ? grid.inferred.gutter : 0;
    } else if (grid.inferred) {
      cols = grid.inferred.columns;
      gutter = grid.inferred.gutter;
    } else if (grid.pageGrid) {
      cols = grid.pageGrid.columns;
    } else if (grid.explicit.length) {
      cols = grid.explicit[0].columns;
    } else {
      cols = 12; // nothing measurable — say so in the label below
    }
    // body.scrollHeight alone under-measures whenever the document is taller
    // than the body box, and the grid then stops partway down the page.
    var pageH = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.documentElement.offsetHeight,
    );
    var colW = (container.width - (cols - 1) * gutter) / cols;

    // Bands, not hairlines. A line marks a boundary; a band shows the column
    // an element is supposed to sit in, which is what you are checking. The
    // gutters are left empty, because an element landing in a gutter is the
    // defect you are looking for and a gapless grid hides it.
    for (var c = 0; c < cols; c++) {
      var band = document.createElement('div');
      band.setAttribute('data-ef', 'col');
      band.style.cssText = 'position:absolute;pointer-events:none;box-sizing:border-box;'
        + 'top:0;height:' + pageH + 'px;'
        + 'left:' + (container.left + c * (colW + gutter)) + 'px;width:' + colW + 'px;'
        + 'background:rgba(31,79,143,.07);'
        + 'border-left:1px solid rgba(31,79,143,.28);'
        + 'border-right:1px solid rgba(31,79,143,.28);';
      layer.appendChild(band);
    }

    // Say what was measured. A grid that silently falls back to the viewport is
    // how the old one went wrong unnoticed for so long.
    var tag = document.createElement('span');
    tag.setAttribute('data-ef', 'label');
    var how = columnCount ? 'you chose'
      : grid.inferred ? Math.round(grid.inferred.coverage * 100) + '% of edges fit'
      : grid.pageGrid ? 'the CSS grid spanning this column'
      : grid.explicit.length ? 'the widest CSS grid on the page'
      : 'no grid detected — showing 12';
    tag.textContent = Math.round(container.width) + 'px content · ' + cols + ' col'
      + (gutter ? ' · ' + gutter + 'px gutter' : '') + ' · ' + Math.round(colW) + 'px each'
      + ' (' + how + ')'
      + (container.measured ? '' : ' · no content container, using the viewport');
    tag.style.cssText = 'position:absolute;top:' + scrollY + 'px;left:' + container.left + 'px;'
      + 'font:10px ui-monospace,monospace;background:rgba(31,79,143,.92);color:#fff;'
      + 'padding:2px 6px;white-space:nowrap;pointer-events:none';
    layer.appendChild(tag);
  }

  return {
    active: true,
    boxes: drawn,
    columns: mode === 'columns' ? cols : null,
    gutter: gutter,
    container: container,
    grid: grid,
  };
}
