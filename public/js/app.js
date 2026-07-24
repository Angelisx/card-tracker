(function () {
  "use strict";

  let cardsDb = null;
  let wallet = { cardIds: [], customCards: [] };

  const el = (id) => document.getElementById(id);

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
    cardsDb = await res.json();
    el("dbNote").textContent =
      `Reward data last checked ${cardsDb.lastVerified}. ${cardsDb.note}`;
  }

  async function loadWallet() {
    const res = await fetch("/api/my-cards");
    wallet = await res.json();
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
  function sortApr(card, ignoreIntro) {
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

  function cardCardHtml(card, inWallet) {
    const aprHtml = card.apr
      ? `<div class="apr-line">APR: ${card.apr}</div>`
      : "";
    return `
      <div class="card" data-card-id="${card.id}">
        <h3>${card.name}</h3>
        <div class="issuer">${card.issuer} · ${card.rewardType}${card.rotating ? " · rotating categories" : ""}</div>
        <div class="rates">${ratesPillHtml(card)}</div>
        ${aprHtml}
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

  function bindGridClicks(gridId) {
    el(gridId).addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      toggleCard(btn.dataset.id, btn.dataset.action);
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
    const res = await fetch("/api/settings");
    if (!res.ok) return;
    const data = await res.json();
    el("webhookUrl").value = data.webhookUrl || "";
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
    const ok = await requireAuth();
    if (!ok) return;
    loadSortState();
    await loadCardsDb();
    await loadWallet();
    await loadSettings();
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
