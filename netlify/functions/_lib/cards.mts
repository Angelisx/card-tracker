import cardsDb from "../../../public/data/cards-db.json" with { type: "json" };

export interface CardCategory {
  category: string;
  rate: number;
  notes?: string;
}

export interface Card {
  id: string;
  name: string;
  issuer: string;
  rewardType: string;
  rotating: boolean;
  categories: CardCategory[];
  baseRate: number;
  source?: string;
}

export function allCards(): Card[] {
  return cardsDb.cards as Card[];
}

export function allCategories(): string[] {
  return cardsDb.categories as string[];
}

export function cardById(id: string): Card | undefined {
  return allCards().find((c) => c.id === id);
}

export function rateFor(card: Card, category: string): number {
  const match = card.categories.find((c) => c.category === category);
  return match ? match.rate : card.baseRate;
}

/** Given a list of card ids (the user's wallet) plus custom cards, return the best card per category. */
export function bestCardPerCategory(cardIds: string[], customCards: Card[] = []) {
  const wallet: Card[] = [
    ...cardIds.map(cardById).filter((c): c is Card => Boolean(c)),
    ...customCards,
  ];
  const categories = allCategories();
  const result: Record<string, { card: Card; rate: number } | null> = {};
  for (const category of categories) {
    let best: { card: Card; rate: number } | null = null;
    for (const card of wallet) {
      const rate = rateFor(card, category);
      if (!best || rate > best.rate) best = { card, rate };
    }
    result[category] = best;
  }
  return result;
}
