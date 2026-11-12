/* Реалістичний 3D-блокнот PRETTYLITTLE PLANS (Three.js), без зовнішніх моделей.
   Обкладинка — напівпрозорий глянцевий пластик з друком: крізь неї просвічує перша сторінка,
   крайка ловить світло, по поверхні ходять скляні блики. Блок сторінок з торцем, золоті кільця,
   резинка, ляссе. Усередині — вкладка-розкладачка з календарем місяця.
   setOpen(t), t від 0 (закритий) до 1 (розкладений):
   резинка зіскакує → обкладинка відкидається вліво → розкладачка розгортається вправо.
   Координати: x — вправо (кільця біля x≈0.05), y — угору, z — до глядача (нижній край книги). */
export async function createPlanner(THREE, base, opts = {}) {
  const loader = new THREE.TextureLoader();
  const aniso = opts.anisotropy || 8;
  const load = n => new Promise((ok, bad) => loader.load(base + n, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; ok(t) }, undefined, bad));
  const names = ['cover', 'back', 'spread_R', 'edge', 'cal_L', 'cal_R'];
  const T = Object.fromEntries((await Promise.all(names.map(n => load(n + '.jpg')))).map((t, i) => [names[i], t]));

  /* ---------- процедурні фактури ---------- */
  function canvasTex(size, draw, srgb = false) {
    const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grain = canvasTex(256, (g, s) => {           // зерно паперу
    const im = g.createImageData(s, s);
    for (let i = 0; i < im.data.length; i += 4) { const v = 118 + rnd() * 20; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255 }
    g.putImageData(im, 0, 0);
  });
  const smudge = canvasTex(512, (g, s) => {         // мікроподряпини й відбитки на пластику (карта шорсткості)
    g.fillStyle = 'rgb(14,14,14)'; g.fillRect(0, 0, s, s);
    g.filter = 'blur(10px)';
    for (let i = 0; i < 14; i++) { const x = rnd() * s, y = rnd() * s, r = 20 + rnd() * 50; g.fillStyle = `rgba(80,80,80,${.25 + rnd() * .35})`; g.beginPath(); g.ellipse(x, y, r, r * (.5 + rnd() * .5), rnd() * 3, 0, 7); g.fill() }
    g.filter = 'none';
    for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(110,110,110,${.15 + rnd() * .25})`; g.lineWidth = .6; g.beginPath(); const x = rnd() * s, y = rnd() * s, a = rnd() * 6.3, l = 6 + rnd() * 40; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke() }
  });
  const pageGrain = grain.clone(); pageGrain.repeat.set(4, 6); pageGrain.needsUpdate = true;
  T.edge.wrapS = T.edge.wrapT = THREE.RepeatWrapping; T.edge.repeat.set(1, 16);

  /* ---------- матеріали ---------- */
  const M = {
    // друк на напівпрозорому пластику (зверху) і він же зсередини — дзеркально й темніше
    plastic: new THREE.MeshPhysicalMaterial({ map: T.cover, transparent: true, opacity: .95, roughness: .3, clearcoat: 1, clearcoatRoughness: .08, depthWrite: false }),
    plasticIn: new THREE.MeshPhysicalMaterial({ map: T.cover, color: '#e9ddd6', transparent: true, opacity: .92, roughness: .35, depthWrite: false }),
    plasticBack: new THREE.MeshPhysicalMaterial({ map: T.back, roughness: .3, clearcoat: 1, clearcoatRoughness: .08 }),
    // крайка пластику: світиться, як торець акрилу
    rim: new THREE.MeshPhysicalMaterial({ color: '#fff6ec', emissive: '#fff0e2', emissiveIntensity: .42, roughness: .1, clearcoat: 1, clearcoatRoughness: .05 }),
    edge: new THREE.MeshStandardMaterial({ map: T.edge, roughness: .95 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d6ab63', metalness: 1, roughness: .16 }),
    elastic: new THREE.MeshPhysicalMaterial({ color: '#5e0c2e', roughness: .6, sheen: .8, sheenRoughness: .5, sheenColor: new THREE.Color('#b0607e'), transparent: true }),
    // скляні блики: чорний колір + додавальне змішування — лише відбиття, без засвічування друку
    glare: new THREE.MeshPhysicalMaterial({ color: '#000000', metalness: 0, roughness: .35, roughnessMap: smudge, ior: 1.5, specularIntensity: 1,
      clearcoat: 1, clearcoatRoughness: .03, iridescence: .15, iridescenceIOR: 1.3, iridescenceThicknessRange: [200, 560], envMapIntensity: .17,
      transparent: true, opacity: .05, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }),
    ribbon: new THREE.MeshPhysicalMaterial({ color: '#6a1434', roughness: .38, sheen: 1, sheenRoughness: .3, sheenColor: new THREE.Color('#d48aa5'), side: THREE.DoubleSide }),
  };
  for (const k of ['glare']) M[k].userData.keepEnv = true;
  const pageMat = (tex, side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ map: tex, bumpMap: pageGrain, bumpScale: .25, roughness: .88, side });

  /* ---------- геометрія ---------- */
  // прямокутник із заокругленими кутами: r — з боку обрізу (праворуч), rl — біля корінця; holes — прорізи під кільця
  function shape(x0, x1, z0, z1, r, rl = 0, holes = null) {
    const s = new THREE.Shape(), a = -z1, b = -z0;
    s.moveTo(x0 + rl, a); s.lineTo(x1 - r, a); s.quadraticCurveTo(x1, a, x1, a + r);
    s.lineTo(x1, b - r); s.quadraticCurveTo(x1, b, x1 - r, b); s.lineTo(x0 + rl, b);
    if (rl) { s.quadraticCurveTo(x0, b, x0, b - rl); s.lineTo(x0, a + rl); s.quadraticCurveTo(x0, a, x0 + rl, a) } else s.closePath();
    for (const [hx0, hx1, zc, hz] of holes || []) {     // овальний проріз
      const h = new THREE.Path(), rr = (hx1 - hx0) / 2, y0 = -zc - hz + rr, y1 = -zc + hz - rr, cx = (hx0 + hx1) / 2;
      h.absarc(cx, y1, rr, 0, Math.PI, false); h.absarc(cx, y0, rr, Math.PI, 2 * Math.PI, false); h.closePath();
      s.holes.push(h);
    }
    return s;
  }
  function slab(x0, x1, z0, z1, y0, y1, r, sideMat, bevel = .003, rl = 0, holes = null) {
    const hs = holes && holes.map(([a, b, zc, hz]) => [a - bevel, b + bevel, zc, hz + bevel]);
    const g = new THREE.ExtrudeGeometry(shape(x0 + bevel, x1 - bevel, z0 + bevel, z1 - bevel, Math.max(.001, r - bevel), rl ? Math.max(.001, rl - bevel) : 0, hs),
      { depth: Math.max(.0002, y1 - y0 - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 12 });
    g.rotateX(-Math.PI / 2); g.translate(0, y0 + bevel, 0);
    return new THREE.Mesh(g, sideMat);
  }
  // площина з текстурою на грані бруска; uv рахується за повними розмірами (ux0..ux1), щоб друк не зсувався
  function face(x0, x1, z0, z1, y, r, mat, { down = false, mirror = false, rl = 0, holes = null, ux0 = x0, ux1 = x1, uz0 = z0, uz1 = z1 } = {}) {
    const g = new THREE.ShapeGeometry(shape(x0, x1, z0, z1, r, rl, holes), 12);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = -p.getY(i);
      p.setXYZ(i, x, y, z);
      uv.setXY(i, mirror ? (ux1 - x) / (ux1 - ux0) : (x - ux0) / (ux1 - ux0), (uz1 - z) / (uz1 - uz0));
    }
    if (down) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t } }
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const cl = (a, b, t) => Math.max(0, Math.min(1, (t - a) / (b - a)));

  // висоти: задня обкладинка, товстий блок сторінок, розкладачка, передня обкладинка
  const Y_BACK = .014, Y_TOP = .114, Y_FLAP = .1147, Y_C0 = .117, Y_C1 = .129;
  const RINGS = [-.62, -.38, -.14, .14, .38, .62], RING_R = .074;
  const PIV = new THREE.Vector3(0, (Y_C1 + .0008) / 2, 0);   // вісь кілець; обкладинка після перевороту лягає на стіл
  const root = new THREE.Group();
  const glareMeshes = [];

  // задня обкладинка і блок сторінок; згори — ліва панель календаря
  root.add(slab(-.1, 1.05, -.78, .78, 0, Y_BACK, .05, M.rim, .004, .03));
  root.add(face(-.1, 1.05, -.78, .78, -.0003, .05, M.plasticBack, { down: true, mirror: true, rl: .03 }));
  const backIn = face(-.096, 1.046, -.776, .776, Y_BACK + .0003, .048, pageMat(null), { rl: .028 }); backIn.material.color.set('#efe2d8'); root.add(backIn);
  root.add(slab(0, 1, -.75, .75, Y_BACK, Y_TOP, .02, M.edge, .0012));
  root.add(face(0, 1, -.75, .75, Y_TOP + .0003, .02, pageMat(T.cal_L)));

  // передня обкладинка на всю ширину: кільця проходять крізь прорізи, навколо них вона й обертається
  const flip = new THREE.Group(); flip.position.copy(PIV); root.add(flip);
  const fl = new THREE.Group(); fl.position.set(-PIV.x, -PIV.y, 0); flip.add(fl);
  const CX0 = -.02, CX1 = 1.05, CZ = .78, BV = .0042;
  const slots = RINGS.map(z => [.027, .066, z, .02]);
  fl.add(slab(CX0, CX1, -CZ, CZ, Y_C0, Y_C1, .05, M.rim, BV, .022, slots));
  const inset = { rl: .02, holes: slots.map(([a, b, z, h]) => [a - .002, b + .002, z, h + .002]), ux0: CX0, ux1: CX1, uz0: -CZ, uz1: CZ };
  fl.add(face(CX0 + BV, CX1 - BV, -CZ + BV, CZ - BV, Y_C1 + .0003, .046, M.plastic, inset));
  fl.add(face(CX0 + BV, CX1 - BV, -CZ + BV, CZ - BV, Y_C0 - .0003, .046, M.plasticIn, { ...inset, down: true }));
  const glareF = slab(CX0 - .001, CX1 + .001, -CZ - .001, CZ + .001, Y_C0 - .001, Y_C1 + .001, .051, M.glare, BV, .023, slots); fl.add(glareF); glareMeshes.push(glareF);
  const glareB = slab(-.101, 1.051, -.781, .781, -.001, Y_BACK + .001, .051, M.glare, .004, .031); root.add(glareB); glareMeshes.push(glareB);

  // розкладачка: права панель календаря на шарнірі x=1; складена лежить лицем донизу на лівій,
  // і тоді зверху видно її зворот — сторінку «Мій планер»
  const NS = 48, FL = 1;
  const flapG = new THREE.BufferGeometry();
  {
    const n = (NS + 1) * 2, uv = new Float32Array(n * 2), idx = [];
    for (let i = 0; i <= NS; i++) for (let j = 0; j < 2; j++) { const k = i * 2 + j; uv[k * 2] = i / NS; uv[k * 2 + 1] = j ? 0 : 1 }
    for (let i = 0; i < NS; i++) { const a = i * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1) }
    flapG.setIndex(idx); flapG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); flapG.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  T.spread_R.wrapS = THREE.RepeatWrapping; T.spread_R.repeat.x = -1; T.spread_R.offset.x = 1;
  const flap = new THREE.Group();
  flap.add(new THREE.Mesh(flapG, pageMat(T.cal_R, THREE.FrontSide)), new THREE.Mesh(flapG, pageMat(T.spread_R, THREE.BackSide)));
  root.add(flap);
  let flapT = -1;
  function setFlap(t) {
    if (t === flapT) return; flapT = t;
    // розгорнута панель плавно спускається з блоку на стіл, як справжній довгий аркуш
    const e = ease(t), th = Math.PI * (1 - e), lag = .9 * Math.sin(Math.PI * t), droop = .3 * e;
    let x = 1, y = Y_FLAP; const ds = FL / NS, p = flapG.attributes.position.array;
    for (let i = 0; i <= NS; i++) {
      if (i) {
        const s = i / NS, ph = th + lag * Math.pow(s, 1.3) - droop * Math.sin(Math.min(1, s * 1.6) * Math.PI);
        x += Math.cos(ph) * ds; y = Math.max(.0015, y + Math.sin(ph) * ds);
      }
      for (let j = 0; j < 2; j++) { const k = (i * 2 + j) * 3; p[k] = x; p[k + 1] = y; p[k + 2] = j ? .75 : -.75 }
    }
    flapG.attributes.position.needsUpdate = true; flapG.computeVertexNormals(); flapG.computeBoundingSphere();
  }

  // кільця: виходять зі сторінок, проходять крізь прорізи обкладинки й огинають корінець
  for (const z of RINGS) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(RING_R, .0064, 18, 72), M.gold);
    r.position.set(PIV.x, PIV.y, z); root.add(r);
  }

  // резинка поперек книги
  const bandPts = [], yb = -.0035, yt = Y_C1 + .0038, zr = .7915, rr = .012;
  const arc = (cy, cz, a0, a1) => { for (let i = 0; i <= 6; i++) { const a = a0 + (a1 - a0) * i / 6; bandPts.push(new THREE.Vector3(0, cy + Math.sin(a) * rr, cz + Math.cos(a) * rr)) } };
  arc(yt - rr, zr - rr, 0, Math.PI / 2); arc(yt - rr, -zr + rr, Math.PI / 2, Math.PI); arc(yb + rr, -zr + rr, Math.PI, 1.5 * Math.PI); arc(yb + rr, zr - rr, 1.5 * Math.PI, 2 * Math.PI);
  const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bandPts, true, 'centripetal'), 220, .0034, 10, true), M.elastic);
  band.scale.x = 4.2; const bandG = new THREE.Group(); bandG.position.x = .93; bandG.add(band); root.add(bandG);

  // ляссе
  {
    const path = [[.40, Y_BACK + .0012], [.74, Y_BACK + .0012], [.80, .009], [.86, .004], [.98, .0025], [1.06, .0025]];
    const curve = new THREE.CatmullRomCurve3(path.map(([z, y]) => new THREE.Vector3(.66, y, z)));
    const N = 60, w = .018, g = new THREE.BufferGeometry(), pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); pos.push(p.x - w, p.y, p.z, p.x + w, p.y, p.z) }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
    g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    root.add(new THREE.Mesh(g, M.ribbon));
  }

  root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } });
  for (const m of glareMeshes) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 10 }   // блики малюються останніми, поверх друку

  // студійне оточення для бликів: софтбокс і діагональні смуги
  if (opts.renderer) {
    const env = new THREE.Scene(); env.background = new THREE.Color(0, 0, 0);
    // м'які лампи: яскравість спадає до країв, тож відбиття — плавний перелив, а не різка пляма
    const soft = canvasTex(128, (g, n) => {
      const gx = g.createLinearGradient(0, 0, 0, n); gx.addColorStop(0, '#000'); gx.addColorStop(.5, '#fff'); gx.addColorStop(1, '#000');
      g.fillStyle = gx; g.fillRect(0, 0, n, n);
      const gy = g.createLinearGradient(0, 0, n, 0); gy.addColorStop(0, 'rgba(0,0,0,1)'); gy.addColorStop(.25, 'rgba(0,0,0,0)'); gy.addColorStop(.75, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = gy; g.fillRect(0, 0, n, n);
    }, true);
    const panel = (w, h, pos, rot, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: soft, color: new THREE.Color(k, k * .97, k * .94), side: THREE.DoubleSide }));
      m.position.set(...pos); m.lookAt(0, 0, 0); m.rotateZ(rot); env.add(m) };
    // камера згори-спереду-зліва: дзеркальне відбиття дивиться приблизно на (0.11, 0.91, -0.39)
    panel(7, .55, [.1, 4.57, -1.8], .62, 1.5);         // діагональний перелив через обкладинку
    panel(7, .2, [.95, 4.55, -2.05], .62, 1.1);        // другий, тонший
    panel(2.6, 3.4, [-2.4, 3.9, -1.6], 0, .5);         // м'який софтбокс зліва
    panel(2.2, 3, [3.4, 2.8, -2.0], 0, .5);            // контровий справа
    const pm = new THREE.PMREMGenerator(opts.renderer);
    M.glare.envMap = pm.fromScene(env, .03).texture; pm.dispose();
  }

  // м'яка контактна тінь
  const blob = canvasTex(256, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, s * .1, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(70,40,40,.5)'); gr.addColorStop(.6, 'rgba(70,40,40,.16)'); gr.addColorStop(1, 'rgba(70,40,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }, true);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 2.15), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.set(.48, .0006, 0); contact.renderOrder = -1; root.add(contact);

  /* ---------- анімація ---------- */
  function setOpen(t) {
    const kb = cl(0, .18, t);                              // резинка зіскакує
    bandG.position.x = .93 + .24 * ease(kb); band.scale.y = band.scale.z = 1 + .04 * Math.sin(Math.PI * kb);
    M.elastic.opacity = 1 - cl(.12, .22, t); bandG.visible = M.elastic.opacity > .01;
    const kc = cl(.1, .5, t);                              // обкладинка відкидається вліво
    flip.rotation.z = Math.PI * ease(kc);
    setFlap(cl(.52, .96, t));                              // розкладачка розгортається вправо
    const w = 1.5 + 1.0 * ease(kc) + 1.0 * ease(cl(.52, .96, t));
    contact.scale.x = w / 1.5; contact.position.x = .48 - .5 * ease(kc) + .5 * ease(cl(.52, .96, t));
  }
  setOpen(0);
  return { root, setOpen, M };
}
