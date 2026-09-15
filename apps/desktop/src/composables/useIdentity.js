import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity'

export function useIdentity() {
  const store = useIdentityStore()
  const { status, user, isAuthenticated, displayName, subject, loading, error } = storeToRefs(store)
  return {
    status, user, isAuthenticated, displayName, subject, loading, error,
    load: store.load,
    signIn: store.signIn,
    signInOrSwitch: store.signInOrSwitch,
    switchAccount: store.switchAccount,
    signOut: store.signOut,
  }
}
