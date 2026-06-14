export type SnapshotPeriod = 'MORNING' | 'NIGHT';

export interface InventoryLine {
  id: string;
  flavorId: string | null;
  flavor: { id: string; name: string } | null;
  toppingId: string | null;
  topping: { id: string; name: string } | null;
  quantity: number;
}

export interface InventorySnapshot {
  id: string;
  takenBy: string;
  user: { id: string; name: string };
  takenAt: string;
  period: SnapshotPeriod;
  notes: string | null;
  lines: InventoryLine[];
}

export interface SnapshotPair {
  morning: InventorySnapshot | null;
  night: InventorySnapshot | null;
}

export interface InventoryLinePayload {
  flavorId?: string;
  toppingId?: string;
  quantity: number;
}

export interface CreateSnapshotPayload {
  period: SnapshotPeriod;
  date: string;
  lines: InventoryLinePayload[];
  notes?: string;
}

export interface DeltaLine {
  label: string;
  morning: number;
  night: number;
  consumed: number; // morning - night (positive = consumed, negative = restocked)
}
