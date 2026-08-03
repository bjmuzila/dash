// DEAD — superseded by ./RealMonth.tsx.
//
// The original version of this tab committed parsed statement rows into
// budget_register, which double-counted every transaction that was also in the
// plan. Statement data now lives in its own budget_statement_tx table and is
// rendered by RealMonth.tsx. Nothing imports this file; delete it.
export {};
