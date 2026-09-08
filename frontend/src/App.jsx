import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import Pricing from './pages/Pricing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import VerifyVisit from './pages/VerifyVisit';

const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
};

const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];
// No navbar, no footer. /verify is opened by a broker from an SMS, on a phone,
// with no Khoj account — every piece of app chrome on that page is a thing to
// tap by mistake instead of the one button that matters.
const CHROMELESS_ROUTES = ['/dashboard'];
const CHROMELESS_PREFIXES = ['/verify/'];

function App() {
  const { pathname } = useLocation();
  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const isChromeless =
    CHROMELESS_ROUTES.includes(pathname) ||
    CHROMELESS_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  return (
    <>
      <ScrollToTop />
      {!isChromeless && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/verify/:token" element={<VerifyVisit />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
      {!isAuthRoute && !isChromeless && <Footer />}
    </>
  );
}

export default App;
