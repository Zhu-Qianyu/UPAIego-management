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
import {
  hasAnyRole,
  hasRole,
  normalizeRoles,
  resolveActiveRole,
  writeStoredActiveRole,
} from "./roleUtils";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** 主职（兼容） */
  role: UserRole | null;
  roles: UserRole[];
  activeRole: UserRole | null;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (allow: readonly UserRole[]) => boolean;
  setActiveRole: (role: UserRole) => void;
  refreshProfile: () => Promise<void>;
  profileSyncHint: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  role: null,
  roles: [],
  activeRole: null,
  hasRole: () => false,
  hasAnyRole: () => false,
  setActiveRole: () => {},
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
  const [activeRole, setActiveRoleState] = useState<UserRole | null>(null);
  const profileUserIdRef = useRef<string | null>(null);

  const loadProfileForSession = useCallback(
    async (next: Session | null, event?: AuthChangeEvent, options?: { force?: boolean }) => {
      setSession(next);

      if (!next?.user) {
        profileUserIdRef.current = null;
        setProfile(null);
        setActiveRoleState(null);
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
        const meta = next.user.user_metadata ?? {};
        const metaRoles = Array.isArray(meta.roles) ? meta.roles : null;
        const metaRole = meta.role;
        const roles = normalizeRoles(
          metaRoles,
          isUserRole(metaRole) ? metaRole : "device_operator"
        );
        const err = await ensureProfileRow(uid, roles, {
          realName: typeof meta.real_name === "string" ? meta.real_name : undefined,
          phone: typeof meta.phone === "string" ? meta.phone : undefined,
          contactEmail: typeof meta.contact_email === "string" ? meta.contact_email : undefined,
        });
        if (err) setProfileSyncHint(err);
        p = await fetchProfile(uid);
        if (!p && !err) {
          setProfileSyncHint(
            "无法读取 profiles：请确认生产数据库已初始化且当前账号有 profile 行"
          );
        }
      }

      profileUserIdRef.current = uid;
      setProfile(p);
      if (p) {
        const nextActive = resolveActiveRole(p.roles);
        setActiveRoleState(nextActive);
        writeStoredActiveRole(nextActive);
      } else {
        setActiveRoleState(null);
      }
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

  const setActiveRole = useCallback(
    (role: UserRole) => {
      if (!profile || !hasRole(profile.roles, role)) return;
      setActiveRoleState(role);
      writeStoredActiveRole(role);
    },
    [profile]
  );

  const roles = profile?.roles ?? [];
  const role = profile?.role ?? null;

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      role,
      roles,
      activeRole: activeRole ?? (profile ? resolveActiveRole(profile.roles) : null),
      hasRole: (r: UserRole) => hasRole(roles, r),
      hasAnyRole: (allow: readonly UserRole[]) => hasAnyRole(roles, allow),
      setActiveRole,
      refreshProfile,
      profileSyncHint,
    }),
    [session, profile, loading, role, roles, activeRole, setActiveRole, refreshProfile, profileSyncHint]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
