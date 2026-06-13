import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-image-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image-upload.component.html',
})
export class ImageUploadComponent {
  @Input() currentImageUrl?: string;
  @Output() uploaded = new EventEmitter<string>();

  private http = inject(HttpClient);

  loading = false;
  error = '';

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.loading = true;
    this.error = '';

    const formData = new FormData();
    formData.append('file', file);

    this.http.post<{ url: string }>(`${environment.apiUrl}/images/upload`, formData).subscribe({
      next: (res) => {
        this.loading = false;
        this.uploaded.emit(res.url);
        input.value = '';
      },
      error: () => {
        this.loading = false;
        this.error = 'Error al subir imagen';
      },
    });
  }
}
