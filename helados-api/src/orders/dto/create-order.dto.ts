import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemToppingDto {
  @IsUUID()
  toppingId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderItemDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  flavorId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemToppingDto)
  toppings: CreateOrderItemToppingDto[];
}

export class CreateOrderDto {
  @IsEnum(['QR', 'CASH'])
  paymentMethod: 'QR' | 'CASH';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
