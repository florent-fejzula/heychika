import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';

interface ScannerControls {
  stop(): void;
}

/** The same sticker seen again within this long is the camera reading it twice, not a second item. */
const REPEAT_MS = 1500;

/**
 * Reads a sticker three ways, like the Scan page: a USB/Bluetooth scanner (which
 * types the code and presses Enter), the phone camera, or typing. Emits each code.
 *
 * The camera keeps going after a read, so a pile of items can be scanned one after
 * another without tapping.
 */
@Component({
  selector: 'app-scanner',
  template: `
    <form class="entry" (submit)="$event.preventDefault(); submit()">
      <label class="field grow">
        <span>{{ label() }}</span>
        <input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" #entry
               [placeholder]="placeholder()" [value]="code()" (input)="code.set($any($event.target).value)" />
      </label>
      <button class="btn" type="submit" [disabled]="!code().trim()">Add</button>
    </form>

    <div class="camera" [hidden]="!cameraOn()">
      <video #video playsinline muted></video>
      <div class="aim" aria-hidden="true"></div>
    </div>
    @if (cameraOn()) {
      <button class="btn btn-small" type="button" (click)="stopCamera()">Stop camera</button>
    } @else {
      <button class="btn btn-small" type="button" (click)="startCamera()">Scan with the camera</button>
    }
    @if (cameraError(); as message) {
      <p class="notice notice-error">{{ message }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }

    .entry {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      align-self: stretch;
    }

    .grow {
      flex: 1;
    }

    .notice {
      margin: 0;
    }

    .camera {
      position: relative;
      align-self: stretch;
      border-radius: var(--radius);
      overflow: hidden;
      background: #000;
      aspect-ratio: 16 / 9;

      video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    }

    .aim {
      position: absolute;
      inset: 25% 10%;
      border: 2px solid rgba(255, 255, 255, 0.85);
      border-radius: 8px;
      box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.35);
    }
  `,
})
export class Scanner {
  readonly label = input('Scan a sticker, or type a SKU');
  readonly placeholder = input('DR-001-BLK-M');
  readonly scanned = output<string>();

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly entry = viewChild<ElementRef<HTMLInputElement>>('entry');
  private controls: ScannerControls | null = null;
  private last = { code: '', at: 0 };

  protected readonly code = signal('');
  protected readonly cameraOn = signal(false);
  protected readonly cameraError = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopCamera());
    afterNextRender(() => this.focus());
  }

  protected submit(): void {
    const code = this.code().trim();
    if (!code) return;
    this.code.set('');
    this.scanned.emit(code);
    this.focus();
  }

  protected async startCamera(): Promise<void> {
    this.cameraError.set(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set('This browser can’t use the camera here. Camera scanning needs a secure (https) page.');
      return;
    }
    this.cameraOn.set(true);
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.QR_CODE]);
      const reader = new BrowserMultiFormatReader(hints);
      const element = this.video()?.nativeElement;
      if (!element) throw new Error('no video element');

      this.controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, element, (scan) => {
        if (!scan) return;
        const code = scan.getText();
        const now = Date.now();
        if (code === this.last.code && now - this.last.at < REPEAT_MS) return;
        this.last = { code, at: now };
        navigator.vibrate?.(60);
        this.scanned.emit(code);
      });
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

  // Ready for the next scan without a tap; skipped on touch screens, where it would raise the keyboard.
  private focus(): void {
    if (window.matchMedia?.('(pointer: fine)').matches) this.entry()?.nativeElement.focus();
  }
}
