/**
 * Outbound port: turn natural language + schema context into SQL. This IS the
 * provider abstraction — the default adapter talks to Claude, but any other
 * model is just a different adapter behind this interface. The application
 * never imports an LLM SDK. (DIP — docs/ARCHITECTURE.md §5.1)
 */

export interface SchemaContext {
  readonly tables: ReadonlyArray<{
    readonly name: string;
    readonly columns: string[];
  }>;
}

export interface GenerateInput {
  readonly nl: string;
  readonly schema: SchemaContext;
  /** Human-readable dialect label, e.g. "PostgreSQL". */
  readonly dialect: string;
}

export interface GeneratedSql {
  readonly sql: string;
  readonly explanation: string;
}

export interface SqlGenerator {
  generate(input: GenerateInput): Promise<GeneratedSql>;
}
