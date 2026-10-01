import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Catalogue, ScanResult } from '../../core/catalogue';
import { formatMoney } from '../../core/money';

interface ScannerControls {
  stop(): void;
}

// Looks up an item by its sticker. Works three ways, all landing in the same place:
//  - a USB or Bluetooth scanner, which "types" the code and presses Enter,
//  - the phone camera,
//  - typing the SKU by hand.
@Component({
  selector: 'app-scan',
  imports: [RouterLink],
  templateUrl: './scan.html',
  styleUrl: './scan.scss',
})
export class Scan {
  private readonly catalogue = inject(Catalogue);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly entry = viewChild<ElementRef<HTMLInputElement>>('entry');
  private controls: ScannerControls | null = null;

  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly cameraOn = signal(false);
  protected readonly cameraError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<ScanResult | null>(null);
  protected readonly notFound = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopCamera());
    afterNextRender(() => this.focusEntry());
  }

  protected async lookup(raw: string): Promise<void> {
    const code = raw.trim();
    if (!code || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    this.notFound.set(null);
    try {
      const found = await this.catalogue.findVariant(code);
      this.result.set(found);
      if (!found) this.notFound.set(code);
      this.code.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
      this.focusEntry();
    }
  }

  protected async startCamera(): Promise<void> {
    this.cameraError.set(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set('This browser can’t use the camera here. Camera scanning needs a secure (https) page.');
      return;
    }

    this.cameraOn.set(true);
    try {
      // Loaded on demand: the scanner library is large and most visits don't need it.
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.QR_CODE]);
      const reader = new BrowserMultiFormatReader(hints);
      const element = this.video()?.nativeElement;
      if (!element) throw new Error('no video element');

      this.controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        element,
        (scan) => {
          if (!scan) return;
          // One good read is enough: stop the camera and show what it found.
          this.stopCamera();
          void this.lookup(scan.getText());
        },
      );
    } catch (e) {
      this.stopCamera();
      const denied = (e as DOMException)?.name === 'NotAllowedError';
      this.cameraError.set(
        denied
          ? 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.'
          : 'Couldn’t start the camera.',
      );
    }
  }

  protected stopCamera(): void {
    this.controls?.stop();
    this.controls = null;
    this.cameraOn.set(false);
  }

  // Ready for the next scan without a tap. Skipped on touch screens, where focusing
  // would raise the keyboard over the camera button.
  private focusEntry(): void {
    if (window.matchMedia?.('(pointer: fine)').matches) this.entry()?.nativeElement.focus();
  }

  protected money(amount: number): string {
    return formatMoney(Number(amount), 'EUR');
  }
}
