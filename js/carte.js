// Page carte du monde : un globe 3D avec les villes où un cookie a été goûté, et une carte plate
// avec un repère par enseigne. Les lieux viennent du champ « lieu » des avis : ceux déjà connus
// sont dans LIEUX ; un nouveau lieu avec une adresse est cherché sur OpenStreetMap (Nominatim)
// puis gardé en mémoire dans le navigateur. Sans lieu : pas de repère.
(function () {
  const { sb, configured, cookiesOf, cookieCount, plural, el, fmtRating, ratingTone, toast, lsGet, lsSet } = window.CK;
  const $ = id => document.getElementById(id);
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

  // ── Lieux déjà placés : [lieu tel qu'écrit dans l'avis, lat, lng, pays, ville] ──
  const LIEUX = new Map([
    ["10 Rue de la Division Leclerc, 67000 Strasbourg", 48.5806, 7.7465, "France", "Strasbourg"],
    ["17 rue de l'Ail, 67000 Strasbourg", 48.5823, 7.7405, "France", "Strasbourg"],
    ["11 rue de Châteaudun, 75009 Paris", 48.8765, 2.3399, "France", "Paris"],
    ["18 Rue de Turbigo, 75002 Paris", 48.8640, 2.3484, "France", "Paris"],
    ["185 Rue de Crimée, 75019 Paris", 48.8907, 2.3795, "France", "Paris"],
    ["19 rue d'Aumale, Paris", 48.8781, 2.3389, "France", "Paris"],
    ["30 Av. Corentin Cariou, 75019 Paris", 48.8946, 2.3866, "France", "Paris"],
    ["40 Rue Saint-Georges, 75009 Paris", 48.8790, 2.3375, "France", "Paris"],
    ["55 Rue des Martyrs, 75009 Paris", 48.8800, 2.3398, "France", "Paris"],
    ["62 Rue de la Chaussée d'Antin, 75009 Paris", 48.8770, 2.3330, "France", "Paris"],
    ["95 Rue de Meaux, 75019 Paris", 48.8810, 2.3775, "France", "Paris"],
    ["En face de la gare du Nord, Paris", 48.8805, 2.3550, "France", "Paris"],
    ["Rue Marx Dormoy, Paris", 48.8885, 2.3600, "France", "Paris"],
    ["Rue Taitbout, Paris", 48.8740, 2.3360, "France", "Paris"],
    ["2 Rue Maurice Bokanowski, 92600 Asnières-sur-Seine", 48.9110, 2.2860, "France", "Asnières-sur-Seine"],
    ["285 Rue Garibaldi, 69007 Lyon", 45.7487, 4.8509, "France", "Lyon"],
    ["50 Avenue Tony Garnier, 69007 Lyon", 45.7330, 4.8330, "France", "Lyon"],
    ["64 Rue Saint-Jean, 69005 Lyon", 45.7620, 4.8275, "France", "Lyon"],
    ["Tasty Pizza Sax, Gambetta, Lyon", 45.7530, 4.8430, "France", "Lyon"],
    ["Crous de l'ENS", 45.7300, 4.8283, "France", "Lyon"],               // ENS de Lyon (Gerland)
    ["44 Grande-Rue, 25000 Besançon", 47.2380, 6.0240, "France", "Besançon"],
    ["58 Grande-Rue, 25000 Besançon", 47.2373, 6.0236, "France", "Besançon"],
    ["McDonald's, Pontarlier", 46.9035, 6.3550, "France", "Pontarlier"],
    ["Monoprix, Marseille", 43.2965, 5.3698, "France", "Marseille"],
    ["Seule épicerie de l'île de Cat Ba, Vietnam", 20.7270, 107.0480, "Vietnam", "Cat Ba"],
    ["Chine", 35.8617, 104.1954, "Chine", "Chine"],
  ].map(([lieu, lat, lng, pays, ville]) => [norm(lieu), { lat, lng, pays, ville }]));


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
    ["Hanoï", 21.0278, 105.8342, "Vietnam"], ["Cat Ba", 20.7270, 107.0480, "Vietnam"],
    ["Vietnam", 14.0583, 108.2772, "Vietnam"], ["Chine", 35.8617, 104.1954, "Chine"],
  ];
  const villeConnue = name => VILLES.find(([n]) => norm(n) === norm(name));
  function cityIn(place) {
    const t = norm(place);
    const v = VILLES.find(([name]) => new RegExp("\\b" + norm(name) + "\\b").test(t));
    return v ? { lat: v[1], lng: v[2], pays: v[3], ville: v[0] } : null;
  }

  // Lieux qui ne désignent pas un endroit précis : pas de repère
  const VAGUE = /fait maison|^decathlon$|^monoprix$|^carrefour$|^starbucks$/;

  // ── Recherche d'une adresse sur OpenStreetMap, gardée en mémoire ──
  const CACHE_KEY = "ck-geo-v2";
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
      if (r) {
        const a = r.address || {};
        hit = { lat: Number(r.lat), lng: Number(r.lon), pays: a.country || null,
          ville: a.city || a.town || a.village || a.municipality || a.state || null };
      }
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

  // Fiches des enseignes (bulles de la carte et panneau des villes du globe)
  function fiche(r) {
    const photo = cookiesOf(r).map(c => c.photo_url).find(Boolean) || r.photo_url;
    return el("div", { class: "pop", "data-tone": ratingTone(r.rating) },
      photo ? el("img", { src: photo, alt: "", loading: "lazy" }) : null,
      el("a", { class: "pop-title", href: "index.html#avis-" + r.id, text: r.title }),
      el("div", { class: "pop-place", text: r.place }),
      el("div", { class: "pop-meta" },
        el("span", { class: "pop-note", text: r.rating != null ? fmtRating(r.rating) + " / 5" : "Hors notation" }),
        el("span", { text: plural(cookieCount(r), "cookie", "cookies") }),
        el("a", { href: "index.html#avis-" + r.id, text: "Lire l'avis →" })));
  }
  const avgOf = reviews => {
    const rated = reviews.filter(r => r.rating != null);
    return rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : null;
  };
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let placed = [];

  // ── Globe ──
  const globe = {
    obj: null, cities: [], selected: null,
    init() {
      const host = $("globe");
      if (!window.Globe) { host.replaceChildren(el("p", { class: "globe-fallback", text: "Le globe ne peut pas s'afficher sur cet appareil." })); return; }
      try {
        this.obj = new window.Globe(host, { animateIn: true })
          .backgroundColor("rgba(0,0,0,0)")
          .showAtmosphere(true).atmosphereAltitude(0.12)
          .polygonAltitude(0.006).polygonSideColor(() => "rgba(0,0,0,0)")
          .pointLat("lat").pointLng("lng").pointRadius(0.4).pointResolution(16)
          .pointAltitude(d => 0.015 + 0.03 * Math.sqrt(d.cookies))
          .pointLabel(d => '<div class="globe-tip"><b>' + d.ville + "</b><span>" + plural(d.cookies, "cookie", "cookies") + " · " + plural(d.reviews.length, "enseigne", "enseignes") + "</span></div>")
          .onPointClick(d => this.select(d))
          .ringLat("lat").ringLng("lng").ringMaxRadius(2.2).ringPropagationSpeed(1.2).ringRepeatPeriod(1400);
      } catch (e) {
        this.obj = null;
        host.replaceChildren(el("p", { class: "globe-fallback", text: "Le globe ne peut pas s'afficher sur cet appareil (WebGL indisponible). La carte plate reste disponible." }));
        return;
      }
      const ctl = this.obj.controls();
      ctl.autoRotate = true; ctl.autoRotateSpeed = 0.45; ctl.enableZoom = true;
      host.addEventListener("pointerdown", () => { ctl.autoRotate = false; });
      this.obj.pointOfView({ lat: 38, lng: 25, altitude: 2.1 });
      this.resize();
      new ResizeObserver(() => this.resize()).observe(host);
      this.theme();
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.theme());
      // Contours des pays (Natural Earth via world-atlas)
      fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json")
        .then(r => r.json())
        .then(topo => { if (window.topojson) this.obj.polygonsData(window.topojson.feature(topo, topo.objects.countries).features); })
        .catch(() => {});
    },
    resize() {
      if (!this.obj) return;
      const host = $("globe");
      this.obj.width(host.clientWidth).height(host.clientHeight);
    },
    theme() {
      if (!this.obj) return;
      const land = cssVar("--gold") || "#b0915a", edge = cssVar("--surface") || "#fffdf9";
      const sea = cssVar("--surface-2") || "#efe9df";
      const hex = (cssVar("--text") || "#1d1915").replace("#", "");
      const ink = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(",");
      const mat = this.obj.globeMaterial();
      mat.color.set(sea);
      if (mat.emissive) { mat.emissive.set(sea); mat.emissiveIntensity = 0.35; }
      if ("shininess" in mat) mat.shininess = 4;
      this.obj.atmosphereColor(land)
        .polygonCapColor(() => land).polygonStrokeColor(() => edge)
        .pointColor(() => cssVar("--text") || "#1d1915")
        .ringColor(() => t => "rgba(" + ink + "," + (1 - t) + ")");
    },
    setCities(cities) {
      this.cities = cities;
      if (!this.obj) return;
      this.obj.pointsData(cities);
    },
    select(city) {
      this.selected = city;
      renderCityList();
      const panel = $("cityPanel");
      panel.hidden = false;
      panel.replaceChildren(
        el("div", { class: "city-head" },
          el("div", {},
            el("span", { class: "city-kicker", text: city.pays || "" }),
            el("h2", { text: city.ville })),
          el("button", { class: "city-close", "aria-label": "Fermer", text: "×", onclick: () => { this.selected = null; panel.hidden = true; renderCityList(); if (this.obj) this.obj.ringsData([]); } })),
        el("p", { class: "city-sub", text: plural(city.cookies, "cookie goûté", "cookies goûtés") + " · " + plural(city.reviews.length, "enseigne", "enseignes") + (city.avg != null ? " · moyenne " + fmtRating(Math.round(city.avg * 100) / 100) + " / 5" : "") }),
        el("div", { class: "city-fiches" }, city.reviews.map(fiche)));
      if (this.obj) {
        this.obj.controls().autoRotate = false;
        this.obj.pointOfView({ lat: city.lat, lng: city.lng, altitude: 0.75 }, 1400);
        this.obj.ringsData([city]);
      }
    }
  };

  function citiesOf(list) {
    const byCity = new Map();
    for (const { r, spot } of list) {
      const name = spot.ville || "Lieu inconnu";
      let c = byCity.get(name);
      if (!c) {
        const known = villeConnue(name);
        c = { ville: name, pays: spot.pays, lat: known ? known[1] : spot.lat, lng: known ? known[2] : spot.lng, reviews: [], cookies: 0 };
        byCity.set(name, c);
      }
      c.reviews.push(r);
      c.cookies += cookieCount(r);
    }
    const cities = [...byCity.values()];
    for (const c of cities) c.avg = avgOf(c.reviews);
    return cities.sort((a, b) => b.cookies - a.cookies || a.ville.localeCompare(b.ville));
  }

  function renderCityList() {
    $("cityList").replaceChildren(...globe.cities.map(c =>
      el("li", {},
        el("button", { class: "city-item" + (globe.selected && globe.selected.ville === c.ville ? " is-active" : ""), "data-tone": ratingTone(c.avg), onclick: () => globe.select(c) },
          el("span", { class: "city-dot" }),
          el("span", { class: "city-name", text: c.ville }),
          el("span", { class: "city-count", text: plural(c.cookies, "cookie", "cookies") })))));
  }

  // ── Carte plate (créée au premier affichage de l'onglet) ──
  const flat = {
    map: null, cluster: null, spots: new Map(),
    init() {
      if (this.map || !window.L) return;
      this.map = L.map("map", { worldCopyJump: true, scrollWheelZoom: true }).setView([30, 10], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(this.map);
      this.cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 45,
        iconCreateFunction: c => L.divIcon({ html: "<span>" + c.getChildCount() + "</span>", className: "cookie-cluster", iconSize: [40, 40] })
      });
      this.map.addLayer(this.cluster);
      for (const p of placed) this.add(p.r, p.spot);
      this.fit();
    },
    // Plusieurs enseignes au même endroit : un seul repère avec toutes les fiches
    add(r, spot) {
      if (!this.map) return;
      const key = spot.lat.toFixed(4) + "," + spot.lng.toFixed(4);
      let s = this.spots.get(key);
      if (!s) {
        s = { reviews: [], marker: L.marker([spot.lat, spot.lng]) };
        this.spots.set(key, s);
        this.cluster.addLayer(s.marker);
      }
      s.reviews.push(r);
      s.marker.setIcon(L.divIcon({
        html: '<span data-tone="' + ratingTone(avgOf(s.reviews)) + '"></span>',
        className: "cookie-pin", iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -8]
      }));
      s.marker.bindPopup(el("div", null, s.reviews.map(fiche)), { maxWidth: 260, maxHeight: 360 });
    },
    fit() {
      if (!this.map || !placed.length) return;
      this.map.fitBounds(L.latLngBounds(placed.map(({ spot }) => [spot.lat, spot.lng])), { padding: [30, 30], maxZoom: 12 });
    }
  };

  // ── Onglets Globe / Carte ──
  function show(view) {
    for (const b of document.querySelectorAll(".view-tab")) b.setAttribute("aria-selected", String(b.dataset.view === view));
    $("globeView").hidden = view !== "globe";
    $("mapView").hidden = view !== "map";
    if (view === "map") { flat.init(); flat.map && flat.map.invalidateSize(); }
    else globe.resize();
  }
  for (const b of document.querySelectorAll(".view-tab")) b.addEventListener("click", () => show(b.dataset.view));

  // ── Chiffres clés ──
  function render(total) {
    const cities = citiesOf(placed);
    const cookies = placed.reduce((s, { r }) => s + cookieCount(r), 0);
    const pays = new Set(placed.map(({ spot }) => spot.pays).filter(Boolean));
    const kpis = [
      [cities.length, cities.length > 1 ? "villes" : "ville"],
      [placed.length, placed.length > 1 ? "enseignes" : "enseigne"],
      [cookies, cookies > 1 ? "cookies goûtés" : "cookie goûté"],
      [pays.size, "pays"],
    ];
    $("kpis").replaceChildren(...kpis.map(([v, l]) => el("div", { class: "stat" }, el("b", { text: v }), el("span", { text: l }))));
    const missing = total - placed.length;
    $("mapNote").textContent = missing > 0
      ? plural(missing, "enseigne n'a", "enseignes n'ont") + " pas de lieu précis (fait maison, lieu non renseigné…) et n'apparai" + (missing > 1 ? "ssent" : "t") + " pas ici."
      : "Toutes les enseignes sont sur le globe.";
    globe.setCities(cities);
    renderCityList();
  }

  async function load() {
    globe.init();
    let reviews;
    if (!configured) {
      $("demoBanner").hidden = false;
      reviews = window.CK.demoReviews();
    } else {
      const { data, error } = await sb.from("reviews").select("*").eq("published", true).order("num");
      if (error) { toast("Impossible de charger les cookies : " + error.message, "error"); return; }
      reviews = data;
    }

    const toSearch = [];
    for (const r of reviews) {
      const place = (r.place || "").trim();
      if (!place || VAGUE.test(norm(place))) continue;
      const spot = quickSpot(place);
      if (spot) placed.push({ r, spot: spot.ville ? spot : { ...spot, ville: (cityIn(place) || {}).ville } });
      else if (looksLikeAddress(place)) toSearch.push(r);
      else { const c = cityIn(place); if (c) placed.push({ r, spot: c }); }
    }
    render(reviews.length);

    // Nouvelles adresses : cherchées une à une, le globe et la carte se complètent au fur et à mesure
    for (const r of toSearch) {
      let spot = (await geocode(r.place.trim())) || cityIn(r.place);
      if (!spot) continue;
      if (!spot.ville) spot = { ...spot, ville: (cityIn(r.place) || {}).ville };
      placed.push({ r, spot });
      flat.add(r, spot);
      render(reviews.length);
    }
    if (toSearch.length) flat.fit();
  }

  load();
})();
