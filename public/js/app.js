(function () {
  "use strict";

  let cardsDb = null;
  let wallet = { cardIds: [], customCards: [] };

  const el = (id) => document.getElementById(id);

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

  function ratesPillHtml(card) {
    const top = [...card.categories].sort((a, b) => b.rate - a.rate).slice(0, 4);
    let html = top
      .map((c) => `<span class="pill">${c.category.replace(/_/g, " ")} ${c.rate}x</span>`)
      .join("");
    html += `<span class="pill base">everything else ${card.baseRate}x</span>`;
    return html;
  }

  function cardCardHtml(card, inWallet) {
    return `
      <div class="card" data-card-id="${card.id}">
        <h3>${card.name}</h3>
        <div class="issuer">${card.issuer} · ${card.rewardType}${card.rotating ? " · rotating categories" : ""}</div>
        <div class="rates">${ratesPillHtml(card)}</div>
        <div class="card-actions">
          <button class="btn ${inWallet ? "danger" : ""}" data-action="${inWallet ? "remove" : "add"}" data-id="${card.id}">
            ${inWallet ? "Remove from wallet" : "Add to wallet"}
          </button>
        </div>
      </div>`;
  }

  function renderWallet() {
    const grid = el("walletGrid");
    const myCards = wallet.cardIds.map(cardById).filter(Boolean);
    if (myCards.length === 0) {
      grid.innerHTML = `<div class="empty">No cards yet. Go to <strong>Browse Cards</strong> and add the ones you own.</div>`;
      return;
    }
    grid.innerHTML = myCards.map((c) => cardCardHtml(c, true)).join("");
  }

  function renderBrowse(filter) {
    const grid = el("browseGrid");
    const q = (filter || "").toLowerCase();
    const cards = cardsDb.cards.filter(
      (c) => c.name.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q)
    );
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
    await loadCardsDb();
    await loadWallet();
    await loadSettings();
    renderWallet();
    renderBrowse("");
    renderBest();
    bindTabs();
    bindGridClicks("walletGrid");
    bindGridClicks("browseGrid");
    bindSettings();
    bindLogout();
    bindSearch();
    el("mcpUrl").textContent = window.location.origin + "/mcp";
  }

  init();
})();
