import "server-only";

/**
 * Thrown by K1 when PostgreSQL reports a deadlock (40P01) or serialization failure (40001).
 * Carries no driver types or messages. Never retried automatically; K2 maps it to 409 `conflict` (D-36).
 */
export class TransactionConflict extends Error {
  readonly kind = "transaction_conflict" as const;

  constructor() {
    super("transaction conflict");
    this.name = "TransactionConflict";
  }
}
