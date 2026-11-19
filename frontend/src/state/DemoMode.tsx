import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface DemoMode {
  demo: boolean;
  enter: () => void;
  exit: () => void;
}

const DemoModeContext = createContext<DemoMode>({ demo: false, enter: () => {}, exit: () => {} });
const KEY = 'cover-demo';

/** Whether the app runs on the simulated pool (no wallet, nothing on-chain). Opens with ?demo or the "Try demo" button. */
export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState(
    () => new URLSearchParams(window.location.search).has('demo') || sessionStorage.getItem(KEY) === '1',
  );
  const enter = useCallback(() => {
    sessionStorage.setItem(KEY, '1');
    setDemo(true);
  }, []);
  const exit = useCallback(() => {
    sessionStorage.removeItem(KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState(null, '', url);
    setDemo(false);
  }, []);
  const value = useMemo(() => ({ demo, enter, exit }), [demo, enter, exit]);
  return <DemoModeContext.Provider value={value}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode(): DemoMode {
  return useContext(DemoModeContext);
}
