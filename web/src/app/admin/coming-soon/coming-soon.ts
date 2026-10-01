import { Component, input } from '@angular/core';

// Stands in for screens that aren't built yet, so the admin's shape is visible
// from day one. Filled from the route's data (see app.routes.ts).
@Component({
  selector: 'app-coming-soon',
  template: `
    <div class="stack">
      <h1>{{ heading() }}</h1>
      <section class="card stack">
        <p>{{ blurb() }}</p>
        <p class="muted">Coming in phase {{ phase() }} of the build.</p>
      </section>
    </div>
  `,
  styles: `
    p {
      margin: 0;
    }
  `,
})
export class ComingSoon {
  readonly heading = input.required<string>();
  readonly blurb = input.required<string>();
  readonly phase = input.required<number>();
}
