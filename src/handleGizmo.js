import * as THREE from 'three';

export class HandleGizmo {
  constructor(scene) {
    this.scene = scene;
    this.target = null;
    this.group = new THREE.Group();
    this.group.name = 'handle_gizmo';
    this.group.visible = false;
    this.scene.add(this.group);

    this.handles = [];
    this.raycastHandles = []; // Array of collider targets for fast and forgiving ray hits
    this.activeHandle = null;
    this.hoveredHandle = null;

    this.dragStartPoint = new THREE.Vector3();
    this.initialScale = new THREE.Vector3();
    this.initialPosition = new THREE.Vector3();
    this.baseGeometrySize = new THREE.Vector3(0.2, 0.2, 0.2);

    this.dragPlane = new THREE.Plane();
    this.tempVec = new THREE.Vector3();

    this._createGizmoGeometry();
  }

  _createGizmoGeometry() {
    // 1. Sleek Neon Wireframe Bounding Box
    const wireGeom = new THREE.BufferGeometry();
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      linewidth: 2
    });
    this.wireframe = new THREE.LineSegments(wireGeom, wireMat);
    this.group.add(this.wireframe);

    // 2. 6 Face Handles (+X, -X, +Y, -Y, +Z, -Z)
    // Distinctive color-coding: X = Coral (#f43f5e), Y = Emerald (#10b981), Z = Sky (#38bdf8)
    this.faceDefinitions = [
      { axis: 'x', dir: 1, name: 'Cara +X', color: 0xf43f5e },
      { axis: 'x', dir: -1, name: 'Cara -X', color: 0xf43f5e },
      { axis: 'y', dir: 1, name: 'Cara +Y', color: 0x10b981 },
      { axis: 'y', dir: -1, name: 'Cara -Y', color: 0x10b981 },
      { axis: 'z', dir: 1, name: 'Cara +Z', color: 0x38bdf8 },
      { axis: 'z', dir: -1, name: 'Cara -Z', color: 0x38bdf8 }
    ];

    const faceHandleGeom = new THREE.SphereGeometry(0.024, 24, 24);
    const hitBoxGeom = new THREE.SphereGeometry(0.048, 12, 12); // Generous collision radius for VR laser

    this.faceDefinitions.forEach(def => {
      const handleGroup = new THREE.Group();
      handleGroup.name = `handle_${def.axis}_${def.dir}`;

      // Visual glossy gem sphere
      const mat = new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.15,
        metalness: 0.35,
        emissive: def.color,
        emissiveIntensity: 0.4
      });
      const visualMesh = new THREE.Mesh(faceHandleGeom, mat);
      visualMesh.name = 'visual';
      handleGroup.add(visualMesh);

      // Glowing orientation ring
      const haloGeom = new THREE.RingGeometry(0.028, 0.034, 32);
      const haloMat = new THREE.MeshBasicMaterial({
        color: def.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.name = 'halo';
      halo.lookAt(
        def.axis === 'x' ? def.dir : 0,
        def.axis === 'y' ? def.dir : 0,
        def.axis === 'z' ? def.dir : 0
      );
      handleGroup.add(halo);

      // Invisible generous hit target (48mm radius)
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitCollider = new THREE.Mesh(hitBoxGeom, hitMat);
      hitCollider.userData = {
        isGizmoHandle: true,
        type: 'face',
        axis: def.axis,
        dir: def.dir,
        name: def.name,
        baseColor: def.color,
        parentGroup: handleGroup,
        visualMesh: visualMesh,
        haloMesh: halo
      };
      handleGroup.add(hitCollider);

      this.group.add(handleGroup);
      this.handles.push(handleGroup);
      this.raycastHandles.push(hitCollider);
    });

    // 3. 8 Corner Handles (Proportional uniform scaling)
    const cornerGeom = new THREE.BoxGeometry(0.03, 0.03, 0.03);
    const cornerHitGeom = new THREE.SphereGeometry(0.048, 12, 12);
    const cornerMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Amber gold
      roughness: 0.2,
      metalness: 0.5,
      emissive: 0xd97706,
      emissiveIntensity: 0.45
    });

    const corners = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1],  [1, -1, 1],  [-1, 1, 1],  [1, 1, 1]
    ];

    corners.forEach(([cx, cy, cz], idx) => {
      const cornerGroup = new THREE.Group();
      cornerGroup.name = `corner_${idx}`;

      const visualMesh = new THREE.Mesh(cornerGeom, cornerMat.clone());
      visualMesh.name = 'visual';
      cornerGroup.add(visualMesh);

      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitCollider = new THREE.Mesh(cornerHitGeom, hitMat);
      hitCollider.userData = {
        isGizmoHandle: true,
        type: 'corner',
        cornerSigns: new THREE.Vector3(cx, cy, cz),
        name: `Esquina ${idx}`,
        baseColor: 0xf59e0b,
        parentGroup: cornerGroup,
        visualMesh: visualMesh
      };
      cornerGroup.add(hitCollider);

      this.group.add(cornerGroup);
      this.handles.push(cornerGroup);
      this.raycastHandles.push(hitCollider);
    });
  }

  attach(object) {
    this.target = object;
    if (!object) {
      this.group.visible = false;
      return;
    }

    if (object.geometry) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const b = object.geometry.boundingBox;
      this.baseGeometrySize.set(
        Math.max(0.001, b.max.x - b.min.x),
        Math.max(0.001, b.max.y - b.min.y),
        Math.max(0.001, b.max.z - b.min.z)
      );
    } else {
      this.baseGeometrySize.set(0.2, 0.2, 0.2);
    }

    this.group.visible = true;
    this.update();
  }

  detach() {
    this.target = null;
    this.group.visible = false;
    this.activeHandle = null;
    this.hoveredHandle = null;
  }

  update() {
    if (!this.target || !this.group.visible) return;

    this.target.updateMatrixWorld(true);
    this.group.position.copy(this.target.position);
    this.group.quaternion.copy(this.target.quaternion);

    const halfX = (this.baseGeometrySize.x * this.target.scale.x) / 2;
    const halfY = (this.baseGeometrySize.y * this.target.scale.y) / 2;
    const halfZ = (this.baseGeometrySize.z * this.target.scale.z) / 2;

    // Update 12 bounding box edges
    const p = [
      new THREE.Vector3(-halfX, -halfY, -halfZ),
      new THREE.Vector3( halfX, -halfY, -halfZ),
      new THREE.Vector3( halfX,  halfY, -halfZ),
      new THREE.Vector3(-halfX,  halfY, -halfZ),
      new THREE.Vector3(-halfX, -halfY,  halfZ),
      new THREE.Vector3( halfX, -halfY,  halfZ),
      new THREE.Vector3( halfX,  halfY,  halfZ),
      new THREE.Vector3(-halfX,  halfY,  halfZ)
    ];

    const linePoints = [
      p[0], p[1], p[1], p[2], p[2], p[3], p[3], p[0], // Back loop
      p[4], p[5], p[5], p[6], p[6], p[7], p[7], p[4], // Front loop
      p[0], p[4], p[1], p[5], p[2], p[6], p[3], p[7]  // Connecting struts
    ];
    this.wireframe.geometry.setFromPoints(linePoints);

    // Position handles
    this.handles.forEach(h => {
      const hitCollider = h.children.find(c => c.userData && c.userData.isGizmoHandle);
      if (!hitCollider) return;

      if (hitCollider.userData.type === 'face') {
        const { axis, dir } = hitCollider.userData;
        if (axis === 'x') h.position.set(dir * halfX, 0, 0);
        if (axis === 'y') h.position.set(0, dir * halfY, 0);
        if (axis === 'z') h.position.set(0, 0, dir * halfZ);
      } else if (hitCollider.userData.type === 'corner') {
        const s = hitCollider.userData.cornerSigns;
        h.position.set(s.x * halfX, s.y * halfY, s.z * halfZ);
      }
    });
  }

  setHover(handleCollider, isHovered) {
    if (!handleCollider) {
      if (this.hoveredHandle) {
        this._applyHoverStyle(this.hoveredHandle, false);
        this.hoveredHandle = null;
      }
      return;
    }

    if (this.hoveredHandle !== handleCollider) {
      if (this.hoveredHandle) this._applyHoverStyle(this.hoveredHandle, false);
      this.hoveredHandle = handleCollider;
      this._applyHoverStyle(this.hoveredHandle, true);
    }
  }

  _applyHoverStyle(collider, isHovered) {
    const visual = collider.userData?.visualMesh;
    const halo = collider.userData?.haloMesh;
    if (!visual) return;

    if (isHovered) {
      visual.scale.setScalar(1.35);
      if (visual.material) visual.material.emissiveIntensity = 0.95;
      if (halo && halo.material) {
        halo.material.opacity = 1.0;
        halo.scale.setScalar(1.2);
      }
    } else if (this.activeHandle !== collider) {
      visual.scale.setScalar(1.0);
      if (visual.material) visual.material.emissiveIntensity = 0.4;
      if (halo && halo.material) {
        halo.material.opacity = 0.65;
        halo.scale.setScalar(1.0);
      }
    }
  }

  startDrag(handleCollider, ray) {
    if (!this.target) return null;
    this.activeHandle = handleCollider;
    this.initialScale.copy(this.target.scale);
    this.initialPosition.copy(this.target.position);

    const visual = handleCollider.userData?.visualMesh;
    if (visual) {
      visual.scale.setScalar(1.5);
      if (visual.material) visual.material.emissiveIntensity = 1.0;
    }

    handleCollider.updateMatrixWorld(true);
    const handleWorldPos = new THREE.Vector3();
    handleCollider.getWorldPosition(handleWorldPos);

    const planeNormal = ray.direction.clone().negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, handleWorldPos);

    const hit = new THREE.Vector3();
    if (ray.intersectPlane(this.dragPlane, hit)) {
      this.dragStartPoint.copy(hit);
    } else {
      this.dragStartPoint.copy(handleWorldPos);
    }

    return {
      type: handleCollider.userData.type,
      axis: handleCollider.userData.axis,
      dir: handleCollider.userData.dir
    };
  }

  updateDrag(ray, snapMm = 10) {
    if (!this.activeHandle || !this.target) return null;

    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(this.dragPlane, hit)) return null;

    const deltaWorld = hit.clone().sub(this.dragStartPoint);
    const invQuat = this.target.quaternion.clone().invert();
    const deltaLocal = deltaWorld.clone().applyQuaternion(invQuat);

    const { type, axis, dir, cornerSigns } = this.activeHandle.userData;

    let didChange = false;
    let activeDimMm = 0;

    if (type === 'face') {
      const deltaOnAxis = (axis === 'x' ? deltaLocal.x : (axis === 'y' ? deltaLocal.y : deltaLocal.z)) * dir;
      const baseDim = this.baseGeometrySize[axis];
      const initialDim = this.initialScale[axis] * baseDim;

      let newDim = initialDim + deltaOnAxis;
      if (snapMm > 0) {
        const stepM = snapMm / 1000;
        newDim = Math.round(newDim / stepM) * stepM;
      }
      newDim = THREE.MathUtils.clamp(newDim, 0.02, 4.0); // 2 cm to 4 m

      const newScaleVal = newDim / baseDim;
      this.target.scale[axis] = newScaleVal;

      // Push-pull CAD: Anchor opposite face while moving active face
      const actualDeltaDim = newDim - initialDim;
      const localShift = new THREE.Vector3();
      localShift[axis] = (actualDeltaDim / 2) * dir;
      const worldShift = localShift.applyQuaternion(this.target.quaternion);

      this.target.position.copy(this.initialPosition).add(worldShift);
      didChange = true;
      activeDimMm = Math.round(newDim * 1000);
    } else if (type === 'corner') {
      const cornerDir = cornerSigns.clone().normalize();
      const proj = deltaLocal.dot(cornerDir);

      const baseAvg = (this.baseGeometrySize.x + this.baseGeometrySize.y + this.baseGeometrySize.z) / 3;
      const currentAvgDim = this.initialScale.x * baseAvg;
      let newDim = currentAvgDim + proj;
      if (snapMm > 0) {
        const stepM = snapMm / 1000;
        newDim = Math.round(newDim / stepM) * stepM;
      }
      newDim = THREE.MathUtils.clamp(newDim, 0.02, 4.0);

      const scaleFactor = newDim / currentAvgDim;
      this.target.scale.copy(this.initialScale).multiplyScalar(scaleFactor);
      this.target.scale.clampScalar(0.05, 5.0);

      didChange = true;
      activeDimMm = Math.round(newDim * 1000);
    }

    if (didChange) {
      this.target.updateMatrixWorld(true);
      this.update();
    }

    return {
      axis: axis || 'uniform',
      valueMm: activeDimMm,
      position: hit
    };
  }

  endDrag() {
    if (this.activeHandle) {
      const visual = this.activeHandle.userData?.visualMesh;
      if (visual) {
        visual.scale.setScalar(1.0);
        if (visual.material) visual.material.emissiveIntensity = 0.4;
      }
      this.activeHandle = null;
    }
  }

  getHandleMeshes() {
    return this.raycastHandles;
  }
}
