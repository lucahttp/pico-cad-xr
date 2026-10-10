import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import { CSGEngine } from './csgEngine.js';
import { SpatialUI } from './spatialUI.js';
import { XRManager } from './xrManager.js';

class PicoCadApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
    this.camera.position.set(0, 1.2, 1.4);

    // High performance WebGL renderer with alpha support for Passthrough
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Studio background for desktop
    this.scene.background = new THREE.Color(0x070b14);

    // OrbitControls for desktop/emulator
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.mouseRaycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.spawnAsHole = false;
    this.gridSnapMm = 25;

    this._setupLighting();
    this._setupWorkplane();

    // Core Systems
    this.csgEngine = new CSGEngine(this.scene);

    // Selection visual box
    this.selectionBox = new THREE.BoxHelper(new THREE.Mesh(), 0x38bdf8);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    // Spatial UI (floating 3D panel in MR)
    this.spatialUI = new SpatialUI(this.scene, {
      addPrimitive: (type) => this.addPrimitive(type),
      toggleHole: () => this.toggleHole(),
      scaleSelected: (factor) => this.scaleSelected(factor),
      rotateSelected: (rx, ry, rz) => this.rotateSelected(rx, ry, rz),
      dropToWorkplane: () => this.dropSelectedToWorkplane(),
      group: () => this.group(),
      intersect: () => this.intersect(),
      duplicate: () => this.duplicate(),
      delete: () => this.deleteSelected(),
      exportSTL: () => this.exportSTL(),
      exportGLTF: () => this.exportGLTF(),
      clear: () => this.clearAll(),
      setColor: (hex) => this.setSelectedColor(hex),
      setMaterialStyle: (style) => this.setSelectedMaterialStyle(style),
      toggleGridSnap: (enabled) => this.setGridSnapEnabled(enabled),
      resetScale: () => this.resetSelectedScale()
    });

    // WebXR Manager (PICO Passthrough & Controllers)
    this.xrManager = new XRManager(
      this.renderer,
      this.scene,
      this.camera,
      this.csgEngine,
      this.spatialUI
    );

    this._setupEvents();
    this._setupInitialScene();

    // Start render loop
    this.renderer.setAnimationLoop(() => this._render());
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2, 4, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.0001;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    fillLight.position.set(-2, 2, -2);
    this.scene.add(fillLight);
  }

  _setupWorkplane() {
    // Holographic Workplane Grid (SketchForge / Tinkercad style)
    const gridSize = 1.0; // 1m x 1m table surface
    const gridDivisions = 40; // 25mm subdivisions
    this.grid = new THREE.GridHelper(gridSize, gridDivisions, 0x38bdf8, 0x1e293b);
    this.grid.position.y = 0.001;
    this.scene.add(this.grid);

    const planeGeom = new THREE.PlaneGeometry(gridSize, gridSize);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.25 });
    this.shadowPlane = new THREE.Mesh(planeGeom, planeMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);
  }

  _setupInitialScene() {
    // Place initial cube at center so user immediately has an object to manipulate
    const initBox = this.csgEngine.createPrimitive('box', new THREE.Vector3(0, 0.1, 0));
    this.selectObject(initBox);
  }

  addPrimitive(type) {
    const offset = (Math.random() - 0.5) * 0.2;
    const pos = new THREE.Vector3(offset, 0.15, offset);
    const obj = this.csgEngine.createPrimitive(type, pos, this.spawnAsHole);
    this.selectObject(obj);
    return obj;
  }

  toggleHole() {
    const selected = Array.from(this.csgEngine.selectedObjects);
    if (selected.length > 0) {
      selected.forEach(obj => this.csgEngine.toggleHole(obj));
      this._updateSelectionHelper();
      this._syncInspector(selected[0]);
    }
  }

  scaleSelected(factor = 1.1) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      selected.scale.multiplyScalar(factor);
      selected.scale.clampScalar(0.08, 4.0);
      selected.updateMatrixWorld(true);
      this._updateSelectionHelper();
      this._syncInspector(selected);
    }
  }

  resetSelectedScale() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      selected.scale.set(1, 1, 1);
      selected.updateMatrixWorld(true);
      this._updateSelectionHelper();
      this._syncInspector(selected);
    }
  }

  rotateSelected(rx = 0, ry = Math.PI / 2, rz = 0) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      selected.rotation.x += rx;
      selected.rotation.y += ry;
      selected.rotation.z += rz;
      selected.updateMatrixWorld(true);
      this._updateSelectionHelper();
    }
  }

  dropSelectedToWorkplane() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.dropToWorkplane(selected);
      this._updateSelectionHelper();
    }
  }

  setSelectedDimensions(wMm, hMm, dMm) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.setObjectDimensions(selected, {
        width: wMm / 1000,
        height: hMm / 1000,
        depth: dMm / 1000
      });
      this._updateSelectionHelper();
    }
  }

  setSelectedColor(hexColor) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.setColor(selected, hexColor);
      this._syncInspector(selected);
    }
  }

  setSelectedMaterialStyle(style) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.setMaterialStyle(selected, style);
      this._syncInspector(selected);
    }
  }

  setGridSnapEnabled(enabled) {
    this.gridSnapMm = enabled ? 25 : 0;
  }

  group() {
    const res = this.csgEngine.groupSelected();
    if (res) {
      this.selectObject(res);
    }
  }

  intersect() {
    const res = this.csgEngine.intersectSelected();
    if (res) {
      this.selectObject(res);
    }
  }

  duplicate() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (!selected) return;

    const dup = this.csgEngine.createPrimitive(
      selected.userData.cadType || 'box',
      selected.position.clone().add(new THREE.Vector3(0.08, 0, 0.08)),
      selected.userData.isHole,
      selected.userData.originalColor
    );
    dup.scale.copy(selected.scale);
    dup.quaternion.copy(selected.quaternion);
    this.selectObject(dup);
  }

  deleteSelected() {
    const selected = Array.from(this.csgEngine.selectedObjects);
    selected.forEach(obj => this.csgEngine.removeObject(obj));
    this.selectObject(null);
  }

  clearAll() {
    this.csgEngine.clearAll();
    this.selectObject(null);
  }

  selectObject(obj) {
    this.csgEngine.selectedObjects.clear();
    if (obj) {
      this.csgEngine.selectedObjects.add(obj);
    }
    this._updateSelectionHelper();
    this._syncInspector(obj);
  }

  _updateSelectionHelper() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.selectionBox.setFromObject(selected);
      this.selectionBox.visible = true;
    } else {
      this.selectionBox.visible = false;
    }
  }

  _syncInspector(obj) {
    const content = document.getElementById('inspector-content');
    const empty = document.getElementById('inspector-empty');
    if (!content || !empty) return;

    if (!obj) {
      content.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    content.style.display = 'flex';
    empty.style.display = 'none';

    // Type and ID
    const typeElem = document.getElementById('inspect-type');
    const badgeElem = document.getElementById('inspect-badge');
    const idElem = document.getElementById('inspect-id');

    const typeNames = {
      box: 'Cubo',
      cylinder: 'Cilindro',
      sphere: 'Esfera',
      cone: 'Cono',
      wedge: 'Cuña',
      pyramid: 'Pirámide',
      torus: 'Torus',
      roof: 'Techo',
      composite: 'Compuesto CSG',
      intersection: 'Intersección CSG'
    };

    const typeStr = typeNames[obj.userData?.cadType] || 'Objeto 3D';
    if (typeElem) typeElem.innerText = typeStr;
    if (idElem) idElem.innerText = obj.userData?.id || '';

    if (badgeElem) {
      if (obj.userData?.isHole) {
        badgeElem.innerText = 'Hueco';
        badgeElem.className = 'badge-hole';
      } else {
        badgeElem.innerText = 'Sólido';
        badgeElem.className = 'badge-solid';
      }
    }

    // Dimensions
    const dims = this.csgEngine.getObjectDimensions(obj);
    const wInput = document.getElementById('dim-width');
    const hInput = document.getElementById('dim-height');
    const dInput = document.getElementById('dim-depth');

    if (wInput) wInput.value = dims.width;
    if (hInput) hInput.value = dims.height;
    if (dInput) dInput.value = dims.depth;

    // Active color swatch
    const curColor = obj.userData?.originalColor ? ('#' + new THREE.Color(obj.userData.originalColor).getHexString()) : '#2563eb';
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      const c = swatch.dataset.color.toLowerCase();
      swatch.classList.toggle('active', c === curColor.toLowerCase());
    });

    // Material finish
    const curFinish = obj.userData?.materialStyle || 'basic';
    document.querySelectorAll('.btn-finish').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === curFinish);
    });
  }

  exportSTL() {
    const exporter = new STLExporter();
    const solids = this.csgEngine.objects.filter(o => !o.userData.isHole);
    if (solids.length === 0) {
      alert('No hay sólidos para exportar a STL.');
      return;
    }

    const exportGroup = new THREE.Group();
    solids.forEach(s => exportGroup.add(s.clone()));

    const stlData = exporter.parse(exportGroup, { binary: true });
    const blob = new Blob([stlData], { type: 'application/octet-stream' });
    this._downloadBlob(blob, 'pico_cad_design.stl');
  }

  exportGLTF() {
    const exporter = new GLTFExporter();
    const exportGroup = new THREE.Group();
    this.csgEngine.objects.forEach(s => exportGroup.add(s.clone()));

    exporter.parse(
      exportGroup,
      (gltf) => {
        const blob = new Blob([JSON.stringify(gltf, null, 2)], { type: 'application/json' });
        this._downloadBlob(blob, 'pico_cad_design.gltf');
      },
      (error) => console.error('Error glTF:', error),
      { binary: false }
    );
  }

  _downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  _setupEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 2D Mouse selection
    window.addEventListener('pointerdown', (e) => {
      if (this.renderer.xr.isPresenting) return;
      if (e.target.closest('.glass-panel')) return; // ignore UI clicks

      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.mouseRaycaster.setFromCamera(this.mouse, this.camera);

      const hits = this.mouseRaycaster.intersectObjects(this.csgEngine.objects, true);
      if (hits.length > 0) {
        let hit = hits[0].object;
        while (hit && !hit.userData.isCadObject && hit.parent) {
          hit = hit.parent;
        }
        if (hit && hit.userData.isCadObject) {
          this.selectObject(hit);
        }
      } else {
        this.selectObject(null);
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelected();
      } else if (e.key === 'h' || e.key === 'H') {
        this.toggleHole();
      } else if (e.key === 'g' || e.key === 'G') {
        this.group();
      } else if (e.key === 'd' || e.key === 'D') {
        this.dropSelectedToWorkplane();
      } else if (e.key === '+' || e.key === '=') {
        this.scaleSelected(1.1);
      } else if (e.key === '-' || e.key === '_') {
        this.scaleSelected(0.9);
      }
    });

    // Top Header Buttons
    document.getElementById('btn-group')?.addEventListener('click', () => this.group());
    document.getElementById('btn-intersect')?.addEventListener('click', () => this.intersect());
    document.getElementById('btn-toggle-hole')?.addEventListener('click', () => this.toggleHole());
    document.getElementById('btn-drop')?.addEventListener('click', () => this.dropSelectedToWorkplane());
    document.getElementById('btn-export-stl')?.addEventListener('click', () => this.exportSTL());
    document.getElementById('btn-export-gltf')?.addEventListener('click', () => this.exportGLTF());
    document.getElementById('btn-clear-scene')?.addEventListener('click', () => this.clearAll());

    // Grid snap selector
    document.getElementById('select-grid-snap')?.addEventListener('change', (e) => {
      this.gridSnapMm = parseInt(e.target.value, 10);
    });

    // Spawn preference toggle (Solid vs Hole)
    const prefSolid = document.getElementById('pref-solid');
    const prefHole = document.getElementById('pref-hole');
    prefSolid?.addEventListener('click', () => {
      this.spawnAsHole = false;
      prefSolid.classList.add('active');
      prefHole?.classList.remove('active');
    });
    prefHole?.addEventListener('click', () => {
      this.spawnAsHole = true;
      prefHole.classList.add('active');
      prefSolid?.classList.remove('active');
    });

    // Shape catalog cards
    document.querySelectorAll('.shape-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const prim = e.currentTarget.dataset.primitive;
        if (prim) this.addPrimitive(prim);
      });
    });

    // Shape Inspector dimension inputs & steppers
    const updateDimsFromInputs = () => {
      const w = parseFloat(document.getElementById('dim-width')?.value || 200);
      const h = parseFloat(document.getElementById('dim-height')?.value || 200);
      const d = parseFloat(document.getElementById('dim-depth')?.value || 200);
      this.setSelectedDimensions(w, h, d);
    };

    ['dim-width', 'dim-height', 'dim-depth'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updateDimsFromInputs);
    });

    document.querySelectorAll('.btn-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const axis = e.currentTarget.dataset.axis;
        const dir = parseInt(e.currentTarget.dataset.dir, 10);
        const inputId = axis === 'x' ? 'dim-width' : axis === 'y' ? 'dim-height' : 'dim-depth';
        const input = document.getElementById(inputId);
        if (input) {
          input.value = Math.max(10, parseInt(input.value || 200, 10) + dir * 10);
          updateDimsFromInputs();
        }
      });
    });

    // Quick scale buttons in inspector
    document.querySelectorAll('.btn-quick-scale').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const factor = parseFloat(e.currentTarget.dataset.scale);
        if (factor) this.scaleSelected(factor);
      });
    });

    document.getElementById('btn-scale-reset')?.addEventListener('click', () => {
      this.resetSelectedScale();
    });

    // Color Swatches
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', (e) => {
        const color = e.currentTarget.dataset.color;
        if (color) this.setSelectedColor(color);
      });
    });

    // Material Finishes
    document.querySelectorAll('.btn-finish').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const style = e.currentTarget.dataset.style;
        if (style) this.setSelectedMaterialStyle(style);
      });
    });

    // Inspector Action Buttons
    document.getElementById('inspect-drop')?.addEventListener('click', () => this.dropSelectedToWorkplane());
    document.getElementById('inspect-rotate')?.addEventListener('click', () => this.rotateSelected(0, Math.PI / 2, 0));
    document.getElementById('inspect-duplicate')?.addEventListener('click', () => this.duplicate());
    document.getElementById('inspect-delete')?.addEventListener('click', () => this.deleteSelected());

    // Enter MR Button
    const enterMrBtn = document.getElementById('btn-enter-xr');
    if (enterMrBtn) {
      enterMrBtn.addEventListener('click', async () => {
        try {
          await this.xrManager.startSession(
            (isAr) => {
              enterMrBtn.innerText = 'Salir de MR';
              document.body.classList.add('in-xr');
              if (isAr) {
                this.scene.background = null;
                this.shadowPlane.visible = false;
              }
            },
            () => {
              enterMrBtn.innerText = 'Entrar a MR';
              document.body.classList.remove('in-xr');
              this.scene.background = new THREE.Color(0x070b14);
              this.shadowPlane.visible = true;
            }
          );
        } catch (err) {
          alert('Error iniciando sesión WebXR: ' + err.message);
        }
      });
    }
  }

  _render() {
    if (!this.renderer.xr.isPresenting) {
      this.controls.update();
    } else {
      this.xrManager.update();
    }

    if (this.selectionBox.visible) {
      this.selectionBox.update();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Bootstrap application on load
window.addEventListener('DOMContentLoaded', () => {
  new PicoCadApp();
});
