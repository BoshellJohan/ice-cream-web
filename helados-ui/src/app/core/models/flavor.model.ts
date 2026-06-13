export interface Flavor {
  id: string;
  name: string;
  priceModifier: number;
  imageUrl?: string;
  active: boolean;
}

export interface CreateFlavorPayload {
  name: string;
  priceModifier: number;
  imageUrl?: string;
}
