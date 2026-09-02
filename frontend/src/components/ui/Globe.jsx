import { useEffect, useMemo, useRef, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';

const EARTH_TEXTURE = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
const BUMP_TEXTURE = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png';

const RADIUS = 2;

const MARKERS = [
  { lat: 19.076, lng: 72.8777 },
  { lat: 28.6139, lng: 77.209 },
  { lat: 12.9716, lng: 77.5946 },
  { lat: 17.385, lng: 78.4867 },
  { lat: 40.7128, lng: -74.006 },
  { lat: 51.5072, lng: -0.1276 },
  { lat: 1.3521, lng: 103.8198 },
  { lat: 25.2048, lng: 55.2708 },
  { lat: -33.8688, lng: 151.2093 },
  { lat: 37.7749, lng: -122.4194 },
];

function latLngToVector3(lat, lng, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function Marker({ lat, lng }) {
  const position = useMemo(() => latLngToVector3(lat, lng, RADIUS * 1.01), [lat, lng]);
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.028, 12, 12]} />
      <meshBasicMaterial color="#8fc0ec" />
    </mesh>
  );
}

function RotatingGlobe() {
  const groupRef = useRef(null);
  const [earthTexture, bumpTexture] = useTexture([EARTH_TEXTURE, BUMP_TEXTURE]);

  useEffect(() => {
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = 16;
    bumpTexture.anisotropy = 8;
  }, [earthTexture, bumpTexture]);

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[RADIUS, 64, 64]} />
        <meshStandardMaterial
          map={earthTexture}
          bumpMap={bumpTexture}
          bumpScale={0.065}
          roughness={0.55}
          metalness={0.08}
        />
      </mesh>
      {MARKERS.map((m) => (
        <Marker key={`${m.lat}-${m.lng}`} lat={m.lat} lng={m.lng} />
      ))}
    </group>
  );
}

function Scene() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0, RADIUS * 2.7);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[RADIUS * 5, RADIUS * 2, RADIUS * 5]} intensity={1.75} color="#fff6e8" />
      <directionalLight position={[-RADIUS * 3, RADIUS, -RADIUS * 2]} intensity={0.3} color="#7fb0e8" />
      <pointLight position={[0, 0, RADIUS * 3]} intensity={0.4} color="#ffffff" />
      <RotatingGlobe />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        rotateSpeed={0.4}
        autoRotate
        autoRotateSpeed={0.6}
        enableDamping
        dampingFactor={0.1}
      />
    </>
  );
}

const Globe = () => (
  <div style={{ width: '100%', aspectRatio: '1', maxWidth: 720 }}>
    <Canvas
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
      camera={{ fov: 45, near: 0.1, far: 1000, position: [0, 0, RADIUS * 2.7] }}
      style={{ background: 'transparent' }}
    >
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  </div>
);

export default Globe;
