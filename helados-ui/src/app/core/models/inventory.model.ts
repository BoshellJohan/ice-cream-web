export type SnapshotPeriod = 'MORNING' | 'NIGHT';

export interface InventoryLine {
  id: string;
  productType: string | null;
  productSize: string | null;
  productId: string | null;
  product: { id: string; name: string; type: string } | null;
  label: string | null;
  quantity: number;
  soldSince?: number;
  remaining?: number;
}

export interface InventoryEdit {
  id: string;
  editedBy: string;
  user: { id: string; name: string };
  editedAt: string;
  reason: string | null;
}

export interface InventorySnapshot {
  id: string;
  takenBy: string;
  user: { id: string; name: string };
  takenAt: string;
  period: SnapshotPeriod;
  notes: string | null;
  lines: InventoryLine[];
  edits: InventoryEdit[];
}

export interface InventorySnapshotSummary {
  id: string;
  takenBy: string;
  user: { id: string; name: string };
  takenAt: string;
  period: SnapshotPeriod;
  notes: string | null;
  lines: { id: string }[];
  edits: { id: string }[];
}

export interface SnapshotPair {
  morning: InventorySnapshot | null;
  night:   InventorySnapshot | null;
}

export interface InventoryLinePayload {
  productType?: string;
  productSize?: string;
  productId?: string;
  label?: string;
  quantity: number;
}

export interface CreateSnapshotPayload {
  period: SnapshotPeriod;
  date: string;
  lines: InventoryLinePayload[];
  notes?: string;
}

export interface UpdateSnapshotPayload {
  lines: InventoryLinePayload[];
  notes?: string;
  reason?: string;
}
