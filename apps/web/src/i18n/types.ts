import type enMessages from '../../messages/en.json'

type AppMessages = typeof enMessages

declare module 'use-intl' {
  interface AppConfig {
    Messages: AppMessages
  }
}

export type IntlMessages = AppMessages

export type TranslationKey = {
  [K in keyof IntlMessages]: IntlMessages[K] extends Record<string, unknown>
    ? `${K & string}.${keyof IntlMessages[K] & string}`
    : K
}[keyof IntlMessages]