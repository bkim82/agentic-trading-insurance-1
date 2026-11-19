import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PoolProvider } from './state/PoolContext';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Claims } from './pages/Claims';
import { ClaimDetail } from './pages/ClaimDetail';
import { FileClaim } from './pages/FileClaim';
import { Join } from './pages/Join';
import { Account } from './pages/Account';

export default function App() {
  return (
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
  );
}
