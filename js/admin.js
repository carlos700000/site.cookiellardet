// Espace auteur : connexion, ajout / modification des avis, photothèque, modération.
(function () {
  const { sb, configured, cookiesOf, cookieCount, plural, photoRank, byRecent, el, ratingBar, ratingTone, fmtRating, timeAgo, toast, legacyPhotoUrl } = window.CK;
  const app = document.getElementById("app");
  const topActions = document.getElementById("topActions");
  const photoFile = document.getElementById("photoFile");

  // ════════════════════════════════════════════════════════════
  //  Accès aux données : Supabase, ou mémoire locale en mode démo
  // ════════════════════════════════════════════════════════════
  const supabaseApi = {
    demo: false,
    async session() { return (await sb.auth.getSession()).data.session; },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async isAdmin(uid) {
      const { data } = await sb.from("admins").select("user_id").eq("user_id", uid).maybeSingle();
      return !!data;
    },
    async listReviews() {
      const { data, error } = await sb.from("reviews").select("*, comments(count)").order("num", { ascending: false });
      if (error) throw error;
      return data;
    },
    async saveReview(row) {
      const { id, ...fields } = row;
      const q = id ? sb.from("reviews").update(fields).eq("id", id) : sb.from("reviews").insert(fields);
      const { data, error } = await q.select("*, comments(count)").single();
      if (error) {
        if (/cookies/.test(error.message)) throw new Error("Exécute d'abord la mise à jour de supabase/schema.sql dans Supabase (colonne « cookies »).");
        throw error;
      }
      return data;
    },
    async deleteReview(id) {
      const { error } = await sb.from("reviews").delete().eq("id", id);
      if (error) throw error;
    },
    async uploadPhoto(blob) {
      const path = new Date().toISOString().slice(0, 10) + "/" + crypto.randomUUID() + ".jpg";
      const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw error;
      return sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
    },
    async listComments() {
      const { data, error } = await sb.from("comments")
        .select("id, pseudo, body, created_at, review_id, reviews(num, title)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
    async deleteComment(id) {
      const { error } = await sb.from("comments").delete().eq("id", id);
      if (error) throw error;
    },
    async importLegacy(rows) {
      const { error } = await sb.from("reviews").insert(rows);
      if (error) throw error;
    },
    async listHidden() {
      // Les photos supprimées avant l'arrivée de la bibliothèque complète (IMG_1713) sont réaffichées
      const { data, error } = await sb.from("photos_masquees").select("url").gte("created_at", window.BIBLIOTHEQUE_DEPUIS || "1970-01-01");
      if (error) return []; // table pas encore créée : rien de masqué
      return data.map(d => d.url);
    },
    async hidePhoto(url) {
      // upsert : une photo déjà masquée avant BIBLIOTHEQUE_DEPUIS est re-datée pour compter à nouveau
      const { error } = await sb.from("photos_masquees").upsert({ url, created_at: new Date().toISOString() });
      if (error) throw new Error(error.code === "42P01" || /photos_masquees/.test(error.message)
        ? "Exécute d'abord le bloc « photos_masquees » de supabase/schema.sql dans Supabase."
        : error.message);
    }
  };

  // Mode démo : rien n'est enregistré, tout disparaît au rechargement.
  const memory = { reviews: [], comments: [] };
  const demoApi = {
    demo: true,
    async session() { return memory.session || null; },
    async signIn() { memory.session = { user: { id: "demo", email: "demo@cookillardet" } }; },
    async signOut() { memory.session = null; },
    async isAdmin() { return true; },
    async listReviews() { return memory.reviews.slice().sort((a, b) => b.num - a.num); },
    async saveReview(row) {
      if (row.id) {
        const i = memory.reviews.findIndex(r => r.id === row.id);
        memory.reviews[i] = { ...memory.reviews[i], ...row };
        return memory.reviews[i];
      }
      const created = { ...row, id: "m" + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), comments: [{ count: 0 }] };
      memory.reviews.push(created);
      return created;
    },
    async deleteReview(id) { memory.reviews = memory.reviews.filter(r => r.id !== id); },
    async uploadPhoto(blob) { return URL.createObjectURL(blob); },
    async listComments() { return memory.comments; },
    async deleteComment(id) { memory.comments = memory.comments.filter(c => c.id !== id); },
    async importLegacy(rows) { for (const r of rows) await demoApi.saveReview(r); },
    async listHidden() { return memory.hidden || []; },
    async hidePhoto(url) { (memory.hidden = memory.hidden || []).push(url); }
  };

  const api = configured ? supabaseApi : demoApi;

  // ════════════════════════════════════════════════════════════
  //  État
  // ════════════════════════════════════════════════════════════
  let reviews = [];
  let comments = [];
  let hidden = new Set(); // anciennes photos supprimées de « Photos à trier »
  let tab = "avis";
  let user = null;

  const legacyUrls = Array.from({ length: window.ANCIENNES_PHOTOS || 0 }, (_, i) => i + 1)
    .filter(n => !(window.HORS_BIBLIOTHEQUE || []).includes(n)).map(legacyPhotoUrl);
  const usedPhotos = () => new Map(reviews.flatMap(r =>
    [r.photo_url, ...cookiesOf(r).map(c => c.photo_url)].filter(Boolean).map(u => [u, r])));
  const unusedLegacy = () => { const used = usedPhotos(); return legacyUrls.filter(u => !used.has(u) && !hidden.has(u)).sort((a, b) => photoRank(b) - photoRank(a)); };
  const nextNum = () => reviews.reduce((m, r) => Math.max(m, r.num || 0), 0) + 1;

  // ════════════════════════════════════════════════════════════
  //  Démarrage & connexion
  // ════════════════════════════════════════════════════════════
  async function boot() {
    const session = await api.session();
    if (!session) return renderLogin();
    user = session.user;
    if (!(await api.isAdmin(user.id))) return renderNotAdmin();
    renderTop();
    await refresh();
  }

  function renderTop() {
    topActions.replaceChildren(
      el("a", { class: "btn btn-ghost btn-sm", href: "index.html", target: "_blank" }, "Voir le site ↗"),
      el("button", { class: "btn btn-ghost btn-sm", onclick: async () => { await api.signOut(); location.reload(); } }, "Déconnexion")
    );
  }

  function renderLogin() {
    topActions.replaceChildren();
    const email = el("input", { class: "input", type: "email", required: !api.demo, autocomplete: "username", placeholder: "ton@email.fr" });
    const pass = el("input", { class: "input", type: "password", required: !api.demo, autocomplete: "current-password" });
    const btn = el("button", { class: "btn btn-primary", type: "submit", text: api.demo ? "Entrer en mode démo" : "Se connecter" });
    const form = el("form", { class: "panel narrow stack" },
      el("div", {}, el("h2", { text: "Bonjour chef 🍪" }), el("p", { class: "lead", text: "Connecte-toi pour publier tes avis." })),
      api.demo && el("div", { class: "notice" },
        "Mode démo : Supabase n'est pas encore configuré (voir ", el("code", { text: "LISEZMOI.md" }),
        "). Tu peux tout essayer, mais rien ne sera enregistré."),
      !api.demo && el("label", { class: "field" }, el("span", { text: "Email" }), email),
      !api.demo && el("label", { class: "field" }, el("span", { text: "Mot de passe" }), pass),
      btn
    );
    form.addEventListener("submit", async e => {
      e.preventDefault();
      btn.disabled = true;
      try { await api.signIn(email.value.trim(), pass.value); await boot(); }
      catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
    app.replaceChildren(form);
  }

  function renderNotAdmin() {
    renderTop();
    app.replaceChildren(el("div", { class: "panel narrow stack" },
      el("h2", { text: "Compte non autorisé" }),
      el("p", { class: "lead" }, "Tu es connecté avec ", el("b", { text: user.email }),
        " mais ce compte n'est pas encore déclaré comme auteur. Exécute la dernière requête de ",
        el("code", { text: "supabase/schema.sql" }), " avec cet email (étape 3 du LISEZMOI).")
    ));
  }

  async function refresh() {
    try {
      let hiddenList;
      [reviews, comments, hiddenList] = await Promise.all([api.listReviews(), api.listComments(), api.listHidden()]);
      hidden = new Set(hiddenList);
    } catch (err) {
      toast("Erreur de chargement : " + err.message, "error");
    }
    renderDashboard();
  }

  // ════════════════════════════════════════════════════════════
  //  Tableau de bord
  // ════════════════════════════════════════════════════════════
  function renderDashboard() {
    const unused = unusedLegacy().length;
    const tabs = [
      ["avis", "Mes enseignes", reviews.length],
      ["photos", "Photos à trier", unused],
      ["commentaires", "Commentaires", comments.length]
    ];
    const tabBar = el("div", { class: "tabs", role: "tablist" }, tabs.map(([id, label, n]) =>
      el("button", { class: "tab", role: "tab", "aria-selected": String(tab === id), onclick: () => { tab = id; renderDashboard(); } },
        label, n ? el("span", { class: "badge", text: n }) : null)
    ));

    const body = tab === "photos" ? viewPhotos() : tab === "commentaires" ? viewComments() : viewReviews();
    app.replaceChildren(
      el("button", { class: "big-add", onclick: () => openEditor() },
        el("span", { class: "plus", text: "+" }),
        el("span", {}, el("b", { text: "Nouvelle enseigne" }), el("span", { text: "Photos des cookies, notes, avis : publié en 1 minute." }))
      ),
      tabBar,
      body
    );
    window.scrollTo(0, 0);
  }

  // ── Onglet : mes avis ──
  function viewReviews() {
    const cookies = reviews.reduce((s, r) => s + cookieCount(r), 0);
    const wrap = el("div", { class: "stack" },
      reviews.length ? el("p", { class: "lead", style: "margin:0", text: plural(reviews.length, "enseigne testée", "enseignes testées") + " · " + plural(cookies, "cookie goûté", "cookies goûtés") }) : null);

    if (!reviews.length) {
      const legacyCount = (window.ANCIENS_AVIS || []).length;
      const btn = el("button", { class: "btn btn-primary", text: "Importer les " + legacyCount + " anciens avis" });
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Import en cours…";
        try {
          await api.importLegacy(window.ANCIENS_AVIS.map(a => ({
            num: a.num,
            title: a.title,
            place: a.place,
            rating: a.rating,
            body: a.body,
            photo_url: a.photo ? legacyPhotoUrl(a.photo) : null,
            published: a.published !== false
          })));
          toast("Anciens avis importés !");
          await refresh();
        } catch (err) { toast("Import impossible : " + err.message, "error"); btn.disabled = false; }
      });
      wrap.append(el("div", { class: "panel stack" },
        el("h2", { text: "Récupérer les anciens avis" }),
        el("p", { class: "lead", text: "Les " + legacyCount + " avis déjà écrits sont prêts à être importés, avec les photos qu'on a pu identifier. Les autres photos t'attendront dans « Photos à trier »." }),
        el("div", {}, btn)
      ));
      return wrap;
    }

    // Photos retrouvées après l'import : on propose de les associer aux anciens avis encore sans photo
    const used = usedPhotos();
    const recovered = (window.ANCIENS_AVIS || [])
      .filter(a => a.photo && !used.has(legacyPhotoUrl(a.photo)))
      .map(a => ({ review: reviews.find(r => r.num === a.num && !r.photo_url), url: legacyPhotoUrl(a.photo) }))
      .filter(x => x.review);
    if (recovered.length) {
      const btn = el("button", { class: "btn btn-primary", text: "Ajouter les " + recovered.length + " photos" });
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Ajout en cours…";
        try {
          for (const { review, url } of recovered) Object.assign(review, await api.saveReview({ id: review.id, photo_url: url }));
          toast(recovered.length + " photos ajoutées !");
          renderDashboard();
        } catch (err) { toast("Erreur : " + err.message, "error"); btn.disabled = false; }
      });
      wrap.append(el("div", { class: "notice stack" },
        el("b", { text: "📸 " + recovered.length + " photos retrouvées" }),
        el("span", { text: "Pour : " + recovered.map(x => x.review.title).join(", ") + "." }),
        el("div", {}, btn)));
    }

    const missing = reviews.filter(r => !r.photo_url).length;
    const search = el("input", { class: "input", type: "search", placeholder: "Filtrer mes avis…" });
    const onlyMissing = el("input", { type: "checkbox" });
    const list = el("div", { class: "rows" });

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const items = reviews.slice().sort(byRecent).filter(r =>
        (!q || (r.title + " " + (r.place || "") + " " + r.num).toLowerCase().includes(q)) &&
        (!onlyMissing.checked || !r.photo_url));
      list.replaceChildren(...items.map(reviewRow));
    };
    search.addEventListener("input", draw);
    onlyMissing.addEventListener("change", draw);

    wrap.append(
      el("div", { class: "filter-row" }, search,
        missing ? el("label", { class: "check" }, onlyMissing, "Sans photo (" + missing + ")") : null),
      list
    );
    draw();
    return wrap;
  }

  function reviewRow(r) {
    const n = r.comments && r.comments[0] ? r.comments[0].count : 0;
    return el("div", { class: "row-item", "data-tone": ratingTone(r.rating) },
      el("div", { class: "row-thumb" }, r.photo_url ? el("img", { src: r.photo_url, alt: "", loading: "lazy" }) : "🍪"),
      el("div", { class: "row-main" },
        el("b", { text: "N° " + r.num + " · " + r.title }),
        el("div", { class: "row-sub" },
          r.rating != null ? el("span", { text: fmtRating(r.rating) + " / 5" }) : el("span", { text: "sans note" }),
          el("span", { text: "🍪 " + cookieCount(r) }),
          n ? el("span", { text: "💬 " + n }) : null,
          !r.published ? el("span", { class: "pill pill-draft", text: "brouillon" }) : null,
          !r.photo_url ? el("span", { class: "pill pill-warn", text: "pas de photo" }) : null
        )
      ),
      el("div", { class: "row-actions" },
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openEditor(r), "aria-label": "Modifier" }, "✏️", el("span", { class: "btn-label", text: " Modifier" }))
      )
    );
  }

  // ── Onglet : photos à trier ──
  function viewPhotos() {
    const unused = unusedLegacy();
    if (!reviews.length) {
      return el("div", { class: "panel" }, el("p", { class: "lead", text: "Importe d'abord les anciens avis (onglet « Mes avis »)." }));
    }
    if (!unused.length) {
      return el("div", { class: "panel" }, el("h2", { text: "Tout est trié 🎉" }), el("p", { class: "lead", text: "Toutes les anciennes photos sont associées à un avis." }));
    }
    return el("div", { class: "stack" },
      el("p", { class: "lead", text: "Ces anciennes photos n'ont pas encore d'avis. Touche une photo pour l'associer à un avis existant ou créer un nouvel avis. La 🗑 retire une photo dont tu ne veux pas." }),
      el("div", { class: "photo-grid" }, unused.map(url =>
        el("div", { class: "photo-cell" },
          el("button", { class: "photo-tile", onclick: () => sortPhoto(url) },
            el("img", { src: url, alt: "", loading: "lazy" }),
            el("span", { class: "tag", text: "#" + url.match(/(\d+)\.jpg$/)[1] })),
          el("button", { class: "photo-del", title: "Supprimer cette photo", "aria-label": "Supprimer cette photo", onclick: () => deletePhoto(url) }, "🗑"))
      ))
    );
  }

  async function deletePhoto(url, after) {
    if (!(await confirmBox("Supprimer définitivement cette photo de « Photos à trier » ?", "Supprimer"))) return false;
    try {
      await api.hidePhoto(url);
      hidden.add(url);
      toast("Photo supprimée.");
      if (after) after();
      renderDashboard();
      return true;
    } catch (err) { toast(err.message, "error"); return false; }
  }

  function sortPhoto(url) {
    const choices = reviews.slice().sort((a, b) => (a.photo_url ? 1 : 0) - (b.photo_url ? 1 : 0) || a.num - b.num);
    const select = el("select", { class: "select" },
      el("option", { value: "", text: "Choisir une enseigne…" }),
      choices.map(r => el("option", { value: r.id, text: "N° " + r.num + " · " + r.title + (r.rating != null ? " (" + fmtRating(r.rating) + ")" : "") + (r.photo_url ? " · " + plural(cookieCount(r), "cookie", "cookies") : " · sans photo") }))
    );
    const preview = el("p", { class: "review-text", style: "font-size:.92rem;color:var(--text-soft)" });
    select.addEventListener("change", () => {
      const r = reviews.find(x => x.id === select.value);
      preview.textContent = r ? r.body : "";
    });
    const assign = el("button", { class: "btn btn-primary", text: "Ajouter à cette enseigne" });
    const m = modal(el("div", { class: "stack" },
      el("img", { src: url, alt: "", style: "max-height:50vh;margin:0 auto;border-radius:12px" }),
      el("label", { class: "field" }, el("span", { text: "Ajouter comme cookie d'une enseigne" }), select),
      preview,
      el("div", { class: "editor-foot" },
        el("button", { class: "btn btn-ghost", onclick: () => { m.close(); openEditor(null, url); } }, "＋ Nouvelle enseigne avec cette photo"),
        assign),
      el("div", { class: "editor-foot", style: "justify-content:center" },
        el("button", { class: "btn btn-danger btn-sm", onclick: () => deletePhoto(url, () => m.close()) }, "🗑 Supprimer cette photo"))
    ), "picker-sheet");
    assign.addEventListener("click", async () => {
      const r = reviews.find(x => x.id === select.value);
      if (!r) { toast("Choisis d'abord une enseigne.", "error"); return; }
      assign.disabled = true;
      try {
        const cookies = [...cookiesOf(r), { photo_url: url, name: null, rating: null, body: "" }];
        const saved = await api.saveReview({ id: r.id, photo_url: cookies[0].photo_url, cookies });
        Object.assign(r, saved);
        m.close();
        toast("Photo associée au n° " + r.num + " !");
        renderDashboard();
      } catch (err) { toast(err.message, "error"); assign.disabled = false; }
    });
  }

  // ── Onglet : commentaires ──
  function viewComments() {
    if (api.demo) return el("div", { class: "panel" }, el("p", { class: "lead", text: "Les commentaires des visiteurs apparaîtront ici une fois le site en ligne. Tu pourras supprimer ceux qui dépassent les bornes." }));
    if (!comments.length) return el("div", { class: "panel" }, el("p", { class: "lead", text: "Aucun commentaire pour l'instant." }));
    return el("div", { class: "rows" }, comments.map(c =>
      el("div", { class: "mod-item" },
        el("div", { class: "row-main" },
          el("div", { class: "row-sub" },
            el("b", { text: c.pseudo, style: "color:var(--text)" }),
            el("span", { text: "sur N° " + (c.reviews ? c.reviews.num + " · " + c.reviews.title : "?") }),
            el("span", { text: timeAgo(c.created_at) })),
          el("p", { text: c.body })),
        el("button", { class: "btn btn-danger btn-sm", "aria-label": "Supprimer", onclick: async () => {
          if (!(await confirmBox("Supprimer ce commentaire de " + c.pseudo + " ?", "Supprimer"))) return;
          try { await api.deleteComment(c.id); comments = comments.filter(x => x.id !== c.id); renderDashboard(); toast("Commentaire supprimé."); }
          catch (err) { toast(err.message, "error"); }
        } }, "🗑")
      )
    ));
  }

  // ════════════════════════════════════════════════════════════
  //  Éditeur d'avis
  // ════════════════════════════════════════════════════════════
  function openEditor(review, presetPhoto) {
    const isNew = !review;
    const r = review || { num: nextNum(), title: "", place: "", rating: 3.5, body: "", photo_url: null, tasted_on: new Date().toISOString().slice(0, 10), published: true };
    let dirty = false;
    const touch = () => { dirty = true; };

    // Cookies testés : { photo: { url } | { blob, url } | null, name, rating, body }
    const cookies = cookiesOf(r).map(c => ({ photo: c.photo_url ? { url: c.photo_url } : null, name: c.name || "", rating: c.rating ?? null, body: c.body || "" }));
    const blankCookie = () => ({ photo: null, name: "", rating: 3.5, body: "" });
    if (!cookies.length) cookies.push(presetPhoto ? { ...blankCookie(), photo: { url: presetPhoto } } : blankCookie());
    const cookieBox = el("div", { class: "stack" });
    const drawCookies = () => cookieBox.replaceChildren(...cookies.map((c, i) => cookieEditor(c, i)));

    function cookieEditor(c, i) {
      const drop = el("div", { class: "photo-drop" });
      const drawPhoto = () => {
        drop.classList.toggle("has-photo", !!c.photo);
        drop.replaceChildren(c.photo
          ? el("img", { src: c.photo.url, alt: "Photo du cookie" })
          : el("div", {}, el("div", { class: "ph-icon", text: "📸" }), el("p", { style: "margin:6px 0 0;color:var(--text-soft)", text: "Prends ce cookie en photo ou glisse une image ici" })));
      };
      drawPhoto();
      const setFile = async file => {
        if (!file || !file.type.startsWith("image/")) return;
        try {
          const blob = await resizeImage(file);
          c.photo = { blob, url: URL.createObjectURL(blob) };
          touch(); drawPhoto();
        } catch { toast("Impossible de lire cette image.", "error"); }
      };
      drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
      drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("dragover"); setFile(e.dataTransfer.files[0]); });
      const pickFile = () => {
        photoFile.value = "";
        photoFile.onchange = () => setFile(photoFile.files[0]);
        photoFile.click();
      };

      const name = el("input", { class: "input", maxlength: "120", placeholder: "Ex. : triple chocolat (facultatif)", oninput: () => { c.name = name.value; touch(); } });
      name.value = c.name;
      const body = el("textarea", { class: "textarea", rows: "3", maxlength: "2000", placeholder: "Ton avis sur ce cookie…", oninput: () => { c.body = body.value; touch(); } });
      body.value = c.body;
      const picker = ratingPicker(c.rating, c.rating == null, v => { c.rating = v; touch(); });

      return el("div", { class: "cookie-edit" },
        el("div", { class: "cookie-edit-head" },
          el("b", { text: "Cookie n° " + (i + 1) }),
          cookies.length > 1 && el("button", { class: "btn btn-danger btn-sm", type: "button", onclick: () => { cookies.splice(i, 1); touch(); drawCookies(); } }, "🗑 Retirer ce cookie")),
        el("div", { class: "editor" },
          el("div", {},
            drop,
            el("div", { class: "photo-actions" },
              el("button", { class: "btn btn-primary", type: "button", onclick: pickFile }, "📷 ", c.photo ? "Changer" : "Photo"),
              el("button", { class: "btn btn-ghost", type: "button", onclick: () => pickLegacy(url => { c.photo = { url }; touch(); drawPhoto(); }, r) }, "🗂 Anciennes"),
              el("button", { class: "btn btn-ghost btn-icon", type: "button", title: "Retirer la photo", "aria-label": "Retirer la photo", onclick: () => { c.photo = null; touch(); drawPhoto(); } }, "✕")
            )),
          el("div", { class: "stack" },
            el("label", { class: "field" }, el("span", { text: "Quel cookie ?" }), name),
            el("div", { class: "field" }, el("span", { text: "Note de ce cookie" }), picker.node),
            el("label", { class: "field" }, el("span", { text: "Avis sur ce cookie" }), body))
        )
      );
    }
    drawCookies();

    // Champs de l'enseigne
    const title = el("input", { class: "input", required: true, maxlength: "120", placeholder: "Ex. : Boulangerie Dupont", oninput: touch });
    title.value = r.title;
    const place = el("input", { class: "input", maxlength: "200", placeholder: "Adresse ou ville (facultatif)", oninput: touch });
    place.value = r.place || "";
    const date = el("input", { class: "input", type: "date", oninput: touch });
    date.value = r.tasted_on || "";
    const num = el("input", { class: "input", type: "number", min: "1", step: "1", required: true, oninput: touch });
    num.value = r.num;
    const body = el("textarea", { class: "textarea", rows: "6", maxlength: "5000", placeholder: "Accueil, choix, prix, ambiance, verdict général…", oninput: touch });
    body.value = r.body || "";
    const published = el("input", { type: "checkbox", onchange: touch });
    published.checked = r.published !== false;

    let rating = r.rating ?? null;
    const globalPicker = ratingPicker(r.rating, r.rating == null, v => { rating = v; touch(); });

    const save = el("button", { class: "btn btn-primary", type: "submit", text: isNew ? "Publier l'avis" : "Enregistrer" });
    published.addEventListener("change", () => { if (isNew) save.textContent = published.checked ? "Publier l'avis" : "Enregistrer le brouillon"; });

    const back = async () => {
      if (dirty && !(await confirmBox("Quitter sans enregistrer les modifications ?", "Quitter"))) return;
      renderDashboard();
    };

    const form = el("form", { class: "panel stack" },
      el("div", { class: "editor-foot" },
        el("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: back, text: "← Retour" }),
        el("h2", { text: isNew ? "Nouvelle enseigne" : "Modifier le n° " + r.num, style: "margin:0" })
      ),
      el("div", { class: "two" },
        el("label", { class: "field" }, el("span", { text: "Nom de l'enseigne / de la boutique" }), title),
        el("label", { class: "field" }, el("span", { text: "Où ?" }), place)),
      el("div", { class: "field" }, el("span", { text: "Note globale de l'enseigne" }), globalPicker.node),
      el("label", { class: "field" }, el("span", { text: "Ton avis sur l'enseigne" }), body),
      el("h3", { class: "editor-sub", text: "Les cookies goûtés" }),
      cookieBox,
      el("div", {}, el("button", { class: "btn btn-ghost", type: "button", onclick: () => {
        cookies.push(blankCookie());
        touch(); drawCookies();
        cookieBox.lastElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
      } }, "＋ Ajouter un cookie")),
      el("div", { class: "two" },
        el("label", { class: "field" }, el("span", { text: "Goûté le" }), date),
        el("label", { class: "field" }, el("span", { text: "Numéro" }), num)),
      el("label", { class: "check" }, published, "Visible sur le site (décoche pour garder en brouillon)"),
      el("div", { class: "editor-foot" },
        !isNew ? el("button", { class: "btn btn-danger", type: "button", onclick: () => removeReview(r) }, "🗑 Supprimer") : el("span"),
        el("div", { class: "right" }, save)
      )
    );

    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!title.value.trim()) { toast("Donne un nom à cette enseigne.", "error"); title.focus(); return; }
      save.disabled = true;
      const label = save.textContent;
      try {
        // On ne garde que les cookies remplis (au moins une photo, un nom ou un avis)
        const kept = cookies.filter(c => c.photo || c.name.trim() || c.body.trim());
        const toUpload = kept.filter(c => c.photo && c.photo.blob);
        for (const [i, c] of toUpload.entries()) {
          save.textContent = "Envoi des photos… " + (i + 1) + "/" + toUpload.length;
          c.photo = { url: await api.uploadPhoto(c.photo.blob) };
        }
        save.textContent = "Enregistrement…";
        const savedCookies = kept.map(c => ({
          photo_url: c.photo ? c.photo.url : null,
          name: c.name.trim() || null,
          rating: c.rating == null ? null : Math.round(Number(c.rating) * 10) / 10,
          body: c.body.trim()
        }));
        const cover = savedCookies.find(c => c.photo_url);
        const row = {
          num: parseInt(num.value, 10) || nextNum(),
          title: title.value.trim(),
          place: place.value.trim() || null,
          rating: rating == null ? null : Math.round(Number(rating) * 10) / 10,
          body: body.value.trim(),
          photo_url: cover ? cover.photo_url : null,
          cookies: savedCookies,
          tasted_on: date.value || null,
          published: published.checked
        };
        if (!isNew) row.id = r.id;
        const saved = await api.saveReview(row);
        if (isNew) reviews.push(saved); else Object.assign(r, saved);
        reviews.sort((a, b) => b.num - a.num);
        dirty = false;
        tab = "avis";
        toast(isNew ? (row.published ? "Avis publié ! 🍪" : "Brouillon enregistré.") : "Modifications enregistrées.");
        renderDashboard();
      } catch (err) {
        toast("Erreur : " + err.message, "error");
        save.disabled = false; save.textContent = label;
      }
    });

    app.replaceChildren(form);
    window.scrollTo(0, 0);
    if (isNew && !presetPhoto) title.focus({ preventScroll: true });
  }

  // Curseur de note sur 5 avec case « Pas de note ». onChange(null | nombre)
  function ratingPicker(initial, none, onChange) {
    const range = el("input", { type: "range", min: "0", max: "5", step: "0.1", "aria-label": "Note sur 5" });
    range.value = initial ?? 3.5;
    const noRating = el("input", { type: "checkbox" });
    noRating.checked = none;
    const value = el("div", { class: "rp-value" });
    const node = el("div", { class: "rating-picker" },
      el("div", { class: "rp-head" }, value, el("label", { class: "check" }, noRating, "Pas de note")),
      range,
      el("div", { class: "rp-scale" }, el("span", { text: "0 · immangeable" }), el("span", { text: "2,5" }), el("span", { text: "5 · parfait" }))
    );
    const draw = () => {
      const off = noRating.checked;
      node.classList.toggle("off", off);
      range.disabled = off;
      node.dataset.tone = off ? "none" : ratingTone(Number(range.value));
      value.replaceChildren(off ? "–" : fmtRating(Number(range.value)), el("small", { text: " / 5" }));
    };
    const changed = () => { draw(); onChange(noRating.checked ? null : Number(range.value)); };
    range.addEventListener("input", changed);
    noRating.addEventListener("change", changed);
    draw();
    return { node };
  }

  async function removeReview(r) {
    if (!(await confirmBox("Supprimer définitivement l'avis n° " + r.num + " « " + r.title + " » et ses commentaires ?", "Supprimer"))) return;
    try {
      await api.deleteReview(r.id);
      reviews = reviews.filter(x => x.id !== r.id);
      comments = comments.filter(c => c.review_id !== r.id);
      toast("Avis supprimé.");
      renderDashboard();
    } catch (err) { toast(err.message, "error"); }
  }

  // Choix d'une ancienne photo (photos non utilisées d'abord)
  function pickLegacy(onPick, current) {
    const used = usedPhotos();
    const sorted = legacyUrls.filter(u => !hidden.has(u)).sort((a, b) => (used.has(a) ? 1 : 0) - (used.has(b) ? 1 : 0));
    const m = modal(el("div", { class: "stack" },
      el("h2", { text: "Anciennes photos", style: "font-family:var(--ff-display);margin:0" }),
      el("p", { class: "lead", style: "margin:0", text: "Les photos grisées sont déjà utilisées par un autre avis." }),
      el("div", { class: "photo-grid" }, sorted.map(url => {
        const owner = used.get(url);
        const mine = owner && current && owner.id === current.id;
        return el("button", { class: "photo-tile" + (owner && !mine ? " used" : "") + (mine ? " selected" : ""), type: "button", onclick: () => { m.close(); onPick(url); } },
          el("img", { src: url, alt: "", loading: "lazy" }),
          el("span", { class: "tag", text: owner ? "n° " + owner.num : "#" + url.match(/(\d+)\.jpg$/)[1] }));
      }))
    ), "picker-sheet");
  }

  // ════════════════════════════════════════════════════════════
  //  Petits outils
  // ════════════════════════════════════════════════════════════
  function modal(content, extraClass, onClose) {
    const sheet = el("div", { class: "sheet " + (extraClass || ""), role: "dialog", "aria-modal": "true" },
      el("button", { class: "sheet-close", "aria-label": "Fermer", text: "×", onclick: () => close() }),
      el("div", { class: "sheet-body" }, content));
    const overlay = el("div", { class: "overlay", onclick: e => { if (e.target === overlay) close(); } }, sheet);
    const onKey = e => { if (e.key === "Escape") close(); };
    function close() {
      if (!overlay.isConnected) return;
      overlay.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey);
      if (onClose) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    return { close };
  }

  function confirmBox(message, okLabel) {
    return new Promise(resolve => {
      let answer = false;
      const m = modal(el("div", { class: "stack", style: "text-align:center" },
        el("p", { style: "margin:8px 0 0;font-size:1.05rem", text: message }),
        el("div", { class: "editor-foot", style: "justify-content:center" },
          el("button", { class: "btn btn-ghost", onclick: () => m.close(), text: "Annuler" }),
          el("button", { class: "btn btn-danger", onclick: () => { answer = true; m.close(); }, text: okLabel }))
      ), "", () => resolve(answer));
    });
  }

  // Réduit la photo (les photos d'iPhone font 4 Mo) avant l'envoi
  function resizeImage(file, max = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const src = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * r);
        c.height = Math.round(img.naturalHeight * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(src);
        c.toBlob(b => (b ? resolve(b) : reject(new Error("conversion"))), "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("lecture")); };
      img.src = src;
    });
  }

  boot();
})();
