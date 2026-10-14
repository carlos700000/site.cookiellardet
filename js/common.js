// Outils partagés entre le site public (index.html) et l'espace admin (admin.html).
(function () {
  const cfg = window.COOKILLARDET_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  function legacyPhotoUrl(n) {
    return "photos/anciennes/" + String(n).padStart(3, "0") + ".jpg";
  }

  // Avis de démonstration (quand Supabase n'est pas encore branché)
  function demoReviews() {
    return (window.ANCIENS_AVIS || [])
      .filter(a => a.published !== false)
      .map(a => ({
        id: "demo-" + a.num,
        num: a.num,
        title: a.title,
        place: a.place,
        rating: a.rating,
        body: a.body,
        photo_url: a.photo ? legacyPhotoUrl(a.photo) : null,
        tasted_on: null,
        cookies: [],
        published: true,
        created_at: new Date(2025, 0, a.num).toISOString(),
        comments: [{ count: 0 }]
      }));
  }

  // Cookies testés dans une enseigne. Les anciens avis n'ont qu'une photo (photo_url) :
  // ils comptent comme un seul cookie.
  function cookiesOf(r) {
    if (Array.isArray(r.cookies) && r.cookies.length) return r.cookies;
    return r.photo_url ? [{ photo_url: r.photo_url, name: null, rating: null, body: "" }] : [];
  }
  const cookieCount = r => Math.max(1, cookiesOf(r).length);

  // Rang d'une photo dans la pellicule du téléphone (plus grand = plus récent).
  // Photo envoyée depuis l'espace auteur : plus récente que toute la pellicule. Inconnue : -1.
  const phoneRank = new Map((window.ORDRE_TELEPHONE || []).map((n, i) => [legacyPhotoUrl(n), i]));
  function photoRank(url) {
    if (!url) return -1;
    if (phoneRank.has(url)) return phoneRank.get(url);
    return url.startsWith("photos/anciennes/") ? -1 : 1e6;
  }
  // Une enseigne est aussi récente que sa photo de cookie la plus récente
  const recency = r => Math.max(photoRank(r.photo_url), ...cookiesOf(r).map(c => photoRank(c.photo_url)));
  // enseignes forcées tout en bas, dans l'ordre de TOUT_EN_BAS
  const bas = window.TOUT_EN_BAS || [];
  const basRank = r => bas.indexOf(r.num);
  const byRecent = (a, b) => basRank(a) - basRank(b) || recency(b) - recency(a) || String(b.created_at || "").localeCompare(String(a.created_at || "")) || b.num - a.num;
  const plural = (n, one, many) => n + " " + (n > 1 ? many : one);

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  function fmtRating(r) {
    if (r == null) return "";
    return Number(r).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  }

  // Note sur 5 → rangée de 5 cookies remplis proportionnellement
  function ratingBar(r, size) {
    const wrap = el("span", { class: "rating" + (size ? " rating-" + size : ""), title: r == null ? "Pas de note" : fmtRating(r) + " / 5" });
    if (r == null) {
      wrap.append(el("span", { class: "rating-none", text: "Hors notation" }));
      return wrap;
    }
    const pct = Math.max(0, Math.min(100, (Number(r) / 5) * 100));
    const track = el("span", { class: "rating-track", "aria-hidden": "true" });
    track.append(el("span", { class: "rating-fill", style: "width:" + pct + "%" }));
    wrap.append(track, el("span", { class: "rating-num" }, el("b", { text: fmtRating(r) }), " / 5"));
    return wrap;
  }

  function ratingTone(r) {
    if (r == null) return "none";
    if (r >= 4.5) return "top";
    if (r >= 3.5) return "good";
    if (r >= 2.5) return "mid";
    return "low";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "à l'instant";
    if (s < 3600) return "il y a " + Math.floor(s / 60) + " min";
    if (s < 86400) return "il y a " + Math.floor(s / 3600) + " h";
    if (s < 86400 * 7) return "il y a " + Math.floor(s / 86400) + " j";
    return fmtDate(iso);
  }

  function mapsUrl(place) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place);
  }

  function toast(msg, kind) {
    let host = document.getElementById("toasts");
    if (!host) { host = el("div", { id: "toasts", "aria-live": "polite" }); document.body.append(host); }
    const t = el("div", { class: "toast" + (kind ? " toast-" + kind : ""), text: msg });
    host.append(t);
    setTimeout(() => t.classList.add("out"), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

  window.CK = { sb, configured, legacyPhotoUrl, demoReviews, cookiesOf, cookieCount, plural, photoRank, byRecent, el, fmtRating, ratingBar, ratingTone, fmtDate, timeAgo, mapsUrl, toast, lsGet, lsSet };
})();
