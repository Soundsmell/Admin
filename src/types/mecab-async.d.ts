declare module 'mecab-async' {
  type MecabRow = string[]

  interface MecabParser {
    parse(
      text: string,
      callback: (err: Error | null, result: MecabRow[]) => void
    ): void
  }

  const MecabExport:
    | MecabParser
    | { new (): MecabParser }
    | { default: MecabParser }
  export = MecabExport
}
