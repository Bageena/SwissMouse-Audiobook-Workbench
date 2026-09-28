// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
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
