import jsonData from './languageMatching.json'
import {regions} from './regions.generated'
export const UNICODE_EXTENSION_SEQUENCE_REGEX = /-u(?:-[0-9a-z]{2,8})+/gi

export function invariant(
  condition: boolean,
  message: string,
  Err: any = Error
): asserts condition {
  if (!condition) {
    throw new Err(message)
  }
}

// This is effectively 2 languages in 2 different regions not even in the same cluster
const DEFAULT_MATCHING_THRESHOLD = 840

interface LSR {
  language: string
  script: string
  region: string
}

interface LanguageMatchInfo {
  supported: string
  desired: string
  distance: number
  oneway: boolean
}

interface LanguageInfo {
  matches: LanguageMatchInfo[]
  matchVariables: Record<string, string[]>
  paradigmLocales: string[]
}

let PROCESSED_DATA: LanguageInfo | undefined

function processData(): LanguageInfo {
  if (!PROCESSED_DATA) {
    const paradigmLocales = jsonData.supplemental.languageMatching[
      'written-new'
    ][0]?.paradigmLocales?._locales.split(' ') as any
    const matchVariables = jsonData.supplemental.languageMatching[
      'written-new'
    ].slice(1, 5) as any[]
    const data = jsonData.supplemental.languageMatching['written-new'].slice(5)
    const matches = data.map(d => {
      const key = Object.keys(d)[0] as string
      const value = d[key as 'no'] as {
        _desired: string
        _distance: string
        oneway?: string
      }
      return {
        supported: key,
        desired: value._desired,
        distance: +value._distance,
        oneway: value.oneway === 'true' ? true : false,
      }
    }, {})
    PROCESSED_DATA = {
      matches,
      matchVariables: matchVariables.reduce<Record<string, string[]>>(
        (all, d) => {
          const key = Object.keys(d)[0] as string
          const value = d[key]
          all[key.slice(1)] = value._value.split('+')
          return all
        },
        {}
      ),
      paradigmLocales: [
        ...paradigmLocales,
        ...paradigmLocales.map((l: string) =>
          new Intl.Locale(l.replace(/_/g, '-')).maximize().toString()
        ),
      ],
    }
  }

  return PROCESSED_DATA
}

function isMatched(
  locale: LSR,
  languageMatchInfoLocale: string,
  matchVariables: Record<string, string[]>
): boolean {
  const [language, script, region] = languageMatchInfoLocale.split('-')
  let matches = true
  if (region && region[0] === '$') {
    const shouldInclude = region[1] !== '!'
    const matchRegions = shouldInclude
      ? matchVariables[region.slice(1)]
      : matchVariables[region.slice(2)]
    const expandedMatchedRegions = matchRegions.flatMap(r => regions[r] || r)
    matches &&= !(
      expandedMatchedRegions.includes(locale.region || '') != shouldInclude
    )
  } else {
    matches &&= locale.region
      ? region === '*' || region === locale.region
      : true
  }
  matches &&= locale.script ? script === '*' || script === locale.script : true
  matches &&= locale.language
    ? language === '*' || language === locale.language
    : true
  return matches
}

function serializeLSR(lsr: LSR): string {
  return [lsr.language, lsr.script, lsr.region].filter(Boolean).join('-')
}

function findMatchingDistanceForLSR(
  desired: LSR,
  supported: LSR,
  data: LanguageInfo
): number {
  for (const d of data.matches) {
    let matches =
      isMatched(desired, d.desired, data.matchVariables) &&
      isMatched(supported, d.supported, data.matchVariables)
    if (!d.oneway && !matches) {
      matches =
        isMatched(desired, d.supported, data.matchVariables) &&
        isMatched(supported, d.desired, data.matchVariables)
    }
    if (matches) {
      const distance = d.distance * 10
      if (
        data.paradigmLocales.includes(serializeLSR(desired)) !=
        data.paradigmLocales.includes(serializeLSR(supported))
      ) {
        return distance - 1
      }
      return distance
    }
  }
  throw new Error('No matching distance found')
}

export function findMatchingDistance(desired: string, supported: string) {
  const desiredLocale = new Intl.Locale(desired).maximize()
  const supportedLocale = new Intl.Locale(supported).maximize()
  const desiredLSR: LSR = {
    language: desiredLocale.language,
    script: desiredLocale.script || '',
    region: desiredLocale.region || '',
  }
  const supportedLSR: LSR = {
    language: supportedLocale.language,
    script: supportedLocale.script || '',
    region: supportedLocale.region || '',
  }
  let matchingDistance = 0

  const data = processData()

  if (desiredLSR.language !== supportedLSR.language) {
    matchingDistance += findMatchingDistanceForLSR(
      {
        language: desiredLocale.language,
        script: '',
        region: '',
      },
      {
        language: supportedLocale.language,
        script: '',
        region: '',
      },
      data
    )
  }

  if (desiredLSR.script !== supportedLSR.script) {
    matchingDistance += findMatchingDistanceForLSR(
      {
        language: desiredLocale.language,
        script: desiredLSR.script,
        region: '',
      },
      {
        language: supportedLocale.language,
        script: desiredLSR.script,
        region: '',
      },
      data
    )
  }

  if (desiredLSR.region !== supportedLSR.region) {
    matchingDistance += findMatchingDistanceForLSR(
      desiredLSR,
      supportedLSR,
      data
    )
  }

  return matchingDistance
}

export function findBestMatch(
  desired: string,
  supportedLocales: readonly string[],
  threshold = DEFAULT_MATCHING_THRESHOLD
): string | undefined {
  let bestMatch = undefined
  let lowestDistance = Infinity
  supportedLocales.forEach((supported, i) => {
    // Add some weight to the distance based on the order of the supported locales
    const distance = findMatchingDistance(desired, supported) + i
    if (distance < lowestDistance) {
      lowestDistance = distance
      bestMatch = supported
    }
  })

  if (lowestDistance >= threshold) {
    return
  }

  return bestMatch
}
