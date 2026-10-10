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

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyG':
          this.group();
          break;
        case 'KeyH':
          this.toggleHole();
          break;
        case 'KeyD':
          this.duplicate();
          break;
        case 'Delete':
        case 'Backspace':
          this.deleteSelected();
          break;
      }
    });

    // 2D UI Button bindings
    document.getElementById('tool-box').onclick = () => this.addPrimitive('box');
    document.getElementById('tool-cyl').onclick = () => this.addPrimitive('cylinder');
    document.getElementById('tool-sphere').onclick = () => this.addPrimitive('sphere');
    document.getElementById('tool-cone').onclick = () => this.addPrimitive('cone');
    document.getElementById('tool-wedge').onclick = () => this.addPrimitive('wedge');
    document.getElementById('tool-torus').onclick = () => this.addPrimitive('torus');

    document.getElementById('tool-toggle-hole').onclick = () => this.toggleHole();
    document.getElementById('tool-group').onclick = () => this.group();
    document.getElementById('tool-duplicate').onclick = () => this.duplicate();
    document.getElementById('tool-delete').onclick = () => this.deleteSelected();
    document.getElementById('tool-export-stl').onclick = () => this.exportSTL();
    document.getElementById('tool-export-gltf').onclick = () => this.exportGLTF();
    document.getElementById('tool-clear').onclick = () => this.clearAll();

    // WebXR / Passthrough Button
    const xrBtn = document.getElementById('btn-enter-xr');
    xrBtn.onclick = async () => {
      try {
        await this.xrManager.startSession(
          (isAr) => {
            // When entering XR:
            document.querySelector('.ui-overlay').style.display = 'none';
            this.controls.enabled = false;

            if (isAr) {
              // PICO Passthrough mode: transparent background so real world cameras show through!
              this.scene.background = null;
              this.renderer.setClearColor(0x000000, 0);
            }
          },
          () => {
            // When exiting XR:
            document.querySelector('.ui-overlay').style.display = 'flex';
            this.controls.enabled = true;
            this.scene.background = new THREE.Color(0x0a0f1d);
          }
        );
      } catch (err) {
        console.error('Error al iniciar WebXR:', err);
        alert('WebXR no pudo iniciar: ' + err.message + '\n\nEn desktop use la extensión "Immersive Web Emulator". En PICO, abra esta URL bajo HTTPS en el Pico Browser.');
      }
    };
  }

  _render() {
    if (this.renderer.xr.isPresenting) {
      this.xrManager.update();
    } else {
      this.controls.update();
    }

    this._updateSelectionHelper();
    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('[pico-cad-xr] canvas + WebGL OK, v1.0.0');
  new PicoCadApp();
});
