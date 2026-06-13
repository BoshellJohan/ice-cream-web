export type Role = 'STAFF' | 'ADMIN';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  role: Role;
  password: string;
}
