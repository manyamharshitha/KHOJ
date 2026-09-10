import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
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

/**
 * Keeps a lost WebGL context from taking the page down with it.
 *
 * The browser drops a context when the GPU is under pressure, the driver
 * resets, or too many contexts are alive at once — and this globe sits on the
 * sign-in pages, where it shares a screen with an OAuth popup. Left unhandled
 * the canvas goes black and three.js keeps drawing into a dead context.
 *
 * ``preventDefault()`` is the load-bearing line. Without it the browser treats
 * the loss as final and never fires ``webglcontextrestored``, so the canvas
 * cannot come back even when the GPU is free again. It is the difference
 * between a blink and a permanent hole in the page.
 */
function ContextGuard({ onLost, onRestored }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return undefined;

    const handleLost = (event) => {
      event.preventDefault();
      onLost();
    };

    canvas.addEventListener('webglcontextlost', handleLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [gl, onLost, onRestored]);

  return null;
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

const Globe = () => {
  const [lost, setLost] = useState(false);

  const handleLost = useCallback(() => setLost(true), []);
  const handleRestored = useCallback(() => setLost(false), []);

  return (
    <div style={{ width: '100%', aspectRatio: '1', maxWidth: 720, position: 'relative' }}>
      {/* The Canvas is never unmounted on loss. Tearing it down would destroy
          the very context the browser is trying to hand back, turning a
          recoverable blink into a permanent blank. The placeholder is layered
          over it instead. */}
      <Canvas
        // 'default' rather than 'high-performance'. Asking for the discrete GPU
        // on a hybrid-graphics laptop provokes a switch, and that switch is
        // itself one of the commonest causes of the context loss this component
        // was losing its context to. A slowly rotating globe does not need it.
        gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
        // Capped below 2. The cost of a pixel ratio is quadratic, and at dpr 2
        // this canvas allocates four times the framebuffer of dpr 1 to draw a
        // decorative sphere.
        dpr={[1, 1.5]}
        camera={{ fov: 45, near: 0.1, far: 1000, position: [0, 0, RADIUS * 2.7] }}
        style={{ background: 'transparent' }}
      >
        <ContextGuard onLost={handleLost} onRestored={handleRestored} />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      {/* Something round and on-brand, rather than a black rectangle. This is
          decoration on a sign-in page: it must never be the reason somebody
          cannot read the form beside it. */}
      {lost && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 35% 30%, rgba(127,176,232,0.35), rgba(18,17,15,0.12) 70%)',
          }}
        />
      )}
    </div>
  );
};

export default Globe;
