import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import type { IntlMessages } from './types'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale
  if (!locale || !routing.locales.includes(locale as 'en' | 'ar')) {
    locale = routing.defaultLocale
  }

  const messages = (await import(`../../messages/${locale}.json`)) as {
    default: IntlMessages
  }

  return {
    locale,
    messages: messages.default,
  }
})
