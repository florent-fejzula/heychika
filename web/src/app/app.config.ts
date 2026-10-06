import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withNavigationErrorHandler } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { reloadOnStaleChunk } from './core/app-update';
import { provideI18n } from './core/i18n';
import { I18nTitleStrategy } from './core/title';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withNavigationErrorHandler(reloadOnStaleChunk)),
    provideClientHydration(withEventReplay()),
    provideI18n(),
    { provide: TitleStrategy, useExisting: I18nTitleStrategy },
  ]
};
