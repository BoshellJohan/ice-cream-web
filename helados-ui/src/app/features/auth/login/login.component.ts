import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';
  loading = false;

  private auth = inject(AuthService);
  private router = inject(Router);

  onSubmit() {
    this.error = '';
    this.loading = true;
    this.auth.login(this.email, this.password).subscribe({
      next: (res) => {
        this.loading = false;
        this.router.navigate(res.role === 'ADMIN' ? ['/dashboard'] : ['/orders/new']);
      },
      error: () => {
        this.loading = false;
        this.error = 'Correo o contraseña incorrectos';
      },
    });
  }
}
