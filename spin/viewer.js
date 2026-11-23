// Spin-dle 3D viewer: loads a Smithsonian Voyager scene (CC0 open-access models) and shows it
// as a silhouette, plain clay, or full colour. Shared by the game and the curator.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const API = 'https://3d-api.si.edu/content/document/';
const UNITS = {mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344};
const LO = ['Thumb', 'Low', 'Medium'];   // quick first load, used for the silhouette and clay views
const HI = ['Low', 'Medium', 'Thumb'];   // better textures for the colour views
const D = THREE.MathUtils.degToRad;

export function pickAsset(model, quals) {
  const ds = (model.derivatives || []).filter(d => d.usage === 'Web3D');
  for (const q of quals) {
    const d = ds.find(x => x.quality === q);
    const a = d && (d.assets || []).find(a => a.type === 'Model' || /\.glb$/i.test(a.uri || ''));
    if (a) return a.uri;
  }
  return null;
}
// Some objects use a "3d_package:" id and some don't, so ask for both at once.
export async function fetchDoc(id) {
  try {
    return await Promise.any(['3d_package:' + id, id].map(p => fetch(API + p + '/document.json')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json().then(doc => ({base: API + p + '/', doc})); })));
  } catch (e) { throw new Error('Could not load this object from the Smithsonian.'); }
}
// The object's title, as stored in the Smithsonian scene file.
export function docTitle(doc) {
  for (const m of doc.metas || []) {
    const t = (m.collection && m.collection.title) || m.title;
    if (t && t !== 'Scene') return t;
  }
  return '';
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(draco);
    this.silMat = new THREE.MeshBasicMaterial({color: 0x1d1f22});
    this.clayMat = new THREE.MeshStandardMaterial({color: 0xd9d3c7, roughness: 0.85, metalness: 0});
    this.mode = 'sil'; this.spin = false; this.spinning = false; this.stage = 0;
    this.radius = 1; this.longAxis = 'x'; this.view = {};
    this.loadId = 0; this.paused = false;
    this.onHi = null;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    let last = performance.now();
    const tick = now => {
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      if (!this.paused) {
        if (this.spin && !this.controls.enabled) this.pivot.rotation.y += dt * 0.5;
        if (this.controls.enabled) this.controls.update();
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  resize() {
    const p = this.canvas.parentElement, w = p.clientWidth, h = p.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame();
  }
  setDark(dark) { this.silMat.color.set(dark ? 0xe8eaed : 0x1d1f22); }

  async buildScene(base, doc, quals, bufs) {
    const models = doc.models || [];
    const sceneDef = (doc.scenes || [])[doc.scene || 0] || {};
    const sceneUnits = sceneDef.units || (models[0] && models[0].units) || 'm';
    const objs = await Promise.all(models.map(async (m, i) => {
      const uri = pickAsset(m, quals);
      if (!uri) return null;
      // Use the copy the page already downloaded, if there is one.
      const buf = bufs && bufs[i];
      const gltf = buf ? await this.loader.parseAsync(buf, base) : await this.loader.loadAsync(base + encodeURI(uri));
      const inner = gltf.scene;
      if (m.translation) inner.position.fromArray(m.translation);
      if (m.rotation) inner.quaternion.fromArray(m.rotation);
      const g = new THREE.Group();
      g.add(inner);
      g.scale.setScalar((UNITS[m.units] || 1) / (UNITS[sceneUnits] || 1));
      return g;
    }));
    const root = new THREE.Group();
    const used = new Set();
    const build = ni => {
      const n = (doc.nodes || [])[ni] || {}, g = new THREE.Group();
      if (n.translation) g.position.fromArray(n.translation);
      if (n.rotation) g.quaternion.fromArray(n.rotation);
      if (n.scale) g.scale.fromArray(n.scale);
      if (n.model !== undefined && objs[n.model]) { g.add(objs[n.model]); used.add(n.model); }
      (n.children || []).forEach(c => g.add(build(c)));
      return g;
    };
    (sceneDef.nodes || []).forEach(ni => root.add(build(ni)));
    objs.forEach((o, i) => { if (o && !used.has(i)) root.add(o); });
    if (!objs.some(Boolean)) throw new Error('This object has no web model.');
    root.traverse(o => { if (o.isMesh) o.userData.orig = o.material; });
    return root;
  }
  clear() {
    for (const c of [...this.pivot.children]) {
      this.pivot.remove(c);
      c.traverse(o => {
        if (!o.isMesh) return;
        o.geometry && o.geometry.dispose();
        [].concat(o.userData.orig || o.material).forEach(m => {
          if (!m) return;
          for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
          m.dispose();
        });
      });
    }
    this.norm = null; this.lo = null; this.hi = null; this.doc = null;
  }
  // Loads the object. Resolves once the quick version is on screen; the better one swaps in later.
  // view: optional per-object tweaks saved by the curator: {fix:[x,y,z] degrees, y0,e0,y1,e1 degrees}.
  async load(id, view) {
    const my = ++this.loadId;
    this.clear();
    this.view = view || {};
    const pre = window.SPIN && window.SPIN.prefetch(id);
    const {base, doc} = pre ? await pre.docP.catch(() => fetchDoc(id)) : await fetchDoc(id);
    if (my !== this.loadId) return null;
    const bufs = pre ? await pre.loP.catch(() => null) : null;
    if (my !== this.loadId) return null;
    const lo = await this.buildScene(base, doc, LO, bufs);
    if (my !== this.loadId) return null;
    this.doc = doc;
    this.fixG = new THREE.Group();
    this.fixG.add(lo);
    this.norm = new THREE.Group();
    this.norm.add(this.fixG);
    this.lo = lo; this.hi = null;
    this.refit();
    this.pivot.add(this.norm);
    this.apply();
    const loUri = (doc.models || []).map(m => pickAsset(m, LO)).join('|');
    const hiUri = (doc.models || []).map(m => pickAsset(m, HI)).join('|');
    if (hiUri !== loUri) {
      this.buildScene(base, doc, HI).then(hi => {
        if (my !== this.loadId) return;
        this.hi = hi; this.fixG.add(hi); this.apply();
        if (this.onHi) this.onHi();
      }).catch(() => {});
    }
    return doc;
  }
  // Re-centre and re-scale after the object's orientation fix changes.
  refit() {
    const f = this.view.fix || [0, 0, 0];
    this.fixG.rotation.set(D(f[0] || 0), D(f[1] || 0), D(f[2] || 0));
    const parent = this.norm.parent;
    if (parent) parent.remove(this.norm);
    this.norm.position.set(0, 0, 0); this.norm.scale.setScalar(1); this.norm.rotation.set(0, 0, 0);
    this.norm.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.lo);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const s = 2 / Math.max(size.x, size.y, size.z, 1e-6);
    this.norm.scale.setScalar(s);
    this.norm.position.copy(center).multiplyScalar(-s);
    this.radius = size.length() * s / 2;
    this.longAxis = size.x >= size.z ? 'x' : 'z';
    if (parent) parent.add(this.norm);
  }
  setView(view) {
    this.view = view || {};
    if (!this.norm) return;
    this.refit();
    this.setStage(this.stage, true);
  }
  frame() {
    // Fit the object's bounding sphere inside whichever field of view is narrower (phones are tall and thin).
    const e = this.elev || 0, vf = D(this.camera.fov / 2);
    const hf = Math.atan(Math.tan(vf) * this.camera.aspect);
    const dist = this.radius / Math.sin(Math.min(vf, hf)) * 1.02;
    this.camera.position.set(0, Math.sin(e) * dist, Math.cos(e) * dist);
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
  }
  apply() {
    if (!this.norm) return;
    const useHi = this.hi && this.mode === 'color';
    if (this.lo) this.lo.visible = !useHi;
    if (this.hi) this.hi.visible = !!useHi;
    this.norm.traverse(o => {
      if (!o.isMesh) return;
      o.material = this.mode === 'sil' ? this.silMat : this.mode === 'clay' ? this.clayMat : o.userData.orig;
    });
  }
  // The camera angles for a stage, in degrees, including any saved tweaks.
  // Stage 0: silhouette end-on · 1: silhouette side-on · 2: clay, turning · 3: colour, turning · 4: colour, you can spin it
  stageDef(n) {
    const profile = this.longAxis === 'x' ? 0 : 90;
    const v = this.view;
    const S = [
      {mode: 'sil', yaw: v.y0 ?? profile + 90, elev: v.e0 ?? 4, spin: false},
      {mode: 'sil', yaw: v.y1 ?? profile, elev: v.e1 ?? 8, spin: false},
      {mode: 'clay', yaw: profile + 45, elev: 16, spin: true},
      {mode: 'color', yaw: profile + 45, elev: 16, spin: true},
      {mode: 'color', yaw: profile + 45, elev: 16, spin: true, orbit: true}
    ];
    return S[Math.max(0, Math.min(4, n))];
  }
  // force: always reset the angle (used by the curator and when switching objects).
  setStage(n, force) {
    this.stage = n;
    const S = this.stageDef(n);
    this.mode = S.mode; this.spin = S.spin; this.elev = D(S.elev);
    if (force || n < 2 || !this.spinning) this.pivot.rotation.set(0, D(S.yaw), 0);
    this.spinning = S.spin;
    this.controls.enabled = !!S.orbit;
    this.frame();
    this.apply();
  }
  // A still picture of one stage (for the curator's side-by-side views).
  snapshot(n) {
    const keep = {stage: this.stage, rot: this.pivot.rotation.y, spin: this.spin, spinning: this.spinning, orbit: this.controls.enabled, cam: this.camera.position.clone()};
    this.setStage(n, true);
    this.spin = false;
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/jpeg', 0.8);
    this.stage = keep.stage;
    const S = this.stageDef(keep.stage);
    this.mode = S.mode; this.elev = D(S.elev); this.spin = keep.spin; this.spinning = keep.spinning;
    this.controls.enabled = keep.orbit;
    this.pivot.rotation.y = keep.rot;
    this.frame();
    if (keep.orbit) this.camera.position.copy(keep.cam);
    this.apply();
    return url;
  }
}
