import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { SmartPlacement } from './smartPlacement.js';

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

    // Interaction state
    this.grabbedObject = null;
    this.grabbingController = null;
    this.grabOffset = new THREE.Vector3();
    this.grabDistance = 1.0;
    this.grabRotationOffset = new THREE.Quaternion();

    // Smart Placement & Workplane system
    this.smartPlacement = new SmartPlacement(0.025, 0.0);
    this.lastHapticTime = 0;
    this.lastSnappedTarget = null;

    // Affordance Ring & Visual Transform Gizmo
    this._createAffordanceGizmo();
    this._createDimensionHUD();

    this.isArSession = false;
    this._initXR();
  }

  _createAffordanceGizmo() {
    this.affordanceGizmo = new THREE.Group();
    this.affordanceGizmo.name = 'affordance_gizmo';
    this.affordanceGizmo.visible = false;

    // Outer cyan ring
    const ringGeom = new THREE.RingGeometry(0.14, 0.155, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    this.affordanceGizmo.add(ringMesh);

    // Inner dashed indicator
    const innerRingGeom = new THREE.RingGeometry(0.09, 0.095, 24);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55
    });
    const innerMesh = new THREE.Mesh(innerRingGeom, innerMat);
    innerMesh.rotation.x = -Math.PI / 2;
    this.affordanceGizmo.add(innerMesh);

    // Label badge canvas (Thumbstick cues)
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    this.affordanceCanvas = canvas;
    this.affordanceCtx = canvas.getContext('2d');
    this._updateAffordanceBadgeText('↑↓ Profundidad  |  ⤡ Escala');

    this.affordanceTexture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: this.affordanceTexture, transparent: true });
    this.affordanceBadge = new THREE.Sprite(spriteMat);
    this.affordanceBadge.scale.set(0.38, 0.095, 1);
    this.affordanceBadge.position.set(0, 0.18, 0);
    this.affordanceGizmo.add(this.affordanceBadge);

    this.scene.add(this.affordanceGizmo);
  }

  _updateAffordanceBadgeText(text) {
    const ctx = this.affordanceCtx;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 112, 24);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
  }

  _createDimensionHUD() {
    // 3D Dimension readout inspired by SketchForge's MoveDimensionOverlay
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    this.dimCanvas = canvas;
    this.dimCtx = canvas.getContext('2d');

    this.dimTexture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: this.dimTexture, transparent: true });
    this.dimHUD = new THREE.Sprite(mat);
    this.dimHUD.scale.set(0.32, 0.08, 1);
    this.dimHUD.visible = false;
    this.scene.add(this.dimHUD);
  }

  _updateDimensionHUD(object) {
    if (!object) {
      this.dimHUD.visible = false;
      return;
    }

    const dims = this.csgEngine.getObjectDimensions(object);
    const type = object.userData.cadType || 'Objeto';
    const text = `${dims.width} × ${dims.depth} × ${dims.height} mm`;

    const ctx = this.dimCtx;
    ctx.clearRect(0, 0, 512, 128);

    // Dark sleek pill badge
    ctx.fillStyle = 'rgba(3, 105, 161, 0.9)';
    ctx.beginPath();
    ctx.roundRect(12, 12, 488, 104, 28);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    // Text
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 52);

    ctx.fillStyle = '#bae6fd';
    ctx.font = '22px sans-serif';
    ctx.fillText(type.toUpperCase() + (object.userData.isHole ? ' (HUECO)' : ''), 256, 92);

    this.dimTexture.needsUpdate = true;

    // Position above object
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    this.dimHUD.position.set(object.position.x, box.max.y + 0.12, object.position.z);
    this.dimHUD.visible = true;
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
        opacity: 0.65
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
    if (now - this.lastHapticTime < 140) return;
    this.lastHapticTime = now;

    const inputSource = controller.userData?.inputSource;
    if (inputSource && inputSource.gamepad && inputSource.gamepad.hapticActuators && inputSource.gamepad.hapticActuators[0]) {
      inputSource.gamepad.hapticActuators[0].pulse(intensity, durationMs).catch(() => {});
    }
  }

  _getIntersections(controller, objects) {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
    return this.raycaster.intersectObjects(objects, true);
  }

  _onSelectStart(controller) {
    // 1. Check Spatial UI interaction first
    const uiHits = this._getIntersections(controller, this.spatialUI.buttons);
    const hitBtn = this.spatialUI.handleRayIntersection(uiHits);
    if (hitBtn) {
      this.triggerHaptic(controller, 0.35, 18);
      this.spatialUI.triggerButton(hitBtn);
      return;
    }

    // 2. Check CAD Objects interaction
    const cadHits = this._getIntersections(controller, this.csgEngine.objects);
    if (cadHits.length > 0) {
      let hitMesh = cadHits[0].object;
      while (hitMesh && !hitMesh.userData.isCadObject && hitMesh.parent) {
        hitMesh = hitMesh.parent;
      }

      if (hitMesh && hitMesh.userData.isCadObject) {
        this.grabbedObject = hitMesh;
        this.grabbingController = controller;

        this.csgEngine.selectedObjects.clear();
        this.csgEngine.selectedObjects.add(hitMesh);

        const hitDistance = cadHits[0].distance;
        this.grabDistance = Math.max(0.2, hitDistance);

        const invControllerRot = controller.quaternion.clone().invert();
        this.grabRotationOffset.copy(invControllerRot.multiply(hitMesh.quaternion));

        // Show affordance ring & dimensions
        this.affordanceGizmo.visible = true;
        this.affordanceGizmo.position.copy(hitMesh.position);
        this._updateDimensionHUD(hitMesh);

        this.triggerHaptic(controller, 0.5, 25);
      }
    }
  }

  _onSelectEnd(controller) {
    if (this.grabbingController === controller) {
      if (this.grabbedObject) {
        const { halfY } = this.smartPlacement.getObjectDimensions(this.grabbedObject);
        this.smartPlacement.applyTableSnap(this.grabbedObject.position, halfY);
        this.grabbedObject.updateMatrixWorld(true);
        this._updateDimensionHUD(this.grabbedObject);
      }

      this.grabbedObject = null;
      this.grabbingController = null;
      this.affordanceGizmo.visible = false;
      this.lastSnappedTarget = null;
    }
  }

  _onSqueezeStart(controller) {
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.toggleHole(selected);
      this._updateDimensionHUD(selected);
      this.triggerHaptic(controller, 0.6, 30);
    }
  }

  _onSqueezeEnd(controller) {}

  update() {
    for (const controller of this.controllers) {
      const laser = controller.getObjectByName('laser');
      const reticle = controller.getObjectByName('reticle');

      if (this.grabbedObject && this.grabbingController === controller) {
        // Read Thumbstick axes
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
            this._updateDimensionHUD(this.grabbedObject);
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

        // Update Affordance Gizmo & Dimension HUD
        this.affordanceGizmo.position.copy(this.grabbedObject.position);
        this.affordanceGizmo.position.y += 0.005;
        this.affordanceBadge.lookAt(this.camera.position);

        this._updateDimensionHUD(this.grabbedObject);

        if (laser) laser.scale.z = this.grabDistance / 3;
        if (reticle) reticle.position.z = -this.grabDistance;
      } else {
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

  async startSession(onSessionStarted, onSessionEnded) {
    if (!navigator.xr) {
      throw new Error('WebXR no está disponible en este navegador.');
    }

    const isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
    const sessionMode = isArSupported ? 'immersive-ar' : 'immersive-vr';

    const sessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'hit-test', 'bounded-floor']
    };

    const session = await navigator.xr.requestSession(sessionMode, sessionInit);
    this.isArSession = isArSupported;

    await this.renderer.xr.setSession(session);

    session.addEventListener('end', () => {
      this.isArSession = false;
      this.dimHUD.visible = false;
      if (onSessionEnded) onSessionEnded();
    });

    if (onSessionStarted) onSessionStarted(this.isArSession);
  }
}
