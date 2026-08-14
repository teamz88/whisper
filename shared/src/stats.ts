/** GET /me/stats — powers the Home stats card. */
export interface UserStats {
  totalWords: number;
  totalSessions: number;
  sessionsToday: number;
  /** Mean microphone time per session, in ms. 0 when there are no sessions. */
  averageDurationMs: number;
  /** Consecutive days, ending today or yesterday, with at least one session. */
  streak: number;
}

export const EMPTY_USER_STATS: UserStats = {
  totalWords: 0,
  totalSessions: 0,
  sessionsToday: 0,
  averageDurationMs: 0,
  streak: 0,
};

/** GET /admin/stats — powers the Team section in Settings. */
export interface AdminStats {
  totalWords: number;
  sessionsThisWeek: number;
  totalUsers: number;
  activeUsers: number;
  mostActiveUser: {
    id: string;
    fullName: string | null;
    email: string;
    words: number;
  } | null;
}
