import React from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import WorkspacePage from '../features/workspace/WorkspacePage';

function AppShell() {
  const Router = typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? HashRouter
    : BrowserRouter;
  return (
    <Router>
      <div className="w-full min-h-screen bg-background text-foreground">
        <WorkspacePage />
      </div>
    </Router>
  );
}

export default AppShell;
