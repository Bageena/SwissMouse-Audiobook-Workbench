import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DependencyStatusProvider } from './dependency-status';
import { applyTheme, getStoredTheme } from './theme';
import './index.css';

applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DependencyStatusProvider><App /></DependencyStatusProvider>
  </React.StrictMode>,
);
