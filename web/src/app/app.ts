import { Component, afterNextRender, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppUpdate } from './core/app-update';
import { UpdateBanner } from './shared/update-banner';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UpdateBanner],
  templateUrl: './app.html',
})
export class App {
  constructor() {
    const update = inject(AppUpdate);
    afterNextRender(() => update.start());
  }
}
