import { activeOrder, activeOrderRelation } from './order-filters';

describe('order filters', () => {
  it('adds cancelledAt: null to a direct where clause', () => {
    const range = { gte: new Date('2026-06-13'), lte: new Date('2026-06-14') };
    expect(activeOrder({ createdAt: range })).toEqual({
      createdAt: range,
      cancelledAt: null,
    });
  });

  it('works with no arguments', () => {
    expect(activeOrder()).toEqual({ cancelledAt: null });
  });

  it('preserves the existing relation filter instead of overwriting it', () => {
    const range = { gte: new Date('2026-06-13'), lte: new Date('2026-06-14') };
    expect(activeOrderRelation({ createdAt: range })).toEqual({
      order: { createdAt: range, cancelledAt: null },
    });
  });

  it('works with no arguments on the relation form', () => {
    expect(activeOrderRelation()).toEqual({ order: { cancelledAt: null } });
  });
});
