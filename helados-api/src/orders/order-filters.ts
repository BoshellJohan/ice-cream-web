/**
 * Un pedido "activo" es el que no ha sido anulado.
 * Estos helpers existen para que la condición viva en un solo lugar:
 * si se olvida en una consulta, los pedidos anulados vuelven a contar
 * en las analíticas y en la conciliación de caja.
 */

/** Para consultas sobre Order directamente. */
export function activeOrder(where: Record<string, unknown> = {}) {
  return { ...where, cancelledAt: null };
}

/** Para consultas que llegan a Order a través de la relación `order`. */
export function activeOrderRelation(orderWhere: Record<string, unknown> = {}) {
  return { order: { ...orderWhere, cancelledAt: null } };
}
