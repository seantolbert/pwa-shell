import type { ReactNode } from 'react';

/**
 * Route layout placeholder for /notes.
 * Eventually will provide motion transitions, shared toolbars, and offline
 * messaging specific to the Notes experience.
 */
const NotesLayout = ({ children }: { children: ReactNode }) => {
  return <section className="min-h-screen">{children}</section>;
};

export default NotesLayout;
