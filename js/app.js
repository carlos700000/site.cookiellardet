// Site public : liste des avis, fiche détaillée et commentaires des visiteurs.
(function () {
  const { sb, configured, cookiesOf, cookieCount, plural, el, ratingBar, ratingTone, fmtRating, fmtDate, timeAgo, mapsUrl, toast, lsGet, lsSet } = window.CK;

  let reviews = [];
  const $ = id => document.getElementById(id);

  async function load() {
    if (!configured) {
      $("demoBanner").hidden = false;
      reviews = window.CK.demoReviews();
      render();
      route();
      return;
    }
    const { data, error } = await sb
      .from("reviews")
      .select("*, comments(count)")
      .eq("published", true)
      .order("num", { ascending: false });
    if (error) {
      toast("Impossible de charger les cookies : " + error.message, "error");
      return;
    }
    reviews = data;
    render();
    route();
  }

  const commentCount = r => (r.comments && r.comments[0] ? r.comments[0].count : 0);

  // ── Statistiques & podium ──
  function renderStats() {
    const rated = reviews.filter(r => r.rating != null);
    const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : null;
    const comments = reviews.reduce((s, r) => s + commentCount(r), 0);
    const cookies = reviews.reduce((s, r) => s + cookieCount(r), 0);
    const items = [
      [reviews.length, reviews.length > 1 ? "enseignes testées" : "enseigne testée"],
      [cookies, cookies > 1 ? "cookies goûtés" : "cookie goûté"],
      [avg == null ? "–" : fmtRating(Math.round(avg * 10) / 10), "note moyenne"],
      [rated.filter(r => r.rating >= 4.5).length, "high level"],
    ];
    if (configured) items.push([comments, "commentaires"]);
    $("stats").replaceChildren(...items.map(([v, l]) => el("div", { class: "stat" }, el("b", { text: v }), el("span", { text: l }))));
  }

  function renderPodium() {
    const top = reviews
      .filter(r => r.rating != null && r.photo_url)
      .sort((a, b) => b.rating - a.rating || b.num - a.num)
      .slice(0, 3);
    $("podiumSection").hidden = top.length < 3;
    const medals = ["🥇", "🥈", "🥉"];
    $("podium").replaceChildren(...top.map((r, i) =>
      el("button", { class: "podium-item", onclick: () => openReview(r.id), "aria-label": r.title },
        el("img", { src: r.photo_url, alt: "", loading: "lazy" }),
        el("span", { class: "medal", text: medals[i] }),
        el("span", { class: "cap" }, el("b", { text: r.title }), fmtRating(r.rating) + " / 5")
      )
    ));
  }

  // ── Grille ──
  function normalize(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function filtered() {
    const q = normalize($("search").value.trim());
    let list = reviews.filter(r => !q || normalize([r.title, r.place, r.body, "n°" + r.num, ...cookiesOf(r).map(c => (c.name || "") + " " + (c.body || ""))].join(" ")).includes(q));
    const sort = $("sort").value;
    const byRating = (a, b) => (b.rating ?? -1) - (a.rating ?? -1);
    if (sort === "best") list.sort((a, b) => byRating(a, b) || b.num - a.num);
    else if (sort === "worst") list.sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99) || b.num - a.num);
    else if (sort === "talked") list.sort((a, b) => commentCount(b) - commentCount(a) || b.num - a.num);
    else list.sort((a, b) => b.num - a.num);
    return list;
  }

  function photoOrPlaceholder(r) {
    if (r.photo_url) return el("img", { src: r.photo_url, alt: "Photo du cookie " + r.title, loading: "lazy" });
    return el("div", { class: "placeholder" }, el("span", { class: "ph-icon", text: "🍪" }), "Pas de photo");
  }

  function card(r) {
    const n = commentCount(r);
    const nc = cookieCount(r);
    return el("button", { class: "card", "data-tone": ratingTone(r.rating), onclick: () => openReview(r.id) },
      el("div", { class: "card-photo" },
        photoOrPlaceholder(r),
        el("span", { class: "card-num", text: "N° " + r.num }),
        r.rating != null && el("span", { class: "card-score", text: fmtRating(r.rating) }),
        nc > 1 && el("span", { class: "card-cookies", text: "🍪 × " + nc })
      ),
      el("div", { class: "card-body" },
        el("h3", { text: r.title }),
        r.place && el("div", { class: "place", text: "📍 " + r.place }),
        el("p", { class: "excerpt", text: r.body }),
        el("div", { class: "meta" },
          ratingBar(r.rating),
          configured && el("span", { text: "💬 " + n })
        )
      )
    );
  }

  function renderGrid() {
    const list = filtered();
    $("grid").replaceChildren(...list.map(card));
    $("empty").hidden = list.length > 0;
    const cookies = list.reduce((s, r) => s + cookieCount(r), 0);
    $("count").textContent = (list.length === reviews.length ? "" : list.length + " sur ")
      + plural(reviews.length, "enseigne", "enseignes") + " · " + plural(cookies, "cookie", "cookies") + " goûté" + (cookies > 1 ? "s" : "");
  }

  function render() {
    renderStats();
    renderPodium();
    renderGrid();
  }

  // ── Fiche détaillée ──
  let overlay = null;

  function openReview(id) {
    if (location.hash !== "#avis-" + id) location.hash = "avis-" + id;
    else showReview(id);
  }

  function closeReview() {
    if (overlay) { overlay.remove(); overlay = null; document.body.style.overflow = ""; }
    if (location.hash.startsWith("#avis-")) history.replaceState(null, "", location.pathname + location.search);
  }

  function route() {
    const m = location.hash.match(/^#avis-(.+)$/);
    if (m) showReview(decodeURIComponent(m[1]));
    else if (overlay) closeReview();
  }

  function showReview(id) {
    const r = reviews.find(x => String(x.id) === id);
    if (!r) return;
    if (overlay) overlay.remove();

    const commentsBox = el("section", { class: "comments" });
    const cookies = cookiesOf(r);
    const mainPhoto = r.photo_url ? el("img", { src: r.photo_url, alt: "Photo du cookie " + r.title }) : null;
    const sheet = el("article", { class: "sheet", "data-tone": ratingTone(r.rating), role: "dialog", "aria-modal": "true", "aria-label": r.title },
      el("button", { class: "sheet-close", "aria-label": "Fermer", onclick: closeReview, text: "×" }),
      el("div", { class: "sheet-photo" }, mainPhoto
        || el("div", { class: "placeholder" }, el("span", { class: "ph-icon", text: "🍪" }), "Pas de photo")),
      el("div", { class: "sheet-body" },
        el("div", { class: "sheet-kicker", text: "N° " + r.num + " · " + plural(cookieCount(r), "cookie goûté", "cookies goûtés") + (r.tasted_on ? " · le " + fmtDate(r.tasted_on) : "") }),
        el("h2", { text: r.title }),
        r.place && el("a", { class: "place-link", href: mapsUrl(r.place), target: "_blank", rel: "noopener" }, "📍 ", r.place),
        el("div", { class: "verdict" }, el("span", { text: "Note de l'enseigne" }), ratingBar(r.rating, "lg")),
        el("p", { class: "review-text", text: r.body }),
        cookieList(cookies, mainPhoto),
        el("div", { class: "share" },
          el("button", { class: "btn btn-ghost btn-sm", onclick: () => share(r) }, "🔗 Partager ce cookie")),
        commentsBox
      )
    );

    overlay = el("div", { class: "overlay", onclick: e => { if (e.target === overlay) closeReview(); } }, sheet);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    overlay.scrollTop = 0;
    sheet.querySelector(".sheet-close").focus();
    renderComments(r, commentsBox);
  }

  // Les cookies testés dans l'enseigne, chacun avec sa photo, sa note et son avis
  function cookieList(cookies, mainPhoto) {
    const detailed = cookies.some(c => c.name || c.rating != null || c.body);
    if (cookies.length < 2 && !detailed) return null;
    return el("section", { class: "cookie-list" },
      el("h3", { text: "Les cookies goûtés (" + cookies.length + ")" }),
      el("ol", {}, cookies.map((c, i) => el("li", { class: "cookie-item", "data-tone": ratingTone(c.rating) },
        c.photo_url
          ? el("button", { class: "cookie-thumb", "aria-label": "Voir la photo", onclick: () => {
              if (mainPhoto) { mainPhoto.src = c.photo_url; mainPhoto.scrollIntoView({ behavior: "smooth", block: "start" }); }
            } }, el("img", { src: c.photo_url, alt: "", loading: "lazy" }))
          : el("div", { class: "cookie-thumb", text: "🍪" }),
        el("div", { class: "cookie-info" },
          el("b", { text: c.name || "Cookie n° " + (i + 1) }),
          c.rating != null && ratingBar(c.rating),
          c.body && el("p", { text: c.body })
        )
      )))
    );
  }

  async function share(r) {
    const url = location.origin + location.pathname + "#avis-" + r.id;
    const text = "Cookie n°" + r.num + " : " + r.title + (r.rating != null ? " (" + fmtRating(r.rating) + "/5)" : "");
    try {
      if (navigator.share) { await navigator.share({ title: "Cookillardet", text, url }); return; }
      await navigator.clipboard.writeText(url);
      toast("Lien copié !");
    } catch { /* partage annulé */ }
  }

  // ── Commentaires ──
  function avatarColor(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    return "hsl(" + h + " 45% 45%)";
  }

  function commentItem(c) {
    return el("li", { class: "comment" },
      el("span", { class: "avatar", style: "background:" + avatarColor(c.pseudo), "aria-hidden": "true", text: c.pseudo.trim().charAt(0) }),
      el("div", { class: "comment-bubble" },
        el("div", { class: "comment-head" }, el("b", { text: c.pseudo }), el("time", { datetime: c.created_at, text: timeAgo(c.created_at) })),
        el("p", { text: c.body })
      )
    );
  }

  async function renderComments(r, box) {
    box.replaceChildren(el("h3", { text: "Commentaires" }));
    if (!configured) {
      box.append(el("p", { class: "no-comments", text: "Les commentaires seront ouverts dès que le site sera en ligne." }));
      return;
    }
    const list = el("ul", { class: "comment-list" });
    const empty = el("p", { class: "no-comments", text: "Pas encore de commentaire. Lance le débat !" });
    box.append(list, empty);

    const { data, error } = await sb.from("comments")
      .select("id, pseudo, body, created_at")
      .eq("review_id", r.id)
      .order("created_at", { ascending: true });
    if (error) { empty.textContent = "Impossible de charger les commentaires."; return; }
    list.replaceChildren(...data.map(commentItem));
    empty.hidden = data.length > 0;
    box.querySelector("h3").textContent = data.length ? "Commentaires (" + data.length + ")" : "Commentaires";

    box.append(commentForm(r, c => {
      list.append(commentItem(c));
      empty.hidden = true;
      r.comments = [{ count: commentCount(r) + 1 }];
      box.querySelector("h3").textContent = "Commentaires (" + commentCount(r) + ")";
      renderStats();
      renderGrid();
    }));
  }

  function commentForm(r, onPosted) {
    const pseudo = el("input", { class: "input", name: "pseudo", maxlength: "40", required: true, placeholder: "Ton pseudo", autocomplete: "nickname" });
    pseudo.value = lsGet("ck-pseudo") || "";
    const body = el("textarea", { class: "textarea", name: "body", maxlength: "1000", required: true, rows: "3", placeholder: "Ton avis sur ce cookie (ou sur l'avis)…" });
    const trap = el("input", { class: "hp", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    const submit = el("button", { class: "btn btn-primary", type: "submit", text: "Publier" });

    const form = el("form", { class: "comment-form" },
      el("label", { class: "field" }, el("span", { text: "Pseudo" }), pseudo),
      el("label", { class: "field" }, el("span", { text: "Commentaire" }), body),
      trap,
      el("div", { class: "row" }, el("span", { class: "hint", text: "Sois gourmand, pas méchant 🍪" }), submit)
    );

    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (trap.value) return; // robot
      const p = pseudo.value.trim(), b = body.value.trim();
      if (!p || !b) { toast("Il faut un pseudo et un message.", "error"); return; }
      const last = Number(lsGet("ck-last-comment") || 0);
      if (Date.now() - last < 15000) { toast("Doucement ! Attends quelques secondes.", "error"); return; }

      submit.disabled = true;
      const { data, error } = await sb.from("comments")
        .insert({ review_id: r.id, pseudo: p, body: b })
        .select("id, pseudo, body, created_at")
        .single();
      submit.disabled = false;
      if (error) { toast("Oups, le commentaire n'est pas passé : " + error.message, "error"); return; }

      lsSet("ck-pseudo", p);
      lsSet("ck-last-comment", String(Date.now()));
      body.value = "";
      onPosted(data);
      toast("Commentaire publié !");
    });
    return form;
  }

  // ── Évènements ──
  $("search").addEventListener("input", renderGrid);
  $("sort").addEventListener("change", renderGrid);
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && overlay) closeReview(); });

  load();
})();
