import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  PerspectiveCamera,
  shaderMaterial,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver } from "@mediapipe/tasks-vision";

// --- 动态生成照片列表 (1.jpg 到 8.jpg + top.jpg) ---
const baseUrl = import.meta.env.BASE_URL;
const TOTAL_NUMBERED_PHOTOS = 8;
const bodyPhotoPaths = [
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `${baseUrl}photos/${i + 1}.jpg`),
  `${baseUrl}photos/top.jpg`
];

// --- Cyberpunk Config ---
const CONFIG = {
  colors: {
    bg: '#050505',
    neonCyan: '#00F3FF',
    neonGreen: '#00FF41',
    neonPink: '#FF00FF',
    neonYellow: '#FAFF00',
    white: '#FFFFFF',
    glitchColors: ['#00F3FF', '#FF00FF', '#FAFF00', '#00FF41'],
    dataBorders: ['#050505', '#00F3FF', '#FF00FF', '#FAFF00'],
  },
  counts: {
    foliage: 18000,   // Increased for more density
    ornaments: 300,   // Data Logs
    elements: 250,    // Data Fragments
    lights: 400       // Data Nodes
  },
  tree: { height: 22, radius: 9 },
  photos: {
    body: bodyPhotoPaths
  }
};

// --- Shader Material (Data Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.neonCyan), uProgress: 0, uChaosSpeed: 1.0 },
  `uniform float uTime; uniform float uProgress; uniform float uChaosSpeed; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    float timeScale = uProgress < 0.5 ? 3.0 * uChaosSpeed : 1.5;
    vec3 noise = vec3(sin(uTime * timeScale + position.x), cos(uTime * timeScale + position.y), sin(uTime * timeScale + position.z)) * (uProgress < 0.5 ? 0.8 : 0.15);
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (65.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(vec3(0.0, 1.0, 0.25), uColor, vMix); // Mix with electric green
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h / 2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Data Foliage ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = spherePoints[i * 3]; positions[i * 3 + 1] = spherePoints[i * 3 + 1]; positions[i * 3 + 2] = spherePoints[i * 3 + 2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i * 3] = tx; targetPositions[i * 3 + 1] = ty; targetPositions[i * 3 + 2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
      materialRef.current.uChaosSpeed = state === 'CHAOS' ? 2.5 : 1.0;
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Data Logs (Holographic Photos) ---
const DataLogs = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.dataBorders[Math.floor(Math.random() * CONFIG.colors.dataBorders.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 2.0,
        y: (Math.random() - 0.5) * 2.0,
        z: (Math.random() - 0.5) * 2.0
      };
      const chaosRotation = new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 1.5)); // Faster Chaos
      group.position.copy(objData.currentPos);

      if (isFormed) {
        const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
        group.lookAt(targetLookPos);
        group.rotation.x += Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
      } else {
        group.rotation.x += delta * objData.rotationSpeed.x * 2;
        group.rotation.y += delta * objData.rotationSpeed.y * 2;
        group.rotation.z += delta * objData.rotationSpeed.z * 2;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.scale, obj.scale, obj.scale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0, 0, 0]}>
          <mesh geometry={photoGeometry} position={[0, 0, 0.01]}>
            <meshStandardMaterial
              map={textures[obj.textureIndex]}
              emissive={CONFIG.colors.neonCyan} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={0.5}
              transparent opacity={0.9}
            />
          </mesh>
          <mesh geometry={borderGeometry} position={[0, -0.15, 0]}>
            <meshStandardMaterial color={obj.borderColor} roughness={0.1} metalness={1.0} wireframe={i % 5 === 0} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// --- Component: Data Fragments (Tech Shapes) ---
const DataFragments = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const icosahedronGeo = useMemo(() => new THREE.IcosahedronGeometry(0.5, 0), []);
  const octahedronGeo = useMemo(() => new THREE.OctahedronGeometry(0.6, 0), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.random() > 0.5 ? 0 : 1;
      const color = Math.random() > 0.5 ? CONFIG.colors.neonPink : CONFIG.colors.neonYellow;
      const scale = 0.5 + Math.random() * 0.7;
      const rotationSpeed = { x: (Math.random() - 0.5) * 3.0, y: (Math.random() - 0.5) * 3.0, z: (Math.random() - 0.5) * 3.0 };

      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), rotationSpeed, wireframe: Math.random() > 0.7 };
    });
  }, [count]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * (isFormed ? 1.5 : 2.5));
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x;
      mesh.rotation.y += delta * objData.rotationSpeed.y;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <mesh
          key={i}
          geometry={obj.type === 0 ? icosahedronGeo : octahedronGeo}
          scale={[obj.scale, obj.scale, obj.scale]}
        >
          <meshStandardMaterial
            color={obj.color}
            emissive={obj.color}
            emissiveIntensity={2}
            wireframe={obj.wireframe}
            roughness={0}
            metalness={1}
          />
        </mesh>
      ))}
    </group>
  );
};

// --- Component: Main Data Node (Top Element) ---
const DataNode = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);
  const geo = useMemo(() => new THREE.OctahedronGeometry(1.5, 0), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.neonCyan,
    emissive: CONFIG.colors.neonCyan,
    emissiveIntensity: 5.0,
    wireframe: true
  }), []);

  useFrame((stateObj, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 2;
      groupRef.current.rotation.z += delta * 1;
      const scale = (state === 'FORMED' ? 1 : 0) * (1 + Math.sin(stateObj.clock.elapsedTime * 5) * 0.2);
      groupRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), delta * 3);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 2, 0]}>
      <mesh geometry={geo} material={mat} />
      <mesh geometry={geo} scale={[0.5, 0.5, 0.5]}>
        <meshStandardMaterial color={CONFIG.colors.neonPink} emissive={CONFIG.colors.neonPink} emissiveIntensity={10} />
      </mesh>
    </group>
  );
};

// --- Component: Digital Rain (Falling Bits) ---
const DigitalRain = () => {
  const count = 500;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 60;
      arr[i * 3 + 1] = Math.random() * 60;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    return arr;
  }, []);

  const meshRef = useRef<THREE.Points>(null);
  useFrame((_, delta) => {
    if (meshRef.current) {
      const pos = meshRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        pos[i * 3 + 1] -= delta * 15;
        if (pos[i * 3 + 1] < -30) pos[i * 3 + 1] = 30;
      }
      meshRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.3} color={CONFIG.colors.neonGreen} transparent opacity={0.4} />
    </points>
  );
};

// --- Component: Holographic Data Wall (3x3 Grid) ---
const DataWall = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const textures = useTexture(CONFIG.photos.body);
  const groupRef = useRef<THREE.Group>(null);
  const borderGeo = useMemo(() => new THREE.PlaneGeometry(3.2, 3.2), []);
  const photoGeo = useMemo(() => new THREE.PlaneGeometry(3, 3), []);

  const data = useMemo(() => {
    return textures.map((_, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      // Grid arrangement: 1-8 followed by top.jpg at the end (index 8)
      const targetPos = new THREE.Vector3((col - 1) * 3.8, (1 - row) * 3.8 + 5, -18);
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 60 - 20);
      const rotationSpeed = { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4 };
      return { targetPos, chaosPos, currentPos: chaosPos.clone(), rotationSpeed, textureIndex: i };
    });
  }, [textures]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    // Smooth breathing effect instead of random flickering for mobile stability
    const breathing = 0.8 + Math.sin(time * 2) * 0.2;

    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      const lerpSpeed = isFormed ? 4.0 : 2.5;
      objData.currentPos.lerp(target, delta * lerpSpeed);
      child.position.copy(objData.currentPos);

      if (isFormed) {
        child.rotation.set(Math.sin(time + i) * 0.05, Math.cos(time * 0.8 + i) * 0.05, 0);

        // Directly update material to avoid extra state re-renders
        const photoMesh = (child as THREE.Group).children[0] as THREE.Mesh;
        if (photoMesh && photoMesh.material) {
          (photoMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 * breathing;
        }
      } else {
        child.rotation.x += delta * objData.rotationSpeed.x;
        child.rotation.y += delta * objData.rotationSpeed.y;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i}>
          {/* Holographic Photo Plane */}
          <mesh geometry={photoGeo}>
            <meshStandardMaterial
              map={textures[obj.textureIndex]}
              transparent
              opacity={0.85}
              emissive={CONFIG.colors.neonCyan}
              emissiveIntensity={0}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Tech Border Frame */}
          <mesh geometry={borderGeo} position={[0, 0, -0.05]}>
            <meshStandardMaterial
              color={i === 8 ? CONFIG.colors.neonPink : CONFIG.colors.neonCyan}
              wireframe
              transparent
              opacity={0.4}
              emissive={i === 8 ? CONFIG.colors.neonPink : CONFIG.colors.neonCyan}
              emissiveIntensity={2.0}
            />
          </mesh>
          {state === 'FORMED' && <Sparkles count={5} scale={3} size={2} speed={0.5} color={CONFIG.colors.neonCyan} />}
        </group>
      ))}
    </group>
  );
};

// --- Component: Holographic Fireworks ---
const Firework = ({ position, color }: { position: THREE.Vector3, color: string }) => {
  const count = 150;
  const particles = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const vels = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 0.5 + Math.random() * 2;
      vels[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      vels[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      vels[i * 3 + 2] = Math.cos(phi) * speed;
    }
    return { pos: arr, vel: vels };
  }, []);

  const meshRef = useRef<THREE.Points>(null);
  const [life, setLife] = useState(1.0);

  useFrame((_, delta) => {
    if (meshRef.current && life > 0) {
      const p = meshRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        p[i * 3] += particles.vel[i * 3] * delta * 5;
        p[i * 3 + 1] += particles.vel[i * 3 + 1] * delta * 5;
        p[i * 3 + 2] += particles.vel[i * 3 + 2] * delta * 5;
      }
      meshRef.current.geometry.attributes.position.needsUpdate = true;
      setLife(l => l - delta * 0.8);
    }
  });

  if (life <= 0) return null;

  return (
    <points ref={meshRef} position={position}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[particles.pos, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.4} color={color} transparent opacity={life} blending={THREE.AdditiveBlending} />
    </points>
  );
};

const FireworksManager = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const [fireworks, setFireworks] = useState<{ id: number, pos: THREE.Vector3, color: string }[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (state === 'FORMED') {
      const interval = setInterval(() => {
        const pos = new THREE.Vector3((Math.random() - 0.5) * 40, 5 + Math.random() * 15, (Math.random() - 0.5) * 40);
        const color = CONFIG.colors.glitchColors[Math.floor(Math.random() * CONFIG.colors.glitchColors.length)];
        setFireworks(prev => [...prev.slice(-10), { id: idRef.current++, pos, color }]);
      }, 800);
      return () => clearInterval(interval);
    }
  }, [state]);

  return (
    <>
      {fireworks.map(f => <Firework key={f.id} position={f.pos} color={f.color} />)}
    </>
  );
};

// --- Component: Glitchy 2026 Title ---
const GlitchTitle = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const [glitch, setGlitch] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 100);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  if (state !== 'FORMED') return null;

  return (
    <div style={{
      position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
      fontSize: '120px', fontWeight: 'bold', color: CONFIG.colors.neonCyan,
      fontFamily: 'Courier New, monospace', pointerEvents: 'none', zIndex: 5,
      opacity: 0.1, letterSpacing: '20px', textShadow: glitch ? `5px 0 ${CONFIG.colors.neonPink}, -5px 0 ${CONFIG.colors.neonGreen}` : 'none'
    }}>
      2026
    </div>
  );
};

// --- Scene Setup ---
const Experience = ({ sceneState, rotationSpeed }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number }) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={20} maxDistance={100} autoRotate={sceneState === 'FORMED'} autoRotateSpeed={0.5} />

      <color attach="background" args={[CONFIG.colors.bg]} />
      <Stars radius={100} depth={50} count={7000} factor={4} saturation={1} fade speed={2} />

      {/* Replaced external Environment with robust local lighting */}
      <ambientLight intensity={0.5} />
      <pointLight position={[20, 30, 20]} intensity={100} color={CONFIG.colors.neonCyan} />
      <pointLight position={[-20, 10, -20]} intensity={80} color={CONFIG.colors.neonPink} />
      <pointLight position={[0, -10, 30]} intensity={50} color={CONFIG.colors.neonYellow} />
      <directionalLight position={[0, 5, 5]} intensity={0.5} />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
          <DataLogs state={sceneState} />
          <DataFragments state={sceneState} />
          <DataNode state={sceneState} />
          <DigitalRain />
          <FireworksManager state={sceneState} />
          <DataWall state={sceneState} />
        </Suspense>
        <Sparkles count={800} scale={40} size={4} speed={0.8} opacity={0.5} color={CONFIG.colors.neonCyan} />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={2.0} radius={0.4} />
        <Vignette eskil={false} offset={0.1} darkness={1.5} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
const GestureController = ({ onGesture, onMove, onStatus }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;
    let stream: MediaStream | null = null;
    let isActive = true;

    const setup = async () => {
      onStatus("INITIALIZING CORE...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });

        if (!isActive) return;

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current && isActive) {
            videoRef.current.srcObject = stream;
            // Handle play() promise to avoid AbortError
            videoRef.current.play().catch(() => {
              /* Ignore interruption errors */
            });
            onStatus("SYSTEM READY_");
            predictWebcam();
          }
        }
      } catch (err: any) {
        if (isActive) onStatus("AI_LINK_OFFLINE");
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current && isActive) {
        if (videoRef.current.videoWidth > 0) {
          const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
          if (results.gestures.length > 0) {
            const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
            if (score > 0.4) {
              if (name === "Open_Palm") onGesture("CHAOS"); if (name === "Closed_Fist") onGesture("FORMED");
            }
            if (results.landmarks.length > 0) {
              const speed = (0.5 - results.landmarks[0][0].x) * 0.2;
              onMove(Math.abs(speed) > 0.01 ? speed : 0);
            }
          } else { onMove(0); }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => {
      isActive = false;
      cancelAnimationFrame(requestRef);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [onGesture, onMove, onStatus]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: 0, position: 'fixed', top: 0, right: 0, width: '1px' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ opacity: 0, position: 'fixed', top: 0, right: 0, width: '1px' }} />
    </>
  );
};

// --- App Entry ---
export default function CyberDataTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("BOOTING...");

  // New Year Countdown Logic
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const target = new Date("Jan 1, 2026 00:00:00").getTime();
      const diff = target - now;
      if (diff < 0) {
        setTimeLeft("WELCOME TO 2026");
      } else {
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${d}D ${h}H ${m}M ${s}S`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: CONFIG.colors.bg, position: 'relative', overflow: 'hidden', textShadow: '0 0 10px rgba(0,243,255,0.5)' }}>
      {/* HUD - Top Center Countdown */}
      <div style={{
        position: 'absolute', top: '40px', left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, textAlign: 'center', pointerEvents: 'none'
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.8)', padding: '10px 20px', border: '1px solid #00F3FF',
          color: '#00F3FF', fontFamily: 'Courier New, monospace', fontSize: '14px', letterSpacing: '4px',
          overflow: 'hidden', position: 'relative'
        }}>
          <div style={{ position: 'absolute', top: 0, left: '-100%', width: '100%', height: '100%', background: 'linear-gradient(90deg, transparent, rgba(0,243,255,0.2), transparent)', animation: 'scan 2s linear infinite' }} />
          SYSTEM BOOT: 2026 // [ {timeLeft} ]
        </div>
        <div style={{ color: '#00FF41', fontSize: '10px', marginTop: '5px', fontFamily: 'monospace' }}>
          LOADING NEURAL_STRUCTURE... {sceneState === 'FORMED' ? 'STABLE' : 'BREACH_DETECTED'}
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0% { left: -100%; }
          100% { left: 100%; }
        }
      `}</style>

      <GlitchTitle state={sceneState} />

      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 1.5]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
          <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} />
        </Canvas>
      </div>
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} />

      {/* HUD - Stats */}
      <div style={{ position: 'absolute', bottom: '40px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'monospace', userSelect: 'none' }}>
        <div style={{ marginBottom: '20px' }}>
          <p style={{ fontSize: '10px', color: '#00F3FF', marginBottom: '5px' }}>&gt; DATA LOGS</p>
          <p style={{ fontSize: '32px', color: '#FF00FF', fontWeight: 'bold', margin: 0, textShadow: '0 0 10px #FF00FF' }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '12px', color: '#555' }}>SHARDS</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', color: '#00F3FF', marginBottom: '5px' }}>&gt; NEURAL_NODES</p>
          <p style={{ fontSize: '32px', color: '#00FF41', fontWeight: 'bold', margin: 0, textShadow: '0 0 10px #00FF41' }}>
            {(CONFIG.counts.foliage / 1000).toFixed(1)}K <span style={{ fontSize: '12px', color: '#555' }}>VECTS</span>
          </p>
        </div>
      </div>

      {/* HUD - AI Status */}
      <div style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', color: '#00FF41', fontSize: '12px', letterSpacing: '2px', zIndex: 10, fontFamily: 'monospace' }}>
        {aiStatus}
      </div>

      {/* HUD - Interaction */}
      <div style={{ position: 'absolute', bottom: '40px', right: '40px', zIndex: 10, display: 'flex', gap: '15px' }}>
        <button
          onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')}
          style={{
            padding: '15px 30px', background: 'transparent', border: '1px solid #00F3FF',
            color: '#00F3FF', fontFamily: 'monospace', cursor: 'pointer', transition: 'all 0.3s',
            backdropFilter: 'blur(10px)', boxShadow: '0 0 15px rgba(0,243,255,0.2)'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#00F3FF'; e.currentTarget.style.color = '#000'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#00F3FF'; }}
        >
          {sceneState === 'CHAOS' ? 'CONSTRUCT_TREE' : 'INIT_BREACH'}
        </button>
      </div>
    </div>
  );
}