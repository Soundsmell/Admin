import path from 'path'
import { fileURLToPath } from 'url'
import type { KuromojiBuilder, KuromojiTokenizer } from 'kuromoji-ko'

let tokenizerPromise: Promise<KuromojiTokenizer | null> | null = null
let lastTokenizerInitFailedAt = 0
const TOKENIZER_RETRY_MS = 60_000
const enableTokenizerDebugLog = process.env.NODE_ENV !== 'production'

function logTokenizerFallback(error?: unknown) {
  if (!enableTokenizerDebugLog) return
  if (error) {
    console.debug(
      'kuromoji-ko tokenizer init failed, fallback tokenization used.',
      error
    )
    return
  }
  console.debug(
    'kuromoji-ko tokenizer init failed, fallback tokenization used.'
  )
}

function isValidWord(word: string, pos: string) {
  if (!word) return false
  if (/^https?:\/\//i.test(word)) return false
  if (/^[0-9]+$/.test(word)) return false
  if (/^[^a-zA-Z0-9가-힣]+$/.test(word)) return false
  if (pos.startsWith('J') || pos.startsWith('E') || pos.startsWith('S')) {
    return false
  }
  return true
}

function fallbackTokenize(text: string) {
  return text
    .split(/[\s.,!?;:"'()[\]{}<>/\\|`~@#$%^&*+=_-]+/)
    .map(token => token.trim())
    .filter(token => token.length > 1)
    .map(token => token.toLowerCase())
}

function resolveKuromojiDicPath() {
  const normalizeLocalPath = (targetPath: string) => {
    const normalizedPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(targetPath)
    return normalizedPath.endsWith(path.sep)
      ? normalizedPath
      : `${normalizedPath}${path.sep}`
  }

  const fromEnv = process.env.KUROMOJI_DICT_PATH?.trim()
  if (fromEnv) {
    if (/^https?:\/\//i.test(fromEnv)) {
      return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`
    }
    if (fromEnv.startsWith('file://')) {
      return normalizeLocalPath(fileURLToPath(fromEnv))
    }
    return normalizeLocalPath(fromEnv)
  }

  const candidatePaths: string[] = []
  try {
    const mainPath = require.resolve('kuromoji-ko')
    candidatePaths.push(path.join(path.dirname(mainPath), '..', 'dict'))
    candidatePaths.push(path.join(path.dirname(mainPath), 'dict'))
  } catch {
    // try next fallback
  }

  try {
    const packageJsonPath = require.resolve('kuromoji-ko/package.json')
    candidatePaths.push(path.join(path.dirname(packageJsonPath), 'dict'))
  } catch {
    // ignored
  }

  for (const candidatePath of candidatePaths) {
    if (candidatePath && require('fs').existsSync(candidatePath)) {
      return normalizeLocalPath(candidatePath)
    }
  }

  return undefined
}

async function createKuromojiTokenizer(): Promise<KuromojiTokenizer | null> {
  try {
    const kuromoji = require('kuromoji-ko') as {
      builder(options?: { dicPath?: string }): KuromojiBuilder
    }
    if (!kuromoji.builder) return null

    const dicPath = resolveKuromojiDicPath()
    const builder = kuromoji.builder(dicPath ? { dicPath } : undefined)

    const promiseResult = builder.build()
    if (
      promiseResult &&
      typeof (promiseResult as Promise<KuromojiTokenizer>).then === 'function'
    ) {
      return (await promiseResult) ?? null
    }

    return await new Promise<KuromojiTokenizer | null>((resolve, reject) => {
      builder.build((error, tokenizer) => {
        if (error) {
          reject(error)
          return
        }
        resolve(tokenizer ?? null)
      })
    })
  } catch (error) {
    logTokenizerFallback(error)
    return null
  }
}

async function getTokenizer() {
  const now = Date.now()
  if (
    tokenizerPromise === null &&
    lastTokenizerInitFailedAt > 0 &&
    now - lastTokenizerInitFailedAt < TOKENIZER_RETRY_MS
  ) {
    return null
  }

  if (!tokenizerPromise) {
    tokenizerPromise = createKuromojiTokenizer()
      .then(tokenizer => {
        if (!tokenizer) {
          lastTokenizerInitFailedAt = Date.now()
          tokenizerPromise = null
        } else {
          lastTokenizerInitFailedAt = 0
        }
        return tokenizer
      })
      .catch(error => {
        logTokenizerFallback(error)
        lastTokenizerInitFailedAt = Date.now()
        tokenizerPromise = null
        return null
      })
  }
  return tokenizerPromise
}

export async function analyzeWords(text: string): Promise<string[]> {
  const tokenizer = await getTokenizer().catch(() => null)
  if (!tokenizer) return fallbackTokenize(text)

  try {
    const tokens = tokenizer.tokenize(text)
    const words: string[] = []

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]
      const surface = token.surface_form?.trim()
      if (!surface) continue

      const pos = token.pos ?? ''
      if (!isValidWord(surface, pos)) continue

      let word = surface.toLowerCase()
      if (
        pos.startsWith('V') &&
        i + 1 < tokens.length &&
        tokens[i + 1].pos?.startsWith('E')
      ) {
        const nextWord = tokens[i + 1].surface_form?.trim()
        if (nextWord && isValidWord(nextWord, tokens[i + 1].pos ?? '')) {
          word = (surface + nextWord).toLowerCase()
          i += 1
        }
      }

      words.push(word)
    }

    return words
  } catch (error) {
    logTokenizerFallback(error)
    return fallbackTokenize(text)
  }
}
