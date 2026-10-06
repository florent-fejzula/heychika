import { inject, provideEnvironmentInitializer } from '@angular/core';
import { TranslocoService, provideTransloco } from '@jsverse/transloco';
import en from './i18n/en.json';

// Every test runs in English, loaded up front, so specs can look for the words
// on screen. (angular.json points the test runner here.)
export default [
  provideTransloco({
    config: { availableLangs: ['en', 'sq'], defaultLang: 'en', missingHandler: { logMissingKey: false } },
  }),
  provideEnvironmentInitializer(() => inject(TranslocoService).setTranslation(en, 'en')),
];
