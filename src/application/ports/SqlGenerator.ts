/**
 * Outbound port: turn natural language + schema context into SQL. This IS the
 * provider abstraction. Concrete provider selection and defaults belong to the
 * adapter factory; the application never imports an LLM SDK. (DIP —
 * docs/ARCHITECTURE.md §5.1)
 */

export interface SchemaContext {
  readonly tables: ReadonlyArray<{
    /** Schema-qualified when a namespace is known (e.g. "mastra.mastra_messages"),
     *  bare for schemaless sources — so a generator can emit a runnable, qualified
     *  reference instead of guessing the namespace. */
    readonly name: string;
    readonly columns: string[];
  }>;
}

export interface GenerateInput {
  readonly nl: string;
  readonly schema: SchemaContext;
  /** Human-readable dialect label, e.g. "PostgreSQL". */
  readonly dialect: string;
  /**
   * The table the user is currently viewing, qualified when a namespace is
   * known (e.g. "public.orders"). A hint, not a constraint: the model should
   * favour it when the request is ambiguous about which table, but may use any
   * table in `schema`. Absent when the user isn't on a table.
   */
  readonly focus?: string;
}

export interface GeneratedSql {
  readonly sql: string;
  readonly explanation: string;
}

export interface SqlGenerator {
  /** Generate one reviewed SQL draft. `signal` cancels the provider request;
   *  implementations must not turn cancellation into a successful result. */
  generate(input: GenerateInput, signal?: AbortSignal): Promise<GeneratedSql>;
}
