import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from './lib/wagmi';
import type { ReactNode } from 'react';
import { PoolProvider } from './state/PoolContext';
import { DemoModeProvider, useDemoMode } from './state/DemoMode';
import { DemoPoolProvider } from './state/DemoPool';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Claims } from './pages/Claims';
import { ClaimDetail } from './pages/ClaimDetail';
import { FileClaim } from './pages/FileClaim';
import { Join } from './pages/Join';
import { Account } from './pages/Account';

const queryClient = new QueryClient();

/** The live pool on Base Sepolia, or the simulated one in demo mode. */
function Pool({ children }: { children: ReactNode }) {
  const { demo } = useDemoMode();
  return demo ? <DemoPoolProvider>{children}</DemoPoolProvider> : <PoolProvider>{children}</PoolProvider>;
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <DemoModeProvider>
          <Pool>
            <BrowserRouter>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Overview />} />
                  <Route path="claims" element={<Claims />} />
                  <Route path="claims/new" element={<FileClaim />} />
                  <Route path="claims/:id" element={<ClaimDetail />} />
                  <Route path="join" element={<Join />} />
                  <Route path="account" element={<Account />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </Pool>
        </DemoModeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
