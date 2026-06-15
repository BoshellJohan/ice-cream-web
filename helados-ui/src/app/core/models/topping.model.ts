export type ToppingType = 'NORMAL' | 'PREMIUM';

export interface ToppingTypeConfig {
  type: ToppingType;
  unitPrice: number;
}

export interface Topping {
  id: string;
  name: string;
  type: ToppingType;
  customPrice: number | null;
  unitPrice: number;
  imageUrl?: string;
  active: boolean;
}

export interface CreateToppingPayload {
  name: string;
  type?: ToppingType;
  customPrice?: number | null;
  imageUrl?: string;
}

export interface UpdateToppingPayload {
  name?: string;
  type?: ToppingType;
  customPrice?: number | null;
  imageUrl?: string;
  active?: boolean;
}
