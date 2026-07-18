import type enMessages from '../../messages/en.json'

type AppMessages = typeof enMessages

declare module 'use-intl' {
  interface AppConfig {
    Messages: AppMessages
  }
}

export type IntlMessages = AppMessages

type LeafTranslationKey<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? LeafTranslationKey<T[K], `${Prefix}${K}.`>
      : never
}[keyof T & string]

export type TranslationKey = LeafTranslationKey<IntlMessages>
