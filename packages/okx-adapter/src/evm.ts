/**
 * The two EVM primitives the adapters share.
 *
 * Both used to be written twice: `toAtomic` in `mock-adapter.ts` and
 * `okx-adapter.ts`, and the address shape in `factory.ts` (`isEvmAddress`)
 * and `okx-adapter.ts` (`isAddressLike`). Two copies of one regex is how
 * one copy silently stops agreeing with the other.
 *
 * Not re-exported from `index.ts` — nothing outside this package needs
 * either, and the public surface should not grow for a private helper.
 */

/** `0x` + 40 hex digits. The prefix is literal; the digits are not case-sensitive. */
export function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

/** Decimal string → atomic units. `('1.5', 6)` is `'1500000'`. */
export function toAtomic(amount: string, decimals: number): string {
  const [intPart, fracPart = ''] = amount.split('.');
  const padded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return `${intPart ?? '0'}${padded}`.replace(/^0+(?=\d)/, '') || '0';
}
