// Sitzung im Backoffice: GET /auth/v1/session. 401 heißt „nicht angemeldet“ (kein Fehler).
import { useQuery } from "@tanstack/react-query";
import { ApiError, request, type CurrentSession } from "./api.js";

export const sessionKey = ["session"] as const;

export async function fetchSession(): Promise<CurrentSession | null> {
  try {
    const s = await request<CurrentSession>("/auth/v1/session");
    // Zweiter Faktor noch offen: Die Sitzung gilt noch nirgends.
    return s.secondFactor === "required" ? null : s;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: fetchSession, staleTime: 60_000 });
}
