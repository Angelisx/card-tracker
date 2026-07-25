(function () {
  "use strict";

  let cardsDb = null;
  let wallet = { cardIds: [], customCards: [], aprOverrides: {} };
  let photoCardIds = new Set();
  // Bumped only when a photo actually changes, so the <img> src stays stable
  // across unrelated re-renders (typing in search, toggling other cards) and
  // the browser can serve it from cache instead of re-fetching every time.
  let photoCacheVersion = 0;

  const el = (id) => document.getElementById(id);

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  const sortState = {
    wallet: { sort: "name", ignoreIntro: false },
    browse: { sort: "name", ignoreIntro: false },
  };

  function loadSortState() {
    try {
      const saved = JSON.parse(localStorage.getItem("cardTrackerSortState") || "{}");
      if (saved.wallet) Object.assign(sortState.wallet, saved.wallet);
      if (saved.browse) Object.assign(sortState.browse, saved.browse);
    } catch {
      // ignore
    }
  }

  function saveSortState() {
    localStorage.setItem("cardTrackerSortState", JSON.stringify(sortState));
  }

  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  async function requireAuth() {
    const res = await fetch("/api/auth");
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = "/login.html";
      return false;
    }
    return true;
  }

  async function loadCardsDb() {
    const res = await fetch("/data/cards-db.json");
    if (!res.ok) throw new Error("Failed to load card database");
    cardsDb = await res.json();
    el("dbNote").textContent =
      `Reward data last checked ${cardsDb.lastVerified}. ${cardsDb.note}`;
  }

  async function loadWallet() {
    const res = await fetch("/api/my-cards");
    if (!res.ok) throw new Error("Failed to load wallet");
    wallet = await res.json();
  }

  function showFatalError() {
    document.querySelectorAll(".tabs, .panel").forEach((n) => n.remove());
    const note = el("dbNote");
    note.classList.add("error-banner");
    note.innerHTML = `
      Something went wrong loading your data. Check your connection and try again.
      <button class="btn small" id="retryLoadBtn">Retry</button>`;
    el("retryLoadBtn").addEventListener("click", () => window.location.reload());
  }

  async function loadPhotoList() {
    try {
      const res = await fetch("/api/card-photo");
      if (!res.ok) return;
      const data = await res.json();
      photoCardIds = new Set(data.cardIds || []);
    } catch {
      // ignore
    }
  }

  // Resize/compress an image file client-side before upload, so we never
  // send more than ~a few hundred KB to Blobs storage.
  function resizeImageFile(file, maxWidth = 500, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadCardPhoto(cardId, file) {
    const dataUrl = await resizeImageFile(file);
    const res = await fetch("/api/card-photo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId, dataUrl }),
    });
    if (!res.ok) {
      toast("Could not upload photo");
      return;
    }
    photoCardIds.add(cardId);
    photoCacheVersion++;
    toast("Photo saved");
    renderWallet();
    renderBrowse(el("browseSearch").value);
  }

  async function removeCardPhoto(cardId) {
    const res = await fetch(`/api/card-photo?cardId=${encodeURIComponent(cardId)}`, { method: "DELETE" });
    if (!res.ok) {
      toast("Could not remove photo");
      return;
    }
    photoCardIds.delete(cardId);
    photoCacheVersion++;
    toast("Photo removed");
    renderWallet();
    renderBrowse(el("browseSearch").value);
  }

  function cardById(id) {
    return cardsDb.cards.find((c) => c.id === id);
  }

  function rateFor(card, category) {
    const match = card.categories.find((c) => c.category === category);
    return match ? match.rate : card.baseRate;
  }

  function bestPerCategory() {
    const myCards = wallet.cardIds.map(cardById).filter(Boolean).concat(wallet.customCards || []);
    const result = {};
    for (const category of cardsDb.categories) {
      let best = null;
      for (const card of myCards) {
        const rate = rateFor(card, category);
        if (!best || rate > best.rate) best = { card, rate };
      }
      result[category] = best;
    }
    return result;
  }

  // Returns a numeric APR to sort on, or null if the card has no APR data.
  // A user-entered override (their actual current rate) always wins, since
  // it's more accurate than the issuer's published intro/regular range.
  function sortApr(card, ignoreIntro) {
    const override = wallet.aprOverrides && wallet.aprOverrides[card.id];
    if (override) return override.apr;
    if (!card.aprData) return null;
    const { introRate, regularMin, regularMax } = card.aprData;
    if (!ignoreIntro && introRate !== null && introRate !== undefined) {
      return introRate;
    }
    if (regularMin == null || regularMax == null) return null;
    return (regularMin + regularMax) / 2;
  }

  function sortCards(cards, sort, ignoreIntro) {
    const copy = [...cards];
    if (sort === "name") {
      copy.sort((a, b) => a.name.localeCompare(b.name));
      return copy;
    }
    const dir = sort === "apr-desc" ? -1 : 1;
    copy.sort((a, b) => {
      const aApr = sortApr(a, ignoreIntro);
      const bApr = sortApr(b, ignoreIntro);
      if (aApr === null && bApr === null) return a.name.localeCompare(b.name);
      if (aApr === null) return 1; // cards with no APR data always sort last
      if (bApr === null) return -1;
      if (aApr === bApr) return a.name.localeCompare(b.name);
      return (aApr - bApr) * dir;
    });
    return copy;
  }

  function ratesPillHtml(card) {
    const top = [...card.categories].sort((a, b) => b.rate - a.rate).slice(0, 4);
    let html = top
      .map((c) => `<span class="pill">${c.category.replace(/_/g, " ")} ${c.rate}x</span>`)
      .join("");
    html += `<span class="pill base">everything else ${card.baseRate}x</span>`;
    return html;
  }

  // Curated gradient palette. Cards get a deterministic pick based on their id,
  // so the same card always looks the same, and different cards from the same
  // issuer still look distinct. These are original designs, not reproductions
  // of actual issuer card art (which is trademarked/copyrighted).
  const CARD_GRADIENTS = [
    ["#4f46e5", "#0ea5e9"],
    ["#0f172a", "#334155"],
    ["#b91c1c", "#f97316"],
    ["#065f46", "#10b981"],
    ["#7c2d12", "#d97706"],
    ["#581c87", "#c026d3"],
    ["#1e3a8a", "#3b82f6"],
    ["#78350f", "#eab308"],
    ["#111827", "#6b7280"],
    ["#9d174d", "#ec4899"],
    ["#134e4a", "#14b8a6"],
    ["#7f1d1d", "#ef4444"],
  ];

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function cardVisualHtml(card) {
    if (photoCardIds.has(card.id)) {
      return `
        <div class="card-visual has-photo">
          <img src="/api/card-photo?cardId=${encodeURIComponent(card.id)}&v=${photoCacheVersion}" alt="${card.name}">
        </div>`;
    }
    const [c1, c2] = CARD_GRADIENTS[hashString(card.id) % CARD_GRADIENTS.length];
    return `
      <div class="card-visual" style="background: linear-gradient(135deg, ${c1}, ${c2});">
        <div class="cv-top">
          <div class="cv-issuer">${card.issuer}</div>
          <div class="cv-chip"></div>
        </div>
        <div class="cv-name">${card.name}</div>
      </div>`;
  }

  function photoControlHtml(card) {
    const hasPhoto = photoCardIds.has(card.id);
    return `
      <div class="photo-control">
        <label class="photo-upload-label">
          ${hasPhoto ? "Change photo" : "Add your own photo"}
          <input type="file" accept="image/*" class="photo-input" data-photo-id="${card.id}" hidden>
        </label>
        ${hasPhoto ? `<button type="button" class="photo-remove-btn" data-photo-remove="${card.id}">Remove</button>` : ""}
      </div>`;
  }

  function aprEditHtml(card, inWallet) {
    if (!inWallet) return "";
    const override = wallet.aprOverrides && wallet.aprOverrides[card.id];
    return `
      <div class="apr-edit">
        <label>Your APR:
          <input type="number" step="0.01" min="0" max="99" class="apr-input" data-apr-id="${card.id}"
            placeholder="e.g. 24.99" value="${override ? override.apr : ""}">
          %
        </label>
        <button type="button" class="btn small" data-apr-save="${card.id}">Save</button>
        ${override ? `<button type="button" class="btn small secondary" data-apr-clear="${card.id}">Clear</button>` : ""}
      </div>`;
  }

  function cardCardHtml(card, inWallet) {
    const override = wallet.aprOverrides && wallet.aprOverrides[card.id];
    const aprHtml = override
      ? `<div class="apr-line apr-override">APR: ${override.apr}% (your rate)</div>`
      : card.apr
      ? `<div class="apr-line">APR: ${card.apr}</div>`
      : "";
    return `
      <div class="card" data-card-id="${card.id}">
        ${cardVisualHtml(card)}
        ${photoControlHtml(card)}
        <h3>${card.name}</h3>
        <div class="issuer">${card.issuer} · ${card.rewardType}${card.rotating ? " · rotating categories" : ""}</div>
        <div class="rates">${ratesPillHtml(card)}</div>
        ${aprHtml}
        ${aprEditHtml(card, inWallet)}
        <div class="card-actions">
          <button class="btn ${inWallet ? "danger" : ""}" data-action="${inWallet ? "remove" : "add"}" data-id="${card.id}">
            ${inWallet ? "Remove from wallet" : "Add to wallet"}
          </button>
        </div>
      </div>`;
  }

  function renderWallet() {
    const grid = el("walletGrid");
    let myCards = wallet.cardIds.map(cardById).filter(Boolean);
    if (myCards.length === 0) {
      grid.innerHTML = `<div class="empty">No cards yet. Go to <strong>Browse Cards</strong> and add the ones you own.</div>`;
      return;
    }
    myCards = sortCards(myCards, sortState.wallet.sort, sortState.wallet.ignoreIntro);
    grid.innerHTML = myCards.map((c) => cardCardHtml(c, true)).join("");
  }

  function renderBrowse(filter) {
    const grid = el("browseGrid");
    const q = (filter || "").toLowerCase();
    let cards = cardsDb.cards.filter(
      (c) => c.name.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q)
    );
    if (cards.length === 0) {
      grid.innerHTML = `<div class="empty">No cards match “${escapeHtml(filter)}”. Try a different name or issuer.</div>`;
      return;
    }
    cards = sortCards(cards, sortState.browse.sort, sortState.browse.ignoreIntro);
    grid.innerHTML = cards
      .map((c) => cardCardHtml(c, wallet.cardIds.includes(c.id)))
      .join("");
  }

  function renderBest() {
    const rec = bestPerCategory();
    const rows = cardsDb.categories
      .map((cat) => {
        const r = rec[cat];
        const label = cat.replace(/_/g, " ");
        if (!r) return `<tr><td>${label}</td><td colspan="2" style="color:var(--text-dim)">No card in your wallet</td></tr>`;
        return `<tr><td>${label}</td><td>${r.card.name}</td><td class="rate-badge">${r.rate}x</td></tr>`;
      })
      .join("");
    el("bestTableBody").innerHTML = rows;
  }

  async function toggleCard(id, action) {
    const res = await fetch("/api/my-cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, cardId: id }),
    });
    if (!res.ok) {
      toast("Could not update wallet");
      return;
    }
    wallet = await res.json();
    renderWallet();
    renderBrowse(el("browseSearch").value);
    renderBest();
    toast(action === "add" ? "Added to wallet" : "Removed from wallet");
  }

  async function saveApr(cardId, apr) {
    const res = await fetch("/api/my-cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_apr", cardId, apr }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Could not save APR");
      return;
    }
    wallet = await res.json();
    renderWallet();
    renderBrowse(el("browseSearch").value);
    toast(apr === null ? "APR override cleared" : "APR updated");
  }

  function bindGridClicks(gridId) {
    const grid = el(gridId);
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (btn) {
        toggleCard(btn.dataset.id, btn.dataset.action);
        return;
      }
      const removeBtn = e.target.closest("button[data-photo-remove]");
      if (removeBtn) {
        removeCardPhoto(removeBtn.dataset.photoRemove);
        return;
      }
      const aprSaveBtn = e.target.closest("button[data-apr-save]");
      if (aprSaveBtn) {
        const cardId = aprSaveBtn.dataset.aprSave;
        const input = grid.querySelector(`input[data-apr-id="${cardId}"]`);
        const value = input ? input.value.trim() : "";
        if (value === "") {
          toast("Enter an APR value first");
          return;
        }
        saveApr(cardId, value);
        return;
      }
      const aprClearBtn = e.target.closest("button[data-apr-clear]");
      if (aprClearBtn) {
        saveApr(aprClearBtn.dataset.aprClear, null);
      }
    });
    grid.addEventListener("change", (e) => {
      const input = e.target.closest("input[data-photo-id]");
      if (!input || !input.files || !input.files[0]) return;
      uploadCardPhoto(input.dataset.photoId, input.files[0]);
    });
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        el(`panel-${tab.dataset.tab}`).classList.add("active");
      });
    });
  }

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      el("webhookUrl").value = data.webhookUrl || "";
    } catch {
      // non-critical; settings tab just stays blank
    }
  }

  function bindSettings() {
    el("saveWebhookBtn").addEventListener("click", async () => {
      const webhookUrl = el("webhookUrl").value.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: webhookUrl || null }),
      });
      if (res.ok) toast("Webhook saved");
      else toast("Could not save webhook");
    });
  }

  function bindSortControls() {
    el("walletSort").value = sortState.wallet.sort;
    el("walletIgnoreIntro").checked = sortState.wallet.ignoreIntro;
    el("browseSort").value = sortState.browse.sort;
    el("browseIgnoreIntro").checked = sortState.browse.ignoreIntro;

    el("walletSort").addEventListener("change", (e) => {
      sortState.wallet.sort = e.target.value;
      saveSortState();
      renderWallet();
    });
    el("walletIgnoreIntro").addEventListener("change", (e) => {
      sortState.wallet.ignoreIntro = e.target.checked;
      saveSortState();
      renderWallet();
    });
    el("browseSort").addEventListener("change", (e) => {
      sortState.browse.sort = e.target.value;
      saveSortState();
      renderBrowse(el("browseSearch").value);
    });
    el("browseIgnoreIntro").addEventListener("change", (e) => {
      sortState.browse.ignoreIntro = e.target.checked;
      saveSortState();
      renderBrowse(el("browseSearch").value);
    });
  }

  function standingColor(standing) {
    if (standing === "EXCELLENT" || standing === "GOOD") return "var(--good)";
    if (standing === "NEEDS_WORK") return "var(--danger)";
    return "var(--text-dim)";
  }

  async function loadCredit() {
    const container = el("creditContent");
    try {
      const res = await fetch("/api/credit-score");
      if (!res.ok) throw new Error("failed");
      const snap = await res.json();
      if (!snap) {
        container.innerHTML = `<div class="empty">No credit score synced yet. Ask Claude (with Credit Karma connected) to sync it.</div>`;
        return;
      }
      const factorRows = snap.factors
        .map(
          (f) => `<tr>
            <td>${f.factorName.replace(/_/g, " ")}</td>
            <td>${f.impactLevel}</td>
            <td style="color:${standingColor(f.standing)}">${f.standing.replace(/_/g, " ")}</td>
          </tr>`
        )
        .join("");
      container.innerHTML = `
        <div class="settings-block">
          <h3>Score band: ${snap.scoreBand}</h3>
          <p class="sub">${snap.source} · synced ${new Date(snap.updatedAt).toLocaleString()}</p>
        </div>
        <table class="rec-table">
          <thead><tr><th>Factor</th><th>Impact</th><th>Standing</th></tr></thead>
          <tbody>${factorRows}</tbody>
        </table>
      `;
    } catch {
      container.innerHTML = `<div class="empty">Could not load credit data.</div>`;
    }
  }

  function bindLogout() {
    el("logoutBtn").addEventListener("click", async () => {
      await fetch("/api/auth", { method: "DELETE" });
      window.location.href = "/login.html";
    });
  }

  function bindSearch() {
    el("browseSearch").addEventListener("input", (e) => renderBrowse(e.target.value));
  }

  async function init() {
    let ok;
    try {
      ok = await requireAuth();
    } catch (err) {
      console.error(err);
      showFatalError();
      return;
    }
    if (!ok) return;
    loadSortState();
    // Fire all four independent fetches at once instead of chaining them —
    // page load time was the sum of four round trips, now it's the slowest one.
    const optionalLoad = Promise.all([loadPhotoList(), loadSettings()]);
    try {
      await Promise.all([loadCardsDb(), loadWallet()]);
    } catch (err) {
      console.error(err);
      showFatalError();
      return;
    }
    await optionalLoad;
    renderWallet();
    renderBrowse("");
    renderBest();
    loadCredit();
    bindTabs();
    bindGridClicks("walletGrid");
    bindGridClicks("browseGrid");
    bindSettings();
    bindSortControls();
    bindLogout();
    bindSearch();
    el("mcpUrl").textContent = window.location.origin + "/mcp";
  }

  init();
})();
