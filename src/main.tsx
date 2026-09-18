import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DependencyStatusProvider } from './dependency-status';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DependencyStatusProvider><App /></DependencyStatusProvider>
  </React.StrictMode>,
);
