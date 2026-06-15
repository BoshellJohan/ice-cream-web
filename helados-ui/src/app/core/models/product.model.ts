export type ProductType = 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL';
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
  createdAt: string;
}

export interface CreateProductPayload {
  name: string;
  type: ProductType;
  size: ProductSize;
  basePrice: number;
  imageUrl?: string;
  directSale?: boolean;
}
