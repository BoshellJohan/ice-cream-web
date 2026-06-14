import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.component.html',
})
export class AppComponent {
  auth   = inject(AuthService);
  router = inject(Router);

  get showNav(): boolean {
    return this.auth.isLoggedIn() && !this.router.url.startsWith('/login');
  }

  get userName(): string {
    return localStorage.getItem('name') ?? '';
  }
}
