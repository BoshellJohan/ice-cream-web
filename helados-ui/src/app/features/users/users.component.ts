import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserAdminService } from '../../core/services/user-admin.service';
import { AppUser, CreateUserPayload, Role } from '../../core/models/user.model';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
})
export class UsersComponent implements OnInit {
  private userSvc = inject(UserAdminService);

  users: AppUser[] = [];
  loading = false;
  saving = false;
  error = '';
  showForm = false;

  form: CreateUserPayload = { name: '', email: '', role: 'STAFF', password: '' };

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.userSvc.getAll().subscribe({
      next: (u) => { this.users = u; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.form = { name: '', email: '', role: 'STAFF', password: '' };
    this.error = '';
    this.showForm = true;
  }

  save() {
    this.saving = true;
    this.error = '';
    this.userSvc.create(this.form).subscribe({
      next: () => { this.saving = false; this.showForm = false; this.load(); },
      error: (err) => { this.saving = false; this.error = err?.error?.message ?? 'Error al crear usuario'; },
    });
  }

  changeRole(user: AppUser) {
    const newRole: Role = user.role === 'ADMIN' ? 'STAFF' : 'ADMIN';
    this.userSvc.changeRole(user.id, newRole).subscribe({ next: () => this.load(), error: () => {} });
  }

  deactivate(user: AppUser) {
    this.userSvc.deactivate(user.id).subscribe({ next: () => this.load(), error: () => {} });
  }
}
