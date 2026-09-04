/**
 * Back-compat aliases for the account deletion flow.
 *
 * `accountDeletionBridge.ts` owns the single implementation; these re-exports
 * keep the original un-suffixed names working for existing consumers.
 */
export { deleteCurrentUserAccountBridge as deleteCurrentUserAccount } from './accountDeletionBridge'

export type {
  AccountDeletionBridgeHooks as AccountDeletionHooks,
  DeleteAccountBridgeInput as DeleteAccountInput,
} from './accountDeletionBridge'
