import styled from 'styled-components';

const PHONE_WIDTH = 433;
const PHONE_HEIGHT = 882;
const SCREEN_X = 21.25;
const SCREEN_Y = 19.25;
const SCREEN_WIDTH = 389.5;
const SCREEN_HEIGHT = 843.5;
const SCREEN_RADIUS = 55.75;

const LEFT_PCT = (SCREEN_X / PHONE_WIDTH) * 100;
const TOP_PCT = (SCREEN_Y / PHONE_HEIGHT) * 100;
const WIDTH_PCT = (SCREEN_WIDTH / PHONE_WIDTH) * 100;
const HEIGHT_PCT = (SCREEN_HEIGHT / PHONE_HEIGHT) * 100;
const RADIUS_H = (SCREEN_RADIUS / SCREEN_WIDTH) * 100;
const RADIUS_V = (SCREEN_RADIUS / SCREEN_HEIGHT) * 100;

const Frame = styled.div`
  position: relative;
  display: inline-block;
  width: 100%;
  aspect-ratio: ${PHONE_WIDTH} / ${PHONE_HEIGHT};
  vertical-align: middle;
  line-height: 0;
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
  transform: translateZ(0);
`;

const PowerButton = styled.span`
  position: absolute;
  z-index: 3;
  right: -2.1%;
  top: 20.5%;
  width: 1.7%;
  height: 8.5%;
  min-width: 3px;
  border-radius: 1px 3px 3px 1px;
  background: linear-gradient(90deg, ${({ theme }) => theme.rule}, ${({ theme }) => theme.rule2});
  box-shadow: 1.5px 0 3px rgba(0, 0, 0, 0.35), inset -0.5px 0 0 rgba(255, 255, 255, 0.1);
`;

/** The iPhone device frame, empty by default — pass children to fill the screen with real content instead of a screenshot. The side button is decorative chrome only. */
const Iphone = ({ children, className, style, ...props }) => (
  <Frame className={className} style={style} {...props}>
    {children && <ScreenContent>{children}</ScreenContent>}
    <Chrome viewBox={`0 0 ${PHONE_WIDTH} ${PHONE_HEIGHT}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 73C2 32.6832 34.6832 0 75 0H357C397.317 0 430 32.6832 430 73V809C430 849.317 397.317 882 357 882H75C34.6832 882 2 849.317 2 809V73Z"
        fill="currentColor"
        opacity="0.14"
      />
      <path
        d="M6 74C6 35.3401 37.3401 4 76 4H356C394.66 4 426 35.3401 426 74V808C426 846.66 394.66 878 356 878H76C37.3401 878 6 846.66 6 808V74Z"
        fill="currentColor"
        opacity="0.08"
      />
      <path
        d={`M${SCREEN_X} 75C${SCREEN_X} 44.2101 46.2101 ${SCREEN_Y} 77 ${SCREEN_Y}H355C385.79 ${SCREEN_Y} 410.75 44.2101 410.75 75V807C410.75 837.79 385.79 862.75 355 862.75H77C46.2101 862.75 ${SCREEN_X} 837.79 ${SCREEN_X} 807V75Z`}
        fill="currentColor"
        opacity="0.14"
      />
      <path
        d="M154 48.5C154 38.2827 162.283 30 172.5 30H259.5C269.717 30 278 38.2827 278 48.5C278 58.7173 269.717 67 259.5 67H172.5C162.283 67 154 58.7173 154 48.5Z"
        fill="currentColor"
        opacity="0.55"
      />
    </Chrome>
    <PowerButton aria-hidden="true" />
  </Frame>
);

export default Iphone;
