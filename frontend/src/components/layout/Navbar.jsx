import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import styled from 'styled-components';
import ThemeToggle from '../ui/ThemeToggle';
import Button from '../ui/Button';

const Bar = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: ${({ $scrolled }) => ($scrolled ? '0.9rem 6vw' : '1.5rem 6vw')};
  background: ${({ theme, $scrolled }) => ($scrolled ? theme.surfaceGlass : 'transparent')};
  backdrop-filter: ${({ $scrolled }) => ($scrolled ? 'blur(14px)' : 'none')};
  border-bottom: 1px solid ${({ theme, $scrolled }) => ($scrolled ? theme.rule : 'transparent')};
  transition: all 0.35s ease;
`;

const Row = styled.nav`
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1280px;
  margin: 0 auto;
`;

const Side = styled.div`
  display: flex;
  align-items: center;
  gap: 1.8rem;
  flex: 1;

  &.right {
    justify-content: flex-end;
  }

  @media (max-width: 860px) {
    .navlink {
      display: none;
    }
  }
`;

const NavA = styled.span`
  a {
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    color: ${({ theme, $scrolled }) => ($scrolled ? theme.ink2 : theme.onDark)};
    opacity: ${({ $scrolled }) => ($scrolled ? 1 : 0.9)};
    transition: color 0.3s ease, opacity 0.2s ease;
  }
  a:hover {
    opacity: 1;
    color: ${({ theme, $scrolled }) => ($scrolled ? theme.ink : '#ffffff')};
  }
  a.active {
    color: ${({ theme }) => theme.accentDeep};
  }
`;

const Logo = styled(Link)`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 1.3rem;
  letter-spacing: -0.01em;
  text-decoration: none;
  color: ${({ theme, $scrolled }) => ($scrolled ? theme.ink : theme.onDark)};
  transition: color 0.35s ease;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 1.1rem;

  @media (max-width: 520px) {
    gap: 0.6rem;
  }
`;

const Burger = styled.button`
  display: none;
  position: relative;
  width: 2.15rem;
  height: 2.15rem;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  flex: none;

  @media (max-width: 860px) {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  span {
    position: absolute;
    left: 50%;
    width: 18px;
    height: 1.6px;
    background: ${({ theme, $scrolled }) => ($scrolled ? theme.ink : theme.onDark)};
    border-radius: 2px;
    transform-origin: center;
    transition: transform 0.3s ease, opacity 0.2s ease, top 0.3s ease, background-color 0.3s ease;
  }

  span:nth-child(1) {
    top: ${({ $open }) => ($open ? '50%' : '38%')};
    transform: translate(-50%, -50%) rotate(${({ $open }) => ($open ? '45deg' : '0deg')});
  }
  span:nth-child(2) {
    top: 50%;
    transform: translate(-50%, -50%);
    opacity: ${({ $open }) => ($open ? 0 : 1)};
  }
  span:nth-child(3) {
    top: ${({ $open }) => ($open ? '50%' : '62%')};
    transform: translate(-50%, -50%) rotate(${({ $open }) => ($open ? '-45deg' : '0deg')});
  }
`;

const MobileMenu = styled(motion.div)`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 99;
  padding: 5.5rem 6vw 2rem;
  background: ${({ theme }) => theme.surface};
  border-bottom: 1px solid ${({ theme }) => theme.rule};
  display: none;

  @media (max-width: 860px) {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  a {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.3rem;
    color: ${({ theme }) => theme.ink};
    text-decoration: none;
    padding: 0.75rem 0;
    border-bottom: 1px solid ${({ theme }) => theme.rule};
  }
`;

const MobileActions = styled.div`
  display: flex;
  gap: 0.8rem;
  margin-top: 1.4rem;

  a {
    border-bottom: none;
    padding: 0;
  }
`;

const links = [
  { to: '/#how-it-works', label: 'How it works' },
  { to: '/#commitments', label: 'Why Khoj' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/#faq', label: 'FAQ' },
];

const Navbar = () => {
  const [scrolledY, setScrolledY] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const hasDarkHero = pathname === '/';
  const scrolled = scrolledY || !hasDarkHero || menuOpen;

  useEffect(() => {
    const onScroll = () => setScrolledY(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <Bar $scrolled={scrolled}>
      <Row>
        <Side>
          <Burger
            type="button"
            $open={menuOpen}
            $scrolled={scrolled}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <span />
            <span />
            <span />
          </Burger>
          <NavA className="navlink" $scrolled={scrolled}>
            <Link to="/#how-it-works">How it works</Link>
          </NavA>
          <NavA className="navlink" $scrolled={scrolled}>
            <Link to="/#commitments">Why Khoj</Link>
          </NavA>
        </Side>

        <Logo to="/" $scrolled={scrolled}>
          khoj
        </Logo>

        <Side className="right">
          <NavA className="navlink" $scrolled={scrolled}>
            <NavLink to="/pricing">Pricing</NavLink>
          </NavA>
          <NavA className="navlink" $scrolled={scrolled}>
            <Link to="/#faq">FAQ</Link>
          </NavA>
          <Actions>
            <ThemeToggle onDark={!scrolled} />
            {pathname !== '/login' && (
              <NavA className="navlink" $scrolled={scrolled}>
                <Link to="/login">Log in</Link>
              </NavA>
            )}
            {pathname !== '/signup' && (
              <Button
                as={Link}
                to="/signup"
                size="sm"
                arrow={false}
                variant={scrolled ? 'dark' : 'outlineLight'}
                className="navlink"
              >
                Start free
              </Button>
            )}
          </Actions>
        </Side>
      </Row>

      <AnimatePresence>
        {menuOpen && (
          <MobileMenu
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {links.map((l) => (
              <Link key={l.label} to={l.to}>
                {l.label}
              </Link>
            ))}
            <MobileActions>
              {pathname !== '/login' && (
                <Button as={Link} to="/login" size="sm" variant="ghost" arrow={false}>
                  Log in
                </Button>
              )}
              {pathname !== '/signup' && (
                <Button as={Link} to="/signup" size="sm" arrow={false}>
                  Start free
                </Button>
              )}
            </MobileActions>
          </MobileMenu>
        )}
      </AnimatePresence>
    </Bar>
  );
};

export default Navbar;
