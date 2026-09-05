import { useEffect, useRef, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';

const EARTH_TEXTURE = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
const BUMP_TEXTURE = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png';

const RADIUS = 2;

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
