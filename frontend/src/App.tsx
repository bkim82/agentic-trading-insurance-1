import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from './lib/wagmi';
import { PoolProvider } from './state/PoolContext';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Claims } from './pages/Claims';
import { ClaimDetail } from './pages/ClaimDetail';
import { FileClaim } from './pages/FileClaim';
import { Join } from './pages/Join';
import { Account } from './pages/Account';

const queryClient = new QueryClient();

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <PoolProvider>
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
        </PoolProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
