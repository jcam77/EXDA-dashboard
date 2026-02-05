import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import Dashboard from './pages/Dashboard';

function App() {
  return (
    <BrowserRouter>
      <div className="w-full min-h-screen bg-background text-foreground">
        <Dashboard />
      </div>
    </BrowserRouter>
  );
}

export default App;