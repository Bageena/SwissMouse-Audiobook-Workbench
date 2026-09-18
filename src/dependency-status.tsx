import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { RequirementsReport } from './types';
import { missingDependencies, missingRequirementsTooltip } from '../tools/feature-dependencies';
import type { FeatureId } from '../tools/feature-dependencies';

type FeatureAvailability = { ready: boolean; missing: ReturnType<typeof missingDependencies>; tooltip?: string };
type DependencyContextValue = {
  report: RequirementsReport | null;
  refresh: (force?: boolean) => Promise<void>;
  feature: (...features: FeatureId[]) => FeatureAvailability;
};

const DependencyContext = createContext<DependencyContextValue | null>(null);

export const DependencyStatusProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [report, setReport] = useState<RequirementsReport | null>(null);
  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetch(`/api/requirements/status${force ? '?refresh=true' : ''}`);
      if (response.ok) setReport(await response.json());
    } catch (error) {
      console.error('Could not refresh dependency status:', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const changed = () => void refresh(true);
    window.addEventListener('requirements-changed', changed);
    return () => window.removeEventListener('requirements-changed', changed);
  }, [refresh]);

  const value = useMemo<DependencyContextValue>(() => ({
    report,
    refresh,
    feature: (...features) => {
      if (!report) return { ready: false, missing: [], tooltip: 'Checking requirements…' };
      const missing = report ? missingDependencies(report.components, features) : [];
      return { ready: report !== null && missing.length === 0, missing, tooltip: missingRequirementsTooltip(missing) };
    },
  }), [report, refresh]);

  return <DependencyContext.Provider value={value}>{children}</DependencyContext.Provider>;
};

export function useDependencyStatus(): DependencyContextValue {
  const value = useContext(DependencyContext);
  if (!value) throw new Error('useDependencyStatus must be used inside DependencyStatusProvider');
  return value;
}
