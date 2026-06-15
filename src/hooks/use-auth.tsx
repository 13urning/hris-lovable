import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { fetchUserData, provisionUser } from "@/lib/user-functions";

type AppRole = "employee" | "hr" | "admin" | "group_head";

// AppUser wraps Firebase's User and adds our internal UUID + convenience alias.
// Exposing `id` (= our DB UUID) keeps every existing component that reads
// `user.id` working without changes.
export type AppUser = {
  id: string; // Internal UUID from public.users table
  uid: string; // Firebase UID (same as firebaseUser.uid)
  email: string | null;
  fullName: string | null; // Display name from profiles.full_name
  firebaseUser: FirebaseUser;
};

type AuthState = {
  user: AppUser | null;
  session: null; // Kept for interface compatibility — Firebase has no session object
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
  const [user, setUser] = useState<AppUser | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesInitialized, setRolesInitialized] = useState(false);
  const rolesInitializedRef = useRef(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setRoles([]);
        setLoading(false);
        setRolesLoading(false);
        rolesInitializedRef.current = true;
        setRolesInitialized(true);
        return;
      }

      if (!rolesInitializedRef.current) setRolesLoading(true);

      try {
        let data = await fetchUserData();

        if (!data) {
          // First login after signup — provision DB records (firebaseUid + email
          // come from the verified ID token on the server)
          const userId = await provisionUser({ data: {} });
          data = {
            profile: {
              id: userId,
              full_name: firebaseUser.email?.split("@")[0] ?? "",
              email: firebaseUser.email ?? "",
              employee_code: null,
              department: "General",
              position: null,
              must_change_password: false,
            },
            roles: ["employee"],
          };
        }

        setUser({
          id: data.profile.id,
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          fullName: data.profile.full_name,
          firebaseUser,
        });
        setRoles(data.roles as AppRole[]);
      } catch (e) {
        console.error("[useAuth] Failed to load user data:", e);
      } finally {
        setRolesLoading(false);
        rolesInitializedRef.current = true;
        setRolesInitialized(true);
        setLoading(false);
      }
    });
  }, []);

  const signIn: AuthState["signIn"] = async (email, password) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return { error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      // Normalise Firebase error messages to be user-friendly
      const msg: Record<string, string> = {
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/user-not-found": "No account with that email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
      };
      return { error: (err.code && msg[err.code]) || err.message || "Sign in failed." };
    }
  };

  const signUp: AuthState["signUp"] = async (email, password, fullName) => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      await provisionUser({ data: { fullName } });
      return { error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const msg: Record<string, string> = {
        "auth/email-already-in-use": "An account with that email already exists.",
        "auth/weak-password": "Password must be at least 6 characters.",
      };
      return { error: (err.code && msg[err.code]) || err.message || "Sign up failed." };
    }
  };

  const signOut = async () => {
    await fbSignOut(auth);
  };

  const value: AuthState = {
    user,
    session: null,
    roles,
    loading,
    rolesLoading,
    rolesInitialized,
    isAuthenticated: !!user,
    isHR: roles.includes("hr") || roles.includes("admin"),
    isAdmin: roles.includes("admin"),
    isGroupHead: roles.includes("group_head"),
    signIn,
    signUp,
    signOut,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
