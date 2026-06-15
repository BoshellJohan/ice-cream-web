import { ToppingType } from './topping.model';

export type ProductType = 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL' | 'DRINK';
export type ProductSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  size: ProductSize;
  basePrice: number;
  imageUrl?: string;
  active: boolean;
  directSale: boolean;
  includedToppingType?: ToppingType | null;
  includedToppingQty?: number | null;
  createdAt: string;
}

export interface CreateProductPayload {
  name: string;
  type: ProductType;
  size: ProductSize;
  basePrice: number;
  imageUrl?: string;
  directSale?: boolean;
  includedToppingType?: ToppingType | null;
  includedToppingQty?: number | null;
}
