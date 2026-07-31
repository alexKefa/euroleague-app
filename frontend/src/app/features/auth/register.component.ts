import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  selector: "app-register",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: "./register.component.html",
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(8)]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();
    this.auth.register(email, password).subscribe({
      next: () => this.router.navigateByUrl("/"),
      error: (err) => {
        this.error.set(
          err?.status === 409 ? "An account with that email already exists." : "Something went wrong."
        );
        this.submitting.set(false);
      },
    });
  }
}