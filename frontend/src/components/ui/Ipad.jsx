import styled from 'styled-components';

const PAD_WIDTH = 820;
const PAD_HEIGHT = 1180;
const BEZEL = 26;
const SCREEN_RADIUS = 28;
const CORNER_RADIUS = 46;
const CAMERA_R = 5;

const SCREEN_X = BEZEL;
const SCREEN_Y = BEZEL;
const SCREEN_WIDTH = PAD_WIDTH - BEZEL * 2;
const SCREEN_HEIGHT = PAD_HEIGHT - BEZEL * 2;

const LEFT_PCT = (SCREEN_X / PAD_WIDTH) * 100;
const TOP_PCT = (SCREEN_Y / PAD_HEIGHT) * 100;
const WIDTH_PCT = (SCREEN_WIDTH / PAD_WIDTH) * 100;
const HEIGHT_PCT = (SCREEN_HEIGHT / PAD_HEIGHT) * 100;
const RADIUS_H = (SCREEN_RADIUS / SCREEN_WIDTH) * 100;
const RADIUS_V = (SCREEN_RADIUS / SCREEN_HEIGHT) * 100;

const Frame = styled.div`
  position: relative;
  display: inline-block;
  width: 100%;
  aspect-ratio: ${PAD_WIDTH} / ${PAD_HEIGHT};
  vertical-align: middle;
  color: ${({ theme }) => theme.ink};
`;

const ScreenContent = styled.div`
  position: absolute;
  z-index: 1;
  overflow: hidden;
  left: ${LEFT_PCT}%;
  top: ${TOP_PCT}%;
  width: ${WIDTH_PCT}%;
  height: ${HEIGHT_PCT}%;
  border-radius: ${RADIUS_H}% / ${RADIUS_V}%;
  background: ${({ theme }) => theme.surface};
  line-height: normal;
`;

const Chrome = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`;

const PowerButton = styled.span`
  position: absolute;
  z-index: 3;
  top: -1.5%;
  right: 13%;
  height: 1.3%;
  width: 9%;
  min-height: 3px;
  border-radius: 3px 3px 1px 1px;
  background: linear-gradient(180deg, ${({ theme }) => theme.rule2}, ${({ theme }) => theme.rule});
  box-shadow: 0 -1.5px 3px rgba(0, 0, 0, 0.35), inset 0 0.5px 0 rgba(255, 255, 255, 0.1);
`;

/** The iPad device frame, empty by default — pass children to fill the screen with real content instead of a screenshot. The top button is decorative chrome only. */
const Ipad = ({ children, className, style, ...props }) => (
  <Frame className={className} style={style} {...props}>
    {children && <ScreenContent>{children}</ScreenContent>}
    <Chrome viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="0"
        y="0"
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        rx={CORNER_RADIUS}
        fill="currentColor"
        opacity="0.14"
      />
      <rect
        x="4"
        y="4"
        width={PAD_WIDTH - 8}
        height={PAD_HEIGHT - 8}
        rx={CORNER_RADIUS - 4}
        fill="currentColor"
        opacity="0.08"
      />
      <rect
        x={SCREEN_X}
        y={SCREEN_Y}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        rx={SCREEN_RADIUS}
        fill="currentColor"
        opacity="0.14"
      />
      <circle cx={PAD_WIDTH / 2} cy={BEZEL / 2} r={CAMERA_R} fill="currentColor" opacity="0.55" />
    </Chrome>
    <PowerButton aria-hidden="true" />
  </Frame>
);

export default Ipad;
