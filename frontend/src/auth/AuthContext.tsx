import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../api/supabase";
import { ensureProfileRow, fetchProfile, type Profile } from "../api/profiles";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Convenience: null if not loaded or no profile */
  role: UserRole | null;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  role: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function applySession(next: Session | null) {
      if (!mounted) return;
      setSession(next);
      if (!next?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      let p = await fetchProfile(next.user.id);
      if (!mounted) return;
      if (!p) {
        const metaRole = next.user.user_metadata?.role;
        const role: UserRole = isUserRole(metaRole) ? metaRole : "device_operator";
        await ensureProfileRow(next.user.id, role);
        p = await fetchProfile(next.user.id);
      }
      if (!mounted) return;
      setProfile(p);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      void applySession(data.session);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      role: profile?.role ?? null,
    }),
    [session, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
