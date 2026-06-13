export interface Topping {
  id: string;
  name: string;
  unitPrice: number;
  imageUrl?: string;
  active: boolean;
}

export interface CreateToppingPayload {
  name: string;
  unitPrice: number;
  imageUrl?: string;
}
