import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "employee" | "hr" | "admin" | "group_head";

type AuthState = {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  rolesLoading: boolean;
  rolesInitialized: boolean;
  isAuthenticated: boolean;
  isHR: boolean;
  isAdmin: boolean;
  isGroupHead: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesInitialized, setRolesInitialized] = useState(false);
  // Ref so the onAuthStateChange closure can read the live value without re-subscribing
  const rolesInitializedRef = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);

      if (event === 'SIGNED_OUT') {
        setRoles([]);
        setRolesLoading(false);
        return;
      }

      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && s?.user) {
        // Only show the loading indicator during the very first role fetch.
        // On subsequent tab-refocus SIGNED_IN events the roles are already known,
        // so we silently refresh them in the background without flipping rolesLoading.
        if (!rolesInitializedRef.current) setRolesLoading(true);
        setTimeout(() => {
          supabase.from("user_roles").select("role").eq("user_id", s.user.id)
            .then(({ data }) => {
              setRoles((data ?? []).map((r) => r.role as AppRole));
              setRolesLoading(false);
              rolesInitializedRef.current = true;
              setRolesInitialized(true);
            });
        }, 0);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setRolesLoading(true);
        supabase.from("user_roles").select("role").eq("user_id", s.user.id)
          .then(({ data }) => {
            setRoles((data ?? []).map((r) => r.role as AppRole));
            setRolesLoading(false);
            rolesInitializedRef.current = true;
            setRolesInitialized(true);
          });
      } else {
        setRolesLoading(false);
        rolesInitializedRef.current = true;
        setRolesInitialized(true);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn: AuthState["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp: AuthState["signUp"] = async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName },
      },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  const value: AuthState = {
    user, session, roles, loading, rolesLoading, rolesInitialized,
    isAuthenticated: !!user,
    isHR: roles.includes("hr") || roles.includes("admin"),
    isAdmin: roles.includes("admin"),
    isGroupHead: roles.includes("group_head"),
    signIn, signUp, signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
