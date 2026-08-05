import { IsEnum } from 'class-validator';

export const CANCEL_REASONS = [
  'REGISTRO_ERRONEO',
  'CLIENTE_CANCELO',
  'PRODUCTO_DEFECTUOSO',
  'OTRO',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export class CancelOrderDto {
  @IsEnum(CANCEL_REASONS, { message: 'Motivo de anulación no válido' })
  reason: CancelReason;
}
