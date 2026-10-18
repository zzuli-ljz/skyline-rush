// 渲染舞台：黄昏天空、雾、PMREM 环境反射、软阴影、GPU 雨丝、Bloom 后期
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 落日方向：前方偏左、低角度——全程朝着夕阳跑（玩家沿 +z 前进）
export const SUN_DIR = new THREE.Vector3(0.24, 0.58, 1).normalize();

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0
      ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55))
      : mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.7));
    float sd = max(dot(d, uSunDir), 0.0);
    // 太阳盘面 + 两层光晕
    col += uSunColor * (pow(sd, 1600.0) * 5.0 + pow(sd, 80.0) * 0.55 + pow(sd, 6.0) * 0.24);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createStage(canvas) {
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // 让 CDP 测试能通过 toDataURL 截帧
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc07a52, 45, 330);

  const camera = new THREE.PerspectiveCamera(76, 1, 0.1, 1400);

  // ---- 天空 ----
  const skyGeo = new THREE.SphereGeometry(1000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x16233f) },
      uHorizon: { value: new THREE.Color(0xe8874f) },
      uGround: { value: new THREE.Color(0x241a20) },
      uSunColor: { value: new THREE.Color(0xffd9a0) },
      uSunDir: { value: SUN_DIR.clone() },
    },
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // 用天空生成环境贴图（PBR 反射来源）
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(skyGeo, skyMat));
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
  }

  // ---- 光照 ----
  const hemi = new THREE.HemisphereLight(0x93b8ff, 0x3a3230, 0.68);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x46527a, 0.4));

  const sun = new THREE.DirectionalLight(0xffc08a, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 420;
  const SC = 55;
  sun.shadow.camera.left = -SC;
  sun.shadow.camera.right = SC;
  sun.shadow.camera.top = SC;
  sun.shadow.camera.bottom = -SC;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // ---- 远景地面（被雾吞掉，只留轮廓） ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // ---- GPU 雨丝 ----
  const rain = buildRain();
  scene.add(rain.obj);

  // ---- 后期 ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.65, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let lastW = -1;
  let lastH = -1;
  let lastDpr = -1;
  function resize(force = false) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!force && w === lastW && h === lastH && dpr === lastDpr) return;
    lastW = w;
    lastH = h;
    lastDpr = dpr;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
  }
  window.addEventListener('resize', () => resize());
  resize(true);

  // 自适应画质：0 低 / 1 中 / 2 高
  function setQuality(q) {
    dpr = q >= 2 ? Math.min(window.devicePixelRatio || 1, 2) : q === 1 ? 1 : 0.75;
    bloom.enabled = q >= 1;
    sun.shadow.mapSize.set(q >= 2 ? 2048 : 1024, q >= 2 ? 2048 : 1024);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    resize(true);
  }

  let rainT = 0;
  function update(dt, focus) {
    rainT += dt;
    rain.mat.uniforms.uTime.value = rainT;
    sky.position.copy(camera.position);
    rain.obj.position.set(camera.position.x, 0, camera.position.z);
    // 阴影相机跟随玩家，保证近处阴影清晰
    sun.position.copy(focus).addScaledVector(SUN_DIR, 160);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();
  }

  function render() {
    composer.render();
  }

  return { renderer, scene, camera, sun, setQuality, update, render, bloom };
}

function buildRain() {
  const N = 520;
  const pos = new Float32Array(N * 2 * 3);
  const tip = new Float32Array(N * 2);
  const seed = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * 56;
    const y = Math.random() * 40;
    const z = -Math.random() * 65 + 15;
    const s = 15 + Math.random() * 15;
    for (let v = 0; v < 2; v++) {
      const k = (i * 2 + v) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      tip[i * 2 + v] = v;
      seed[i * 2 + v] = s;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0.3 } },
    vertexShader: /* glsl */ `
      attribute float aTip;
      attribute float aSeed;
      uniform float uTime;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = 40.0 - mod(p.y + uTime * aSeed, 40.0);
        p.y -= aTip * 0.55;
        p.x += aTip * 0.12;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = uAlpha * clamp(1.0 + mv.z / 60.0, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() { gl_FragColor = vec4(0.72, 0.8, 0.95, vA); }
    `,
  });
  const obj = new THREE.LineSegments(geo, mat);
  obj.frustumCulled = false;
  return { obj, mat };
}
