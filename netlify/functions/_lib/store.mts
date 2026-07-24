import { getStore } from "@netlify/blobs";

export function walletStore() {
  return getStore("card-tracker-wallet");
}

const WALLET_KEY = "wallet";
const SETTINGS_KEY = "settings";

export interface WalletData {
  cardIds: string[];
  customCards: any[];
  updatedAt: string;
}

export interface SettingsData {
  webhookUrl: string | null;
  updatedAt: string;
}

export async function getWallet(): Promise<WalletData> {
  const store = walletStore();
  const data = await store.get(WALLET_KEY, { type: "json" });
  return data || { cardIds: [], customCards: [], updatedAt: new Date(0).toISOString() };
}

export async function setWallet(data: Omit<WalletData, "updatedAt">): Promise<WalletData> {
  const store = walletStore();
  const full: WalletData = { ...data, updatedAt: new Date().toISOString() };
  await store.setJSON(WALLET_KEY, full);
  return full;
}

export async function getSettings(): Promise<SettingsData> {
  const store = walletStore();
  const data = await store.get(SETTINGS_KEY, { type: "json" });
  return data || { webhookUrl: null, updatedAt: new Date(0).toISOString() };
}

export async function setSettings(webhookUrl: string | null): Promise<SettingsData> {
  const store = walletStore();
  const full: SettingsData = { webhookUrl, updatedAt: new Date().toISOString() };
  await store.setJSON(SETTINGS_KEY, full);
  return full;
}

export async function fireWebhook(wallet: WalletData) {
  try {
    const settings = await getSettings();
    if (!settings.webhookUrl) return;
    await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "wallet.updated", wallet }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("webhook delivery failed", err);
  }
}
