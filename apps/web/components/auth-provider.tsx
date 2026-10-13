"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, ApiError, type Me } from "../lib/api";
type AccountState = {
  me: Me | null;
  loading: boolean;
  error: string;
  reload: (signal?: AbortSignal) => Promise<void>;
  accept: (me: Me | null) => void;
};
const AuthContext = createContext<AccountState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const value = await api<Me>("/me", { signal });
      if (!signal?.aborted) setMe(value);
    } catch (cause) {
      if (signal?.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) setMe(null);
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Account could not be loaded.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  return (
    <AuthContext.Provider
      value={{
        me,
        loading,
        error,
        reload,
        accept: (value) => {
          setMe(value);
          setError("");
          setLoading(false);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Account provider is missing");
  return value;
}
