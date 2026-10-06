/**
 * Where an already-burned authorization nonce is recorded.
 *
 * === WHY THIS IS AN INTERFACE ========================================
 * `OkxPaymentAdapter` held `private spentNonces = new Set<string>()`. A
 * `Set` is not a place: a restart empties it and a second replica never
 * had it, so the same signed authorization bought an audit again after
 * either event (R-40). The guard was right; only its storage was wrong.
 *
 * The interface is declared in the package that consumes it and
 * implemented in `apps/api`, the same split as `PaymentAdapter` itself.
 * This package must not learn what a database is: it is also loaded by
 * `packages/mcp-server`, which has no database and does not need one.
 * =====================================================================
 */

/**
 * A single-use record of authorization nonces.
 *
 * The contract is one atomic test-and-set: `burn(key)` returns `true` exactly
 * once, for the first caller, and `false` for every caller after it —
 * including callers in other processes sharing the same backing store.
 * Implementing it as `SELECT` then `INSERT` is a race, not an
 * implementation detail; the implementations in this repository let the
 * insert itself be the comparison and report whether it happened.
 *
 * **A throw is not `false`.** `false` means "this authorization was already
 * spent" and is permanent; a throw means "I could not answer" and is an
 * outage. Callers must not collapse the two — see the note at the burn site
 * in `okx-adapter.ts`.
 */
export interface NonceStore {
  /**
   * Claim `key`. Returns `true` if this call is the first to claim it,
   * `false` if an earlier call already did.
   */
  burn(key: string): Promise<boolean>;
}

/**
 * The default: a `Set` in this process — the behaviour the adapter had
 * before this interface existed.
 *
 * It is the default because it is **correct** for a caller that has no
 * database and no second replica, and there is one: `packages/mcp-server`.
 * That package calls `verifyPayment` only in `PAYMENT_MODE=mock`, where it
 * auto-verifies its own `mock:<id>` header so an agent gets a synchronous
 * result, and the mock path never reaches a nonce. Wiring a database into
 * that process would be wiring one for a code path it cannot take.
 *
 * The API is the opposite case and passes a durable store
 * (`apps/api/src/repositories/nonce-repository.ts`). If you are adding a
 * caller that can restart, or that can run more than one replica, you want
 * that one, not this one.
 */
export class InMemoryNonceStore implements NonceStore {
  private readonly burned = new Set<string>();

  async burn(key: string): Promise<boolean> {
    // No `await` between the read and the write, so this is atomic with
    // respect to the event loop. That is the whole reason a `Set` is
    // sufficient here.
    if (this.burned.has(key)) return false;
    this.burned.add(key);
    return true;
  }
}
