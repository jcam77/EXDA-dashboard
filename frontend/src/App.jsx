import React from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import Dashboard from './pages/Dashboard';

function App() {
  const Router = typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? HashRouter
    : BrowserRouter;
  return (
    <Router>
      <div className="w-full min-h-screen bg-background text-foreground">
        <Dashboard />
      </div>
    </Router>
  );
}

export default App;
