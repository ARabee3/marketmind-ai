import type enMessages from '../../messages/en.json'

export type IntlMessages = typeof enMessages

export type TranslationKey = {
  [K in keyof IntlMessages]: IntlMessages[K] extends Record<string, unknown>
    ? `${K & string}.${keyof IntlMessages[K] & string}`
    : K
}[keyof IntlMessages]
