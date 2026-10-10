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
    this.scene.background = new THREE.Color(0x0a0f1d);

    // OrbitControls for desktop/emulator
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.mouseRaycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

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
      group: () => this.group(),
      duplicate: () => this.duplicate(),
      delete: () => this.deleteSelected(),
      exportSTL: () => this.exportSTL(),
      clear: () => this.clearAll()
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
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2, 4, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.0001;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.4);
    fillLight.position.set(-2, 2, -2);
    this.scene.add(fillLight);
  }

  _setupWorkplane() {
    // Holographic Workplane Grid (Tinkercad style)
    const gridSize = 1.0; // 1m x 1m table surface
    const gridDivisions = 20; // 5cm grid steps
    this.grid = new THREE.GridHelper(gridSize, gridDivisions, 0x38bdf8, 0x1e293b);
    this.grid.position.y = 0.001;
    this.scene.add(this.grid);

    // Subtle table shadow receiver (hidden in Passthrough)
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
    // Spawn primitive with slight offset on table
    const offset = (Math.random() - 0.5) * 0.2;
    const pos = new THREE.Vector3(offset, 0.2, offset);
    const obj = this.csgEngine.createPrimitive(type, pos);
    this.selectObject(obj);
    return obj;
  }

  toggleHole() {
    const selected = Array.from(this.csgEngine.selectedObjects);
    if (selected.length > 0) {
      selected.forEach(obj => this.csgEngine.toggleHole(obj));
      this._updateSelectionHelper();
    }
  }

  scaleSelected(factor = 1.2) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      selected.scale.multiplyScalar(factor);
      selected.scale.clampScalar(0.08, 4.0);
      selected.updateMatrixWorld(true);
      this._updateSelectionHelper();
    }
  }

  group() {
    const res = this.csgEngine.groupSelected();
    if (res) {
      this.selectObject(res);
    }
  }

  duplicate() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (!selected) return;

    const dup = this.csgEngine.createPrimitive(
      selected.userData.cadType || 'box',
      selected.position.clone().add(new THREE.Vector3(0.1, 0, 0.1)),
      selected.userData.isHole
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

    // 2D Mouse selection for desktop & emulator
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

    // Keyboard shortcuts for testing
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelected();
      } else if (e.key === 'h' || e.key === 'H') {
        this.toggleHole();
      } else if (e.key === 'g' || e.key === 'G') {
        this.group();
      } else if (e.key === '+' || e.key === '=') {
        this.scaleSelected(1.2);
      } else if (e.key === '-' || e.key === '_') {
        this.scaleSelected(0.8);
      }
    });

    // 2D HTML UI Bindings
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const prim = e.currentTarget.dataset.primitive;
        const action = e.currentTarget.dataset.action;
        if (prim) this.addPrimitive(prim);
        if (action === 'hole') this.toggleHole();
        if (action === 'group') this.group();
        if (action === 'duplicate') this.duplicate();
        if (action === 'delete') this.deleteSelected();
        if (action === 'export-stl') this.exportSTL();
        if (action === 'export-gltf') this.exportGLTF();
      });
    });

    // Enter MR Button
    const enterMrBtn = document.getElementById('enter-mr-btn');
    if (enterMrBtn) {
      enterMrBtn.addEventListener('click', async () => {
        try {
          await this.xrManager.startSession(
            (isAr) => {
              enterMrBtn.innerText = 'Salir de MR';
              document.body.classList.add('in-xr');
              if (isAr) {
                this.scene.background = null; // transparent for passthrough
                this.shadowPlane.visible = false;
              }
            },
            () => {
              enterMrBtn.innerText = 'Entrar a MR (Passthrough)';
              document.body.classList.remove('in-xr');
              this.scene.background = new THREE.Color(0x0a0f1d);
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
