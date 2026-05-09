declare module 'mecab-ya' {
  type MecabRow = string[]

  class MeCab {
    parse(
      text: string,
      callback: (err: Error | null, result: MecabRow[]) => void
    ): void
  }

  export = MeCab
}
