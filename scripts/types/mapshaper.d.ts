/** Minimal typdeklaration för mapshaper (paketet saknar egna typer). Endast det API som används i scripts/lib/geo.ts. */
declare module 'mapshaper' {
  const mapshaper: {
    applyCommands(commands: string, input: Record<string, string | Buffer>): Promise<Record<string, string | Buffer>>;
  };
  export default mapshaper;
}
