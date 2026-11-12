/* Реалістичний 3D-блокнот PRETTYLITTLE PLANS (Three.js), без зовнішніх моделей.
   Тверда обкладинка з тканинною фактурою й заокругленими кутами, блок сторінок з торцем,
   золоті кільця, резинка, ляссе. setOpen(t), t від 0 (закритий) до 1 (розворот):
   резинка зіскакує → обкладинка відкривається → три справжні сторінки з PDF
   перегортаються, вигинаючись, і відкривається розворот «Мій планер».
   Координати: x — вправо (корінець біля x≈0), y — угору, z — до глядача (нижній край книги). */
export async function createPlanner(THREE, base, opts = {}) {
  const loader = new THREE.TextureLoader();
  const aniso = opts.anisotropy || 8;
  const load = n => new Promise((ok, bad) => loader.load(base + n, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; ok(t) }, undefined, bad));
  const names = ['cover', 'back', 'spread_L', 'spread_R', 'edge', 'a_L', 'a_R', 'b_L', 'b_R', 'c_L', 'c_R'];
  const T = Object.fromEntries((await Promise.all(names.map(n => load(n + '.jpg')))).map((t, i) => [names[i], t]));

  /* ---------- процедурні фактури: тканина обкладинки й папір ---------- */
  function canvasTex(size, draw, srgb = false) {
    const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const linen = canvasTex(256, (g, s) => {           // переплетення ниток
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(255,255,255,${.10 + rnd() * .18})`; g.fillRect(0, y, s, 1) }
    for (let x = 0; x < s; x += 2) { g.fillStyle = `rgba(0,0,0,${.08 + rnd() * .16})`; g.fillRect(x, 0, 1, s) }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '0,0,0' : '255,255,255'},.12)`; g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 6, 1) }
  });
  const grain = canvasTex(256, (g, s) => {           // зерно паперу
    const im = g.createImageData(s, s);
    for (let i = 0; i < im.data.length; i += 4) { const v = 118 + rnd() * 20; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255 }
    g.putImageData(im, 0, 0);
  });
  const coverLinen = linen.clone(); coverLinen.repeat.set(9, 15); coverLinen.needsUpdate = true;
  const boardLinen = linen.clone(); boardLinen.repeat.set(30, 30); boardLinen.needsUpdate = true;
  const pageGrain = grain.clone(); pageGrain.repeat.set(4, 6); pageGrain.needsUpdate = true;
  T.edge.wrapS = T.edge.wrapT = THREE.RepeatWrapping; T.edge.repeat.set(1, 14);

  /* ---------- матеріали ---------- */
  const M = {
    cover: new THREE.MeshPhysicalMaterial({ map: T.cover, bumpMap: coverLinen, bumpScale: .9, roughness: .78, sheen: .35, sheenRoughness: .8, sheenColor: new THREE.Color('#fff4ef') }),
    back: new THREE.MeshPhysicalMaterial({ map: T.back, bumpMap: coverLinen, bumpScale: .9, roughness: .8, sheen: .3, sheenRoughness: .8 }),
    board: new THREE.MeshPhysicalMaterial({ color: '#efe3d6', bumpMap: boardLinen, bumpScale: .6, roughness: .82, sheen: .3, sheenRoughness: .8 }),
    inner: new THREE.MeshStandardMaterial({ color: '#f7efe7', bumpMap: boardLinen, bumpScale: .4, roughness: .9 }),
    edge: new THREE.MeshStandardMaterial({ map: T.edge, roughness: .95 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d9b06a', metalness: 1, roughness: .22 }),
    elastic: new THREE.MeshPhysicalMaterial({ color: '#5e0c2e', roughness: .6, sheen: .8, sheenRoughness: .5, sheenColor: new THREE.Color('#b0607e'), transparent: true }),
    ribbon: new THREE.MeshPhysicalMaterial({ color: '#6a1434', roughness: .38, sheen: 1, sheenRoughness: .3, sheenColor: new THREE.Color('#d48aa5'), side: THREE.DoubleSide }),
  };
  const pageMat = (tex, side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ map: tex, bumpMap: pageGrain, bumpScale: .25, roughness: .88, side });

  /* ---------- геометрія ---------- */
  // прямокутник із заокругленими кутами з боку обрізу (праворуч); біля корінця кути прямі
  function shape(x0, x1, z0, z1, r) {
    const s = new THREE.Shape(), a = -z1, b = -z0;     // у площині форми y2 = -z
    s.moveTo(x0, a); s.lineTo(x1 - r, a); s.quadraticCurveTo(x1, a, x1, a + r);
    s.lineTo(x1, b - r); s.quadraticCurveTo(x1, b, x1 - r, b); s.lineTo(x0, b); s.closePath(); return s;
  }
  // брусок (обкладинка або блок сторінок) з фаскою; верх і низ — окремі площини з текстурою
  function slab(x0, x1, z0, z1, y0, y1, r, sideMat, bevel = .003) {
    const g = new THREE.ExtrudeGeometry(shape(x0 + bevel, x1 - bevel, z0 + bevel, z1 - bevel, Math.max(.001, r - bevel)),
      { depth: y1 - y0 - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
    g.rotateX(-Math.PI / 2); g.translate(0, y0 + bevel, 0);
    return new THREE.Mesh(g, sideMat);
  }
  // площина-«наклейка» з текстурою на грані бруска (mirror — для граней, що перевертаються)
  function face(x0, x1, z0, z1, y, r, mat, { down = false, mirror = false } = {}) {
    const g = new THREE.ShapeGeometry(shape(x0, x1, z0, z1, r), 12);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = -p.getY(i);
      p.setXYZ(i, x, y, z);
      uv.setXY(i, mirror ? (x1 - x) / (x1 - x0) : (x - x0) / (x1 - x0), (z1 - z) / (z1 - z0));
    }
    if (down) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t } }
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
  const shadowy = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } }); return o };

  const PIV = new THREE.Vector3(.05, .07, 0);      // вісь кілець
  const root = new THREE.Group();

  // задня обкладинка (корінцем під кільцями)
  root.add(slab(-.08, 1.05, -.78, .78, 0, .02, .05, M.board, .004));
  root.add(face(-.08, 1.05, -.78, .78, -.0004, .05, M.back, { down: true, mirror: true }));
  root.add(face(-.08, 1.05, -.78, .78, .0204, .05, M.inner));
  // правий блок сторінок; згори — права сторінка розвороту
  root.add(slab(0, 1, -.75, .75, .02, .07, .02, M.edge, .0015));
  root.add(face(0, 1, -.75, .75, .0703, .02, pageMat(T.spread_R)));

  // обкладинка + лівий блок: обертаються навколо кілець
  const flip = new THREE.Group(); flip.position.copy(PIV); root.add(flip);
  const fl = new THREE.Group(); fl.position.set(-PIV.x, -PIV.y, 0); flip.add(fl);
  fl.add(slab(0, 1, -.75, .75, .0722, .12, .02, M.edge, .0015));
  fl.add(face(0, 1, -.75, .75, .0719, .02, pageMat(T.a_L), { down: true, mirror: true }));
  fl.add(slab(.13, 1.05, -.78, .78, .12, .14, .05, M.board, .004));
  fl.add(face(.13, 1.05, -.78, .78, .1404, .05, M.cover));
  fl.add(face(.13, 1.05, -.78, .78, .1196, .05, M.inner, { down: true }));

  // аркуші, що перегортаються: вигнута площина з двома сторонами
  const NS = 56, S0 = -.05, S1 = .95;               // s — відстань від осі кілець уздовж аркуша
  function sheet(front, back, rest, land) {
    const g = new THREE.BufferGeometry(), n = (NS + 1) * 2;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
    for (let i = 0; i <= NS; i++) for (let j = 0; j < 2; j++) {
      const k = i * 2 + j; uv[k * 2] = (S0 + (S1 - S0) * i / NS + PIV.x); uv[k * 2 + 1] = j ? 0 : 1;   // j=0 — дальній край (z=-0.75)
    }
    for (let i = 0; i < NS; i++) { const a = i * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1) }
    g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    back.wrapS = THREE.RepeatWrapping; back.repeat.x = -1; back.offset.x = 1;
    const grp = new THREE.Group();
    const mf = new THREE.Mesh(g, pageMat(front, THREE.FrontSide)), mb = new THREE.Mesh(g, pageMat(back, THREE.BackSide));
    grp.add(mf, mb); shadowy(grp);
    const sh = { grp, g, rest, land, t: -1 };
    sh.set = t => {
      if (t === sh.t) return; sh.t = t;
      const e = ease(t), th = Math.PI * e, curl = .95 * Math.sin(Math.PI * t), lift = .03 * Math.sin(Math.PI * t);
      const yh = rest + (land - rest) * e;
      // інтегруємо вздовж аркуша: дальній край відстає від осі — папір вигинається
      let x = PIV.x, y = yh; const ds = (S1 - S0) / NS;
      const pts = []; const i0 = Math.round(-S0 / ds);
      for (let i = 0; i <= NS; i++) pts.push(null);
      pts[i0] = [x, y];
      for (let i = i0 + 1; i <= NS; i++) { const s = (i - i0) * ds / S1, ph = th - curl * Math.pow(s, 1.35) + lift * s; x += Math.cos(ph) * ds; y += Math.sin(ph) * ds; pts[i] = [x, y] }
      x = PIV.x; y = yh; for (let i = i0 - 1; i >= 0; i--) { x -= Math.cos(th) * ds; y -= Math.sin(th) * ds; pts[i] = [x, y] }
      const p = g.attributes.position.array;
      for (let i = 0; i <= NS; i++) for (let j = 0; j < 2; j++) { const k = (i * 2 + j) * 3; p[k] = pts[i][0]; p[k + 1] = pts[i][1]; p[k + 2] = j ? .75 : -.75 }
      g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
    };
    sh.set(0); return sh;
  }
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  // зверху вниз: перший перегортається першим і лягає найнижче
  const sheets = [sheet(T.a_R, T.b_L, .0716, .0688), sheet(T.b_R, T.c_L, .0711, .0693), sheet(T.c_R, T.spread_L, .0706, .0698)];
  sheets.forEach(s => root.add(s.grp));

  // кільця
  for (const z of [-.62, -.38, -.14, .14, .38, .62]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(.066, .0078, 16, 64), M.gold);
    r.position.set(PIV.x, PIV.y, z); root.add(r);
  }

  // резинка: петля навколо книги поперек, сплющена трубка
  const bandPts = [], yb = -.003, yt = .146, zr = .788, rr = .012;
  const arc = (cy, cz, a0, a1) => { for (let i = 0; i <= 6; i++) { const a = a0 + (a1 - a0) * i / 6; bandPts.push(new THREE.Vector3(0, cy + Math.sin(a) * rr, cz + Math.cos(a) * rr)) } };
  arc(yt - rr, zr - rr, 0, Math.PI / 2); arc(yt - rr, -zr + rr, Math.PI / 2, Math.PI); arc(yb + rr, -zr + rr, Math.PI, 1.5 * Math.PI); arc(yb + rr, zr - rr, 1.5 * Math.PI, 2 * Math.PI);
  const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bandPts, true, 'centripetal'), 220, .0034, 10, true), M.elastic);
  band.scale.x = 4.2; const bandG = new THREE.Group(); bandG.position.x = .93; bandG.add(band); root.add(bandG);

  // ляссе: виходить з-під блоку й лягає на стіл
  {
    const path = [[.40, .0212], [.74, .0212], [.80, .016], [.86, .006], [.98, .0025], [1.06, .0025]];
    const curve = new THREE.CatmullRomCurve3(path.map(([z, y]) => new THREE.Vector3(.66, y, z)));
    const N = 60, w = .018, g = new THREE.BufferGeometry(), pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); pos.push(p.x - w, p.y, p.z, p.x + w, p.y, p.z) }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
    g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    root.add(new THREE.Mesh(g, M.ribbon));
  }

  shadowy(root);

  // м'яка контактна тінь під книгою
  const blob = canvasTex(256, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, s * .1, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(70,40,40,.55)'); gr.addColorStop(.6, 'rgba(70,40,40,.18)'); gr.addColorStop(1, 'rgba(70,40,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }, true);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.set(.48, .0006, 0); contact.renderOrder = -1; root.add(contact);

  /* ---------- анімація ---------- */
  const cl = (a, b, t) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  function setOpen(t) {
    const kb = cl(0, .2, t);                               // резинка зіскакує за край
    bandG.position.x = .93 + .24 * ease(kb); band.scale.y = band.scale.z = 1 + .04 * Math.sin(Math.PI * kb);
    M.elastic.opacity = 1 - cl(.13, .24, t); bandG.visible = M.elastic.opacity > .01;
    const kc = cl(.12, .52, t);                            // обкладинка разом із лівим блоком
    flip.rotation.z = Math.PI * ease(kc);
    sheets.forEach((s, i) => s.set(cl(.34 + .14 * i, .66 + .14 * i, t)));
    contact.scale.x = 1 + .9 * ease(kc); contact.position.x = .48 - .45 * ease(kc);
  }
  setOpen(0);
  return { root, setOpen };
}
