import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "../api/supabase";
import { ensureProfileRow, fetchProfile, type Profile } from "../api/profiles";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  role: UserRole | null;
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

function isSilentAuthEvent(event: AuthChangeEvent, userId: string | null): boolean {
  if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return true;
  if (event === "INITIAL_SESSION" && userId) return true;
  return false;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileSyncHint, setProfileSyncHint] = useState<string | null>(null);
  const profileUserIdRef = useRef<string | null>(null);

  const loadProfileForSession = useCallback(
    async (next: Session | null, event?: AuthChangeEvent, options?: { force?: boolean }) => {
      setSession(next);

      if (!next?.user) {
        profileUserIdRef.current = null;
        setProfile(null);
        setProfileSyncHint(null);
        setLoading(false);
        return;
      }

      const uid = next.user.id;
      const silent = !options?.force && isSilentAuthEvent(event ?? "INITIAL_SESSION", profileUserIdRef.current);

      if (silent && profileUserIdRef.current === uid) {
        setLoading(false);
        return;
      }

      const showBoot = profileUserIdRef.current !== uid;
      if (showBoot) setLoading(true);
      setProfileSyncHint(null);

      let p = await fetchProfile(uid);
      if (!p) {
        const metaRole = next.user.user_metadata?.role;
        const role: UserRole = isUserRole(metaRole) ? metaRole : "device_operator";
        const err = await ensureProfileRow(uid, role);
        if (err) setProfileSyncHint(err);
        p = await fetchProfile(uid);
        if (!p && !err) {
          setProfileSyncHint(
            "无法读取 profiles：请确认表存在且字段 role 为 admin / device_operator / scene_operator / collection_executor"
          );
        }
      }

      profileUserIdRef.current = uid;
      setProfile(p);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      void loadProfileForSession(nextSession, event);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [loadProfileForSession]);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfileForSession(data.session, undefined, { force: true });
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
