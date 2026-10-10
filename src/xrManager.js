import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

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

    this.isArSession = false;
    this._initXR();
  }

  _initXR() {
    this.renderer.xr.enabled = true;
    const controllerModelFactory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.userData.id = i;
      this.scene.add(controller);
      this.controllers.push(controller);

      // Visual Laser Pointer
      const laserGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -3) // 3m ray
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
      this.spatialUI.triggerButton(hitBtn);
      return;
    }

    // 2. Check CAD Objects interaction
    const cadHits = this._getIntersections(controller, this.csgEngine.objects);
    if (cadHits.length > 0) {
      let hitMesh = cadHits[0].object;
      // Navigate to top cad object if hit wireframe
      while (hitMesh && !hitMesh.userData.isCadObject && hitMesh.parent) {
        hitMesh = hitMesh.parent;
      }

      if (hitMesh && hitMesh.userData.isCadObject) {
        this.grabbedObject = hitMesh;
        this.grabbingController = controller;

        // Toggle or set selection
        this.csgEngine.selectedObjects.clear();
        this.csgEngine.selectedObjects.add(hitMesh);

        // Distance from controller to object
        const hitDistance = cadHits[0].distance;
        this.grabDistance = Math.max(0.2, hitDistance);

        // Calculate rotation offset
        const invControllerRot = controller.quaternion.clone().invert();
        this.grabRotationOffset.copy(invControllerRot.multiply(hitMesh.quaternion));
      }
    }
  }

  _onSelectEnd(controller) {
    if (this.grabbingController === controller) {
      this.grabbedObject = null;
      this.grabbingController = null;
    }
  }

  _onSqueezeStart(controller) {
    // Squeeze grip button toggles Solid vs Hole on selected object
    const selected = Array.from(this.csgEngine.selectedObjects)[0];
    if (selected) {
      this.csgEngine.toggleHole(selected);
    }
  }

  _onSqueezeEnd(controller) {}

  update() {
    // Update laser lengths and handle 6DoF dragging
    for (const controller of this.controllers) {
      const laser = controller.getObjectByName('laser');
      const reticle = controller.getObjectByName('reticle');

      if (this.grabbedObject && this.grabbingController === controller) {
        // Dragging object in 3D space
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.quaternion);
        const targetPos = controller.position.clone().add(dir.multiplyScalar(this.grabDistance));
        this.grabbedObject.position.copy(targetPos);

        // Rotate with controller
        const targetRot = controller.quaternion.clone().multiply(this.grabRotationOffset);
        this.grabbedObject.quaternion.copy(targetRot);
        this.grabbedObject.updateMatrixWorld(true);

        if (laser) laser.scale.z = this.grabDistance / 3;
        if (reticle) reticle.position.z = -this.grabDistance;
      } else {
        // Normal raycast pointer
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
    const mode = isArSupported ? 'immersive-ar' : 'immersive-vr';

    const sessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'hit-test', 'plane-detection', 'mesh-detection']
    };

    const session = await navigator.xr.requestSession(mode, sessionInit);
    this.isArSession = (mode === 'immersive-ar');

    await this.renderer.xr.setSession(session);

    session.addEventListener('end', () => {
      this.isArSession = false;
      if (onSessionEnded) onSessionEnded();
    });

    if (onSessionStarted) onSessionStarted(this.isArSession);
    return session;
  }
}
