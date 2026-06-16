import { ToppingType } from './topping.model';

export type ProductType = 'CONE' | 'CONTAINER' | 'BEVERAGE';
export type ProductSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'OZ4' | 'OZ5' | 'OZ6' | 'OZ7' | 'OZ8';

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  size: ProductSize | null;
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
  size?: ProductSize;
  basePrice: number;
  imageUrl?: string;
  directSale?: boolean;
  includedToppingType?: ToppingType | null;
  includedToppingQty?: number | null;
}
