import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';
import ishikaPhoto from '../../assets/PHOTO-2026-08-20-19-56-57.jpg';

const people = [
  {
    name: 'Ishika Dumeer',
    photo: ishikaPhoto,
    github: 'https://github.com/Ishika1106',
    linkedin: 'https://www.linkedin.com/in/ishika-dumeer/',
  },
  {
    name: 'Manyam Harshitha Reddy',
    photo: null,
    github: 'https://github.com/manyamharshitha',
    linkedin: 'https://www.linkedin.com/in/harshitha-manyam-9868a9379/',
  },
];

const Wrap = styled.section`
  padding: 7rem 6vw;
  background: ${({ theme }) => theme.bg};
`;

const Head = styled.div`
  max-width: 640px;
  margin: 0 auto 3rem;
  text-align: center;
`;

const LabelRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.9rem;
  margin-bottom: 1.1rem;

  .bar {
    width: 24px;
    height: 1px;
    background: ${({ theme }) => theme.rule2};
  }
`;

const Label = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
`;

const Title = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.6rem, 2.8vw, 2.15rem);
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin: 0;
  color: ${({ theme }) => theme.ink};
`;

const Grid = styled.div`
  max-width: 760px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2.5rem;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
    max-width: 340px;
  }
`;

const Card = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
`;

const Photo = styled.div`
  width: 96px;
  height: 96px;
  border-radius: 50%;
  margin-bottom: 1.2rem;
  overflow: hidden;
  background: ${({ theme }) => theme.ink};
  color: ${({ theme }) => theme.bg};
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 1.1rem;
  font-weight: 600;
  border: 1px solid ${({ theme }) => theme.rule};

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 15%;
  }
`;

const Name = styled.h3`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.2rem;
  letter-spacing: -0.01em;
  margin: 0 0 1rem;
  color: ${({ theme }) => theme.ink};
`;

const Links = styled.div`
  display: flex;
  align-items: center;
  gap: 0.9rem;
`;

const IconLink = styled.a`
  display: flex;
  color: ${({ theme }) => theme.ink2};
  transition: color 0.2s ease;

  &:hover {
    color: ${({ $brand }) => $brand || 'inherit'};
  }

  svg {
    width: 19px;
    height: 19px;
  }
`;

const initials = (name) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const GithubIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const LinkedinIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.28 2.38 4.28 5.47v6.27zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
  </svg>
);

const Creators = () => (
  <Wrap id="creators">
    <Head>
      <LabelRow>
        <span className="bar" />
        <Label>Meet the creators</Label>
        <span className="bar" />
      </LabelRow>
      <Title>Who's behind Khoj</Title>
    </Head>

    <Grid>
      {people.map((p, i) => (
        <ScrollReveal key={p.name} delay={i * 0.08}>
          <Card>
            <Photo>{p.photo ? <img src={p.photo} alt={p.name} /> : initials(p.name)}</Photo>
            <Name>{p.name}</Name>
            <Links>
              <IconLink href={p.github} target="_blank" rel="noreferrer" aria-label={`${p.name} on GitHub`}>
                <GithubIcon />
              </IconLink>
              <IconLink
                href={p.linkedin}
                target="_blank"
                rel="noreferrer"
                aria-label={`${p.name} on LinkedIn`}
                $brand="#0A66C2"
              >
                <LinkedinIcon />
              </IconLink>
            </Links>
          </Card>
        </ScrollReveal>
      ))}
    </Grid>
  </Wrap>
);

export default Creators;
