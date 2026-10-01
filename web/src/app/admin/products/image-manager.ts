import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Catalogue, ImageRow } from '../../core/catalogue';

export interface ColourOption {
  id: number;
  name: string;
}

@Component({
  selector: 'app-image-manager',
  templateUrl: './image-manager.html',
  styleUrl: './image-manager.scss',
})
export class ImageManager {
  private readonly catalogue = inject(Catalogue);

  readonly productId = input.required<number>();
  /** Colours this design comes in, so a photo can be tagged with the colour it shows. */
  readonly colours = input.required<ColourOption[]>();

  protected readonly images = signal<ImageRow[]>([]);
  protected readonly loaded = signal(false);
  protected readonly progress = signal<string | null>(null);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  constructor() {
    effect(() => {
      const id = this.productId();
      untracked(() => this.reload(id));
    });
  }

  protected url(image: ImageRow): string {
    return this.catalogue.imageUrl(image.storage_path, true);
  }

  protected async upload(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    input.value = ''; // lets the same photo be picked again later
    if (!files.length) return;

    this.message.set(null);
    let order = Math.max(0, ...this.images().map((i) => i.sort_order)) + 1;
    const failures: string[] = [];

    for (const [index, file] of files.entries()) {
      this.progress.set(files.length > 1 ? `Uploading photo ${index + 1} of ${files.length}…` : 'Uploading…');
      try {
        await this.catalogue.uploadImage(this.productId(), file, order++);
      } catch (e) {
        failures.push((e as Error).message);
      }
    }

    this.progress.set(null);
    await this.reload(this.productId());
    if (failures.length) {
      this.message.set({ kind: 'error', text: failures.join(' ') });
    }
  }

  protected async makeCover(image: ImageRow): Promise<void> {
    await this.act(() => this.catalogue.setCover(image.id));
  }

  protected async move(image: ImageRow, by: -1 | 1): Promise<void> {
    const list = [...this.images()];
    const from = list.findIndex((i) => i.id === image.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    this.images.set(list); // show it immediately; the save below makes it permanent
    await this.act(() =>
      this.catalogue.reorderImages(
        this.productId(),
        list.map((i) => i.id),
      ),
    );
  }

  protected async tag(image: ImageRow, value: string): Promise<void> {
    const colourId = value ? Number(value) : null;
    await this.act(() => this.catalogue.setImageColour(image.id, colourId));
  }

  protected async remove(image: ImageRow): Promise<void> {
    if (!confirm('Delete this photo?')) return;
    await this.act(() => this.catalogue.deleteImage(image));
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.message.set(null);
    try {
      await action();
    } catch (e) {
      this.message.set({ kind: 'error', text: (e as Error).message });
    }
    await this.reload(this.productId());
  }

  private async reload(id: number): Promise<void> {
    try {
      this.images.set(await this.catalogue.listImages(id));
    } catch (e) {
      this.message.set({ kind: 'error', text: (e as Error).message });
    } finally {
      this.loaded.set(true);
    }
  }
}
