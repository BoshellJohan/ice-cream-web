export interface DailyRevenue {
  date: string;
  total: number;
  count: number;
}

export interface SummaryData {
  totalRevenue: number;
  totalOrders: number;
  ordersWithCoupon: number;
  dailyRevenue: DailyRevenue[];
}

export interface TopFlavor {
  name: string;
  count: number;
}

export interface TopTopping {
  name: string;
  quantity: number;
}

export interface TopItemsData {
  topFlavors: TopFlavor[];
  topToppings: TopTopping[];
}

export interface DailyData {
  orders:       number;
  items:        number;
  totalRevenue: number;
  cashRevenue:  number;
  qrRevenue:    number;
}

export interface ReconciliationData {
  actualCash: number;
  actualQr:   number;
  updatedAt:  string;
}

export interface ReconciliationSummaryData {
  daysReconciled: number;
  daysInRange:    number;
  systemCash:  number;
  systemQr:    number;
  systemTotal: number;
  actualCash:  number;
  actualQr:    number;
  actualTotal: number;
}
