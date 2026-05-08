import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  /** Sync profile row from DB / upsert; use when MigrationNotice asks to retry */
  refreshProfile: () => Promise<void>;
  profileSyncHint: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  role: null,
  refreshProfile: async () => {},
  profileSyncHint: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileSyncHint, setProfileSyncHint] = useState<string | null>(null);

  const loadProfileForSession = useCallback(async (next: Session | null) => {
    setSession(next);
    if (!next?.user) {
      setProfile(null);
      setProfileSyncHint(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setProfileSyncHint(null);
    let p = await fetchProfile(next.user.id);
    if (!p) {
      const metaRole = next.user.user_metadata?.role;
      const role: UserRole = isUserRole(metaRole) ? metaRole : "device_operator";
      const err = await ensureProfileRow(next.user.id, role);
      if (err) {
        setProfileSyncHint(err);
      }
      p = await fetchProfile(next.user.id);
      if (!p && !err) {
        setProfileSyncHint(
          "无法读取 profiles：请确认表存在且字段 role 为 admin / device_operator / scene_operator / collection_executor"
        );
      }
    }
    setProfile(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function applySession(next: Session | null) {
      if (!mounted) return;
      await loadProfileForSession(next);
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
  }, [loadProfileForSession]);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfileForSession(data.session);
  }, [loadProfileForSession]);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      role: profile?.role ?? null,
      refreshProfile,
      profileSyncHint,
    }),
    [session, profile, loading, refreshProfile, profileSyncHint]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
