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
