// Page statistiques : chiffres clés et graphiques calculés à partir des avis publiés.
(function () {
  const { sb, configured, cookieCount, plural, el, fmtRating, ratingTone, toast } = window.CK;
  const $ = id => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";

  async function load() {
    let reviews;
    if (!configured) {
      $("demoBanner").hidden = false;
      reviews = window.CK.demoReviews();
    } else {
      const { data, error } = await sb.from("reviews").select("*").eq("published", true).order("num");
      if (error) { toast("Impossible de charger les cookies : " + error.message, "error"); return; }
      reviews = data;
    }
    render(reviews.slice().sort((a, b) => a.num - b.num));
  }

  // ── Ville d'une enseigne, devinée à partir du lieu (puis du titre et de l'avis) ──
  const VILLES = ["Paris", "Lyon", "Marseille", "Strasbourg", "Besançon", "Pontarlier", "Asnières-sur-Seine",
    "Bordeaux", "Lille", "Nantes", "Toulouse", "Nice", "Grenoble", "Dijon", "Annecy", "Rennes", "Montpellier",
    "Berlin", "Rome", "Londres", "Bruxelles", "Genève", "Lausanne", "Chine", "Vietnam"];
  // Repères qui suffisent à situer la ville
  const REPERES = [[/\bisfa\b/, "Lyon"], [/\bconfluence\b/, "Lyon"], [/gare du nord/, "Paris"], [/\basni[eè]res\b/, "Asnières-sur-Seine"]];
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const known = s => VILLES.find(v => norm(v) === norm(s).trim());
  const findIn = text => {
    const t = norm(text);
    const v = VILLES.find(v => new RegExp("\\b" + norm(v) + "\\b").test(t));
    if (v) return v;
    const r = REPERES.find(([re]) => re.test(t));
    return r ? r[1] : null;
  };

  function cityOf(r) {
    const place = (r.place || "").trim();
    if (/fait maison/i.test(place) || /fait maison|\bby me\b/i.test(r.title)) return "Fait maison";
    const cp = place.match(/\b\d{5}\s+([^,]+)/);
    if (cp) return known(cp[1]) || cp[1].trim();
    if (place.includes(",")) {
      const last = place.split(",").pop().trim();
      if (known(last)) return known(last);
    }
    return findIn(place) || findIn(r.title) || findIn(r.body) || "Non précisée";
  }

  // ── Petits outils de dessin ──
  function svg(tag, attrs, ...children) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    for (const c of children) if (c != null) n.append(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  }
  const card = (title, sub, ...body) => el("section", { class: "chart-card" },
    el("h2", { text: title }), sub ? el("p", { class: "chart-sub", text: sub }) : null, ...body);

  // Barres horizontales : [{ label, value, display, tone }]
  function hbars(rows, max) {
    max = max || Math.max(1, ...rows.map(r => r.value));
    return el("div", { class: "hbars" }, ...rows.map(r =>
      el("div", { class: "hbar", "data-tone": r.tone || null },
        el("span", { class: "hbar-label", text: r.label }),
        el("span", { class: "hbar-track" }, el("span", { class: "hbar-fill" + (r.muted ? " is-muted" : ""), style: "width:" + (r.value / max * 100) + "%" })),
        el("b", { class: "hbar-value", text: r.display != null ? r.display : String(r.value) }))));
  }

  function render(reviews) {
    const rated = reviews.filter(r => r.rating != null);
    const cookies = reviews.reduce((s, r) => s + cookieCount(r), 0);
    const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : null;
    const cities = new Map();
    for (const r of reviews) {
      const c = cityOf(r);
      const e = cities.get(c) || { name: c, enseignes: 0, cookies: 0, notes: [] };
      e.enseignes++; e.cookies += cookieCount(r);
      if (r.rating != null) e.notes.push(Number(r.rating));
      cities.set(c, e);
    }
    const realCities = [...cities.values()].filter(c => c.name !== "Non précisée" && c.name !== "Fait maison");
    const highLevel = rated.filter(r => r.rating >= 4.5).length;

    // Chiffres clés
    const kpis = [
      [reviews.length, reviews.length > 1 ? "enseignes testées" : "enseigne testée"],
      [cookies, cookies > 1 ? "cookies goûtés" : "cookie goûté"],
      [realCities.length, realCities.length > 1 ? "villes et pays" : "ville"],
      [avg != null ? fmtRating(Math.round(avg * 100) / 100) : "–", "note moyenne / 5"],
      [highLevel, "high level (≥ 4,5)"],
    ];
    $("kpis").replaceChildren(...kpis.map(([v, l]) => el("div", { class: "stat" }, el("b", { text: v }), el("span", { text: l }))));

    const charts = [];

    // 1. Cookies par ville
    const byCookies = [...cities.values()].sort((a, b) =>
      (a.name === "Non précisée") - (b.name === "Non précisée") || b.cookies - a.cookies || a.name.localeCompare(b.name));
    charts.push(card("Cookies goûtés par ville", null,
      hbars(byCookies.map(c => ({ label: c.name, value: c.cookies, muted: c.name === "Non précisée",
        display: c.cookies + (c.enseignes !== c.cookies ? " · " + plural(c.enseignes, "enseigne", "enseignes") : "") })))));

    // 2. Répartition des notes (par tranche de 0,5)
    const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i / 2, n: 0 }));
    for (const r of rated) buckets[Math.min(9, Math.floor(Number(r.rating) * 2))].n++;
    charts.push(card("Répartition des notes", plural(rated.length, "enseigne notée", "enseignes notées"), histogram(buckets)));

    // 3. Note moyenne par ville (au moins 2 enseignes notées)
    const avgCities = [...cities.values()].filter(c => c.notes.length >= 2 && c.name !== "Non précisée")
      .map(c => ({ ...c, avg: c.notes.reduce((s, n) => s + n, 0) / c.notes.length }))
      .sort((a, b) => b.avg - a.avg);
    if (avgCities.length) charts.push(card("Note moyenne par ville", "Villes avec au moins 2 enseignes notées",
      hbars(avgCities.map(c => ({ label: c.name, value: c.avg, tone: ratingTone(c.avg),
        display: fmtRating(Math.round(c.avg * 100) / 100) + " · " + c.notes.length })), 5)));

    // 4. Les notes au fil des dégustations
    if (rated.length >= 2) charts.push(card("Les notes au fil des dégustations", "Chaque point est une enseigne, du n° 1 au plus récent. La ligne suit la moyenne des 5 dernières.", timeline(rated)));

    // 5. Note par cookie goûté (cookies notés séparément)
    const cookieNotes = reviews.flatMap(r => (r.cookies || []).filter(c => c.rating != null).map(c => Number(c.rating)));
    if (cookieNotes.length >= 3) {
      const b2 = Array.from({ length: 10 }, (_, i) => ({ from: i / 2, n: 0 }));
      for (const n of cookieNotes) b2[Math.min(9, Math.floor(n * 2))].n++;
      charts.push(card("Notes des cookies", plural(cookieNotes.length, "cookie noté à part", "cookies notés à part"), histogram(b2)));
    }

    // 6. Top et flop
    const link = r => el("a", { class: "rank-item", href: "index.html#avis-" + r.id, "data-tone": ratingTone(r.rating) },
      el("span", { class: "rank-num", text: "N° " + r.num }), el("span", { class: "rank-title", text: r.title }),
      el("b", { class: "rank-note", text: fmtRating(r.rating) }));
    const sorted = rated.slice().sort((a, b) => b.rating - a.rating || b.num - a.num);
    charts.push(card("Le top 5", null, el("div", { class: "rank" }, ...sorted.slice(0, 5).map(link))));
    charts.push(card("Le flop 5", null, el("div", { class: "rank" }, ...sorted.slice(-5).reverse().map(link))));

    $("charts").replaceChildren(...charts);
  }

  function histogram(buckets) {
    const W = 520, H = 220, pad = { l: 28, r: 8, t: 18, b: 34 };
    const max = Math.max(1, ...buckets.map(b => b.n));
    const bw = (W - pad.l - pad.r) / buckets.length;
    const y = n => pad.t + (H - pad.t - pad.b) * (1 - n / max);
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Histogramme des notes" });
    for (let i = 0; i <= max; i += Math.max(1, Math.ceil(max / 4))) {
      g.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: y(i), y2: y(i), class: "grid" }),
        svg("text", { x: pad.l - 6, y: y(i) + 4, "text-anchor": "end", class: "axis" }, String(i)));
    }
    buckets.forEach((b, i) => {
      const x = pad.l + i * bw + 3;
      const tone = ratingTone(b.from + 0.25);
      if (b.n) {
        g.append(svg("rect", { x, y: y(b.n), width: bw - 6, height: y(0) - y(b.n), rx: 4, class: "bar", "data-tone": tone },
          svg("title", {}, fmtRating(b.from) + " à " + fmtRating(b.from + 0.5) + " : " + b.n)));
        g.append(svg("text", { x: x + (bw - 6) / 2, y: y(b.n) - 5, "text-anchor": "middle", class: "val" }, String(b.n)));
      }
      if (i % 2 === 0) g.append(svg("text", { x: pad.l + i * bw, y: H - pad.b + 18, "text-anchor": "middle", class: "axis" }, fmtRating(b.from)));
    });
    g.append(svg("text", { x: W - pad.r, y: H - pad.b + 18, "text-anchor": "end", class: "axis" }, "5"));
    return g;
  }

  function timeline(rated) {
    const W = 520, H = 220, pad = { l: 28, r: 10, t: 12, b: 30 };
    const n = rated.length;
    const x = i => pad.l + (W - pad.l - pad.r) * (n === 1 ? 0.5 : i / (n - 1));
    const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / 5);
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Évolution des notes" });
    for (let v = 0; v <= 5; v++) g.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "grid" }),
      svg("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" }, String(v)));
    const avg = rated.map((_, i) => {
      const w = rated.slice(Math.max(0, i - 4), i + 1);
      return w.reduce((s, r) => s + Number(r.rating), 0) / w.length;
    });
    g.append(svg("polyline", { points: avg.map((v, i) => x(i) + "," + y(v)).join(" "), class: "trend" }));
    rated.forEach((r, i) => g.append(svg("circle", { cx: x(i), cy: y(r.rating), r: 4, class: "dot", "data-tone": ratingTone(r.rating) },
      svg("title", {}, "N° " + r.num + " · " + r.title + " : " + fmtRating(r.rating)))));
    g.append(svg("text", { x: pad.l, y: H - 8, class: "axis" }, "N° " + rated[0].num),
      svg("text", { x: W - pad.r, y: H - 8, "text-anchor": "end", class: "axis" }, "N° " + rated[n - 1].num));
    return g;
  }

  load();
})();
