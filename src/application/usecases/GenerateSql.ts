/**
 * Use case: generate SQL from natural language, then classify it. Pure
 * orchestration over the SqlGenerator port — it returns the SQL, the model's
 * explanation, and a read/write/DDL classification so the UI can require review
 * (and warn loudly) before anything runs. It NEVER executes. (§5.2)
 */

import type {
  SqlGenerator,
  GenerateInput,
} from '../ports/SqlGenerator.ts';
import {
  classifyStatement,
  type StatementKind,
} from '../../domain/query/classify.ts';
import { ok, err, type Result } from '../../shared/Result.ts';

export interface GeneratedQuery {
  readonly sql: string;
  readonly explanation: string;
  readonly kind: StatementKind;
}

export const generateSql = async (
  generator: SqlGenerator,
  input: GenerateInput,
): Promise<Result<GeneratedQuery, Error>> => {
  try {
    const out = await generator.generate(input);
    return ok({
      sql: out.sql.trim(),
      explanation: out.explanation,
      kind: classifyStatement(out.sql),
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
