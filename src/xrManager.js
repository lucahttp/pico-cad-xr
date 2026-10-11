import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { SmartPlacement } from './smartPlacement.js';
import { HandleGizmo } from './handleGizmo.js';

export class XRManager {
  constructor(renderer, scene, camera, csgEngine, spatialUI) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.csgEngine = csgEngine;
    this.spatialUI = spatialUI;

    this.controllers = [];
    this.controllerGrips = [];
    this.raycaster = new THREE.Raycaster();
    this.tempMatrix = new THREE.Matrix4();

    // Interaction state: Object movement
    this.grabbedObject = null;
    this.grabbingController = null;
    this.grabOffset = new THREE.Vector3();
    this.grabDistance = 1.0;
    this.grabRotationOffset = new THREE.Quaternion();

    // Interaction state: 3D Handle Gizmo (Push-Pull modification)
    this.handleGizmo = new HandleGizmo(this.scene);
    this.isDraggingGizmoHandle = false;
    this.draggingController = null;
    this.hoveredHandle = null;

    // Smart Placement & Workplane system
    this.smartPlacement = new SmartPlacement(0.025, 0.0);
    this.lastHapticTime = 0;
    this.lastSnappedTarget = null;

    // Visual Gizmos & Overlays
    this._createAffordanceGizmo();
    this._createDimensionHUD();
    this._createObjectContextBar();

    this.dimFadeTimer = null;
    this.isArSession = false;
    this._initXR();
  }

  _createAffordanceGizmo() {
    this.affordanceGizmo = new THREE.Group();
    this.affordanceGizmo.name = 'affordance_gizmo';
    this.affordanceGizmo.visible = false;

    // Clean Holographic Ground Ring (No bulky text banners!)
    const outerRingGeom = new THREE.RingGeometry(0.14, 0.155, 36);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const outerRing = new THREE.Mesh(outerRingGeom, outerRingMat);
    outerRing.rotation.x = -Math.PI / 2;
    this.affordanceGizmo.add(outerRing);

    // Inner dashed indicator ring
    const innerRingGeom = new THREE.RingGeometry(0.085, 0.092, 28);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const innerRing = new THREE.Mesh(innerRingGeom, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    this.affordanceGizmo.add(innerRing);

    this.scene.add(this.affordanceGizmo);
  }

  _createDimensionHUD() {
    // Sleek glassmorphic dimension readout
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    this.dimCanvas = canvas;
    this.dimCtx = canvas.getContext('2d');

    this.dimTexture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: this.dimTexture, transparent: true, opacity: 0.95 });
    this.dimHUD = new THREE.Sprite(mat);
    this.dimHUD.scale.set(0.32, 0.08, 1);
    this.dimHUD.visible = false;
    this.scene.add(this.dimHUD);
  }

  _scheduleDimensionHUDFade() {
    if (this.dimFadeTimer) clearTimeout(this.dimFadeTimer);
    this.dimFadeTimer = setTimeout(() => {
      if (!this.grabbedObject && !this.isDraggingGizmoHandle) {
        this.dimHUD.visible = false;
      }
    }, 1800);
  }

  _updateDimensionHUD(object, activeAxis = null, activeValMm = null) {
    if (!object) {
      this.dimHUD.visible = false;
      return;
    }

    if (this.dimFadeTimer) clearTimeout(this.dimFadeTimer);

    const dims = this.csgEngine.getObjectDimensions(object);
    const type = (object.userData.cadType || 'Objeto').toUpperCase();
    const isHole = object.userData.isHole;

    const ctx = this.dimCtx;
    ctx.clearRect(0, 0, 512, 128);

    // Dark Glass Pill Badge
    ctx.fillStyle = 'rgba(7, 11, 20, 0.92)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 112, 24);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = activeAxis ? '#10b981' : '#38bdf8';
    ctx.stroke();

    // Top Header line
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 20px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${type}  ●  ${isHole ? 'CORTE HUECO' : 'SÓLIDO'}`, 256, 34);

    // Main dimension value
    if (activeAxis && activeValMm) {
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 36px monospace';
      ctx.fillText(`${activeAxis.toUpperCase()}: ${activeValMm} mm`, 256, 68);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '20px monospace';
      ctx.fillText(`(${dims.width} × ${dims.depth} × ${dims.height} mm)`, 256, 98);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 34px monospace';
      ctx.fillText(`${dims.width} × ${dims.depth} × ${dims.height} mm`, 256, 78);
    }

    this.dimTexture.needsUpdate = true;

    // Position above object
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    this.dimHUD.position.set(object.position.x, box.max.y + 0.14, object.position.z);
    this.dimHUD.visible = true;
  }

  _createObjectContextBar() {
    // Quick Context Toolbar floating directly above selected object
    this.contextBar = new THREE.Group();
    this.contextBar.name = 'object_context_bar';
    this.contextBar.visible = false;
    this.contextButtons = [];

    const actions = [
      { id: 'hole', label: '🕳️ Hueco', bg: '#334155', border: '#94a3b8', fn: () => this._contextToggleHole() },
      { id: 'drop', label: '⬇️ Mesa', bg: '#0369a1', border: '#38bdf8', fn: () => this._contextDropToTable() },
      { id: 'rot', label: '🔄 90°', bg: '#1e293b', border: '#64748b', fn: () => this._contextRotate90() },
      { id: 'dup', label: '📋 Clonar', bg: '#065f46', border: '#10b981', fn: () => this._contextDuplicate() },
      { id: 'del', label: '🗑️ Borrar', bg: '#7f1d1d', border: '#ef4444', fn: () => this._contextDelete() }
    ];

    const btnW = 0.065;
    const btnH = 0.034;
    const spacing = 0.07;
    const startX = -((actions.length - 1) * spacing) / 2;

    actions.forEach((act, idx) => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = act.bg;
      ctx.beginPath();
      ctx.roundRect(8, 8, 240, 112, 24);
      ctx.fill();

      ctx.lineWidth = 6;
      ctx.strokeStyle = act.border;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(act.label, 128, 64);

      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.2,
        metalness: 0.3
      });

      const geom = new THREE.BoxGeometry(btnW, btnH, 0.008);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(startX + idx * spacing, 0, 0);

      // Invisible generous hit target (35mm radius)
      const hitGeom = new THREE.SphereGeometry(0.036, 12, 12);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitMesh = new THREE.Mesh(hitGeom, hitMat);
      hitMesh.userData = {
        isContextButton: true,
        action: act.fn,
        visualMesh: mesh
      };
      mesh.add(hitMesh);

      this.contextBar.add(mesh);
      this.contextButtons.push(hitMesh);
    });

    this.scene.add(this.contextBar);
  }

  _updateContextBar(object) {
    if (!object) {
      this.contextBar.visible = false;
      return;
    }

    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    this.contextBar.position.set(object.position.x, box.max.y + 0.065, object.position.z);
    this.contextBar.quaternion.copy(this.camera.quaternion); // Always faces user comfortably
    this.contextBar.visible = true;
  }

  _contextToggleHole() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.toggleHole(selected);
      this.handleGizmo.update();
      this._updateDimensionHUD(selected);
      this._updateContextBar(selected);
    }
  }

  _contextDropToTable() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.dropToWorkplane(selected);
      selected.updateMatrixWorld(true);
      this.handleGizmo.update();
      this._updateDimensionHUD(selected);
      this._updateContextBar(selected);
    }
  }

  _contextRotate90() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      selected.rotation.y += Math.PI / 2;
      selected.updateMatrixWorld(true);
      this.handleGizmo.update();
      this._updateContextBar(selected);
    }
  }

  _contextDuplicate() {
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
    this._selectObject(dup);
  }

  _contextDelete() {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.removeObject(selected);
      this._deselectAll();
    }
  }

  _selectObject(obj) {
    this.csgEngine.selectedObjects.clear();
    if (obj) {
      this.csgEngine.selectedObjects.add(obj);
      this.handleGizmo.attach(obj);
      this._updateDimensionHUD(obj);
      this._updateContextBar(obj);
    } else {
      this._deselectAll();
    }
  }

  _deselectAll() {
    this.csgEngine.selectedObjects.clear();
    this.handleGizmo.detach();
    this.contextBar.visible = false;
    this.affordanceGizmo.visible = false;
    this._scheduleDimensionHUDFade();
  }

  _initXR() {
    this.renderer.xr.enabled = true;
    const controllerModelFactory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.userData.id = i;
      this.scene.add(controller);
      this.controllers.push(controller);

      controller.addEventListener('connected', (event) => {
        controller.userData.inputSource = event.data;
      });
      controller.addEventListener('disconnected', () => {
        controller.userData.inputSource = null;
      });

      // Visual Laser Pointer
      const laserGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -3)
      ]);
      const laserMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.75
      });
      const laser = new THREE.Line(laserGeom, laserMat);
      laser.name = 'laser';
      controller.add(laser);

      // Reticle point
      const dotGeom = new THREE.SphereGeometry(0.008, 16, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const dot = new THREE.Mesh(dotGeom, dotMat);
      dot.position.set(0, 0, -3);
      dot.name = 'reticle';
      controller.add(dot);

      // Controller Grip Model
      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(controllerModelFactory.createControllerModel(grip));
      this.scene.add(grip);
      this.controllerGrips.push(grip);

      // Event listeners for Trigger & Grip
      controller.addEventListener('selectstart', (e) => this._onSelectStart(e.target));
      controller.addEventListener('selectend', (e) => this._onSelectEnd(e.target));
      controller.addEventListener('squeezestart', (e) => this._onSqueezeStart(e.target));
      controller.addEventListener('squeezeend', (e) => this._onSqueezeEnd(e.target));
    }
  }

  triggerHaptic(controller, intensity = 0.4, durationMs = 20) {
    const now = performance.now();
    if (now - this.lastHapticTime < 90) return;
    this.lastHapticTime = now;

    const inputSource = controller.userData?.inputSource;
    if (inputSource && inputSource.gamepad && inputSource.gamepad.hapticActuators && inputSource.gamepad.hapticActuators[0]) {
      inputSource.gamepad.hapticActuators[0].pulse(intensity, durationMs).catch(() => {});
    }
  }

  _getIntersections(controller, objects) {
    if (!objects || objects.length === 0) return [];
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
    return this.raycaster.intersectObjects(objects, true);
  }

  _getControllerRay(controller) {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    return new THREE.Ray(
      new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld),
      new THREE.Vector3(0, 0, -1).applyMatrix4(this.tempMatrix)
    );
  }

  _onSelectStart(controller) {
    // 1. Priority A: Context Bar Buttons (Direct actions on active piece)
    if (this.contextBar.visible) {
      const barHits = this._getIntersections(controller, this.contextButtons);
      if (barHits.length > 0) {
        let hit = barHits[0].object;
        if (hit && hit.userData.isContextButton && hit.userData.action) {
          this.triggerHaptic(controller, 0.45, 20);
          hit.userData.action();
          return;
        }
      }
    }

    // 2. Priority B: Gizmo Handles (Direct 3D Face Push-Pull or Corner Scale)
    if (this.handleGizmo.group.visible) {
      const handleHits = this._getIntersections(controller, this.handleGizmo.getHandleMeshes());
      if (handleHits.length > 0) {
        let hitHandle = handleHits[0].object;
        if (hitHandle && hitHandle.userData.isGizmoHandle) {
          this.isDraggingGizmoHandle = true;
          this.draggingController = controller;
          const ray = this._getControllerRay(controller);
          this.handleGizmo.startDrag(hitHandle, ray);

          this.triggerHaptic(controller, 0.6, 25);
          this._updateDimensionHUD(this.handleGizmo.target);
          return;
        }
      }
    }

    // 3. Priority C: Spatial UI Panel Buttons
    const uiHits = this._getIntersections(controller, this.spatialUI.buttons);
    const hitBtn = this.spatialUI.handleRayIntersection(uiHits);
    if (hitBtn) {
      this.triggerHaptic(controller, 0.4, 20);
      this.spatialUI.triggerButton(hitBtn);
      return;
    }

    // 4. Priority D: CAD Objects (Selection & 6DoF Translation)
    const cadHits = this._getIntersections(controller, this.csgEngine.objects);
    if (cadHits.length > 0) {
      let hitMesh = cadHits[0].object;
      while (hitMesh && !hitMesh.userData.isCadObject && hitMesh.parent) {
        hitMesh = hitMesh.parent;
      }

      if (hitMesh && hitMesh.userData.isCadObject) {
        this.grabbedObject = hitMesh;
        this.grabbingController = controller;

        this._selectObject(hitMesh);

        const hitDistance = cadHits[0].distance;
        this.grabDistance = Math.max(0.2, hitDistance);

        const invControllerRot = controller.quaternion.clone().invert();
        this.grabRotationOffset.copy(invControllerRot.multiply(hitMesh.quaternion));

        // Show subtle ground ring
        this.affordanceGizmo.visible = true;
        this.affordanceGizmo.position.copy(hitMesh.position);
        this.affordanceGizmo.position.y = 0.002;

        this.triggerHaptic(controller, 0.5, 25);
      }
    } else {
      // Clicked on empty space: deselect
      if (!this.grabbedObject && !this.isDraggingGizmoHandle) {
        this._deselectAll();
      }
    }
  }

  _onSelectEnd(controller) {
    if (this.isDraggingGizmoHandle && this.draggingController === controller) {
      this.handleGizmo.endDrag();
      this.isDraggingGizmoHandle = false;
      this.draggingController = null;
      this.triggerHaptic(controller, 0.35, 18);
      if (this.handleGizmo.target) {
        this._updateDimensionHUD(this.handleGizmo.target);
        this._updateContextBar(this.handleGizmo.target);
      }
      this._scheduleDimensionHUDFade();
      return;
    }

    if (this.grabbingController === controller) {
      if (this.grabbedObject) {
        const { halfY } = this.smartPlacement.getObjectDimensions(this.grabbedObject);
        this.smartPlacement.applyTableSnap(this.grabbedObject.position, halfY);
        this.grabbedObject.updateMatrixWorld(true);
        this.handleGizmo.update();
        this._updateDimensionHUD(this.grabbedObject);
        this._updateContextBar(this.grabbedObject);
      }

      this.grabbedObject = null;
      this.grabbingController = null;
      this.affordanceGizmo.visible = false;
      this.lastSnappedTarget = null;
      this._scheduleDimensionHUDFade();
    }
  }

  _onSqueezeStart(controller) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this._contextToggleHole();
      this.triggerHaptic(controller, 0.6, 30);
    }
  }

  _onSqueezeEnd(controller) {}

  update() {
    for (const controller of this.controllers) {
      const laser = controller.getObjectByName('laser');
      const reticle = controller.getObjectByName('reticle');

      // State A: Dragging a 3D Handle (push-pull face or corner scale)
      if (this.isDraggingGizmoHandle && this.draggingController === controller) {
        const ray = this._getControllerRay(controller);
        const dragInfo = this.handleGizmo.updateDrag(ray, this.spatialUI.gridSnapEnabled ? 25 : 5);

        if (dragInfo && this.handleGizmo.target) {
          this._updateDimensionHUD(this.handleGizmo.target, dragInfo.axis, dragInfo.valueMm);
          this._updateContextBar(this.handleGizmo.target);
          this.triggerHaptic(controller, 0.22, 10);
        }

        if (laser) laser.scale.z = 0.5;
        if (reticle) reticle.position.z = -1.5;
        continue;
      }

      // State B: Moving an entire object in 6DoF
      if (this.grabbedObject && this.grabbingController === controller) {
        // Read Thumbstick axes for fine tuning
        const inputSource = controller.userData?.inputSource;
        if (inputSource && inputSource.gamepad && inputSource.gamepad.axes) {
          const axes = inputSource.gamepad.axes;
          const stickX = axes[2] || 0;
          const stickY = axes[3] || 0;

          // Continuous scaling with stick X
          if (Math.abs(stickX) > 0.18) {
            const scaleDelta = 1.0 + stickX * 0.015;
            this.grabbedObject.scale.multiplyScalar(scaleDelta);
            this.grabbedObject.scale.clampScalar(0.08, 4.0);
            this.handleGizmo.update();
            this._updateDimensionHUD(this.grabbedObject);
            this._updateContextBar(this.grabbedObject);
          }

          // Depth Push/Pull with stick Y
          if (Math.abs(stickY) > 0.18) {
            this.grabDistance += stickY * 0.012;
            this.grabDistance = THREE.MathUtils.clamp(this.grabDistance, 0.2, 4.0);
          }
        }

        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.quaternion);
        let targetPos = controller.position.clone().add(dir.clone().multiplyScalar(this.grabDistance));

        // Smart Placement: Surface & Face Snapping
        const candidateTargets = this.csgEngine.objects.filter(obj => obj !== this.grabbedObject);
        const surfaceHits = this._getIntersections(controller, candidateTargets);

        let didSnapToSurface = false;
        if (surfaceHits.length > 0) {
          const hit = surfaceHits[0];
          if (Math.abs(hit.distance - this.grabDistance) < 0.18) {
            const snapData = this.smartPlacement.calculateSurfaceSnap(hit, this.grabbedObject);
            if (snapData) {
              targetPos.copy(snapData.position);
              didSnapToSurface = true;

              if (this.lastSnappedTarget !== hit.object) {
                this.triggerHaptic(controller, 0.45, 18);
                this.lastSnappedTarget = hit.object;
              }
            }
          }
        }

        if (!didSnapToSurface) {
          this.lastSnappedTarget = null;
          const { halfY } = this.smartPlacement.getObjectDimensions(this.grabbedObject);
          const isTable = this.smartPlacement.applyTableSnap(targetPos, halfY);
          if (isTable) {
            targetPos.x = Math.round(targetPos.x / 0.025) * 0.025;
            targetPos.z = Math.round(targetPos.z / 0.025) * 0.025;
          }
        }

        this.grabbedObject.position.copy(targetPos);

        const targetRot = controller.quaternion.clone().multiply(this.grabRotationOffset);
        this.grabbedObject.quaternion.copy(targetRot);
        this.grabbedObject.updateMatrixWorld(true);

        // Update Affordance Ground Ring, Dimension HUD & Gizmo
        this.affordanceGizmo.position.copy(this.grabbedObject.position);
        this.affordanceGizmo.position.y = 0.002;

        this.handleGizmo.update();
        this._updateDimensionHUD(this.grabbedObject);
        this._updateContextBar(this.grabbedObject);

        if (laser) laser.scale.z = this.grabDistance / 3;
        if (reticle) reticle.position.z = -this.grabDistance;
      } else {
        // State C: Hover detection (Context Bar -> Handles -> UI -> CAD Objects)
        let hitFound = false;

        // 1. Check Context Bar hover
        if (this.contextBar.visible) {
          const barHits = this._getIntersections(controller, this.contextButtons);
          if (barHits.length > 0) {
            const d = barHits[0].distance;
            if (laser) laser.scale.z = d / 3;
            if (reticle) reticle.position.z = -d;
            hitFound = true;
          }
        }

        // 2. Check Gizmo Handles hover
        if (!hitFound && this.handleGizmo.group.visible) {
          const handleHits = this._getIntersections(controller, this.handleGizmo.getHandleMeshes());
          if (handleHits.length > 0) {
            let hitCollider = handleHits[0].object;
            if (hitCollider && hitCollider !== this.hoveredHandle) {
              if (this.hoveredHandle) this.handleGizmo.setHover(this.hoveredHandle, false);
              this.hoveredHandle = hitCollider;
              this.handleGizmo.setHover(this.hoveredHandle, true);
              this.triggerHaptic(controller, 0.2, 10);
            }
            const d = handleHits[0].distance;
            if (laser) laser.scale.z = d / 3;
            if (reticle) reticle.position.z = -d;
            hitFound = true;
          } else if (this.hoveredHandle) {
            this.handleGizmo.setHover(this.hoveredHandle, false);
            this.hoveredHandle = null;
          }
        }

        // 3. Check Spatial UI & Objects hover
        if (!hitFound) {
          const hits = this._getIntersections(controller, [
            ...this.spatialUI.buttons,
            ...this.csgEngine.objects
          ]);

          if (hits.length > 0) {
            const d = hits[0].distance;
            if (laser) laser.scale.z = d / 3;
            if (reticle) reticle.position.z = -d;
          } else {
            if (laser) laser.scale.z = 1.0;
            if (reticle) reticle.position.z = -3;
          }
        }
      }
    }
  }

  async startSession(onStart, onEnd) {
    if (!navigator.xr) {
      throw new Error('WebXR no soportado en este navegador');
    }

    const isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
    const sessionMode = isArSupported ? 'immersive-ar' : 'immersive-vr';

    const sessionInit = isArSupported
      ? {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['hand-tracking', 'hit-test']
        }
      : {
          requiredFeatures: ['local-floor']
        };

    const session = await navigator.xr.requestSession(sessionMode, sessionInit);
    this.renderer.xr.setSession(session);
    this.isArSession = isArSupported;

    if (onStart) onStart(isArSupported);

    session.addEventListener('end', () => {
      this.isArSession = false;
      if (onEnd) onEnd();
    });

    return session;
  }
}
