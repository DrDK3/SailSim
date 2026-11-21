import { createContext, useContext, type ReactNode } from 'react';

/**
 * The player view and the instructor view (review #14, package D). The honesty labels (where a figure comes from, its
 * evidence level, the exercises' thresholds, the assist record) are shown where they apply in the instructor view.
 * In the player view they are gathered in About ("How far to trust this"), reached by one link: moved, not deleted.
 */
export interface TrustView {
  /** Settings → Instructor view. */
  instructor: boolean;
  /** Open About at "How far to trust this". */
  openTrust: () => void;
}

export const TrustContext = createContext<TrustView>({ instructor: false, openTrust: () => {} });

export const useTrust = (): TrustView => useContext(TrustContext);

/**
 * An honesty label (provenance, an estimate's tag, a threshold): shown where it applies in the instructor view; in
 * the player view it is listed in About instead (src/ui/About.tsx keeps the same statements).
 */
export function TrustNote({ children, className = 'fine', testId }: { children: ReactNode; className?: string; testId?: string }) {
  const { instructor } = useTrust();
  if (!instructor) return null;
  return (
    <p className={`${className} trust-note`} data-testid={testId ?? 'trust-note'}>
      {children}
    </p>
  );
}

/** Content shown only in the instructor view (a table, a block of tools), without the note's paragraph. */
export function InstructorOnly({ children }: { children: ReactNode }) {
  return useTrust().instructor ? <>{children}</> : null;
}

/** The player view's one link to the labels: "How far to trust this" (About). Nothing in the instructor view. */
export function TrustLink() {
  const { instructor, openTrust } = useTrust();
  if (instructor) return null;
  return (
    <button className="link trust-link" onClick={openTrust} data-testid="trust-link">
      How far to trust this
    </button>
  );
}
