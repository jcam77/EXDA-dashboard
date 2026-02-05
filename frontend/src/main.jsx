import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

/* global __APP_VERSION__ */
// IMPORTANT: This looks for a <div> with id="root" in your index.html
const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("FATAL ERROR: Could not find 'root' element in index.html");
  document.body.innerHTML = '<div style="color:red; padding:20px;">Error: Missing root element in index.html</div>';
} else {
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
  document.title = appVersion ? `EXDA Dashboard ${appVersion}` : 'EXDA Dashboard';

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
