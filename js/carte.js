// Page carte du monde : un repère par enseigne, placé grâce au champ « lieu » de l'avis.
// Les lieux déjà connus sont dans LIEUX ; un nouveau lieu avec une adresse est cherché sur
// OpenStreetMap (Nominatim) puis gardé en mémoire dans le navigateur. Sans lieu : pas de repère.
(function () {
  const { sb, configured, cookiesOf, cookieCount, plural, el, fmtRating, ratingTone, toast, lsGet, lsSet } = window.CK;
  const $ = id => document.getElementById(id);
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

  // ── Lieux déjà placés : [lieu tel qu'écrit dans l'avis, lat, lng, pays] ──
  const LIEUX = new Map([
    ["10 Rue de la Division Leclerc, 67000 Strasbourg", 48.5806, 7.7465, "France"],
    ["17 rue de l'Ail, 67000 Strasbourg", 48.5823, 7.7405, "France"],
    ["11 rue de Châteaudun, 75009 Paris", 48.8765, 2.3399, "France"],
    ["18 Rue de Turbigo, 75002 Paris", 48.8640, 2.3484, "France"],
    ["185 Rue de Crimée, 75019 Paris", 48.8907, 2.3795, "France"],
    ["19 rue d'Aumale, Paris", 48.8781, 2.3389, "France"],
    ["30 Av. Corentin Cariou, 75019 Paris", 48.8946, 2.3866, "France"],
    ["40 Rue Saint-Georges, 75009 Paris", 48.8790, 2.3375, "France"],
    ["55 Rue des Martyrs, 75009 Paris", 48.8800, 2.3398, "France"],
    ["62 Rue de la Chaussée d'Antin, 75009 Paris", 48.8770, 2.3330, "France"],
    ["95 Rue de Meaux, 75019 Paris", 48.8810, 2.3775, "France"],
    ["En face de la gare du Nord, Paris", 48.8805, 2.3550, "France"],
    ["Rue Marx Dormoy, Paris", 48.8885, 2.3600, "France"],
    ["Rue Taitbout, Paris", 48.8740, 2.3360, "France"],
    ["2 Rue Maurice Bokanowski, 92600 Asnières-sur-Seine", 48.9110, 2.2860, "France"],
    ["285 Rue Garibaldi, 69007 Lyon", 45.7487, 4.8509, "France"],
    ["50 Avenue Tony Garnier, 69007 Lyon", 45.7330, 4.8330, "France"],
    ["64 Rue Saint-Jean, 69005 Lyon", 45.7620, 4.8275, "France"],
    ["Tasty Pizza Sax, Gambetta, Lyon", 45.7530, 4.8430, "France"],
    ["Crous de l'ENS", 45.7300, 4.8283, "France"],               // ENS de Lyon (Gerland)
    ["44 Grande-Rue, 25000 Besançon", 47.2380, 6.0240, "France"],
    ["58 Grande-Rue, 25000 Besançon", 47.2373, 6.0236, "France"],
    ["McDonald's, Pontarlier", 46.9035, 6.3550, "France"],
    ["Monoprix, Marseille", 43.2965, 5.3698, "France"],
    ["Seule épicerie de l'île de Cat Ba, Vietnam", 20.7270, 107.0480, "Vietnam"],
    ["Chine", 35.8617, 104.1954, "Chine"],
  ].map(([lieu, lat, lng, pays]) => [norm(lieu), { lat, lng, pays }]));

  // Villes et pays reconnus dans un lieu écrit à la main (« Boulangerie X, Lyon »)
  const VILLES = [
    ["Paris", 48.8566, 2.3522, "France"], ["Lyon", 45.7640, 4.8357, "France"], ["Marseille", 43.2965, 5.3698, "France"],
    ["Strasbourg", 48.5734, 7.7521, "France"], ["Besançon", 47.2378, 6.0241, "France"], ["Pontarlier", 46.9035, 6.3550, "France"],
    ["Asnières-sur-Seine", 48.9110, 2.2860, "France"], ["Bordeaux", 44.8378, -0.5792, "France"], ["Lille", 50.6292, 3.0573, "France"],
    ["Nantes", 47.2184, -1.5536, "France"], ["Toulouse", 43.6047, 1.4442, "France"], ["Nice", 43.7102, 7.2620, "France"],
    ["Grenoble", 45.1885, 5.7245, "France"], ["Dijon", 47.3220, 5.0415, "France"], ["Annecy", 45.8992, 6.1294, "France"],
    ["Rennes", 48.1173, -1.6778, "France"], ["Montpellier", 43.6108, 3.8767, "France"],
    ["Berlin", 52.5200, 13.4050, "Allemagne"], ["Rome", 41.9028, 12.4964, "Italie"], ["Londres", 51.5074, -0.1278, "Royaume-Uni"],
    ["Bruxelles", 50.8503, 4.3517, "Belgique"], ["Genève", 46.2044, 6.1432, "Suisse"], ["Lausanne", 46.5197, 6.6323, "Suisse"],
    ["Hanoï", 21.0278, 105.8342, "Vietnam"], ["Vietnam", 14.0583, 108.2772, "Vietnam"], ["Chine", 35.8617, 104.1954, "Chine"],
  ];
  function cityIn(place) {
    const t = norm(place);
    const v = VILLES.find(([name]) => new RegExp("\\b" + norm(name) + "\\b").test(t));
    return v ? { lat: v[1], lng: v[2], pays: v[3] } : null;
  }

  // Lieux qui ne désignent pas un endroit précis : pas de repère
  const VAGUE = /fait maison|^decathlon$|^monoprix$|^carrefour$|^starbucks$/;

  // ── Recherche d'une adresse sur OpenStreetMap, gardée en mémoire ──
  const CACHE_KEY = "ck-geo-v1";
  let cache = {};
  try { cache = JSON.parse(lsGet(CACHE_KEY) || "{}") || {}; } catch { cache = {}; }
  let lastCall = 0;
  async function geocode(place) {
    const key = norm(place);
    if (key in cache) return cache[key];
    const wait = lastCall + 1100 - Date.now(); // 1 recherche par seconde au maximum
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
    let hit = null;
    try {
      const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&accept-language=fr&q=" + encodeURIComponent(place);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null; // on réessaiera à la prochaine visite
      const [r] = await res.json();
      if (r) hit = { lat: Number(r.lat), lng: Number(r.lon), pays: (r.address && r.address.country) || null };
    } catch { return null; }
    cache[key] = hit;
    lsSet(CACHE_KEY, JSON.stringify(cache));
    return hit;
  }

  // Position d'une enseigne, sans appel réseau (null si inconnue ou à chercher)
  function quickSpot(place) {
    return LIEUX.get(norm(place)) || (norm(place) in cache ? cache[norm(place)] : null);
  }
  // Une adresse (code postal ou « …, ville ») vaut la peine d'être cherchée
  const looksLikeAddress = place => /\b\d{5}\b/.test(place) || /\d+\s*,?\s*(rue|av|avenue|bd|boulevard|place|quai|chemin|allée)\b/i.test(place) || place.includes(",");

  // ── Carte ──
  const map = L.map("map", { worldCopyJump: true, scrollWheelZoom: true }).setView([30, 10], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    iconCreateFunction: c => L.divIcon({
      html: "<span>" + c.getChildCount() + "</span>", className: "cookie-cluster", iconSize: [40, 40]
    })
  });
  map.addLayer(cluster);

  // Plusieurs enseignes au même endroit : un seul repère avec toutes les fiches
  const spots = new Map();
  function pinIcon(reviews) {
    const rated = reviews.filter(r => r.rating != null);
    const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : null;
    return L.divIcon({
      html: '<span data-tone="' + ratingTone(avg) + '"></span>',
      className: "cookie-pin", iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -8]
    });
  }
  function popupFor(reviews) {
    return el("div", null, ...reviews.map(r => {
      const photo = cookiesOf(r).map(c => c.photo_url).find(Boolean) || r.photo_url;
      const n = cookieCount(r);
      return el("div", { class: "pop", "data-tone": ratingTone(r.rating) },
        photo ? el("img", { src: photo, alt: "", loading: "lazy" }) : null,
        el("a", { class: "pop-title", href: "index.html#avis-" + r.id, text: r.title }),
        el("div", { class: "pop-place", text: r.place }),
        el("div", { class: "pop-meta" },
          el("span", { class: "pop-note", text: r.rating != null ? fmtRating(r.rating) + " / 5" : "Hors notation" }),
          el("span", { text: plural(n, "cookie", "cookies") }),
          el("a", { href: "index.html#avis-" + r.id, text: "Lire l'avis →" })));
    }));
  }
  function addToMap(r, spot) {
    const key = spot.lat.toFixed(4) + "," + spot.lng.toFixed(4);
    let s = spots.get(key);
    if (!s) {
      s = { reviews: [], spot, marker: L.marker([spot.lat, spot.lng]) };
      spots.set(key, s);
      cluster.addLayer(s.marker);
    }
    s.reviews.push(r);
    s.marker.setIcon(pinIcon(s.reviews));
    s.marker.bindPopup(popupFor(s.reviews), { maxWidth: 260, maxHeight: 360 });
  }

  // ── Chiffres clés ──
  function renderKpis(placed, total) {
    const enseignes = placed.length;
    const cookies = placed.reduce((s, { r }) => s + cookieCount(r), 0);
    const pays = new Set(placed.map(({ spot }) => spot.pays).filter(Boolean));
    const kpis = [
      [enseignes, enseignes > 1 ? "enseignes sur la carte" : "enseigne sur la carte"],
      [cookies, cookies > 1 ? "cookies goûtés" : "cookie goûté"],
      [pays.size, "pays"],
    ];
    $("kpis").replaceChildren(...kpis.map(([v, l]) => el("div", { class: "stat" }, el("b", { text: v }), el("span", { text: l }))));
    const missing = total - enseignes;
    $("mapNote").textContent = missing > 0
      ? plural(missing, "enseigne n'a", "enseignes n'ont") + " pas de lieu précis (fait maison, lieu non renseigné…) et n'apparai" + (missing > 1 ? "ssent" : "t") + " pas sur la carte."
      : "Toutes les enseignes sont sur la carte.";
  }

  function fit(placed) {
    if (!placed.length) return;
    const bounds = L.latLngBounds(placed.map(({ spot }) => [spot.lat, spot.lng]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
  }

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

    const placed = [];
    const toSearch = [];
    for (const r of reviews) {
      const place = (r.place || "").trim();
      if (!place || VAGUE.test(norm(place))) continue;
      const spot = quickSpot(place);
      if (spot) placed.push({ r, spot });
      else if (looksLikeAddress(place)) toSearch.push(r);
      else { const c = cityIn(place); if (c) placed.push({ r, spot: c }); }
    }
    for (const p of placed) addToMap(p.r, p.spot);
    renderKpis(placed, reviews.length);
    fit(placed);

    // Nouvelles adresses : cherchées une à une, la carte se complète au fur et à mesure
    for (const r of toSearch) {
      const spot = (await geocode(r.place.trim())) || cityIn(r.place);
      if (!spot) continue;
      placed.push({ r, spot });
      addToMap(r, spot);
      renderKpis(placed, reviews.length);
    }
    if (toSearch.length) fit(placed);
  }

  load();
})();
