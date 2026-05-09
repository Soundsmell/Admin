declare module 'kuromoji-ko' {
  export type KuromojiToken = {
    surface_form?: string
    pos?: string
  }

  export type KuromojiTokenizer = {
    tokenize(text: string): KuromojiToken[]
  }

  export type KuromojiBuilder = {
    build(
      callback?: (error: Error | null, tokenizer: KuromojiTokenizer) => void
    ): Promise<KuromojiTokenizer> | void
  }

  export function builder(options?: { dicPath?: string }): KuromojiBuilder
}
